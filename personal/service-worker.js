/* The build embeds every reader asset, PDF worker, font, CMap and WASM file. */
const PREFIX = "paperink-offline-" + encodeURIComponent(self.registration.scope) + "-";
const CACHE = PREFIX + "__CACHE_VERSION__";
const APP_VERSION = "__APP_VERSION__";
const RESOURCES = __PRECACHE_FILES__;
const RECOVERY_HTML = __RECOVERY_HTML__;
const scope = self.registration.scope;
const assetUrls = new Set(RESOURCES.map(path => new URL(path, scope).href));

async function needsStartupRecovery() {
  if (!self.registration.active) return false;
  const older = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE);
  if (!older.length) return true;
  const cache = await caches.open(older[older.length - 1]);
  const index = await cache.match(new URL("./index.html", scope));
  if (!index) return true;
  const html = await index.text();
  for (const script of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
    if (!await cache.match(new URL(script[1], scope))) return true;
  }
  return false;
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      // Sequential batches limit concurrent downloads on iPad; install is atomic.
      for (let index = 0; index < RESOURCES.length; index += 16) {
        await cache.addAll(RESOURCES.slice(index, index + 16).map(path => new Request(new URL(path, scope), { cache: "reload" })));
      }
      // Legacy workers returned undefined on a cache miss, so a blank page
      // could never reach its in-app update button. Activate only this repair
      // case after the new resources are complete; never navigate live tabs.
      if (await needsStartupRecovery()) await self.skipWaiting();
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    // Keep one prior build for tabs still using its lazy PDF/AI chunks.
    const older = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE);
    if (!await needsStartupRecovery()) for (const name of older.slice(0, -1)) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "GET_VERSION") event.ports[0]?.postMessage({ version: APP_VERSION });
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  // No API responses, Key, PDFs, or user notes are put in the asset cache.
  if (request.mode === "navigate" && request.url.startsWith(scope)) {
    event.respondWith((async () => {
      let cached;
      try { cached = await (await caches.open(CACHE)).match(new URL("./index.html", scope)); } catch { /* Storage may be temporarily unavailable. */ }
      const recovery = new URL(request.url).searchParams.has("paperink-recover");
      if (cached && !recovery) return cached;
      try { const response = await fetch(new Request(request, { cache: "no-store" })); if (response.ok) return response; } catch { /* Keep a usable screen when the origin is unreachable. */ }
      return cached || new Response(RECOVERY_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    })());
  } else if (assetUrls.has(request.url)) {
    event.respondWith((async () => {
      try { const cached = await (await caches.open(CACHE)).match(request); if (cached) return cached; } catch { /* Try network without deleting local data. */ }
      return fetch(request);
    })());
  } else if (request.url.startsWith(new URL("./assets/", scope).href)) {
    event.respondWith((async () => {
      for (const name of (await caches.keys()).filter(name => name.startsWith(PREFIX))) {
        const cached = await (await caches.open(name)).match(request); if (cached) return cached;
      }
      return fetch(request);
    })());
  }
});
