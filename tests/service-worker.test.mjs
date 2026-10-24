import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const navigation = url => { const request = new Request(url); Object.defineProperty(request, "mode", { value: "navigate" }); return request; };
const source = await readFile(new URL("../personal/service-worker.js", import.meta.url), "utf8");
function worker(active = false) {
  const scope = "https://example.org/paperink-reader/", prefix = "paperink-offline-" + encodeURIComponent(scope) + "-", name = prefix + "new";
  const handlers = {}, stores = new Map(), fetched = [], deleted = [];
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async key => { deleted.push(key); return stores.delete(key); },
    open: async key => { if (!stores.has(key)) stores.set(key, new Map()); return { match: async request => stores.get(key).get(typeof request === "string" ? request : request.url || request.href)?.clone(), addAll: async () => {} }; },
  };
  let online = true, serverStatus = 200, activations = 0;
  const self = { registration: { scope, active: active ? {} : null }, location: new URL(scope), clients: { claim: async () => {} }, skipWaiting: async () => { activations++; }, addEventListener: (name, callback) => { handlers[name] = callback; } };
  vm.runInNewContext(source.replace("__CACHE_VERSION__", "new").replace("__APP_VERSION__", "0.6.1").replace("__PRECACHE_FILES__", JSON.stringify(["./index.html", "./assets/new.js"])).replace("__RECOVERY_HTML__", JSON.stringify("<h1>墨读恢复</h1>")), {
    self, caches, URL, Request, Response, Set,
    fetch: async request => { fetched.push(request.url); if (!online) throw Error("offline"); return new Response("network", { status: serverStatus }); },
  });
  const event = async (type, fields = {}) => { let pending; handlers[type]({ ...fields, waitUntil: task => { pending = task; }, respondWith: task => { pending = task; } }); return pending; };
  return { scope, prefix, name, stores, deleted, fetched, event, activations: () => activations, offline: () => { online = false; }, httpError: () => { serverStatus = 503; } };
}

test("cached navigation stays offline; absent HTML returns a usable recovery document", async () => {
  const w = worker(); w.offline();
  const request = navigation(w.scope);
  w.stores.set(w.name, new Map([[w.scope + "index.html", new Response("cached reader")]]));
  assert.equal(await (await w.event("fetch", { request })).text(), "cached reader");
  w.stores.get(w.name).clear();
  const response = await w.event("fetch", { request });
  assert.equal(response.status, 200); assert.match(response.headers.get("Content-Type"), /text\/html/);
  assert.match(await response.text(), /墨读恢复/);
});

test("HTTP errors cannot replace the local reader with an error document", async () => {
  const w = worker(); w.httpError();
  w.stores.set(w.name, new Map([[w.scope + "index.html", new Response("cached reader")]]));
  const response = await w.event("fetch", { request: new Request(w.scope + "?paperink-recover=1") });
  // A normal fetch is deliberately not a navigation and must remain untouched.
  assert.equal(response, undefined);
  const result = await w.event("fetch", { request: navigation(w.scope + "?paperink-recover=1") });
  assert.equal(await result.text(), "cached reader");
  assert.deepEqual(w.fetched, [w.scope + "?paperink-recover=1"]);
});

test("activation preserves one prior build, so an old window can still import its chunks", async () => {
  const w = worker(); w.offline();
  w.stores.set(w.prefix + "ancient", new Map());
  w.stores.set(w.prefix + "previous", new Map([[w.scope + "assets/old.js", new Response("old code")]]));
  w.stores.set(w.name, new Map()); w.stores.set("unrelated-cache", new Map());
  await w.event("activate");
  assert.deepEqual(w.deleted, [w.prefix + "ancient"]);
  const response = await w.event("fetch", { request: new Request(w.scope + "assets/old.js") });
  assert.equal(await response.text(), "old code");
  assert.equal(w.activations(), 0);
  await w.event("message", { data: { type: "ACTIVATE_UPDATE" } }); assert.equal(w.activations(), 1);
});

test("AI requests and user data are never captured by the asset handler", async () => {
  const w = worker();
  assert.equal(await w.event("fetch", { request: new Request("https://api.deepseek.com/chat/completions", { method: "POST" }) }), undefined);
  assert.equal(await w.event("fetch", { request: new Request(w.scope + "private-document.pdf") }), undefined);
  assert.equal(w.stores.size, 0);
});

test("a cache miss actually awaits the lookup and reaches the network for HTML and entry scripts", async () => {
  const w = worker();
  assert.equal(await (await w.event("fetch", { request: navigation(w.scope) })).text(), "network");
  assert.equal(await (await w.event("fetch", { request: new Request(w.scope + "assets/new.js") })).text(), "network");
  assert.deepEqual(w.fetched, [w.scope, w.scope + "assets/new.js"]);
});

test("a legacy cache missing its entry can receive the repair without an unreachable update button", async () => {
  const w = worker(true);
  w.stores.set(w.prefix + "broken", new Map([[w.scope + "index.html", new Response('<script type="module" src="./assets/missing.js"></script>')]]));
  await w.event("install"); assert.equal(w.activations(), 1);
  await w.event("activate"); assert.equal(w.stores.has(w.prefix + "broken"), true);
});

test("a healthy previous reader continues to require its normal update confirmation", async () => {
  const w = worker(true);
  w.stores.set(w.prefix + "healthy", new Map([[w.scope + "index.html", new Response('<script type="module" src="./assets/old.js"></script>')], [w.scope + "assets/old.js", new Response("old code")]]));
  await w.event("install"); assert.equal(w.activations(), 0);
});
