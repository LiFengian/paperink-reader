"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownToLine, BookOpen, ChevronLeft, ChevronRight, CircleHelp, Eraser, FilePlus2, FolderOpen, Hand, Highlighter, ImagePlus, Lasso, Menu, MessageCircle, Minus, PenLine, Plus, Redo2, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createShareablePdf } from "../lib/export-pdf";
import { deleteDocument, getPdf, listDocuments, saveDocument, savePdf } from "../lib/local-store";
import { clamp, markBounds, markInPolygon, markNear, movedMark, pathFromPoints, pointInPolygon } from "../lib/geometry";
import type { ChatMessage, Mark, Point, ReaderDocument, ReaderPage, Stroke, ToolName } from "../lib/reader-types";

type Gesture =
  | { kind: "draw"; pointer: number; points: Point[]; pageId: string }
  | { kind: "move"; pointer: number; start: Point; before: Mark[]; after: Mark[]; pageId: string }
  | { kind: "pan"; pointer: number; x: number; y: number; left: number; top: number };
type History = { pageId: string; before: Mark[]; after: Mark[] };
type Quote = { text: string; pageId: string };
const COLORS = ["#202a35", "#d4654f", "#4c79bb", "#298f79", "#e3ba4e"];
const uid = () => crypto.randomUUID();

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`tool-button ${active ? "active" : ""}`} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

export default function Home() {
  const [library, setLibrary] = useState<ReaderDocument[]>([]);
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<ToolName>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2.5);
  const [zoom, setZoom] = useState(1);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(false);
  const [viewSize, setViewSize] = useState({ width: 900, height: 900 });
  const pdfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chatMessages = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const undoStack = useRef<History[]>([]);
  const redoStack = useRef<History[]>([]);
  const page = doc?.pages[doc.currentPage] || null;
  const fit = page ? Math.min((viewSize.width - 48) / page.width, (viewSize.height - 48) / page.height, 1.4) : 1;
  const scale = Math.max(0.25, fit * zoom);
  const selectionBounds = useMemo(() => markBounds(page?.marks.filter(mark => selected.includes(mark.id)) || []), [page, selected]);

  useEffect(() => { listDocuments().then(setLibrary).catch(() => setMessage("无法读取本地文献库。")); }, []);
  useEffect(() => {
    const node = workspace.current;
    if (!node) return;
    const update = () => setViewSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [!!doc, chatOpen, libraryOpen]);
  useEffect(() => {
    if (!doc) return;
    const timer = window.setTimeout(() => {
      saveDocument(doc).then(() => setLibrary(list => [doc, ...list.filter(item => item.id !== doc.id)].sort((a, b) => b.updatedAt - a.updatedAt)))
        .catch(() => setMessage("自动保存失败。请检查 iPad 存储空间并导出 PDF。"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    chatMessages.current?.scrollTo({ top: chatMessages.current.scrollHeight, behavior: "smooth" });
  }, [doc?.chat.length, busy, chatOpen]);
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setPdf(null);
    if (doc) (async () => {
      const blob = await getPdf(doc.id);
      if (!blob || cancelled) return;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = pdfjs.getDocument({ data: await blob.arrayBuffer() });
      const opened = await (task as ReturnType<typeof pdfjs.getDocument>).promise;
      if (!cancelled) setPdf(opened);
    })().catch(() => { if (!cancelled) setMessage("PDF 加载失败，请尝试重新导入。"); });
    return () => { cancelled = true; task?.destroy().catch(() => {}); };
  }, [doc?.id]);
  useEffect(() => {
    if (!page || !canvas.current) return;
    let cancelled = false;
    let rendering: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const target = canvas.current!;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      target.width = Math.round(page.width * scale * ratio);
      target.height = Math.round(page.height * scale * ratio);
      target.style.width = `${page.width * scale}px`;
      target.style.height = `${page.height * scale}px`;
      const context = target.getContext("2d");
      if (!context) return;
      context.fillStyle = "white";
      context.fillRect(0, 0, target.width, target.height);
      if (page.sourcePage === null || !pdf) return;
      const sourcePage = await pdf.getPage(page.sourcePage);
      if (cancelled) return;
      rendering = sourcePage.render({
        canvas: target, canvasContext: context, viewport: sourcePage.getViewport({ scale }),
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await rendering.promise;
    })().catch(error => { if (!cancelled && error?.name !== "RenderingCancelledException") setMessage("这一页渲染失败。"); });
    return () => { cancelled = true; rendering?.cancel(); };
  }, [pdf, page?.id, page?.sourcePage, page?.width, page?.height, scale]);

  const updateDoc = useCallback((change: (current: ReaderDocument) => ReaderDocument) => {
    setDoc(current => current ? { ...change(current), updatedAt: Date.now() } : null);
  }, []);
  const setMarks = (pageId: string, marks: Mark[]) => {
    if (!doc) return;
    const before = doc.pages.find(item => item.id === pageId)?.marks || [];
    undoStack.current.push({ pageId, before, after: marks });
    redoStack.current = [];
    updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === pageId ? { ...item, marks } : item) }));
  };
  const applyHistory = (entry: History, marks: Mark[]) => {
    updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === entry.pageId ? { ...item, marks } : item) }));
    setSelected([]);
  };
  const undo = () => { const entry = undoStack.current.pop(); if (entry) { redoStack.current.push(entry); applyHistory(entry, entry.before); } };
  const redo = () => { const entry = redoStack.current.pop(); if (entry) { undoStack.current.push(entry); applyHistory(entry, entry.after); } };

  async function importPdf(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setMessage("请选择 PDF 文件。"); return; }
    setBusy(true); setMessage("正在读取 PDF…");
    try {
      const bytes = await file.arrayBuffer();
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ data: bytes.slice(0) });
      const opened = await task.promise;
      const pages: ReaderPage[] = [];
      for (let i = 1; i <= opened.numPages; i++) {
        const source = await opened.getPage(i);
        const viewport = source.getViewport({ scale: 1 });
        pages.push({ id: uid(), sourcePage: i, width: viewport.width, height: viewport.height, marks: [] });
      }
      await task.destroy();
      const next: ReaderDocument = { id: uid(), name: file.name, createdAt: Date.now(), updatedAt: Date.now(), currentPage: 0, pages, chat: [] };
      await savePdf(next.id, file);
      await saveDocument(next);
      setLibrary(items => [next, ...items]); setDoc(next); setZoom(1); setLibraryOpen(false);
      setMessage(`已导入 ${pages.length} 页，文件保存在此设备。`);
    } catch { setMessage("PDF 导入失败。加密或损坏的 PDF 可能无法打开。"); }
    finally { setBusy(false); if (pdfInput.current) pdfInput.current.value = ""; }
  }
  function changePage(index: number) {
    if (!doc) return;
    updateDoc(current => ({ ...current, currentPage: clamp(index, 0, current.pages.length - 1) }));
    setSelected([]); setQuote(null); setZoom(1); workspace.current?.scrollTo(0, 0);
  }
  function addBlankPage() {
    if (!page) return;
    const blank: ReaderPage = { id: uid(), sourcePage: null, width: page.width, height: page.height, marks: [] };
    updateDoc(current => {
      const pages = [...current.pages];
      pages.splice(current.currentPage + 1, 0, blank);
      return { ...current, pages, currentPage: current.currentPage + 1 };
    });
    setSelected([]); setMessage("已插入空白页。");
  }
  async function addImage(file: File) {
    if (!page) return;
    try {
      const url = URL.createObjectURL(file);
      const image = new Image(); image.src = url; await image.decode();
      const copy = window.document.createElement("canvas");
      const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
      copy.width = Math.round(image.width * ratio); copy.height = Math.round(image.height * ratio);
      copy.getContext("2d")!.drawImage(image, 0, 0, copy.width, copy.height);
      URL.revokeObjectURL(url);
      const imageWidth = Math.min(260, page.width * 0.42);
      const imageHeight = imageWidth * copy.height / copy.width;
      const mark: Mark = { id: uid(), type: "image", src: copy.toDataURL("image/png"), x: (page.width - imageWidth) / 2, y: (page.height - imageHeight) / 2, width: imageWidth, height: imageHeight };
      setMarks(page.id, [...page.marks, mark]); setTool("lasso"); setSelected([mark.id]);
      setMessage("图片已插入。用套索工具拖动它。");
    } catch { setMessage("图片插入失败，请换一张图片重试。"); }
    if (imageInput.current) imageInput.current.value = "";
  }
  async function exportPdf() {
    if (!doc) return;
    setBusy(true); setMessage("正在生成可分享的 PDF…");
    try {
      const source = await getPdf(doc.id);
      if (!source) throw new Error("missing pdf");
      const bytes = await createShareablePdf(doc, source);
      const filename = doc.name.replace(/\.pdf$/i, "") + "-墨读批注.pdf";
      const file = new File([new Uint8Array(bytes)], filename, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: filename });
      else {
        const url = URL.createObjectURL(file), anchor = window.document.createElement("a");
        anchor.href = url; anchor.download = filename; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setMessage("PDF 已生成，可通过系统分享发送到微信。");
    } catch (error) { if ((error as Error)?.name !== "AbortError") setMessage("PDF 导出失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function extractText(polygon: Point[]) {
    if (!page || !canvas.current) return;
    setBusy(true); setMessage("正在识别圈选的文字…");
    try {
      let text = "";
      if (page.sourcePage !== null && pdf) {
        const source = await pdf.getPage(page.sourcePage);
        const content = await source.getTextContent();
        const pdfjs = await import("pdfjs-dist");
        const viewport = source.getViewport({ scale: 1 });
        const pieces: string[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.max(3, Math.hypot(transform[2], transform[3]));
          const w = item.width || height;
          const a = { x: transform[4], y: transform[5] - height };
          const b = { x: transform[4] + w, y: transform[5] };
          const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if ([a, b, center].some(point => pointInPolygon(point, polygon))) pieces.push(item.str + (item.hasEOL ? "\n" : " "));
        }
        text = pieces.join("").replace(/[ \t]+\n/g, "\n").trim();
      }
      if (!text) {
        const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
        const x = Math.max(0, Math.min(...xs) - 10), y = Math.max(0, Math.min(...ys) - 10);
        const w = Math.min(page.width - x, Math.max(...xs) - x + 10), h = Math.min(page.height - y, Math.max(...ys) - y + 10);
        const factor = canvas.current.width / page.width;
        const crop = window.document.createElement("canvas");
        crop.width = Math.max(1, Math.round(w * factor)); crop.height = Math.max(1, Math.round(h * factor));
        crop.getContext("2d")!.drawImage(canvas.current, x * factor, y * factor, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "ocr", image: crop.toDataURL("image/jpeg", 0.82) }) });
        const result = await response.json() as { error?: string; content?: string };
        if (!response.ok) throw new Error(result.error);
        text = result.content || "";
      }
      setQuote({ text, pageId: page.id }); setChatOpen(true);
      setMessage("文字已提取，可修改原文并补充你的问题。");
    } catch (error) { setMessage((error as Error).message || "文字识别失败，请重试。"); }
    finally { setBusy(false); }
  }
  function eventPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / scale, 0, page!.width), y: clamp((event.clientY - bounds.top) / scale, 0, page!.height) };
  }
  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!page || !workspace.current) return;
    if (event.pointerType === "touch" || tool === "pan") {
      gesture.current = { kind: "pan", pointer: event.pointerId, x: event.clientX, y: event.clientY, left: workspace.current.scrollLeft, top: workspace.current.scrollTop };
    } else {
      const point = eventPoint(event);
      if (tool === "eraser") {
        const hit = [...page.marks].reverse().find(mark => markNear(mark, point));
        if (hit) setMarks(page.id, page.marks.filter(mark => mark.id !== hit.id));
        return;
      }
      if (tool === "lasso" && selectionBounds && point.x >= selectionBounds.x - 12 && point.x <= selectionBounds.x + selectionBounds.width + 12 && point.y >= selectionBounds.y - 12 && point.y <= selectionBounds.y + selectionBounds.height + 12) {
        gesture.current = { kind: "move", pointer: event.pointerId, start: point, before: page.marks, after: page.marks, pageId: page.id };
      } else {
        if (tool === "lasso") setSelected([]);
        gesture.current = { kind: "draw", pointer: event.pointerId, points: [point], pageId: page.id };
        setDraft([point]);
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId || !page || !workspace.current) return;
    if (active.kind === "pan") {
      workspace.current.scrollLeft = active.left - (event.clientX - active.x);
      workspace.current.scrollTop = active.top - (event.clientY - active.y);
    } else if (active.kind === "draw") {
      const point = eventPoint(event), last = active.points.at(-1)!;
      if (Math.hypot(point.x - last.x, point.y - last.y) < 1.2) return;
      active.points.push(point); setDraft([...active.points]);
    } else {
      const point = eventPoint(event), dx = point.x - active.start.x, dy = point.y - active.start.y;
      const moved = active.before.map(mark => selected.includes(mark.id) ? movedMark(mark, dx, dy) : mark);
      active.after = moved;
      updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === active.pageId ? { ...item, marks: moved } : item) }));
    }
  }
  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId || !page) return;
    gesture.current = null;
    if (active.kind === "draw") {
      setDraft([]);
      if (tool === "pen" || tool === "highlighter") {
        const points = active.points.length === 1
          ? [active.points[0], { x: active.points[0].x + 0.01, y: active.points[0].y + 0.01 }]
          : active.points;
        const stroke: Stroke = { id: uid(), type: "stroke", tool, color: tool === "highlighter" && color === COLORS[0] ? "#e9c84f" : color, width: tool === "highlighter" ? width * 6 : width, points };
        setMarks(active.pageId, [...page.marks, stroke]);
      } else if (tool === "lasso") {
        if (active.points.length < 3) return;
        const ids = page.marks.filter(mark => markInPolygon(mark, active.points)).map(mark => mark.id);
        setSelected(ids); setMessage(ids.length ? `已选中 ${ids.length} 个对象，拖动可移动。` : "未圈中笔迹或图片。");
      } else if (tool === "ask" && active.points.length >= 3) void extractText(active.points);
    } else if (active.kind === "move") {
      if (JSON.stringify(active.before) !== JSON.stringify(active.after)) { undoStack.current.push({ pageId: active.pageId, before: active.before, after: active.after }); redoStack.current = []; }
    }
  }
  async function sendMessage() {
    if (!doc || !prompt.trim() || busy) return;
    const original = quote?.text.trim();
    const content = original ? `【${doc.name}，第 ${doc.pages.findIndex(item => item.id === quote!.pageId) + 1} 页】\n原文：\n${original}\n\n我的问题：${prompt.trim()}` : prompt.trim();
    const user: ChatMessage = { id: uid(), role: "user", content: prompt.trim(), pageId: quote?.pageId, quotedText: original };
    const previous = doc.chat;
    updateDoc(current => ({ ...current, chat: [...current.chat, user] }));
    setPrompt(""); setQuote(null); setBusy(true);
    try {
      const messages = [...previous.slice(-12).map(item => ({ role: item.role, content: item.quotedText ? `原文：${item.quotedText}\n问题：${item.content}` : item.content })), { role: "user", content }];
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
      const result = await response.json() as { error?: string; content?: string };
      if (!response.ok) throw new Error(result.error || "AI 请求失败。");
      updateDoc(current => ({ ...current, chat: [...current.chat, { id: uid(), role: "assistant", content: result.content || "" }] }));
    } catch (error) {
      setMessage((error as Error).message || "AI 请求失败。");
      setPrompt(user.content);
      if (original) setQuote({ text: original, pageId: user.pageId! });
      updateDoc(current => ({ ...current, chat: current.chat.filter(item => item.id !== user.id) }));
    } finally { setBusy(false); }
  }
  async function removeDoc(id: string) {
    if (!confirm("确定删除这份文献及全部本地笔记吗？")) return;
    await deleteDocument(id);
    setLibrary(items => items.filter(item => item.id !== id));
    if (doc?.id === id) setDoc(null);
    setMessage("文献已从这台设备删除。");
  }

  return <main className="app-shell">
    <input ref={pdfInput} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={event => { const file = event.target.files?.[0]; if (file) void importPdf(file); }} />
    <input ref={imageInput} className="hidden-input" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void addImage(file); }} />
    <header className="topbar"><div className="topbar-left"><button className="plain-icon" aria-label="打开文献库" onClick={() => setLibraryOpen(!libraryOpen)}><Menu size={21} /></button><div className="brand"><span className="brand-mark"><BookOpen size={21} /></span>墨读<span className="brand-dot">.</span></div><span className="topbar-divider" /><span className="document-title" title={doc?.name}>{doc?.name || "你的文献工作台"}</span></div><div className="topbar-right"><span className="local-pill"><i />本机保存</span><button className="header-button subtle" onClick={() => setHelp(true)}><CircleHelp size={17} /><span>使用说明</span></button><button className="header-button primary" disabled={!doc || busy} onClick={() => void exportPdf()}><ArrowDownToLine size={17} /><span>导出与分享</span></button></div></header>
    <div className="app-body">
      {libraryOpen && <aside className="library-panel"><div className="panel-heading"><div><span className="eyebrow">LIBRARY</span><h2>文献库</h2></div><button className="plain-icon compact" aria-label="关闭文献库" onClick={() => setLibraryOpen(false)}><X size={18} /></button></div><button className="import-button" disabled={busy} onClick={() => pdfInput.current?.click()}><Plus size={18} />导入 PDF 文献</button><div className="library-caption">最近阅读 <span>{library.length}</span></div><div className="library-list">{library.length ? library.map(item => <div className={`library-item ${doc?.id === item.id ? "selected" : ""}`} key={item.id}><button className="library-open" onClick={() => { setDoc(item); setSelected([]); setQuote(null); setLibraryOpen(false); }}><span className="book-thumb"><BookOpen size={22} /></span><span className="book-info"><strong>{item.name}</strong><small>{item.pages.length} 页 · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span></button><button className="delete-small" title="删除文献" aria-label={`删除 ${item.name}`} onClick={() => void removeDoc(item.id)}><Trash2 size={15} /></button></div>) : <div className="library-empty"><FolderOpen size={28} /><p>还没有文献</p><small>导入 PDF 后，笔记会自动保存在这台设备。</small></div>}</div><div className="library-footer"><span>◈</span><p>文献和笔记仅存于本机。提问会发送所选文字；扫描页识别会发送局部截图至 DeepSeek。</p></div></aside>}
      <section className="reader-area">{doc && page ? <>
        <div className="toolbar"><div className="tool-group"><ToolButton label="移动页面" active={tool === "pan"} onClick={() => setTool("pan")}><Hand size={19} /></ToolButton><ToolButton label="钢笔" active={tool === "pen"} onClick={() => setTool("pen")}><PenLine size={19} /></ToolButton><ToolButton label="荧光笔" active={tool === "highlighter"} onClick={() => setTool("highlighter")}><Highlighter size={19} /></ToolButton><ToolButton label="橡皮擦" active={tool === "eraser"} onClick={() => setTool("eraser")}><Eraser size={19} /></ToolButton><ToolButton label="套索移动" active={tool === "lasso"} onClick={() => setTool("lasso")}><Lasso size={19} /></ToolButton><ToolButton label="圈选问 AI" active={tool === "ask"} onClick={() => setTool("ask")}><Sparkles size={19} /></ToolButton></div><span className="toolbar-divider" /><div className="color-group">{COLORS.map(paint => <button key={paint} className={`color-swatch ${color === paint ? "selected" : ""}`} style={{ background: paint }} aria-label={`颜色 ${paint}`} onClick={() => setColor(paint)} />)}</div><span className="toolbar-divider optional-divider" /><div className="size-group"><span>笔触</span><input aria-label="笔触粗细" type="range" min="1" max="7" step="0.5" value={width} onChange={event => setWidth(Number(event.target.value))} /></div><span className="toolbar-spacer" /><div className="tool-group utility"><ToolButton label="撤销" onClick={undo}><Undo2 size={18} /></ToolButton><ToolButton label="重做" onClick={redo}><Redo2 size={18} /></ToolButton><ToolButton label="插入空白页" onClick={addBlankPage}><FilePlus2 size={18} /></ToolButton><ToolButton label="插入图片" onClick={() => imageInput.current?.click()}><ImagePlus size={18} /></ToolButton></div><button className={`chat-toggle ${chatOpen ? "on" : ""}`} onClick={() => setChatOpen(!chatOpen)}><MessageCircle size={18} /><span>AI 助读</span></button></div>
        <div className="reader-hint"><i />{tool === "ask" ? "用 Apple Pencil 圈住想问的句子，提取后可修改原文并补充问题" : tool === "lasso" ? "圈住笔迹或图片后拖动；手指可移动页面" : tool === "eraser" ? "点按笔迹或图片即可擦除" : "Apple Pencil 书写，手指移动页面"}</div>
        <div ref={workspace} className="workspace"><div className="paper" style={{ width: page.width * scale, height: page.height * scale }}><canvas ref={canvas} className="pdf-canvas" /><svg className="ink-layer" width={page.width * scale} height={page.height * scale} viewBox={`0 0 ${page.width} ${page.height}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>{page.marks.map(mark => mark.type === "stroke" ? <path key={mark.id} d={pathFromPoints(mark.points)} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.tool === "highlighter" ? 0.38 : 1} /> : <image key={mark.id} href={mark.src} x={mark.x} y={mark.y} width={mark.width} height={mark.height} preserveAspectRatio="none" />)}{selectionBounds && <rect x={selectionBounds.x - 8} y={selectionBounds.y - 8} width={selectionBounds.width + 16} height={selectionBounds.height + 16} rx="5" fill="none" stroke="#537abc" strokeWidth="1.5" strokeDasharray="6 5" pointerEvents="none" />}{draft.length > 0 && <path d={pathFromPoints(draft, tool === "ask" || tool === "lasso")} fill={tool === "ask" ? "rgba(82,118,195,.1)" : "none"} stroke={tool === "ask" ? "#577fc5" : tool === "lasso" ? "#537abc" : color} strokeWidth={tool === "ask" || tool === "lasso" ? 2 : width} strokeDasharray={tool === "lasso" ? "5 4" : undefined} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}</svg></div></div>
        <footer className="page-footer"><div className="page-navigation"><button aria-label="上一页" disabled={doc.currentPage === 0} onClick={() => changePage(doc.currentPage - 1)}><ChevronLeft size={19} /></button><span><strong>{doc.currentPage + 1}</strong> / {doc.pages.length}</span><button aria-label="下一页" disabled={doc.currentPage === doc.pages.length - 1} onClick={() => changePage(doc.currentPage + 1)}><ChevronRight size={19} /></button></div><div className="zoom-controls"><button aria-label="缩小" onClick={() => setZoom(value => clamp(value - 0.15, 0.5, 3))}><Minus size={17} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大" onClick={() => setZoom(value => clamp(value + 0.15, 0.5, 3))}><Plus size={17} /></button></div></footer>
      </> : <div className="welcome"><div className="welcome-art"><div className="art-page back" /><div className="art-page front"><div className="art-lines"><i /><i /><i /><i /></div><span>∿</span></div><b>✦</b></div><span className="eyebrow">YOUR READING DESK</span><h1>让思考留在文献旁边。</h1><p>导入 PDF，用 Apple Pencil 写下想法，圈出看不懂的句子，随时向 AI 提问。</p><button className="welcome-import" onClick={() => pdfInput.current?.click()}><Plus size={19} />导入第一篇文献</button><div className="welcome-steps"><span><PenLine size={16} />自由批注</span><span><Lasso size={16} />套索整理</span><span><Sparkles size={16} />圈选问 AI</span></div></div>}</section>
      {chatOpen && <aside className="chat-panel"><div className="chat-heading"><div className="chat-heading-icon"><Sparkles size={20} /></div><div><span className="eyebrow">READING COMPANION</span><h2>AI 助读</h2></div><button className="plain-icon compact chat-close" aria-label="关闭 AI 助读" onClick={() => setChatOpen(false)}><X size={19} /></button></div><div ref={chatMessages} className="chat-messages">{doc?.chat.length ? doc.chat.map(item => <div className={`chat-message ${item.role}`} key={item.id}>{item.role === "assistant" && <span className="assistant-avatar">✦</span>}<div className="message-body">{item.quotedText && <div className="message-quote">“{item.quotedText.slice(0, 230)}{item.quotedText.length > 230 ? "…" : ""}”</div>}<p>{item.content}</p></div></div>) : <div className="chat-empty"><span>✦</span><h3>读到哪里，问到哪里</h3><p>用工具栏的 <strong>圈选问 AI</strong> 圈出段落，或在下方直接输入问题。</p><button onClick={() => setPrompt("请解释这篇文献中的核心研究问题。")}>解释研究问题 <ChevronRight size={15} /></button><button onClick={() => setPrompt("请帮我梳理这页的主要论证。")}>梳理主要论证 <ChevronRight size={15} /></button></div>}{busy && <div className="typing-indicator"><i /><i /><i /></div>}</div><div className="chat-composer">{quote && <div className="quote-editor"><div><span>第 {doc ? doc.pages.findIndex(item => item.id === quote.pageId) + 1 : 1} 页圈选文字 · 可编辑</span><button aria-label="移除引用" onClick={() => setQuote(null)}><X size={15} /></button></div><textarea aria-label="圈选文字" value={quote.text} onChange={event => setQuote({ ...quote, text: event.target.value })} rows={4} /></div>}<div className="composer-box"><textarea aria-label="向 AI 提问" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={doc ? "输入你的问题，或先圈选文献…" : "先导入一份 PDF 文献"} disabled={!doc || busy} rows={3} /><div><span>Enter 发送 · Shift + Enter 换行</span><button aria-label="发送消息" disabled={!doc || busy || !prompt.trim()} onClick={() => void sendMessage()}><Send size={17} /></button></div></div></div></aside>}
    </div>
    {message && <div className="status-toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={() => setMessage("")}><X size={14} /></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-modal" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭说明" onClick={() => setHelp(false)}><X size={20} /></button><span className="eyebrow">QUICK START</span><h2>在 iPad 上开始阅读</h2><p><strong>01 导入文献</strong> 从“文件”选择 PDF，原文和笔记保存在当前 iPad 的浏览器存储中。</p><p><strong>02 手写与整理</strong> Apple Pencil 写画；套索圈住笔迹或图片后拖动。手指移动页面。</p><p><strong>03 圈选提问</strong> 点击 ✦ 工具，用笔圈出文字。确认提取内容并补充问题再发送。</p><p><strong>04 分享批注</strong> 点击“导出与分享”，生成含笔迹和插图的 PDF，可发到微信。</p><div className="help-note">建议定期导出 PDF；清除 Safari 网站数据会删除本机保存的文献与笔记。</div><button className="help-done" onClick={() => setHelp(false)}>开始使用</button></div></div>}
  </main>;
}
