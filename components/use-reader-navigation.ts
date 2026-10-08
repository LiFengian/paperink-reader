import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

type Position = { x: number; y: number };
type Anchor = { source: Position; client: Position; local: Position; startZoom: number };
type Options = { enabled: boolean; identity?: string; workspace: RefObject<HTMLDivElement | null>; canvas: RefObject<HTMLCanvasElement | null>; scale: number; fit: number; zoom: number; setZoom: (zoom: number) => void; settled: () => void };

export function useReaderNavigation(options: Options) {
  const current = useRef(options); current.current = options;
  const fingers = useRef(new Map<number, Position>());
  const pan = useRef<{ pointer: number; last: Position; time: number; vx: number; vy: number } | null>(null);
  const pinch = useRef<{ distance: number; anchor: Anchor; target: number } | null>(null);
  const frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingZoom = useRef<{ anchor: Anchor; target: number } | null>(null);
  const stopMomentum = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  const position = (event: ReactPointerEvent) => ({ x: event.clientX, y: event.clientY });
  const midpoint = (a: Position, b: Position) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function anchor(client: Position): Anchor | null {
    const paper = current.current.canvas.current?.parentElement;
    if (!paper) return null;
    const bounds = paper.getBoundingClientRect(), local = { x: client.x - bounds.left, y: client.y - bounds.top };
    return { client, local, source: { x: local.x / current.current.scale, y: local.y / current.current.scale }, startZoom: current.current.zoom };
  }
  function preview(a: Anchor, target: number, client = a.client, animate = false) {
    const paper = current.current.canvas.current?.parentElement;
    if (!paper) return;
    paper.style.transformOrigin = `${a.local.x}px ${a.local.y}px`;
    paper.style.transition = animate ? "transform 150ms ease-out" : "none";
    paper.style.transform = `translate(${client.x - a.client.x}px, ${client.y - a.client.y}px) scale(${target / a.startZoom})`;
  }
  function commit(a: Anchor, target: number, client = a.client) {
    const { workspace, canvas, fit, setZoom, settled } = current.current, viewport = workspace.current, paper = canvas.current?.parentElement;
    if (!viewport || !paper) return;
    paper.style.transition = "none"; paper.style.transform = "";
    if (canvas.current) canvas.current.style.visibility = "hidden";
    flushSync(() => setZoom(target));
    const bounds = paper.getBoundingClientRect();
    viewport.scrollLeft += bounds.left + a.source.x * fit * target - client.x;
    viewport.scrollTop += bounds.top + a.source.y * fit * target - client.y;
    settled();
  }
  function zoomBy(delta: number) {
    const viewport = current.current.workspace.current;
    if (!viewport || pinch.current) return;
    stopMomentum();
    const bounds = viewport.getBoundingClientRect(), a = pendingZoom.current?.anchor || anchor({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
    if (!a) return;
    const target = Math.max(0.5, Math.min(5, (pendingZoom.current?.target ?? current.current.zoom) + delta));
    pendingZoom.current = { anchor: a, target }; preview(a, target, a.client, true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; pendingZoom.current = null; commit(a, target); }, 160);
  }
  function start(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!current.current.enabled || !current.current.workspace.current) return false;
    if (event.pointerType === "mouse" && event.button !== 0) return true;
    event.preventDefault(); stopMomentum();
    if (pendingZoom.current) { const pending = pendingZoom.current; if (timer.current) clearTimeout(timer.current); pendingZoom.current = null; commit(pending.anchor, pending.target); }
    if (fingers.current.has(event.pointerId) || fingers.current.size >= 2 || (event.pointerType !== "touch" && fingers.current.size)) return true;
    fingers.current.set(event.pointerId, position(event));
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic input or an ended pointer. */ }
    if (fingers.current.size === 2 && event.pointerType === "touch") {
      const [a, b] = [...fingers.current.values()], focus = midpoint(a, b), initial = anchor(focus);
      if (initial) { pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: initial, target: initial.startZoom }; pan.current = null; }
    } else pan.current = { pointer: event.pointerId, last: position(event), time: performance.now(), vx: 0, vy: 0 };
    return true;
  }
  function move(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!current.current.enabled) return false;
    if (!fingers.current.has(event.pointerId)) return false;
    event.preventDefault(); fingers.current.set(event.pointerId, position(event));
    if (pinch.current && fingers.current.size === 2) {
      const [a, b] = [...fingers.current.values()], focus = midpoint(a, b), state = pinch.current;
      state.target = Math.max(0.5, Math.min(5, state.anchor.startZoom * Math.hypot(a.x - b.x, a.y - b.y) / state.distance));
      preview(state.anchor, state.target, focus); return true;
    }
    const state = pan.current, viewport = current.current.workspace.current;
    if (state?.pointer === event.pointerId && viewport) {
      const now = performance.now(), dt = Math.max(8, now - state.time), dx = state.last.x - event.clientX, dy = state.last.y - event.clientY;
      viewport.scrollLeft += dx; viewport.scrollTop += dy;
      state.vx = state.vx * 0.3 + Math.max(-3, Math.min(3, dx / dt)) * 0.7;
      state.vy = state.vy * 0.3 + Math.max(-3, Math.min(3, dy / dt)) * 0.7;
      state.last = position(event); state.time = now;
    }
    return true;
  }
  function end(event: ReactPointerEvent<SVGSVGElement>): boolean {
    if (!current.current.enabled) return false;
    if (!fingers.current.has(event.pointerId)) return false;
    event.preventDefault();
    if (pinch.current) {
      const state = pinch.current, values = [...fingers.current.values()], focus = midpoint(values[0], values[1]);
      pinch.current = null; commit(state.anchor, state.target, focus);
      fingers.current.delete(event.pointerId);
      const remaining = [...fingers.current.entries()][0];
      pan.current = remaining ? { pointer: remaining[0], last: remaining[1], time: performance.now(), vx: 0, vy: 0 } : null;
      return true;
    }
    fingers.current.delete(event.pointerId);
    const state = pan.current; pan.current = null;
    if (!state || event.type === "pointercancel" || event.type === "lostpointercapture" || performance.now() - state.time > 100) { current.current.settled(); return true; }
    let vx = state.vx, vy = state.vy, last = performance.now(), elapsed = 0;
    const step = (time: number) => {
      const viewport = current.current.workspace.current;
      if (!viewport) return;
      const dt = Math.min(32, time - last); last = time; elapsed += dt;
      const beforeX = viewport.scrollLeft, beforeY = viewport.scrollTop;
      viewport.scrollLeft += vx * dt; viewport.scrollTop += vy * dt;
      if (viewport.scrollLeft === beforeX) vx = 0;
      if (viewport.scrollTop === beforeY) vy = 0;
      const friction = Math.exp(-dt / 180); vx *= friction; vy *= friction;
      if (Math.hypot(vx, vy) > 0.025 && elapsed < 900) frame.current = requestAnimationFrame(step);
      else { frame.current = null; current.current.settled(); }
    };
    frame.current = requestAnimationFrame(step);
    return true;
  }
  useEffect(() => {
    stopMomentum(); fingers.current.clear(); pan.current = null; pinch.current = null;
    return () => {
      stopMomentum(); if (timer.current) clearTimeout(timer.current); timer.current = null; pendingZoom.current = null;
      const paper = current.current.canvas.current?.parentElement; if (paper) { paper.style.transform = ""; paper.style.transition = ""; }
    };
  }, [options.identity, options.enabled]);
  return { start, move, end, zoomBy };
}
