import type { NoteMark, Point, ReaderPage } from "./reader-types";

export function createStickyNote(page: ReaderPage, point: Point): NoteMark {
  const width = Math.min(28, page.width), height = Math.min(28, page.height);
  return {
    id: crypto.randomUUID(), type: "note",
    x: Math.max(0, Math.min(page.width - width, point.x - width / 2)),
    y: Math.max(0, Math.min(page.height - height, point.y - height / 2)),
    width, height, text: "", strokes: [], images: [], noteWidth: 480, noteHeight: 320,
  };
}

export function resizeStickyNote(note: NoteMark, percent: number, page: Pick<ReaderPage, "width" | "height">): NoteMark {
  const size = 28 * Math.max(50, Math.min(200, percent)) / 100;
  const width = Math.min(size, page.width), height = Math.min(size, page.height);
  const x = Math.max(0, Math.min(page.width - width, note.x + (note.width - width) / 2));
  const y = Math.max(0, Math.min(page.height - height, note.y + (note.height - height) / 2));
  return x === note.x && y === note.y && width === note.width && height === note.height ? note : { ...note, x, y, width, height };
}

export function moveStickyNote(note: NoteMark, delta: Point, page: Pick<ReaderPage, "width" | "height">): NoteMark {
  const x = Math.max(0, Math.min(page.width - note.width, note.x + delta.x));
  const y = Math.max(0, Math.min(page.height - note.height, note.y + delta.y));
  return x === note.x && y === note.y ? note : { ...note, x, y };
}
