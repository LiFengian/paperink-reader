/* The build embeds every reader asset, PDF worker, font, CMap and WASM file. */
const PREFIX = "paperink-offline-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + "__CACHE_VERSION__";
const RESOURCES = __PRECACHE_FILES__;
const scope = self.registration.scope;
const assetUrls = new Set(RESOURCES.map(path => new URL(path, scope).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      // Sequential batches limit concurrent downloads on iPad; install is atomic.
      for (let index = 0; index < RESOURCES.length; index += 16) {
        await cache.addAll(RESOURCES.slice(index, index + 16).map(path => new Request(new URL(path, scope), { cache: "reload" })));
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  // No API responses, Key, PDFs, or user notes are put in the asset cache.
  if (request.mode === "navigate" && request.url.startsWith(scope)) {
    event.respondWith((async () => (await caches.open(CACHE)).match(new URL("./index.html", scope)) || fetch(request))());
  } else if (assetUrls.has(request.url)) {
    event.respondWith((async () => (await caches.open(CACHE)).match(request) || fetch(request))());
  }
});
