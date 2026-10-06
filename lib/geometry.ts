import type { Mark, Point } from "./reader-types";

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const pathFromPoints = (points: Point[], close = false) =>
  points.length ? `M ${points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}${close ? " Z" : ""}` : "";

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y + Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

export function markInPolygon(mark: Mark, polygon: Point[]) {
  return mark.type === "stroke"
    ? mark.points.some(point => pointInPolygon(point, polygon))
    : pointInPolygon({ x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 }, polygon);
}

export function markBounds(marks: Mark[]) {
  const points = marks.flatMap(mark => mark.type === "stroke" ? mark.points : [
    { x: mark.x, y: mark.y }, { x: mark.x + mark.width, y: mark.y + mark.height },
  ]);
  if (!points.length) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function movedMark(mark: Mark, dx: number, dy: number): Mark {
  return mark.type === "stroke" ? { ...mark, points: mark.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
    : { ...mark, x: mark.x + dx, y: mark.y + dy };
}

export function markNear(mark: Mark, point: Point) {
  if (mark.type === "image") return point.x >= mark.x && point.x <= mark.x + mark.width && point.y >= mark.y && point.y <= mark.y + mark.height;
  if (mark.points.length === 1) return Math.hypot(point.x - mark.points[0].x, point.y - mark.points[0].y) < 10;
  for (let i = 1; i < mark.points.length; i++) {
    const a = mark.points[i - 1], b = mark.points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) < Math.max(8, mark.width / 2 + 6)) return true;
  }
  return false;
}
