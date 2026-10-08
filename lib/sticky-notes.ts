import type { NoteMark, Point, ReaderPage } from "./reader-types";

export function createStickyNote(page: ReaderPage, point: Point): NoteMark {
  const width = Math.min(28, page.width), height = Math.min(28, page.height);
  return {
    id: crypto.randomUUID(), type: "note",
    x: Math.max(0, Math.min(page.width - width, point.x - width / 2)),
    y: Math.max(0, Math.min(page.height - height, point.y - height / 2)),
    width, height, text: "", strokes: [], noteWidth: 480, noteHeight: 320,
  };
}
