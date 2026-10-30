// Shared Web Push sending helper, used by both send-notifications (the
// cron-driven sender) and test-push (the Settings "send test notification"
// button) so the VAPID setup and error handling live in one place.

import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set as function secrets');
}

// mailto: subject is required by the Web Push protocol (lets a push service
// contact you if your server is misbehaving) — not shown to the user.
webpush.setVapidDetails('mailto:push@imre-automates.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: { action: string; title: string }[];
}

/** True if the push service says this subscription is permanently dead
 * (unsubscribed, expired, or the endpoint no longer exists) — the caller
 * should delete the row so it stops being tried every minute. */
export function isDeadSubscription(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number } | null)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function sendPush(sub: PushSubscriptionRow, payload: PushPayload): Promise<void> {
  await webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth_key },
    },
    JSON.stringify(payload),
  );
}
