import { PDFDocument, PDFHexString, StandardFonts, rgb } from "pdf-lib";
import type { NoteMark, ReaderDocument, Stroke } from "./reader-types";

function colorFromHex(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
  const number = Number.parseInt(full, 16);
  return rgb(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function drawStroke(page: import("pdf-lib").PDFPage, mark: Stroke, sx: number, sy: number) {
  if (!mark.points.length) return;
  const color = colorFromHex(mark.color);
  const opacity = mark.tool === "highlighter" ? 0.32 : 1;
  const thickness = mark.width * (sx + sy) / 2;
  if (mark.points.length === 1) {
    const point = mark.points[0];
    page.drawCircle({ x: point.x * sx, y: page.getHeight() - point.y * sy, size: thickness / 2, color, opacity });
    return;
  }
  for (let i = 1; i < mark.points.length; i++) {
    const from = mark.points[i - 1];
    const to = mark.points[i];
    page.drawLine({
      start: { x: from.x * sx, y: page.getHeight() - from.y * sy },
      end: { x: to.x * sx, y: page.getHeight() - to.y * sy },
      thickness, color, opacity,
    });
  }
}

export async function createShareablePdf(document: ReaderDocument, original: Blob): Promise<Uint8Array> {
  const source = await PDFDocument.load(await original.arrayBuffer());
  const result = await PDFDocument.create();
  const handwritten: { note: NoteMark; readerPage: number; number: number }[] = [];
  let noteNumber = 0;
  for (const readerPage of document.pages) {
    const page = readerPage.sourcePage === null
      ? result.addPage([readerPage.width, readerPage.height])
      : (await result.copyPages(source, [readerPage.sourcePage - 1]))[0];
    if (readerPage.sourcePage !== null) result.addPage(page);
    const sx = page.getWidth() / readerPage.width;
    const sy = page.getHeight() / readerPage.height;
    for (const mark of readerPage.marks) {
      if (mark.type === "stroke") {
        drawStroke(page, mark, sx, sy);
      } else if (mark.type === "image") {
        const bytes = await fetch(mark.src).then(response => response.arrayBuffer());
        const image = mark.src.startsWith("data:image/jpeg")
          ? await result.embedJpg(bytes)
          : await result.embedPng(bytes);
        page.drawImage(image, {
          x: mark.x * sx,
          y: page.getHeight() - (mark.y + mark.height) * sy,
          width: mark.width * sx,
          height: mark.height * sy,
        });
      } else {
        const x = mark.x * sx, y = page.getHeight() - (mark.y + mark.height) * sy, width = mark.width * sx, height = mark.height * sy;
        const number = ++noteNumber;
        let contents = mark.text;
        if (mark.strokes.length) {
          handwritten.push({ note: mark, readerPage: document.pages.indexOf(readerPage) + 1, number });
          contents += `${contents ? "\n\n" : ""}手写便签见第 ${document.pages.length + handwritten.length} 页附页。`;
        }
        page.drawRectangle({ x, y, width, height, color: rgb(1, 0.91, 0.6), borderColor: rgb(0.77, 0.6, 0.24), borderWidth: 0.7 });
        for (const offset of [0.42, 0.65]) page.drawLine({ start: { x: x + width * 0.23, y: y + height * offset }, end: { x: x + width * 0.75, y: y + height * offset }, thickness: 1, color: rgb(0.6, 0.44, 0.18) });
        const annotation = result.context.obj({
          Type: "Annot", Subtype: "Text", Rect: [x, y, x + width, y + height],
          Contents: PDFHexString.fromText(contents || "空白便签"), T: PDFHexString.fromText(`墨读便签 ${number}`),
          NM: PDFHexString.fromText(mark.id), Name: "Comment", C: [1, 0.91, 0.6], Open: false, F: 4, P: page.ref,
        });
        page.node.addAnnot(result.context.register(annotation));
      }
    }
  }
  if (handwritten.length) {
    const font = await result.embedFont(StandardFonts.Helvetica);
    for (const { note, readerPage, number } of handwritten) {
      const page = result.addPage([note.noteWidth + 48, note.noteHeight + 100]);
      page.drawText(`Handwritten sticky note ${number} | Reader page ${readerPage}`, { x: 24, y: page.getHeight() - 32, size: 12, font, color: rgb(0.38, 0.3, 0.16) });
      page.drawRectangle({ x: 24, y: 28, width: note.noteWidth, height: note.noteHeight, color: rgb(1, 0.99, 0.94) });
      for (const mark of note.strokes) drawStroke(page, { ...mark, points: mark.points.map(point => ({ x: point.x + 24, y: point.y + 72 })) }, 1, 1);
    }
  }
  return result.save();
}
