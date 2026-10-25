// Run against an offline build served locally, in an isolated browser context:
// node tests/browser/reader-input.mjs --playwright=./path/to/playwright/index.mjs --executable="C:/path/to/msedge.exe"
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf("="); return [arg.slice(2, at), arg.slice(at + 1)]; }));
const { chromium, devices } = await import(args.playwright ? pathToFileURL(resolve(args.playwright)).href : "playwright");
const base = args.url || "http://127.0.0.1:4174/paperink-reader/";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname)) throw Error("Use a local QA server; this test seeds an isolated local library.");
const browser = await chromium.launch({ headless: true, ...(args.executable ? { executablePath: args.executable } : {}) });
try {
  const context = await browser.newContext({ ...devices["iPad Pro 11"], viewport: { width: 1024, height: 768 } });
  const page = await context.newPage(), errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.waitForSelector(".welcome");
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("paperink-local-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("documents", "readwrite");
        tx.objectStore("documents").put({ id: "input-regression", name: "Input regression.pdf", createdAt: 1, updatedAt: 1, currentPage: 0, pages: [{ id: "long-page", sourcePage: null, width: 612, height: 1800, marks: [] }], chat: [] });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    localStorage.setItem("paperink-last-document", "input-regression");
  });
  await page.reload();
  await page.waitForSelector(".ink-layer");
  await page.waitForFunction(() => !localStorage.getItem("paperink-opening-document"));
  await page.evaluate(() => {
    window.inputEvents = [];
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) document.addEventListener(type, event => {
      inputEvents.push({ type, trusted: event.isTrusted, kind: event.pointerType, width: event.width, height: event.height });
    }, true);
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const contact = (id, x, y, radius = 22) => ({ id, x, y, radiusX: radius, radiusY: radius, force: .5 });
  const pen = (type, x, y) => cdp.send("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", button: "left", buttons: type === "mouseReleased" ? 0 : 1, force: type === "mouseReleased" ? 0 : .5 });
  const top = () => page.locator(".workspace").evaluate(node => node.scrollTop);
  const marks = () => page.locator(".ink-layer").evaluate(node => node.querySelectorAll(":scope > path:not(.live-ink):not(.ai-question-mark), [data-note-id], .ai-question-mark").length);
  async function reset() {
    await page.waitForTimeout(1000); // Let bounded inertia end before resetting.
    await page.locator(".workspace").evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
    await page.evaluate(() => { inputEvents.length = 0; });
  }
  async function drag({ radius = 22, grow = radius, margin = false, cancel = false } = {}) {
    const r = await page.locator(".workspace").boundingBox(), x = r.x + (margin ? 4 : r.width / 2), y = r.y + 350;
    await touch("touchStart", [contact(1, x, y, radius)]);
    for (let n = 1; n <= 10; n++) {
      await touch("touchMove", [contact(1, x, y - n * 12, n < 4 ? radius : grow)]);
      await page.waitForTimeout(16);
    }
    await touch(cancel ? "touchCancel" : "touchEnd", []);
    const result = { scroll: await top(), events: await page.evaluate(() => inputEvents) };
    assert.ok(Math.abs(result.scroll - 120) < 6, JSON.stringify(result));
    assert.ok(result.events.length && result.events.every(event => event.trusted), "Exercise browser input, not dispatchEvent");
    assert.ok(result.events.some(event => event.type === "gotpointercapture"), "Exercise actual pointer capture");
    return result;
  }
  // Fingers can exceed the old 36px cutoff. Every tool must accept them without editing.
  for (const label of ["钢笔", "荧光笔", "橡皮擦", "套索移动", "AI 询问画笔", "插入便签", "移动页面"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await reset(); const before = await marks();
    const result = await drag();
    assert.ok(result.events.some(event => event.kind === "touch" && event.width >= 44));
    assert.equal(await marks(), before, label + " touch must not edit");
    assert.equal(await page.locator(".sticky-note-dialog").count(), 0);
    assert.match(await page.getByRole("button", { name: label, exact: true }).getAttribute("class"), /active/);
    checks.push(label + ": 44px finger pan");
  }
  if (await page.getByRole("button", { name: "关闭 AI 助读" }).count()) await page.getByRole("button", { name: "关闭 AI 助读" }).click();
  await page.getByRole("button", { name: "钢笔", exact: true }).click();
  await reset(); await drag({ radius: 4, grow: 30 }); checks.push("contact grows from 8px to 60px without interrupting pan");
  await reset(); await drag({ margin: true }); checks.push("workspace margin drag");
  await reset(); await drag({ cancel: true });
  await reset(); await drag(); checks.push("cancelled touch releases state and next drag works");

  // Large contacts must not disable pinching either.
  await reset();
  const r = await page.locator(".workspace").boundingBox(), x = r.x + r.width / 2, y = r.y + 260;
  await touch("touchStart", [contact(1, x - 80, y)]);
  await touch("touchStart", [contact(1, x - 80, y), contact(2, x + 80, y)]);
  await touch("touchMove", [contact(1, x - 120, y, 30), contact(2, x + 120, y, 30)]);
  await touch("touchEnd", []);
  await page.waitForFunction(() => document.querySelector(".zoom-controls span").textContent === "150%");
  checks.push("44px to 60px two-finger pinch in pen mode");

  // A held touch that was interrupted by the pen stays inactive after pen lift.
  await reset(); const count = await marks();
  await touch("touchStart", [contact(1, x, y)]);
  await pen("mousePressed", x - 30, y - 40);
  const frozen = await top();
  await touch("touchMove", [contact(1, x, y - 100, 30)]);
  await pen("mouseMoved", x + 30, y - 40);
  await pen("mouseReleased", x + 30, y - 40);
  await page.waitForTimeout(170);
  await touch("touchMove", [contact(1, x, y - 160, 30)]);
  await touch("touchEnd", []);
  assert.equal(await top(), frozen);
  await page.waitForFunction(expected => document.querySelectorAll(".ink-layer > path:not(.live-ink):not(.ai-question-mark)").length === expected, count + 1);
  await reset(); await drag(); checks.push("pen writes, blocks held palm, and fresh finger drag resumes");

  await page.getByRole("button", { name: "移动页面", exact: true }).click();
  await reset();
  await pen("mousePressed", x, y);
  await pen("mouseMoved", x, y - 90);
  await pen("mouseReleased", x, y - 90);
  assert.ok(await top() >= 85); checks.push("explicit hand tool accepts pen drag");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks }));
} finally { await browser.close(); }
