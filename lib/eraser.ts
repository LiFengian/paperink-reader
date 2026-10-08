import type { Mark, Point, Stroke } from "./reader-types";
import { individualBounds } from "./geometry.ts";

export type EraserMode = "stroke" | "area";
const point = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.00001;
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

// Split at the exact capsule boundaries, even if input samples are far apart.
function outside(a: Point, b: Point, from: Point, to: Point, radius: number): [Point, Point][] {
  const dx = b.x - a.x, dy = b.y - a.y, dd = dx * dx + dy * dy;
  if (!dd) return distance(a, from, to) > radius ? [[a, b]] : [];
  const cuts = [0, 1];
  const add = (t: number) => { if (t > 0 && t < 1 && Number.isFinite(t)) cuts.push(t); };
  for (const center of [from, to]) {
    const px = a.x - center.x, py = a.y - center.y;
    const n = 2 * (px * dx + py * dy), c = px * px + py * py - radius * radius;
    const determinant = n * n - 4 * dd * c;
    if (determinant >= 0) { const root = Math.sqrt(determinant); add((-n - root) / (2 * dd)); add((-n + root) / (2 * dd)); }
  }
  const ex = to.x - from.x, ey = to.y - from.y, length = Math.hypot(ex, ey);
  if (length) {
    const cross = ex * (a.y - from.y) - ey * (a.x - from.x), crossDelta = ex * dy - ey * dx;
    if (crossDelta) { add((radius * length - cross) / crossDelta); add((-radius * length - cross) / crossDelta); }
    const projection = (a.x - from.x) * ex + (a.y - from.y) * ey, delta = dx * ex + dy * ey;
    if (delta) { add(-projection / delta); add((length * length - projection) / delta); }
  }
  cuts.sort((x, y) => x - y);
  const pieces: [Point, Point][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const start = cuts[i - 1], end = cuts[i];
    if (end - start > 1e-10 && distance(point(a, b, (start + end) / 2), from, to) > radius) pieces.push([point(a, b, start), point(a, b, end)]);
  }
  return pieces;
}

function cutStroke(stroke: Stroke, from: Point, to: Point, radius: number, id: () => string): Stroke[] {
  const effective = radius + stroke.width / 2;
  if (stroke.points.length === 1) return distance(stroke.points[0], from, to) > effective ? [stroke] : [];
  const fragments: Point[][] = [];
  let altered = false;
  let current: Point[] = [];
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    const pieces = outside(a, b, from, to, effective);
    const kept = pieces.reduce((total, [start, end]) => total + Math.hypot(start.x - end.x, start.y - end.y), 0);
    if (Math.hypot(a.x - b.x, a.y - b.y) - kept > 1e-7 || (!pieces.length && same(a, b))) altered = true;
    for (const [a, b] of pieces) {
      if (!current.length || !same(current.at(-1)!, a)) { current = [a]; fragments.push(current); }
      if (!same(current.at(-1)!, b)) current.push(b);
    }
  }
  if (!altered) return [stroke];
  if (fragments.length === 1 && fragments[0].length === stroke.points.length && fragments[0].every((p, i) => same(p, stroke.points[i]))) return [stroke];
  return fragments.filter(fragment => fragment.length > 1).map((points, index) => ({ ...stroke, id: index ? id() : stroke.id, points }));
}

export function eraseMarks(marks: Mark[], from: Point, to: Point, radius: number, mode: EraserMode, id: () => string): Mark[] {
  let changed = false;
  const next = marks.flatMap<Mark>(mark => {
    if (mark.type !== "stroke") return [mark];
    const bounds = individualBounds(mark), reach = radius + mark.width / 2;
    if (bounds.right < Math.min(from.x, to.x) - reach || bounds.left > Math.max(from.x, to.x) + reach || bounds.bottom < Math.min(from.y, to.y) - reach || bounds.top > Math.max(from.y, to.y) + reach) return [mark];
    const pieces = cutStroke(mark, from, to, radius, id);
    if (pieces.length === 1 && pieces[0] === mark) return [mark];
    changed = true;
    return mode === "stroke" ? [] : pieces;
  });
  return changed ? next : marks;
}
