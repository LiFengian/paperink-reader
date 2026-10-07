import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AiSelection, Point, ReaderPage } from "./reader-types";

export type TextRun = {
  text: string; x: number; y: number; width: number; height: number; baseline: number;
  advances: number[]; hasEOL?: boolean;
};

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextRun[]>>>();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function aiStrokeKind(points: Point[]): AiSelection["kind"] {
  if (!points.length) return "mark";
  const bounds = points.reduce<{ x: number; y: number; right: number; bottom: number }>((b, p) => ({ x: Math.min(b.x, p.x), y: Math.min(b.y, p.y), right: Math.max(b.right, p.x), bottom: Math.max(b.bottom, p.y) }), { x: points[0].x, y: points[0].y, right: points[0].x, bottom: points[0].y });
  const width = bounds.right - bounds.x, height = bounds.bottom - bounds.y;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; twiceArea += a.x * b.y - b.x * a.y; }
  const gap = Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y);
  if (points.length >= 4 && width > 8 && height > 8 && Math.abs(twiceArea) > width * height * 0.4 && gap < Math.max(18, Math.hypot(width, height) * 0.6)) return "circle";
  return width > 8 && width >= height * 2 ? "underline" : "mark";
}

function inside(point: Point, points: Point[]) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function distanceToStroke(point: Point, points: Point[]) {
  let distance = Math.hypot(point.x - points[0].x, point.y - points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return distance;
}

function strokeYAt(x: number, points: Point[]) {
  let result = points[0].y, nearest = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const t = b.x === a.x ? 0.5 : clamp((x - a.x) / (b.x - a.x), 0, 1);
    const dx = Math.abs(a.x + (b.x - a.x) * t - x);
    if (dx < nearest) { nearest = dx; result = a.y + (b.y - a.y) * t; }
  }
  return result;
}

/** Resolve the marked row using PDF baselines, before asking a vision model. */
export function locateAiSelection(runs: TextRun[], points: Point[]): AiSelection {
  const kind = aiStrokeKind(points);
  const result: AiSelection = { kind, text: "", boxes: [] };
  if (!points.length || !runs.length) return result;
  const minX = points.reduce((x, p) => Math.min(x, p.x), Infinity), maxX = points.reduce((x, p) => Math.max(x, p.x), -Infinity);
  let target: TextRun | undefined, best = Infinity;
  if (kind === "underline") {
    for (const run of runs) {
      if (run.x > maxX + 3 || run.x + run.width < minX - 3) continue;
      const x = (Math.max(run.x, minX) + Math.min(run.x + run.width, maxX)) / 2;
      const delta = strokeYAt(x, points) - run.baseline;
      if (Math.abs(delta) > Math.max(12, run.height * 0.95 + 4)) continue;
      // A line below the stroke is less likely to be the underlined row.
      const score = Math.abs(delta) + (delta < -run.height * 0.2 ? 1000 : 0);
      if (score < best) { best = score; target = run; }
    }
    if (!target) return result;
  }
  const pieces: string[] = [];
  let lastBaseline: number | undefined;
  for (const run of runs) {
    const characters = Array.from(run.text);
    if (kind === "underline" && Math.abs(run.baseline - target!.baseline) > Math.max(2.5, Math.min(run.height, target!.height) * 0.25)
      && !(run.height < target!.height * 0.85 && run.y + run.height / 2 >= target!.y - 3 && run.y + run.height / 2 <= target!.y + target!.height + 3)) continue;
    const selected = characters.map((_, index) => {
      const x = run.x + (run.advances[index] + run.advances[index + 1]) / 2;
      const center = { x, y: run.y + run.height / 2 };
      if (kind === "underline") return x >= minX - 3 && x <= maxX + 3;
      if (kind === "circle") return inside(center, points);
      return distanceToStroke(center, points) < Math.max(7, run.height * 0.6);
    });
    // Approximate font metrics can land in the middle of an English word.
    const word = (character: string) => /^[A-Za-z0-9'’_-]$/.test(character);
    for (let i = 0; i < selected.length; i++) if (selected[i] && word(characters[i])) {
      let left = i, right = i;
      while (left > 0 && word(characters[left - 1])) selected[--left] = true;
      while (right + 1 < selected.length && word(characters[right + 1])) selected[++right] = true;
      i = right;
    }
    const spans: string[] = [];
    for (let i = 0; i < selected.length; i++) {
      if (!selected[i]) continue;
      const start = i; while (i + 1 < selected.length && selected[i + 1]) i++;
      const text = characters.slice(start, i + 1).join("").trim();
      if (!text) continue;
      spans.push(text);
      result.boxes.push({ x: run.x + run.advances[start], y: run.y, width: run.advances[i + 1] - run.advances[start], height: run.height });
    }
    if (!spans.length) continue;
    if (lastBaseline !== undefined && Math.abs(lastBaseline - run.baseline) > 3) pieces.push("\n");
    pieces.push(spans.join(" … ") + (run.hasEOL ? "\n" : " "));
    lastBaseline = run.baseline;
  }
  result.text = pieces.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

async function pageTextRuns(pdf: PDFDocumentProxy, pageNumber: number): Promise<TextRun[]> {
  let pages = cache.get(pdf); if (!pages) { pages = new Map(); cache.set(pdf, pages); }
  let pending = pages.get(pageNumber);
  if (!pending) {
    pending = (async () => {
      const source = await pdf.getPage(pageNumber), content = await source.getTextContent();
      const viewport = source.getViewport({ scale: 1 }), pdfjs = await import("pdfjs-dist");
      const measure = window.document.createElement("canvas").getContext("2d");
      const runs: TextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        if (Math.abs(t[1]) > Math.abs(t[0]) * 0.35) continue;
        const fontHeight = Math.max(2, Math.hypot(t[2], t[3])), style = content.styles[item.fontName];
        const ascent = style?.ascent ?? 0.8, descent = style?.descent ?? -0.2;
        const width = item.width || fontHeight * Array.from(item.str).length * 0.5;
        if (measure) measure.font = `${fontHeight}px ${style?.fontFamily || "serif"}`;
        const widths = Array.from(item.str).map(character => measure?.measureText(character).width || 1);
        const total = widths.reduce((sum, value) => sum + value, 0);
        const advances = [0]; for (const value of widths) advances.push(advances.at(-1)! + value / total * width);
        runs.push({ text: item.str, x: t[4], y: t[5] - fontHeight * ascent, width, height: Math.max(3, fontHeight * (ascent - descent)), baseline: t[5], advances, hasEOL: item.hasEOL });
      }
      return runs;
    })();
    pages.set(pageNumber, pending);
    pending.catch(() => pages!.delete(pageNumber));
  }
  return pending;
}

export async function identifyAiMark(pdf: PDFDocumentProxy | null, page: ReaderPage, points: Point[]) {
  if (!pdf || page.sourcePage === null) return locateAiSelection([], points);
  return locateAiSelection(await pageTextRuns(pdf, page.sourcePage), points);
}
