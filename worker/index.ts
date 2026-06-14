/// <reference lib="webworker" />

/**
 * Custom service worker logic injected into the next-pwa (workbox) service
 * worker via `importScripts`. next-pwa compiles this file (worker/index.ts)
 * and prepends it to the generated public/sw.js at build time.
 *
 * Responsibilities here are limited to Web Push: receiving a push event from
 * the browser's push service (even when the site/PWA is closed) and showing a
 * device notification, plus focusing/opening the app when the user taps it.
 *
 * Workbox owns precaching/runtime caching — do NOT add caching here.
 */

export {};

declare const self: ServiceWorkerGlobalScope;

type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  timestamp?: number;
};

const DEFAULT_ICON = "/icon-192.png";
const DEFAULT_BADGE = "/icon-192.png";
const DEFAULT_TITLE = "sNeek";

function parsePushData(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json() as PushPayload;
  } catch {
    // Fallback: treat the raw payload as the body text.
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

self.addEventListener("push", (event: PushEvent) => {
  const data = parsePushData(event);
  const title = (data.title && data.title.trim()) || DEFAULT_TITLE;
  const url = (data.url && data.url.trim()) || "/";

  const options: NotificationOptions = {
    body: data.body || "",
    icon: data.icon || DEFAULT_ICON,
    badge: data.badge || DEFAULT_BADGE,
    tag: data.tag || undefined,
    // Re-alert even if a notification with the same tag exists.
    renotify: Boolean(data.tag),
    timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const data = (event.notification.data || {}) as { url?: string };
  const targetUrl = data.url || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Try to focus an existing tab/window and navigate it to the target.
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          const target = new URL(targetUrl, self.location.origin);
          // Same-origin window already open: focus + navigate.
          if (clientUrl.origin === target.origin) {
            await client.focus();
            if ("navigate" in client && client.url !== target.href) {
              try {
                await (client as WindowClient).navigate(target.href);
              } catch {
                // navigate can fail on some browsers; focus is enough.
              }
            }
            return;
          }
        } catch {
          // Ignore malformed client URLs.
        }
      }

      // No suitable window open: open a new one.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

// Some push services rotate subscription keys; re-subscribe transparently.
self.addEventListener("pushsubscriptionchange", (event: Event) => {
  const subChangeEvent = event as PushSubscriptionChangeEvent;
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey =
          subChangeEvent.oldSubscription?.options?.applicationServerKey ?? undefined;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey ?? undefined,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub.toJSON()),
        });
      } catch {
        // Best-effort; the client subscriber will recover on next load.
      }
    })()
  );
});
