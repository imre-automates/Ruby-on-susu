import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// PushManager.subscribe wants the VAPID public key as a raw Uint8Array, not
// the base64url string it's stored/transmitted as.
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function bufferToBase64url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The current device's existing browser-level push subscription for this
 * app, if any — independent of whether we've stored a matching row in
 * push_subscriptions (the two can drift, e.g. the browser silently expired
 * a subscription), so callers should treat this as the source of truth for
 * "is this device subscribed at all" and push_subscriptions as "does the
 * server know about it." */
async function getBrowserSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function isSubscribed(): Promise<boolean> {
  return (await getBrowserSubscription()) !== null;
}

/** Request permission, subscribe this device to push, and store the
 * subscription (endpoint/keys/timezone) for this child. Throws on denial or
 * misconfiguration — callers should catch and show the message. */
export async function subscribeToPush(childId: string): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications aren’t supported on this browser/device.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Notifications aren’t configured for this deployment yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { error } = await supabase!.from('push_subscriptions').upsert(
    {
      child_id: childId,
      endpoint: sub.endpoint,
      p256dh: bufferToBase64url(sub.getKey('p256dh')),
      auth_key: bufferToBase64url(sub.getKey('auth')),
      timezone,
    },
    { onConflict: 'child_id,endpoint' },
  );
  if (error) throw new Error(`Saving the subscription failed: ${error.message}`);
}

/** Unsubscribes this device from push entirely (not just for one child —
 * a browser push subscription isn't itself child-scoped) and removes every
 * push_subscriptions row for it. */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getBrowserSubscription();
  if (!sub) return;
  await supabase!.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Calls the test-push Edge Function for the signed-in user's own devices. */
export async function sendTestPush(): Promise<{ sent: number; total: number }> {
  const { data: { session } } = await supabase!.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/test-push`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error ?? 'Test notification failed');
  return result;
}
