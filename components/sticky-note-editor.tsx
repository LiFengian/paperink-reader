"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Eraser, PenLine, Redo2, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { InkMarks } from "./ink-marks";
import { clamp } from "../lib/geometry";
import { eraseMarks } from "../lib/eraser";
import type { NoteMark, Point, Stroke } from "../lib/reader-types";

type Props = {
  note: NoteMark;
  pageNumber: number;
  onChange: (change: Partial<Pick<NoteMark, "text" | "strokes">>) => void;
  onClose: () => void;
  onDelete: () => void;
  onActivity: () => void;
};
type Input = { pointer: number; points: Point[]; before: Stroke[]; after: Stroke[]; mode: "pen" | "eraser"; color: string; width: number; left: number; top: number; scale: number; painted: number };

export function StickyNoteEditor({ note, pageNumber, onChange, onClose, onDelete, onActivity }: Props) {
  const [tab, setTab] = useState<"ink" | "text">(note.text && !note.strokes.length ? "text" : "ink");
  const [mode, setMode] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#202a35");
  const [width, setWidth] = useState(2.5);
  const [preview, setPreview] = useState<Stroke[] | null>(null);
  const [history, setHistory] = useState<{ before: Stroke[]; after: Stroke[] }[]>([]);
  const [redo, setRedo] = useState<{ before: Stroke[]; after: Stroke[] }[]>([]);
  const surface = useRef<HTMLDivElement>(null), live = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input | null>(null), frame = useRef<number | null>(null);
  const close = useRef(onClose); close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".sticky-note-dialog"); dialog?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key === "Tab" && dialog) {
        const items = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled),textarea,input")], first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => {
    const node = surface.current; if (!node) return;
    const block = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    for (const name of ["touchstart", "touchmove", "contextmenu", "selectstart"]) node.addEventListener(name, block, { passive: false });
    return () => { for (const name of ["touchstart", "touchmove", "contextmenu", "selectstart"]) node.removeEventListener(name, block); };
  }, [tab]);

  function point(event: { clientX: number; clientY: number }, active: Input): Point {
    return { x: clamp((event.clientX - active.left) / active.scale, 0, note.noteWidth), y: clamp((event.clientY - active.top) / active.scale, 0, note.noteHeight) };
  }
  function paint() {
    frame.current = null;
    const active = input.current; if (!active) return;
    if (active.mode === "eraser") { setPreview(active.after); return; }
    const context = live.current?.getContext("2d"); if (!context) return;
    if (!active.painted) { const p = active.points[0]; context.beginPath(); context.arc(p.x, p.y, active.width / 2, 0, Math.PI * 2); context.fill(); active.painted = 1; }
    if (active.painted >= active.points.length) return;
    context.beginPath(); const start = active.points[active.painted - 1]; context.moveTo(start.x, start.y);
    for (let i = active.painted; i < active.points.length; i++) context.lineTo(active.points[i].x, active.points[i].y);
    context.stroke(); active.painted = active.points.length;
  }
  function append(event: ReactPointerEvent<SVGSVGElement>, active: Input) {
    for (const sample of [...(event.nativeEvent.getCoalescedEvents?.() || []), event.nativeEvent]) {
      const next = point(sample, active), previous = active.points.at(-1)!;
      if (Math.hypot(next.x - previous.x, next.y - previous.y) < 0.15) continue;
      if (active.mode === "eraser") active.after = eraseMarks(active.after, previous, next, 8, "area", () => crypto.randomUUID()) as Stroke[];
      active.points.push(next);
    }
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    onActivity();
    event.preventDefault();
    if (input.current || event.pointerType === "touch" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const box = event.currentTarget.getBoundingClientRect(), canvas = live.current!;
    const active: Input = { pointer: event.pointerId, points: [], before: note.strokes, after: note.strokes, mode, color, width, left: box.left, top: box.top, scale: box.width / note.noteWidth, painted: 0 };
    active.points.push(point(event, active)); input.current = active;
    if (mode === "eraser") active.after = eraseMarks(active.before, active.points[0], active.points[0], 8, "area", () => crypto.randomUUID()) as Stroke[];
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(box.width * ratio); canvas.height = Math.ceil(box.height * ratio);
    const context = canvas.getContext("2d")!; context.scale(active.scale * ratio, active.scale * ratio);
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = width; context.lineCap = "round"; context.lineJoin = "round";
    canvas.style.visibility = "visible"; paint();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer already released. */ }
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    onActivity();
    const active = input.current; if (!active || event.pointerId !== active.pointer) return;
    event.preventDefault(); append(event, active);
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    onActivity();
    const active = input.current; if (!active || event.pointerId !== active.pointer) return;
    event.preventDefault();
    if (event.type === "pointerup") append(event, active);
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    const points = active.points.length > 1 ? active.points : [active.points[0], { x: active.points[0].x + 0.01, y: active.points[0].y + 0.01 }];
    const after = active.mode === "eraser" ? active.after : [...active.before, { id: crypto.randomUUID(), type: "stroke" as const, tool: "pen" as const, color: active.color, width: active.width, points }];
    input.current = null; if (live.current) live.current.style.visibility = "hidden"; setPreview(null);
    if (after !== active.before) { setHistory(items => [...items, { before: active.before, after }]); setRedo([]); onChange({ strokes: after }); }
  }
  function undoInk() { const item = history.at(-1); if (item) { setHistory(history.slice(0, -1)); setRedo([...redo, item]); onChange({ strokes: item.before }); } }
  function redoInk() { const item = redo.at(-1); if (item) { setRedo(redo.slice(0, -1)); setHistory([...history, item]); onChange({ strokes: item.after }); } }

  return <div className="sticky-note-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="sticky-note-dialog" role="dialog" aria-modal="true" aria-labelledby="sticky-note-title" tabIndex={-1}>
      <header className="sticky-note-heading"><span className="sticky-note-symbol"><StickyNote size={22} /></span><div><h2 id="sticky-note-title">便签</h2><small>第 {pageNumber} 页 · 随时收起，再点标记展开</small></div><button className="plain-icon" aria-label="收起便签" title="收起便签" onClick={onClose}><X size={20} /></button></header>
      <div className="sticky-note-tabs" role="tablist" aria-label="便签记录方式"><button role="tab" aria-selected={tab === "ink"} aria-controls="sticky-note-ink" id="sticky-note-ink-tab" onClick={() => setTab("ink")}>手写</button><button role="tab" aria-selected={tab === "text"} aria-controls="sticky-note-text" id="sticky-note-text-tab" onClick={() => setTab("text")}>文字</button></div>
      {tab === "text" ? <div role="tabpanel" id="sticky-note-text" aria-labelledby="sticky-note-text-tab"><textarea className="sticky-note-text" aria-label="便签文字" placeholder="记下你的理解、问题和想法…" value={note.text} onChange={event => onChange({ text: event.target.value })} /></div> : <div role="tabpanel" id="sticky-note-ink" aria-labelledby="sticky-note-ink-tab">
        <div className="sticky-note-tools"><button aria-label="便签钢笔" className={mode === "pen" ? "active" : ""} onClick={() => setMode("pen")}><PenLine size={18} /></button><button aria-label="便签橡皮" className={mode === "eraser" ? "active" : ""} onClick={() => setMode("eraser")}><Eraser size={18} /></button><span className="sticky-note-tool-divider" />{["#202a35", "#d4654f", "#4c79bb"].map(value => <button key={value} aria-label={`便签颜色 ${value}`} className={`sticky-note-color ${color === value ? "active" : ""}`} style={{ background: value }} onClick={() => { setColor(value); setMode("pen"); }} />)}<input aria-label="便签笔触粗细" type="range" min="1" max="6" step="0.5" value={width} onChange={event => setWidth(Number(event.target.value))} /><span className="sticky-note-tool-spacer" /><button aria-label="撤销便签笔迹" disabled={!history.length} onClick={undoInk}><Undo2 size={18} /></button><button aria-label="重做便签笔迹" disabled={!redo.length} onClick={redoInk}><Redo2 size={18} /></button></div>
        <div ref={surface} className="sticky-note-ink" style={{ aspectRatio: `${note.noteWidth} / ${note.noteHeight}` }}><canvas ref={live} className="sticky-note-live" /><svg aria-label="便签手写区域" viewBox={`0 0 ${note.noteWidth} ${note.noteHeight}`} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}><InkMarks marks={preview || note.strokes} /></svg></div>
        <p className="sticky-note-pencil-hint">用 Apple Pencil 写画，手掌触碰不会移动便签。</p>
      </div>}
      <footer className="sticky-note-footer"><span>内容自动保存在本机</span><button aria-label="删除便签" onClick={onDelete}><Trash2 size={15} />删除</button><button className="sticky-note-done" onClick={onClose}>收起便签</button></footer>
    </section>
  </div>;
}
