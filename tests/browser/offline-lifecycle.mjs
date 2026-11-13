// Run after build:offline. Uses an ephemeral localhost server and isolated browser data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument } from "pdf-lib";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const at = arg.indexOf("=");
  if (at < 3) throw Error("Use --name=value arguments");
  return [arg.slice(2, at), arg.slice(at + 1)];
}));
const { chromium } = await import(args.playwright ? pathToFileURL(resolve(args.playwright)).href : "playwright");
const root = resolve("dist/offline"), scope = "/paperink-reader/";
const originalWorker = await readFile(resolve(root, "sw.js"), "utf8");
assert.ok(!originalWorker.includes("__PRECACHE_FILES__"), "Run build:offline first");
let revision = 1;
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = resolve(root, pathname.slice(scope.length) || "index.html");
  if (!pathname.startsWith(scope) || !file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
  try {
    // Distinct cache versions exercise a real waiting worker without rebuilding identical assets.
    const body = file === resolve(root, "sw.js")
      ? originalWorker.replace(/(const CACHE = PREFIX \+ ")([^"]+)/, `$1$2-qa-${revision}`)
      : await readFile(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(args.executable ? { executablePath: args.executable } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  context.setDefaultTimeout(20_000);
  const base = `http://127.0.0.1:${server.address().port}${scope}`, checks = [], errors = [];
  context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
  let page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector(".welcome");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText("Offline lifecycle regression fixture", { x: 50, y: 700 });
  const pdfBytes = Array.from(await pdf.save());
  const fixture = {
    id: "offline-regression", name: "Offline regression.pdf", createdAt: 1, updatedAt: 1, currentPage: 0,
    pages: [{ id: "pdf-page", sourcePage: 1, width: 612, height: 792, marks: [
      { id: "existing-stroke", type: "stroke", tool: "pen", color: "#202a35", width: 2, points: [{ x: 40, y: 40 }, { x: 80, y: 60 }] },
      { id: "existing-note", type: "note", x: 160, y: 160, width: 28, height: 28, text: "Retain note text", strokes: [], noteWidth: 480, noteHeight: 320,
        images: [{ id: "photo", width: 1, height: 1, src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=" }] },
    ] }],
    chat: [{ id: "answer", role: "assistant", content: String.raw`Offline formula: \(\alpha_i=\frac{1}{2}\).` }],
  };
  await page.evaluate(async ({ fixture, pdfBytes }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("paperink-local-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["documents", "pdfs"], "readwrite");
        tx.objectStore("documents").put(fixture);
        tx.objectStore("pdfs").put(new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), fixture.id);
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    localStorage.setItem("paperink-last-document", fixture.id);
    localStorage.setItem("paperink-personal-deepseek-key", "qa-placeholder-key");
  }, { fixture, pdfBytes });

  async function ready() {
    await page.waitForSelector(".ink-layer");
    await page.waitForFunction(() => !localStorage.getItem("paperink-opening-document"));
    assert.equal(await page.locator('[data-note-id="existing-note"]').count(), 1);
  }
  async function snapshot() {
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open("paperink-local-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try {
        return await new Promise((resolve, reject) => {
          const names = ["documents", "pdfs", "document-meta", "page-meta", "mark-deltas", "chat-deltas", "note-images"];
          const tx = db.transaction(names), result = {};
          for (const name of names) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { result[name] = r.result; }; }
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = async () => { result.pdfs = await Promise.all(result.pdfs.map(async blob => Array.from(new Uint8Array(await blob.arrayBuffer())))); resolve(result); };
        });
      } finally { db.close(); }
    });
  }
  async function draw() {
    await page.getByRole("button", { name: "钢笔", exact: true }).click();
    const box = await page.locator(".ink-layer").boundingBox();
    await page.mouse.move(box.x + 70, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 130, box.y + 120, { steps: 5 });
    await page.mouse.up();
  }
  async function waitingUpdate() {
    revision++;
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.getByRole("button", { name: "保存并更新", exact: true }).waitFor();
  }

  await page.reload(); await ready();
  const initial = await snapshot();
  // A new page has no application module memory; clear HTTP cache so assets must come from SW.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache"); await cdp.detach();
  await page.close(); await context.setOffline(true);
  page = await context.newPage(); await page.goto(base); await ready();
  await page.getByRole("button", { name: "AI 助读", exact: true }).click();
  await page.locator(".ai-answer .katex").waitFor();
  assert.equal(await page.locator(".katex-error").count(), 0);
  assert.deepEqual(await snapshot(), initial, "cold start must preserve PDF, notes, photos and chat");
  await page.getByRole("button", { name: "关闭 AI 助读" }).click();
  checks.push("cold offline PDF startup and first lazy AI formula render preserve library contents");

  await context.setOffline(false); await waitingUpdate();
  // An open note is a real update guard, even when the update button is invoked programmatically.
  await page.locator('[data-note-id="existing-note"]').click();
  await page.waitForSelector(".sticky-note-dialog");
  await page.getByRole("button", { name: "保存并更新", exact: true }).evaluate(button => button.click());
  await page.getByText("请先收起便签或完成当前笔画，再更新阅读器。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), "installed");
  await page.locator('.sticky-note-heading [aria-label="收起便签"]').click();

  // Hold a real IDB write lock. Autosave and the explicit update save must queue behind it.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("paperink-local-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    let held = true;
    const tx = db.transaction("document-meta", "readwrite"), store = tx.objectStore("document-meta");
    window.releaseSaveLock = () => { held = false; };
    tx.oncomplete = () => db.close();
    await new Promise(resolve => {
      const pump = () => { const r = store.get("offline-regression"); r.onsuccess = () => { resolve(); if (held) pump(); }; };
      pump();
    });
    window.queuedSaves = 0;
    const native = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (mode === "readwrite" && Array.from(stores).includes("mark-deltas")) window.queuedSaves++;
      return native.call(this, stores, mode, ...rest);
    };
  });
  await draw();
  await page.getByRole("button", { name: "保存并更新", exact: true }).click();
  await page.waitForSelector(".reader-update-saving");
  await page.waitForFunction(() => window.queuedSaves > 0);
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), "installed", "must not activate while save is blocked");
  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => window.releaseSaveLock());
  await reloaded; await ready();
  const saved = await snapshot();
  assert.deepEqual(saved.documents, initial.documents);
  assert.deepEqual(saved.pdfs, initial.pdfs);
  assert.deepEqual(saved["chat-deltas"], initial["chat-deltas"]);
  assert.deepEqual(saved["note-images"], initial["note-images"]);
  assert.equal(saved["page-meta"][0].markIds.length, 3, "latest stroke must survive update reload");
  assert.equal(saved["mark-deltas"].filter(mark => mark.type === "stroke").length, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("paperink-personal-deepseek-key")), "qa-placeholder-key");
  checks.push("open note blocks update; queued final stroke commits before worker activation and survives reload");

  await waitingUpdate();
  // Simulate quota failure at the real storage write boundary, not in a fake save implementation.
  await page.evaluate(() => {
    window.failedWrites = 0;
    const native = IDBObjectStore.prototype.put;
    window.restoreWrites = () => { IDBObjectStore.prototype.put = native; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "document-meta") { window.failedWrites++; throw new DOMException("QA quota failure", "QuotaExceededError"); }
      return native.apply(this, args);
    };
  });
  await draw();
  await page.waitForFunction(() => window.failedWrites > 0);
  await page.getByRole("button", { name: "保存并更新", exact: true }).click();
  await page.getByText("当前笔记保存失败，请先备份再更新。", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.failedWrites >= 2), "exercise both autosave and explicit update save failure");
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), "installed");
  assert.deepEqual(await snapshot(), saved, "failed writes must not modify previously committed data");
  assert.equal(await page.locator(".reader-update-saving").count(), 0, "failed save must unlock the reader");
  await page.evaluate(() => window.restoreWrites());
  const retried = page.waitForEvent("load");
  await page.getByRole("button", { name: "保存并更新", exact: true }).click();
  await retried; await ready();
  assert.equal((await snapshot())["page-meta"][0].markIds.length, 4, "retry must save the unsaved stroke");
  checks.push("quota failure prevents activation/reload and preserves committed data; retry saves pending ink");

  // Evict cached HTML/entry while retaining the active SW: its bundled recovery must still run offline.
  const preserved = await snapshot();
  await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith("paperink-offline-")) await caches.delete(name); });
  await context.setOffline(true); await page.close();
  page = await context.newPage(); await page.goto(base);
  await page.locator("#reader-startup-actions").waitFor();
  await page.locator("#reader-repair").click();
  await page.getByText("请先连接网络，再点击联网修复。本机内容已保留。", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), preserved);
  await page.locator("#reader-library").click();
  await page.waitForURL("**/?paperink-library=1");
  assert.equal(await page.evaluate(() => localStorage.getItem("paperink-last-document")), null);
  assert.equal(await page.evaluate(() => localStorage.getItem("paperink-personal-deepseek-key")), "qa-placeholder-key");
  assert.deepEqual(await snapshot(), preserved);
  checks.push("offline recovery and return-to-library actions preserve PDFs, ink, photos, chat and Key");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
