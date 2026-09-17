/* Private API data stays in IndexedDB. Only the client shell and immutable assets are cached. */
const CACHE = "todo-shell-v3";
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const shell = event.request.mode === "navigate" && ["/today", "/review"].includes(url.pathname);
  const asset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
  if (!shell && !asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && !response.redirected && (asset || new URL(response.url).pathname === url.pathname)) await cache.put(event.request, response.clone());
      if (!response.ok && response.status >= 500) return await cache.match(event.request) ?? response;
      return response;
    } catch (error) {
      return await cache.match(event.request) ?? (shell ? await cache.match("/today") : undefined) ?? new Response("离线页面尚未缓存。请联网打开一次今日页。", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "CLEAR_PRIVATE_CACHE") event.waitUntil(caches.delete(CACHE));
  if (event.data?.type === "CACHE_SHELL" && Array.isArray(event.data.assets)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const assets = event.data.assets.filter(value => {
        try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && url.pathname.startsWith("/_next/static/"); } catch { return false; }
      }).slice(0, 150);
      await Promise.allSettled([...assets, "/today", "/review"].map(async url => {
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok && !response.redirected) await cache.put(url, response);
      }));
    })());
  }
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* Display a generic notification. */ }
  const title = typeof data.title === "string" ? data.title.slice(0, 200) : "TodoTodoList";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "有一项回顾等待你处理。";
  let url = "/review";
  try {
    const candidate = new URL(data.url, self.location.origin);
    if (candidate.origin === self.location.origin && ["/review", "/today"].includes(candidate.pathname)) url = candidate.pathname + candidate.search + candidate.hash;
  } catch { /* Keep the safe destination. */ }
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/icons/todo-192.png", tag: typeof data.tag === "string" ? data.tag.slice(0, 128) : "todo-review",
    data: { url }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || "/review", self.location.origin);
    if (url.origin !== self.location.origin || !["/review", "/today"].includes(url.pathname)) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url === url.href);
    if (existing) await existing.focus();
    else await self.clients.openWindow(url.href);
  })());
});
