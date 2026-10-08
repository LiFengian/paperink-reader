import test from "node:test";
import assert from "node:assert/strict";
import { readWholePaper, paperReference } from "../lib/paper-context.ts";
test("whole paper includes later pages, explicit empty pages and original page references", async () => {
  let reads = 0;
  const pdf = { numPages: 3, getPage: async index => ({ getTextContent: async () => { reads++; return { items: index === 2 ? [] : [{ str: index === 1 ? "Research question" : "Conclusion on the last page", hasEOL: true }] }; } }) };
  const context = await readWholePaper(pdf);
  assert.match(context.text, /Conclusion on the last page/); assert.deepEqual(context.emptyPages, [2]);
  assert.match(paperReference("paper.pdf", context), /原始 PDF 第 3 页/);
  await readWholePaper(pdf); assert.equal(reads, 3);
});
test("overlong papers are rejected rather than silently cut off", async () => {
  const pdf = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "a".repeat(700001) }] }) }) };
  await assert.rejects(readWholePaper(pdf), /不会静默截断全文/);
});

test("background extraction pauses for drawing and a question promotes the shared task", async () => {
  let reads = 0;
  const pdf = { numPages: 2, getPage: async () => { reads++; return { getTextContent: async () => ({ items: [{ str: "Complete paper" }] }) }; } };
  const background = readWholePaper(pdf, undefined, { background: true, isBusy: () => true });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(reads, 0);
  const foreground = readWholePaper(pdf);
  assert.equal(foreground, background);
  assert.equal((await foreground).pageCount, 2); assert.equal(reads, 2);
});

test("closing a document cancels paused background work and allows a fresh read", async () => {
  let cancelled = false, reads = 0;
  const pdf = { numPages: 1, getPage: async () => { reads++; return { getTextContent: async () => ({ items: [] }) }; } };
  const task = readWholePaper(pdf, undefined, { background: true, isBusy: () => true, isCancelled: () => cancelled });
  const rejection = assert.rejects(task, /已取消/);
  cancelled = true;
  const restarted = readWholePaper(pdf);
  await rejection;
  assert.equal((await restarted).pageCount, 1); assert.equal(reads, 1);
});
