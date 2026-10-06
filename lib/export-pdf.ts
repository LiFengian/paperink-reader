import { PDFDocument, rgb } from "pdf-lib";
import type { ReaderDocument, Stroke } from "./reader-types";

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
      } else {
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
      }
    }
  }
  return result.save();
}
