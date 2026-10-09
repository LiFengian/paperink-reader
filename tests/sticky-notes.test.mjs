import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFHexString, PDFName } from "pdf-lib";
import { createStickyNote, moveStickyNote, resizeStickyNote } from "../lib/sticky-notes.ts";
import { readFile } from "node:fs/promises";
import { markBounds, markInPolygon, movedMark } from "../lib/geometry.ts";
import { eraseMarks } from "../lib/eraser.ts";
import { createShareablePdf } from "../lib/export-pdf.ts";
import { validateBackupDocument } from "../lib/library-backup.ts";

const page = { id: "p1", width: 612, height: 792, sourcePage: 1, marks: [] };
const ink = { id: "ink", type: "stroke", tool: "pen", color: "#202a35", width: 2.5, points: [{ x: 20, y: 30 }, { x: 200, y: 90 }] };
const note = { ...createStickyNote(page, { x: 200, y: 200 }), text: "这是中文便签\nRetained note", strokes: [ink] };
const document = { id: "doc", name: "notes.pdf", createdAt: 1, updatedAt: 2, currentPage: 0, pages: [{ ...page, marks: [note] }], chat: [] };
const photo = { id: "photo", src: "data:image/png;base64," + (await readFile(new URL("../public/icon-192.png", import.meta.url))).toString("base64"), width: 192, height: 192, name: "photo.png" };

test("note placement stays inside the page and lasso moves its anchor without altering contents", () => {
  const edge = createStickyNote(page, { x: 0, y: 792 });
  assert.equal(edge.x, 0); assert.equal(edge.y + edge.height, page.height);
  const moved = movedMark(note, 50, 70);
  assert.equal(moved.x, note.x + 50); assert.equal(moved.y, note.y + 70);
  assert.equal(moved.text, note.text); assert.equal(moved.strokes, note.strokes);
  assert.equal(markInPolygon(note, [{ x: 170, y: 170 }, { x: 230, y: 170 }, { x: 230, y: 230 }, { x: 170, y: 230 }]), true);
  assert.deepEqual(markBounds([note]), { x: note.x, y: note.y, width: note.width, height: note.height });
  assert.equal(eraseMarks([note], { x: 0, y: 0 }, { x: 612, y: 792 }, 50, "area", () => "unused")[0], note);
});

test("backup validation accepts text and ink notes, rejects malformed nested ink", () => {
  validateBackupDocument(document);
  const invalid = change => ({ ...document, pages: [{ ...page, marks: [{ ...note, ...change }] }] });
  assert.throws(() => validateBackupDocument(invalid({ strokes: [{ ...ink, points: [{ x: NaN, y: 0 }] }] })), /格式不受支持/);
  assert.throws(() => validateBackupDocument(invalid({ strokes: [ink, ink] })), /格式不受支持/);
  assert.throws(() => validateBackupDocument(invalid({ text: null })), /格式不受支持/);
});

test("direct marker drag keeps the whole marker inside the page and preserves text and handwriting", () => {
  const moved = moveStickyNote(note, { x: 1000, y: -1000 }, page);
  assert.equal(moved.x + moved.width, page.width); assert.equal(moved.y, 0);
  assert.equal(moved.text, note.text); assert.equal(moved.strokes, note.strokes);
  assert.equal(moveStickyNote(note, { x: 0, y: 0 }, page), note);
});

test("marker resize preserves its center and contents, stays on the page, and has bounded sizes", () => {
  const content = { ...note, images: [photo] }, resized = resizeStickyNote(content, 200, page);
  assert.equal(resized.width, 56); assert.equal(resized.height, 56);
  assert.equal(resized.x + resized.width / 2, note.x + note.width / 2);
  assert.equal(resized.images, content.images); assert.equal(resized.strokes, note.strokes); assert.equal(resized.text, note.text);
  const edge = resizeStickyNote(createStickyNote(page, { x: 612, y: 792 }), 200, page);
  assert.equal(edge.x + edge.width, page.width); assert.equal(edge.y + edge.height, page.height);
  assert.equal(resizeStickyNote(note, 1000, page).width, 56); assert.equal(resizeStickyNote(note, 1, page).width, 14);
  assert.equal(resizeStickyNote(note, 100, page), note);
});

test("note images validate for backup, with remote, malformed and duplicate images rejected", () => {
  const withImages = images => ({ ...document, pages: [{ ...page, marks: [{ ...note, images }] }] });
  validateBackupDocument(withImages([photo]));
  assert.throws(() => validateBackupDocument(withImages([{ ...photo, src: "https://example.com/photo.png" }])), /格式不受支持/);
  assert.throws(() => validateBackupDocument(withImages([{ ...photo, width: 0 }])), /格式不受支持/);
  assert.throws(() => validateBackupDocument(withImages([photo, photo])), /格式不受支持/);
});

test("PDF export preserves Chinese note text and appends handwritten note contents", async () => {
  const original = await PDFDocument.create(); original.addPage([612, 792]);
  const bytes = await createShareablePdf(document, new Blob([await original.save()]));
  const exported = await PDFDocument.load(bytes);
  assert.equal(exported.getPageCount(), 2);
  const annotation = exported.getPage(0).node.Annots().lookup(0, PDFDict);
  assert.equal(annotation.lookup(PDFName.of("Subtype"), PDFName).asString(), "/Text");
  const contents = annotation.lookup(PDFName.of("Contents"), PDFHexString).decodeText();
  assert.match(contents, /这是中文便签/); assert.match(contents, /第 2 页附页/);
  assert.equal(exported.getPage(1).getWidth(), note.noteWidth + 48);
  assert.ok(exported.getPage(1).node.Contents(), "handwritten appendix has rendered contents");
  const textOnly = { ...document, pages: [{ ...page, marks: [{ ...note, strokes: [] }] }] };
  assert.equal((await PDFDocument.load(await createShareablePdf(textOnly, new Blob([await original.save()])))).getPageCount(), 1);
});

test("PDF export keeps note photos on appendix pages even without handwriting", async () => {
  const original = await PDFDocument.create(); original.addPage([612, 792]);
  const withImages = { ...document, pages: [{ ...page, marks: [{ ...note, strokes: [], images: [photo, { ...photo, id: "second" }] }] }] };
  const exported = await PDFDocument.load(await createShareablePdf(withImages, new Blob([await original.save()])));
  assert.equal(exported.getPageCount(), 3);
  for (const page of exported.getPages().slice(1)) assert.ok(page.node.Resources().lookup(PDFName.of("XObject"), PDFDict).keys().length > 0);
  const contents = exported.getPage(0).node.Annots().lookup(0, PDFDict).lookup(PDFName.of("Contents"), PDFHexString).decodeText();
  assert.match(contents, /第 2–3 页附页/); assert.match(contents, /这是中文便签/);
});
