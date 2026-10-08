import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFHexString, PDFName } from "pdf-lib";
import { createStickyNote } from "../lib/sticky-notes.ts";
import { markBounds, markInPolygon, movedMark } from "../lib/geometry.ts";
import { eraseMarks } from "../lib/eraser.ts";
import { createShareablePdf } from "../lib/export-pdf.ts";
import { validateBackupDocument } from "../lib/library-backup.ts";

const page = { id: "p1", width: 612, height: 792, sourcePage: 1, marks: [] };
const ink = { id: "ink", type: "stroke", tool: "pen", color: "#202a35", width: 2.5, points: [{ x: 20, y: 30 }, { x: 200, y: 90 }] };
const note = { ...createStickyNote(page, { x: 200, y: 200 }), text: "这是中文便签\nRetained note", strokes: [ink] };
const document = { id: "doc", name: "notes.pdf", createdAt: 1, updatedAt: 2, currentPage: 0, pages: [{ ...page, marks: [note] }], chat: [] };

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
