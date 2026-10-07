import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { readLibraryBackup, validateBackupDocument } from "../lib/library-backup.ts";

const original = await PDFDocument.create(); original.addPage([612, 792]);
const pdf = Buffer.from(await original.save());
const document = {
  id: "old-document", name: "测试文献.pdf", createdAt: 123, updatedAt: 456, currentPage: 1,
  pages: [
    { id: "source", sourcePage: 1, width: 612, height: 792, marks: [{ id: "pen", type: "stroke", tool: "pen", color: "#202a35", width: 2.5, points: [{ x: 20, y: 30 }] }] },
    { id: "blank", sourcePage: null, width: 612, height: 792, marks: [] },
  ],
  chat: [{ id: "message", role: "user", content: "解释这个公式", quotedText: "E=mc²" }],
};
const pack = (doc = document, bytes = pdf, changes = {}) => {
  const manifest = Buffer.from(JSON.stringify({ format: "paperink-library", version: 1, entries: [{ document: doc, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }], ...changes }));
  const header = Buffer.alloc(12); header.write("PINKBK01"); header.writeUInt32BE(manifest.length, 8);
  return new Blob([header, manifest, bytes]);
};

test("backup preserves editable strokes, blank pages, PDF bytes and chat, using fresh document IDs", async () => {
  const [entry] = await readLibraryBackup(pack());
  assert.notEqual(entry.document.id, document.id);
  assert.deepEqual({ ...entry.document, id: document.id }, document);
  assert.deepEqual(Buffer.from(await entry.pdf.arrayBuffer()), pdf);
  assert.notEqual((await readLibraryBackup(pack()))[0].document.id, entry.document.id);
});
test("truncated and corrupted PDFs are rejected before any restore writes", async () => {
  const backup = pack();
  await assert.rejects(readLibraryBackup(backup.slice(0, backup.size - 1)), /不完整/);
  const changed = Buffer.from(await backup.arrayBuffer()); changed[changed.length - 10] ^= 1;
  await assert.rejects(readLibraryBackup(new Blob([changed])), /校验失败/);
  await assert.rejects(readLibraryBackup(pack(document, Buffer.from("%PDF-broken"))), /无法读取/);
});
test("unsupported formats, trailing bytes and out of range page references are rejected", async () => {
  await assert.rejects(readLibraryBackup(pack(document, pdf, { version: 2 })), /版本不受支持/);
  await assert.rejects(readLibraryBackup(new Blob([pack(), "unexpected"])), /附加数据/);
  await assert.rejects(readLibraryBackup(pack({ ...document, pages: [{ ...document.pages[0], sourcePage: 99 }], currentPage: 0 })), /页面引用无效/);
});
test("invalid annotations and external image URLs cannot be restored", () => {
  const invalid = mark => ({ ...document, pages: [{ ...document.pages[0], marks: [mark] }], currentPage: 0 });
  assert.throws(() => validateBackupDocument(invalid({ ...document.pages[0].marks[0], points: [{ x: null, y: 2 }] })), /数据不完整/);
  assert.throws(() => validateBackupDocument(invalid({ id: "image", type: "image", src: "https://example.com/tracker.png", x: 0, y: 0, width: 20, height: 20 })), /数据不完整/);
  assert.throws(() => validateBackupDocument({ ...document, currentPage: 999 }), /数据不完整/);
});
