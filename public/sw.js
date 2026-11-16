// Minimal service worker. Deliberately does NOT cache pages or API responses: this app is
// all live data, and a stale cached timer would be worse than an offline error.
// Its jobs: make the app installable, and show notifications (Android Chrome and installed
// iOS apps only allow notifications via a service worker registration).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A pass-through fetch handler (some browsers still look for one to treat the site as an app).
self.addEventListener("fetch", () => {});

// Tapping a reminder focuses the open app (or opens it).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
