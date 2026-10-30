// Handles a notification action button tap (e.g. "Log wake-up", "Log 150mL
// formula") — called directly from the service worker's notificationclick
// handler (public/push-sw.js), which has NO access to the page's Supabase
// session (service workers can't read localStorage, where the session is
// normally persisted), so it can't make an ordinary authenticated request.
//
// Instead this is a "capability URL" pattern: the caller presents `logId`,
// which is the notification_log row's own id — a value that only exists
// because send-notifications (service-role) already created it for this
// exact (subscription, event) pair, is practically unguessable (a random
// uuid), and is single-use (the acted_at check below). That's the security
// boundary here, not a JWT — deliberately: see README Security model for
// the trade-off this makes.
//
// verify_jwt is OFF for this function (set at deploy time) for exactly that
// reason — the service worker has no JWT to present.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const body = await req.json().catch(() => null) as { logId?: string; action?: string } | null;
  const logId = body?.logId;
  const action = body?.action;
  if (!logId || !action) {
    return new Response(JSON.stringify({ error: 'logId and action are required' }), { status: 400 });
  }

  const { data: log, error: logErr } = await db
    .from('notification_log')
    .select('id, kind, source_id, acted_at, subscription_id')
    .eq('id', logId)
    .maybeSingle();
  if (logErr) return new Response(JSON.stringify({ error: logErr.message }), { status: 500 });
  if (!log) return new Response(JSON.stringify({ error: 'Unknown notification' }), { status: 404 });
  if (log.acted_at) return new Response(JSON.stringify({ error: 'Already actioned' }), { status: 409 });

  const { data: sub } = await db.from('push_subscriptions').select('child_id').eq('id', log.subscription_id).maybeSingle();
  const childId = sub?.child_id as string | undefined;
  if (!childId) return new Response(JSON.stringify({ error: 'Subscription/child not found' }), { status: 404 });

  let result: Record<string, unknown> = { ok: true };

  if (action === 'log_wakeup' && log.kind === 'sleep_running') {
    // .is('end_ts', null) makes this a no-op (not a duplicate/error) if the
    // sleep was already ended some other way before this button was tapped.
    const { error } = await db.from('sleeps')
      .update({ end_ts: new Date().toISOString() })
      .eq('id', log.source_id)
      .is('end_ts', null);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  } else if (action === 'log_feed' && (log.kind === 'feed_open' || log.kind === 'feed_overdue')) {
    // Stale-notification guard: if a feed's already been logged (manually,
    // from the app) since this alert was computed, source_id (the "last
    // feed" at send time) won't match the child's current last feed anymore
    // — don't blindly add a second, bogus feed on top of a real one.
    const { data: currentLast } = await db.from('feeds').select('id').eq('child_id', childId)
      .order('ts', { ascending: false }).limit(1).maybeSingle();
    if (currentLast?.id !== log.source_id) {
      result = { ok: true, skipped: 'A feed was already logged since this notification was sent.' };
    } else {
      const { data: settings } = await db.from('baby_settings')
        .select('bottle_presets_ml, bottle_default_substance').eq('child_id', childId).maybeSingle();
      const volume_ml = settings?.bottle_presets_ml?.[0] ?? 150;
      const substance = settings?.bottle_default_substance ?? 'formula';
      const { error } = await db.from('feeds').insert({
        child_id: childId, ts: new Date().toISOString(),
        delivery: 'bottle', substance, volume_ml,
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      result = { ok: true, logged: `${volume_ml}mL ${substance}` };
    }
  } else {
    return new Response(JSON.stringify({ error: `Unknown action "${action}" for kind "${log.kind}"` }), { status: 400 });
  }

  await db.from('notification_log').update({ acted_at: new Date().toISOString() }).eq('id', logId);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
});
