// "Send test notification" button in Settings. Runs as the CALLING user
// (not service role) — the Supabase client is built from the caller's own
// JWT, so RLS on push_subscriptions ("own subscriptions") naturally scopes
// this to only the devices that user themselves subscribed, with no extra
// authorization check needed here.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isDeadSubscription, sendPush } from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const authz = req.headers.get('Authorization');
  if (!authz) return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401 });

  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authz } },
  });

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!subs || subs.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No subscriptions for this account — enable notifications first' }),
      { status: 400 },
    );
  }

  let sent = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    try {
      await sendPush(sub, { title: 'Baby Tracker', body: 'Test notification — if you see this, it works!' });
      sent++;
    } catch (err) {
      if (isDeadSubscription(err)) {
        await db.from('push_subscriptions').delete().eq('id', sub.id);
      }
      errors.push(err instanceof Error ? err.message : 'unknown error');
    }
  }

  return new Response(JSON.stringify({ sent, total: subs.length, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
