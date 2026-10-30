// Push notification handling, loaded into the generated service worker via
// workbox's `importScripts` option (vite.config.ts) — this runs in the same
// SW context as the precaching logic vite-plugin-pwa generates, without
// switching the whole build to injectManifest mode just for two listeners.

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
    }),
  );
});

// Focus an already-open tab if there is one, otherwise open a new one —
// standard pattern so tapping the notification doesn't stack duplicate tabs.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    }),
  );
});
