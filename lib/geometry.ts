import type { Mark, Point } from "./reader-types";

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export const pathFromPoints = (points: Point[], close = false) =>
  points.length ? `M ${points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}${close ? " Z" : ""}` : "";

const boundsCache = new WeakMap<Mark, { left: number; right: number; top: number; bottom: number }>();
const polygonBoundsCache = new WeakMap<Point[], { left: number; right: number; top: number; bottom: number }>();
export function individualBounds(mark: Mark) {
  const existing = boundsCache.get(mark); if (existing) return existing;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  if (mark.type === "image") { left = mark.x; right = mark.x + mark.width; top = mark.y; bottom = mark.y + mark.height; }
  else for (const point of mark.points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
  const bounds = { left, right, top, bottom }; boundsCache.set(mark, bounds); return bounds;
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y + Number.EPSILON) + a.x) inside = !inside;
  }
  return inside;
}

export function markInPolygon(mark: Mark, polygon: Point[]) {
  const bounds = individualBounds(mark);
  let area = polygonBoundsCache.get(polygon);
  if (!area) {
    area = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const point of polygon) { area.left = Math.min(area.left, point.x); area.right = Math.max(area.right, point.x); area.top = Math.min(area.top, point.y); area.bottom = Math.max(area.bottom, point.y); }
    polygonBoundsCache.set(polygon, area);
  }
  if (bounds.right < area.left || bounds.left > area.right || bounds.bottom < area.top || bounds.top > area.bottom) return false;
  return mark.type === "stroke"
    ? mark.points.some(point => pointInPolygon(point, polygon))
    : pointInPolygon({ x: mark.x + mark.width / 2, y: mark.y + mark.height / 2 }, polygon);
}

export function markBounds(marks: Mark[]) {
  if (!marks.length) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const mark of marks) { const bounds = individualBounds(mark); left = Math.min(left, bounds.left); right = Math.max(right, bounds.right); top = Math.min(top, bounds.top); bottom = Math.max(bottom, bounds.bottom); }
  return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null;
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
