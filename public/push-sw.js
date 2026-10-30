// Push notification handling, loaded into the generated service worker via
// workbox's `importScripts` option (vite.config.ts) — this runs in the same
// SW context as the precaching logic vite-plugin-pwa generates, without
// switching the whole build to injectManifest mode just for these listeners.
//
// Action buttons ("Log wake-up", "Log 150mL formula") can't make an
// ordinary authenticated Supabase request from here — a service worker has
// no access to the page's session (no localStorage). Instead each
// notification carries a single-use capability token (data.logId, the
// notification_log row's own id) that notification-action verifies and
// acts on directly with service-role access. See that function's header
// comment for the full reasoning.

self.addEventListener('push', (event) => {
  let payload = { title: 'Baby Tracker', body: '' };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // non-JSON push payload — fall back to the default above
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Baby Tracker', {
      body: payload.body ?? '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: payload.tag, // same tag replaces any still-showing notification of that kind
      data: payload.data ?? {},
      actions: payload.actions ?? [],
    }),
  );
});

async function focusOrOpen(url) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    if ('focus' in client) {
      await client.focus();
      // postMessage rather than navigating: the app is a single-page app
      // that doesn't re-read the URL after initial load, so an already-open
      // tab needs to be told to switch tabs instead of reloaded.
      const url2 = new URL(url, self.location.origin);
      client.postMessage({ type: 'navigate', tab: url2.searchParams.get('tab') });
      return;
    }
  }
  if (self.clients.openWindow) await self.clients.openWindow(url);
}

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event;
  const data = notification.data ?? {};
  notification.close();

  // "Still asleep" is purely an acknowledgement — nothing to write, just
  // dismiss (no server round-trip, no capability token needed).
  if (action === 'ack') return;

  if (action === 'log_wakeup' || action === 'log_feed') {
    event.waitUntil(
      fetch(`${self.location.origin}/functions/v1/notification-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: data.logId, action }),
      }).catch(() => {
        // Best-effort: if this fails (offline, function down), the
        // notification still closes — the user can always log it from the
        // app directly, same as if the button didn't exist.
      }),
    );
    return;
  }

  // Body tap (no action) — open or focus the app at the given tab.
  event.waitUntil(focusOrOpen(data.deepLink ?? '/'));
});
