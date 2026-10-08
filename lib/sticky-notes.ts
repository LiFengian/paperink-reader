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

export function moveStickyNote(note: NoteMark, delta: Point, page: Pick<ReaderPage, "width" | "height">): NoteMark {
  const x = Math.max(0, Math.min(page.width - note.width, note.x + delta.x));
  const y = Math.max(0, Math.min(page.height - note.height, note.y + delta.y));
  return x === note.x && y === note.y ? note : { ...note, x, y };
}
