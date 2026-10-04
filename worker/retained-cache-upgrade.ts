/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;

// Only remove cached account responses. Keep unrelated offline work and all
// IndexedDB drafts/evidence intact; activation never reloads an open form.
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin === self.location.origin &&
          (url.pathname.startsWith("/_accounts/") || url.pathname === "/accounts" || url.pathname.startsWith("/api/auth/"))) {
          await cache.delete(request);
        }
      }
    }
  })());
});
