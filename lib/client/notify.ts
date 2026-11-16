"use client";

/** Register the service worker once (no-op where unsupported). */
export const registerServiceWorker = () => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed", e));
};

export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

/**
 * Show a system notification. Prefers the service worker (required on Android Chrome and in
 * installed iOS apps, where `new Notification()` throws), falls back to the page API on desktop.
 */
export const notify = async (title: string, body: string, opts: { tag?: string; url?: string } = {}) => {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, { body, tag: opts.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: opts.url ?? "/" } });
      return;
    }
    new Notification(title, { body, tag: opts.tag, icon: "/icon-192.png" });
  } catch (e) {
    console.warn("Notification failed", e);
  }
};
