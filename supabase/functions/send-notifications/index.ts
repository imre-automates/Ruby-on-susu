// Cron-driven push sender. Invoked every minute by pg_cron (via pg_net) —
// see schema.sql, "Part 7: push notifications" — with the service-role key
// as its Authorization header, so it runs with full database access and
// bypasses RLS (it has to: it reads every family's data in one pass, not
// just one caregiver's).
//
// Three notification kinds, matching the brief exactly:
//   feed_open      "You can feed again."
//   feed_overdue   "No feeding recorded yet."
//   sleep_running  "Your timer is still running. Is that still correct?"
//
// Each is evaluated PER SUBSCRIPTION (per device), not per child, because
// each device stores its own IANA timezone and "day hours" / "sleep window"
// gating has to use that device's local time, not the server's UTC clock.
// Exactly-once delivery is enforced by notification_log's unique
// (subscription_id, kind, source_id) constraint via an atomic
// insert-on-conflict — if two overlapping cron ticks ever raced (they
// shouldn't at a 1-minute cadence, but pg_net is fire-and-forget so it's
// not guaranteed), only one would win the insert and only one push would
// be sent.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isDeadSubscription, sendPush, type PushSubscriptionRow } from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface BabySettingsRow {
  child_id: string;
  day_start_hour: number;
  day_end_hour: number;
  feed_min_interval_h: number;
  feed_max_interval_h: number;
  notify_feed_open: boolean;
  notify_feed_overdue: boolean;
  notify_sleep_running: boolean;
  sleep_alert_threshold_h: number;
  sleep_alert_window_start_hour: number;
  sleep_alert_window_end_hour: number;
}

interface Candidate {
  subscription: PushSubscriptionRow;
  kind: 'feed_open' | 'feed_overdue' | 'sleep_running';
  sourceId: string;
  title: string;
  body: string;
}

/** The subscription's local hour-of-day right now, via its stored IANA
 * timezone — mirrors the half-open [start, end) convention the existing
 * NextFeed card uses for day_start_hour/day_end_hour (src/components/QuickAdd.tsx).
 * `% 24` guards against a known Intl quirk in some engines where midnight
 * with hour12:false formats as "24" instead of "0". */
function localHour(timezone: string, now: Date): number {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(now),
  );
  return h % 24;
}

function inWindow(hour: number, startHour: number, endHour: number): boolean {
  return hour >= startHour && hour < endHour;
}

async function processChild(
  childId: string,
  settings: BabySettingsRow,
  subscriptions: (PushSubscriptionRow & { timezone: string })[],
  now: Date,
): Promise<Candidate[]> {
  const [lastFeedResp, runningSleepResp] = await Promise.all([
    db.from('feeds').select('id, ts').eq('child_id', childId)
      .order('ts', { ascending: false }).limit(1).maybeSingle(),
    db.from('sleeps').select('id, start_ts').eq('child_id', childId).is('end_ts', null)
      .order('start_ts', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const lastFeed = lastFeedResp.data as { id: string; ts: string } | null;
  const runningSleep = runningSleepResp.data as { id: string; start_ts: string } | null;

  const earliest = lastFeed ? +new Date(lastFeed.ts) + settings.feed_min_interval_h * 3600_000 : null;
  const latest = lastFeed ? +new Date(lastFeed.ts) + settings.feed_max_interval_h * 3600_000 : null;
  const sleepHours = runningSleep ? (+now - +new Date(runningSleep.start_ts)) / 3600_000 : null;

  const candidates: Candidate[] = [];
  for (const sub of subscriptions) {
    const hour = localHour(sub.timezone, now);

    if (lastFeed && earliest !== null && latest !== null) {
      if (settings.notify_feed_open && inWindow(hour, settings.day_start_hour, settings.day_end_hour)
          && +now >= earliest && +now < latest) {
        candidates.push({
          subscription: sub, kind: 'feed_open', sourceId: lastFeed.id,
          title: 'Baby Tracker', body: 'You can feed again.',
        });
      }
      if (settings.notify_feed_overdue && inWindow(hour, settings.day_start_hour, settings.day_end_hour)
          && +now >= latest) {
        candidates.push({
          subscription: sub, kind: 'feed_overdue', sourceId: lastFeed.id,
          title: 'Baby Tracker', body: 'No feeding recorded yet.',
        });
      }
    }

    if (runningSleep && sleepHours !== null && settings.notify_sleep_running
        && inWindow(hour, settings.sleep_alert_window_start_hour, settings.sleep_alert_window_end_hour)
        && sleepHours >= settings.sleep_alert_threshold_h) {
      candidates.push({
        subscription: sub, kind: 'sleep_running', sourceId: runningSleep.id,
        title: 'Baby Tracker', body: 'Your timer is still running. Is that still correct?',
      });
    }
  }
  return candidates;
}

Deno.serve(async () => {
  const now = new Date();

  const { data: settingsRows, error: settingsErr } = await db
    .from('baby_settings')
    .select(`
      child_id, day_start_hour, day_end_hour, feed_min_interval_h, feed_max_interval_h,
      notify_feed_open, notify_feed_overdue, notify_sleep_running,
      sleep_alert_threshold_h, sleep_alert_window_start_hour, sleep_alert_window_end_hour
    `);
  if (settingsErr) {
    return new Response(JSON.stringify({ error: settingsErr.message }), { status: 500 });
  }

  const { data: subRows, error: subErr } = await db
    .from('push_subscriptions')
    .select('id, child_id, endpoint, p256dh, auth_key, timezone');
  if (subErr) {
    return new Response(JSON.stringify({ error: subErr.message }), { status: 500 });
  }

  const subsByChild = new Map<string, (PushSubscriptionRow & { timezone: string })[]>();
  for (const row of subRows ?? []) {
    const list = subsByChild.get(row.child_id) ?? [];
    list.push(row);
    subsByChild.set(row.child_id, list);
  }

  const allCandidates: Candidate[] = [];
  for (const settings of (settingsRows ?? []) as BabySettingsRow[]) {
    const subs = subsByChild.get(settings.child_id) ?? [];
    if (subs.length === 0) continue; // no device opted in for this child — nothing to compute
    allCandidates.push(...await processChild(settings.child_id, settings, subs, now));
  }

  let sent = 0;
  let deadSubsRemoved = 0;
  for (const c of allCandidates) {
    // Atomic claim: only the request that actually inserts the row sends
    // the push, so two near-simultaneous cron ticks can't double-send.
    const { data: claimed, error: claimErr } = await db
      .from('notification_log')
      .insert({ subscription_id: c.subscription.id, kind: c.kind, source_id: c.sourceId })
      .select('id')
      .maybeSingle();
    if (claimErr || !claimed) continue; // already sent (unique violation) or a real error — either way, skip

    try {
      await sendPush(c.subscription, { title: c.title, body: c.body });
      sent++;
    } catch (err) {
      if (isDeadSubscription(err)) {
        await db.from('push_subscriptions').delete().eq('id', c.subscription.id);
        deadSubsRemoved++;
      }
      // Any other send failure: the notification_log row stays, so this
      // specific event won't be retried — matches "once per event" rather
      // than hammering a possibly-still-valid-but-temporarily-failing endpoint.
    }
  }

  return new Response(JSON.stringify({ evaluated: allCandidates.length, sent, deadSubsRemoved }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
