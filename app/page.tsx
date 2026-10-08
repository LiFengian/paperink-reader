"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownToLine, BookOpen, ChevronLeft, ChevronRight, CircleHelp, Eraser, FileMinus2, FilePlus2, FolderOpen, Hand, Highlighter, ImagePlus, Lasso, Menu, MessageCircle, Minus, Paintbrush, PenLine, Plus, Redo2, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useReaderNavigation } from "../components/use-reader-navigation";
import { eraseMarks } from "../lib/eraser";
import type { EraserMode } from "../lib/eraser";
import { readWholePaper, paperReference } from "../lib/paper-context";
import { getAiSettings } from "../lib/ai-client";
import { PersonalControls } from "../components/personal-controls";
import { askAi } from "../lib/ai-client";
import { pdfRaster } from "../lib/pdf-raster";
import { createShareablePdf } from "../lib/export-pdf";
import { createAiContext } from "../lib/ai-context";
import { aiStrokeKind, identifyAiMark } from "../lib/ai-selection";
import { deleteDocument, getPdf, listDocuments, saveDocument, savePdf } from "../lib/local-store";
import { clamp, markBounds, markInPolygon, movedMark, pathFromPoints } from "../lib/geometry";
import type { AiMark, AiSelection, ChatMessage, Mark, Point, ReaderDocument, ReaderPage, Stroke, ToolName } from "../lib/reader-types";

type Gesture =
  | { kind: "draw"; pointer: number; points: Point[]; pageId: string; tool: ToolName; color: string; width: number; left: number; top: number; scale: number; pageWidth: number; pageHeight: number }
  | { kind: "move"; pointer: number; start: Point; before: Mark[]; after: Mark[]; pageId: string }
  | { kind: "erase"; pointer: number; pageId: string; before: Mark[]; after: Mark[]; previous: Point; radius: number; mode: EraserMode };
type History =
  | { kind: "marks"; pageId: string; before: Mark[]; after: Mark[] }
  | { kind: "pages"; before: ReaderPage[]; after: ReaderPage[]; beforePage: number; afterPage: number };
const COLORS = ["#202a35", "#d4654f", "#4c79bb", "#298f79", "#e3ba4e"];
const uid = () => crypto.randomUUID();

function pdfResources(personal: boolean) {
  return personal ? {
    cMapUrl: new URL("./pdfjs/cmaps/", document.baseURI).href, cMapPacked: true,
    standardFontDataUrl: new URL("./pdfjs/standard_fonts/", document.baseURI).href,
    wasmUrl: new URL("./pdfjs/wasm/", document.baseURI).href,
  } : {};
}

function pdfImportErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === "PasswordException") return "这个 PDF 需要密码，暂时无法导入。";
  if (error instanceof Error && error.name === "InvalidPDFException") return "PDF 文件结构损坏，无法导入。";
  if (error instanceof Error && error.name === "QuotaExceededError") return "设备存储空间不足，无法保存 PDF。";
  return "PDF 导入失败，请刷新页面后重试。";
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`tool-button ${active ? "active" : ""}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function AiPenIcon() {
  return <span className="ai-pen-icon" aria-hidden="true"><PenLine size={19} /><span>AI</span></span>;
}

function AccessGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "locked" | "ready" | "unavailable">("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/access", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("访问服务暂时不可用。"); return response.json() as Promise<{ authorized: boolean; configured: boolean }>; })
      .then((result: { authorized: boolean; configured: boolean }) => setStatus(result.authorized ? "ready" : result.configured ? "locked" : "unavailable"))
      .catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    return () => controller.abort();
  }, []);

  async function unlock() {
    if (!code.trim() || submitting) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "验证失败，请重试。");
      setCode(""); setStatus("ready");
    } catch (reason) { setError((reason as Error).message || "验证失败，请重试。"); }
    finally { setSubmitting(false); }
  }

  if (status === "ready") return children;
  return <main className="access-shell"><div className="access-card">
    <div className="access-brand"><span className="brand-mark"><BookOpen size={23} /></span><span>墨读<span className="brand-dot">.</span></span></div>
    <span className="eyebrow">YOUR READING DESK</span>
    <h1>{status === "unavailable" ? "暂时无法验证访问码" : "欢迎回来"}</h1>
    <p>{status === "checking" ? "正在检查这台设备的访问状态…" : status === "unavailable" ? "请稍后刷新页面重试。" : "首次输入应用访问码即可。此后这台设备会记住，无需再登录 GPT。"}</p>
    {status === "locked" && <form onSubmit={event => { event.preventDefault(); void unlock(); }}>
      <label htmlFor="access-code">应用访问码</label>
      <input id="access-code" type="password" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" placeholder="粘贴你的访问码" required />
      {error && <span className="access-error" role="alert">{error}</span>}
      <button type="submit" disabled={submitting || !code}>{submitting ? "正在验证…" : "进入墨读"}</button>
    </form>}
    {status === "unavailable" && <button className="access-retry" onClick={() => window.location.reload()}>刷新页面</button>}
    <small>文献和笔记仍保存在这台设备。</small>
  </div></main>;
}

export default function Home() { return <AccessGate><Reader /></AccessGate>; }

export function Reader({ personal = false }: { personal?: boolean } = {}) {
  const [library, setLibrary] = useState<ReaderDocument[]>([]);
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [tool, setTool] = useState<ToolName>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(2.5);
  const [zoom, setZoom] = useState(1);
  const [eraserMode, setEraserMode] = useState<EraserMode>("stroke");
  const [eraserSize, setEraserSize] = useState(14);
  const [paperStatus, setPaperStatus] = useState("正在准备全文…");
  const [aiLabel, setAiLabel] = useState("Flash · 深度思考");
  const editFrame = useRef<number | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const previewPath = useRef<SVGPathElement>(null);
  const previewFrame = useRef<number | null>(null);
  const [aiMarks, setAiMarks] = useState<AiMark[]>([]);
  const [aiRedoMarks, setAiRedoMarks] = useState<AiMark[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [help, setHelp] = useState(false);
  const [viewSize, setViewSize] = useState({ width: 900, height: 900 });
  const [renderWindow, setRenderWindow] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const viewportFrame = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const renderedPage = useRef<string | null>(null);
  const chatMessages = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const undoStack = useRef<History[]>([]);
  const redoStack = useRef<History[]>([]);
  const page = doc?.pages[doc.currentPage] || null;
  const fit = page ? Math.min((viewSize.width - 48) / page.width, 3) : 1;
  const scale = Math.max(0.25, fit * zoom);
  const selectionBounds = useMemo(() => markBounds(page?.marks.filter(mark => selected.includes(mark.id)) || []), [page, selected]);
  const aiPageNumbers = doc?.pages.flatMap((item, index) => aiMarks.some(mark => mark.pageId === item.id) ? [index + 1] : []) || [];

  function refreshVisiblePdf() {
    const paper = canvas.current?.parentElement, viewport = workspace.current;
    if (!paper || !viewport) return;
    const p = paper.getBoundingClientRect(), v = viewport.getBoundingClientRect();
    const x = Math.max(0, Math.floor(v.left - p.left - 96)), y = Math.max(0, Math.floor(v.top - p.top - 96));
    const width = Math.max(1, Math.ceil(Math.min(p.width, v.right - p.left + 96) - x));
    const height = Math.max(1, Math.ceil(Math.min(p.height, v.bottom - p.top + 96) - y));
    setRenderWindow(previous => previous.x === x && previous.y === y && previous.width === width && previous.height === height ? previous : { x, y, width, height });
  }
  function scheduleVisiblePdf() {
    if (viewportFrame.current !== null) clearTimeout(viewportFrame.current);
    viewportFrame.current = setTimeout(() => { viewportFrame.current = null; refreshVisiblePdf(); }, 70);
  }
  useEffect(() => { refreshVisiblePdf(); }, [page?.id, scale, viewSize.width, viewSize.height]);
  const navigation = useReaderNavigation({ enabled: tool === "pan", identity: page?.id, workspace, canvas, scale, fit, zoom, setZoom, settled: refreshVisiblePdf });
  useEffect(() => {
    const update = () => { const settings = getAiSettings(); setAiLabel(`${settings.model === "deepseek-v4-pro" ? "Pro" : "Flash"} · ${settings.effort === "none" ? "快速回答" : settings.effort === "max" ? "更深入思考" : "深度思考"}`); };
    update(); window.addEventListener("paperink-ai-settings", update); return () => window.removeEventListener("paperink-ai-settings", update);
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!pdf) { setPaperStatus("正在准备全文…"); return; }
    void readWholePaper(pdf, (index, total) => { if (!cancelled) setPaperStatus(`正在准备全文 ${index}/${total} 页…`); })
      .then(context => { if (!cancelled) setPaperStatus(`全文文字已准备 · ${context.pageCount} 页${context.emptyPages.length ? ` · ${context.emptyPages.length} 页无文字层` : ""}`); })
      .catch(error => { if (!cancelled) setPaperStatus((error as Error).message || "全文准备失败，请重新打开文献。"); });
    return () => { cancelled = true; };
  }, [pdf]);

  useEffect(() => {
    const node = workspace.current;
    if (!node) return;
    // Safari's native touch listeners must be non-passive to suppress selection,
    // long-press menus and scroll gestures before they cancel Pencil input.
    const block = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    node.addEventListener("touchstart", block, { passive: false });
    node.addEventListener("touchmove", block, { passive: false });
    node.addEventListener("contextmenu", block);
    node.addEventListener("selectstart", block);
    return () => {
      node.removeEventListener("touchstart", block); node.removeEventListener("touchmove", block);
      node.removeEventListener("contextmenu", block); node.removeEventListener("selectstart", block);
    };
  }, [!!doc]);
  useEffect(() => () => { if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current); if (viewportFrame.current !== null) clearTimeout(viewportFrame.current); if (editFrame.current !== null) cancelAnimationFrame(editFrame.current); }, []);

  useEffect(() => {
    listDocuments().then(items => {
      setLibrary(items);
      if (personal) {
        const lastId = localStorage.getItem("paperink-last-document");
        const last = items.find(item => item.id === lastId);
        if (last) { setDoc(last); setLibraryOpen(false); }
      }
    }).catch(() => setMessage("无法读取本地文献库。"));
  }, [personal]);
  useEffect(() => {
    if (personal && doc) {
      try { localStorage.setItem("paperink-last-document", doc.id); } catch { /* Notes still save to IndexedDB. */ }
    }
  }, [personal, doc?.id]);
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
    if (!doc || gesture.current?.kind === "erase" || gesture.current?.kind === "move") return;
    let cancelled = false;
    saveDocument(doc).then(() => {
      if (!cancelled) setLibrary(list => [doc, ...list.filter(item => item.id !== doc.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    }).catch(() => { if (!cancelled) setMessage("自动保存失败。请检查 iPad 存储空间并保存完整备份。"); });
    return () => { cancelled = true; };
  }, [doc]);
  useEffect(() => {
    chatMessages.current?.scrollTo({ top: chatMessages.current.scrollHeight, behavior: "smooth" });
  }, [doc?.chat.length, busy, chatOpen]);
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    undoStack.current = []; redoStack.current = [];
    setAiMarks([]); setAiRedoMarks([]); setPrompt("");
    setPdf(null);
    if (doc) (async () => {
      const blob = await getPdf(doc.id);
      if (!blob || cancelled) return;
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument({ data: await blob.arrayBuffer(), ...pdfResources(personal) });
      const opened = await (task as ReturnType<typeof pdfjs.getDocument>).promise;
      if (!cancelled) setPdf(opened);
    })().catch(() => { if (!cancelled) setMessage("PDF 加载失败，请尝试重新导入。"); });
    return () => { cancelled = true; task?.destroy().catch(() => {}); };
  }, [doc?.id]);
  useEffect(() => {
    const keepExistingPages = (marks: AiMark[]) => {
      const retained = marks.filter(mark => doc?.pages.some(item => item.id === mark.pageId));
      return retained.length === marks.length ? marks : retained;
    };
    setAiMarks(keepExistingPages); setAiRedoMarks(keepExistingPages);
  }, [doc?.pages]);
  useEffect(() => {
    if (!page || !canvas.current) return;
    let cancelled = false;
    let rendering: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const visible = canvas.current!;
      if (renderedPage.current !== page.id) { visible.style.visibility = "hidden"; renderedPage.current = page.id; }
      const target = window.document.createElement("canvas");
      const raster = pdfRaster(renderWindow.width, renderWindow.height, devicePixelRatio);
      const ratio = raster.ratio;
      target.width = raster.width;
      target.height = raster.height;
      target.style.width = `${renderWindow.width}px`;
      target.style.height = `${renderWindow.height}px`;
      target.style.left = `${renderWindow.x}px`; target.style.top = `${renderWindow.y}px`;
      const context = target.getContext("2d");
      if (!context) return;
      context.fillStyle = "white";
      context.fillRect(0, 0, target.width, target.height);
      if (page.sourcePage !== null && pdf) {
        const sourcePage = await pdf.getPage(page.sourcePage);
        if (cancelled) return;
        rendering = sourcePage.render({ canvas: target, canvasContext: context, viewport: sourcePage.getViewport({ scale }), transform: [ratio, 0, 0, ratio, -renderWindow.x * ratio, -renderWindow.y * ratio] });
        await rendering.promise;
      }
      if (cancelled) return;
      visible.width = target.width; visible.height = target.height;
      visible.style.width = target.style.width; visible.style.height = target.style.height;
      visible.style.left = target.style.left; visible.style.top = target.style.top;
      visible.getContext("2d")?.drawImage(target, 0, 0); visible.style.visibility = "visible";
    })().catch(error => { if (!cancelled && error?.name !== "RenderingCancelledException") setMessage("这一页渲染失败。"); });
    return () => { cancelled = true; rendering?.cancel(); };
  }, [pdf, page?.id, page?.sourcePage, page?.width, page?.height, scale, renderWindow]);

  useEffect(() => {
    const visible = baseCanvas.current;
    if (!page || !visible) return;
    let cancelled = false, task: { cancel: () => void; promise: Promise<void> } | null = null;
    visible.width = 1; visible.height = 1;
    void (async () => {
      const target = window.document.createElement("canvas");
      const density = Math.min(1.5, Math.sqrt(2_000_000 / (page.width * page.height * fit * fit)));
      target.width = Math.max(1, Math.floor(page.width * fit * density)); target.height = Math.max(1, Math.floor(page.height * fit * density));
      const context = target.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, target.width, target.height);
      if (pdf && page.sourcePage !== null) {
        const source = await pdf.getPage(page.sourcePage); if (cancelled) return;
        task = source.render({ canvas: target, canvasContext: context, viewport: source.getViewport({ scale: fit * density }) }); await task.promise;
      }
      if (!cancelled) { visible.width = target.width; visible.height = target.height; visible.getContext("2d")?.drawImage(target, 0, 0); }
    })().catch(() => { /* The sharp renderer reports an actual page failure. */ });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page?.id, page?.sourcePage, fit]);

  const updateDoc = useCallback((change: (current: ReaderDocument) => ReaderDocument) => {
    setDoc(current => current ? { ...change(current), updatedAt: Date.now() } : null);
  }, []);
  const setMarks = (pageId: string, marks: Mark[]) => {
    if (!doc) return;
    const before = doc.pages.find(item => item.id === pageId)?.marks || [];
    undoStack.current.push({ kind: "marks", pageId, before, after: marks });
    redoStack.current = [];
    updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === pageId ? { ...item, marks } : item) }));
  };
  const applyHistory = (entry: History, direction: "before" | "after") => {
    if (entry.kind === "pages") {
      updateDoc(current => ({ ...current, pages: entry[direction], currentPage: direction === "before" ? entry.beforePage : entry.afterPage }));
      clearPreview(); setZoom(1); gesture.current = null; workspace.current?.scrollTo(0, 0);
      setMessage(direction === "before" ? "已撤销页面操作。" : "已重做页面操作。");
    } else {
      updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === entry.pageId ? { ...item, marks: entry[direction] } : item) }));
    }
    setSelected([]);
  };
  function undoAiMark() {
    const last = aiMarks.at(-1);
    if (!last || busy) return;
    setAiMarks(aiMarks.slice(0, -1)); setAiRedoMarks([...aiRedoMarks, last]);
  }
  function redoAiMark() {
    const last = aiRedoMarks.at(-1);
    if (!last || busy) return;
    setAiMarks([...aiMarks, last]); setAiRedoMarks(aiRedoMarks.slice(0, -1));
  }
  function clearAiMarks() { if (!busy) { setAiMarks([]); setAiRedoMarks([]); } }
  const undo = () => { if (tool === "ask") { undoAiMark(); return; } const entry = undoStack.current.pop(); if (entry) { redoStack.current.push(entry); applyHistory(entry, "before"); } };
  const redo = () => { if (tool === "ask") { redoAiMark(); return; } const entry = redoStack.current.pop(); if (entry) { undoStack.current.push(entry); applyHistory(entry, "after"); } };

  async function importPdf(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setMessage("请选择 PDF 文件。"); return; }
    setBusy(true); setMessage("正在读取 PDF…");
    try {
      const bytes = await file.arrayBuffer();
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ data: bytes.slice(0), ...pdfResources(personal) });
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
    } catch (error) { console.error("PDF import failed", error); setMessage(pdfImportErrorMessage(error)); }
    finally { setBusy(false); if (pdfInput.current) pdfInput.current.value = ""; }
  }
  function changePage(index: number) {
    if (!doc) return;
    updateDoc(current => ({ ...current, currentPage: clamp(index, 0, current.pages.length - 1) }));
    setSelected([]); setZoom(1); workspace.current?.scrollTo(0, 0);
  }
  function addBlankPage() {
    if (!doc || !page) return;
    const blank: ReaderPage = { id: uid(), sourcePage: null, width: page.width, height: page.height, marks: [] };
    const pages = [...doc.pages];
    pages.splice(doc.currentPage + 1, 0, blank);
    const currentPage = doc.currentPage + 1;
    undoStack.current.push({ kind: "pages", before: doc.pages, after: pages, beforePage: doc.currentPage, afterPage: currentPage });
    redoStack.current = [];
    updateDoc(current => ({ ...current, pages, currentPage }));
    setSelected([]); setMessage("已插入空白页。");
  }
  function deleteCurrentPage() {
    if (!doc || !page || busy) return;
    if (doc.pages.length === 1) { setMessage("文献至少需要保留一页，无法删除最后一页。"); return; }
    const pageNumber = doc.currentPage + 1;
    if (!confirm(`确定删除第 ${pageNumber} 页及其全部笔记吗？`)) return;
    const pages = doc.pages.filter(item => item.id !== page.id);
    const currentPage = Math.min(doc.currentPage, pages.length - 1);
    undoStack.current.push({ kind: "pages", before: doc.pages, after: pages, beforePage: doc.currentPage, afterPage: currentPage });
    redoStack.current = [];
    updateDoc(current => ({ ...current, pages, currentPage }));
    setSelected([]); clearPreview(); setZoom(1); gesture.current = null;
    workspace.current?.scrollTo(0, 0);
    setMessage(`已删除第 ${pageNumber} 页，可点击撤销恢复。`);
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

  function eventPoint(event: ReactPointerEvent<SVGSVGElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / scale, 0, page!.width), y: clamp((event.clientY - bounds.top) / scale, 0, page!.height) };
  }
  function clearPreview() {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null; previewPath.current?.setAttribute("d", "");
  }
  function paintPreview() {
    previewFrame.current = null;
    const active = gesture.current, path = previewPath.current;
    if (!path || active?.kind !== "draw") return;
    path.setAttribute("d", pathFromPoints(active.points, active.tool === "lasso"));
    path.setAttribute("stroke", active.tool === "ask" ? "#436ed5" : active.tool === "lasso" ? "#537abc" : active.color);
    path.setAttribute("stroke-width", String(active.tool === "ask" ? 1.6 : active.tool === "lasso" ? 2 : active.width));
    path.setAttribute("stroke-dasharray", active.tool === "lasso" ? "5 4" : "none");
    path.setAttribute("opacity", active.tool === "highlighter" ? "0.38" : "1");
  }
  function appendSamples(event: ReactPointerEvent<SVGSVGElement>, active: Extract<Gesture, { kind: "draw" }>) {
    const samples = event.nativeEvent.getCoalescedEvents?.() || [];
    for (const sample of [...samples, event.nativeEvent]) {
      const point = { x: clamp((sample.clientX - active.left) / active.scale, 0, active.pageWidth), y: clamp((sample.clientY - active.top) / active.scale, 0, active.pageHeight) };
      const last = active.points.at(-1)!;
      if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.15) active.points.push(point);
    }
  }
  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!page || !workspace.current || (tool === "ask" && busy)) return;
    if (navigation.start(event)) return;
    event.preventDefault();
    // A palm or second pointer must never replace the active Pencil gesture.
    if (gesture.current || (event.pointerType === "touch" && tool !== "pan") || (event.pointerType === "mouse" && event.button !== 0)) return;
    {
      const point = eventPoint(event);
      if (tool === "eraser") {
        const after = eraseMarks(page.marks, point, point, eraserSize / 2, eraserMode, uid);
        gesture.current = { kind: "erase", pointer: event.pointerId, pageId: page.id, before: page.marks, after, previous: point, radius: eraserSize / 2, mode: eraserMode };
        previewEditing();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Already ended. */ }
        return;
      }
      if (tool === "lasso" && selectionBounds && point.x >= selectionBounds.x - 12 && point.x <= selectionBounds.x + selectionBounds.width + 12 && point.y >= selectionBounds.y - 12 && point.y <= selectionBounds.y + selectionBounds.height + 12) {
        gesture.current = { kind: "move", pointer: event.pointerId, start: point, before: page.marks, after: page.marks, pageId: page.id };
      } else {
        if (tool === "lasso") setSelected([]);
        const bounds = event.currentTarget.getBoundingClientRect();
        gesture.current = { kind: "draw", pointer: event.pointerId, points: [point], pageId: page.id, tool, color: tool === "highlighter" && color === COLORS[0] ? "#e9c84f" : color, width: tool === "highlighter" ? width * 6 : width, left: bounds.left, top: bounds.top, scale, pageWidth: page.width, pageHeight: page.height };
        paintPreview();
      }
    }
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Native capture can already have ended. */ }
    event.preventDefault();
  }
  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (navigation.move(event)) return;
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId || !page || !workspace.current) return;
    if (active.kind === "erase") {
      const point = eventPoint(event); active.after = eraseMarks(active.after, active.previous, point, active.radius, active.mode, uid); active.previous = point;
      if (editFrame.current === null) editFrame.current = requestAnimationFrame(previewEditing);
    } else if (active.kind === "draw") {
      event.preventDefault();
      appendSamples(event, active);
      if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(paintPreview);
    } else {
      const point = eventPoint(event), dx = point.x - active.start.x, dy = point.y - active.start.y;
      const moved = active.before.map(mark => selected.includes(mark.id) ? movedMark(mark, dx, dy) : mark);
      active.after = moved;
      if (editFrame.current === null) editFrame.current = requestAnimationFrame(previewEditing);
    }
  }
  function previewEditing() {
    editFrame.current = null;
    const active = gesture.current;
    if (active?.kind === "erase" || active?.kind === "move") updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === active.pageId ? { ...item, marks: active.after } : item) }));
  }
  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (navigation.end(event)) return;
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId || !page) return;
    event.preventDefault();
    if (active.kind === "draw" && event.type !== "pointercancel" && event.type !== "lostpointercapture") appendSamples(event, active);
    if (editFrame.current !== null) { cancelAnimationFrame(editFrame.current); editFrame.current = null; }
    if (active.kind === "erase" && event.type === "pointerup") { const point = eventPoint(event); active.after = eraseMarks(active.after, active.previous, point, active.radius, active.mode, uid); }
    gesture.current = null;
    if (active.kind === "draw") {
      clearPreview();
      if (active.tool === "pen" || active.tool === "highlighter") {
        const points = active.points.length === 1
          ? [active.points[0], { x: active.points[0].x + 0.01, y: active.points[0].y + 0.01 }]
          : active.points;
        const stroke: Stroke = { id: uid(), type: "stroke", tool: active.tool as "pen" | "highlighter", color: active.tool === "highlighter" && active.color === COLORS[0] ? "#e9c84f" : active.color, width: active.width, points };
        setMarks(active.pageId, [...(doc?.pages.find(item => item.id === active.pageId)?.marks || []), stroke]);
      } else if (active.tool === "lasso") {
        if (active.points.length < 3) return;
        const ids = page.marks.filter(mark => markInPolygon(mark, active.points)).map(mark => mark.id);
        setSelected(ids); setMessage(ids.length ? `已选中 ${ids.length} 个对象，拖动可移动。` : "未圈中笔迹或图片。");
      } else if (active.tool === "ask") {
        const points = active.points.length === 1 ? [active.points[0], { x: active.points[0].x + 0.01, y: active.points[0].y + 0.01 }] : active.points;
        const mark: AiMark = { id: uid(), pageId: active.pageId, points };
        setAiMarks(marks => [...marks, mark]);
        setAiRedoMarks([]); setMessage(""); if (window.innerWidth > 900) setChatOpen(true);
        const sourcePage = doc?.pages.find(item => item.id === active.pageId);
        if (sourcePage) {
          const resolve = (selection: AiSelection) => {
            const update = (marks: AiMark[]) => marks.map(item => item.id === mark.id ? { ...item, selection } : item);
            setAiMarks(update); setAiRedoMarks(update);
          };
          void identifyAiMark(pdf, sourcePage, points).then(resolve).catch(() => resolve({ kind: aiStrokeKind(points), text: "", boxes: [] }));
        }
      }
    } else if (active.kind === "move" || active.kind === "erase") {
      updateDoc(current => ({ ...current, pages: current.pages.map(item => item.id === active.pageId ? { ...item, marks: active.after } : item) }));
      if (active.before !== active.after && JSON.stringify(active.before) !== JSON.stringify(active.after)) { undoStack.current.push({ kind: "marks", pageId: active.pageId, before: active.before, after: active.after }); redoStack.current = []; }
    }
  }
  async function sendMessage() {
    if (!doc || !prompt.trim() || busy) return;
    const question = prompt.trim();
    const documentId = doc.id;
    const user: ChatMessage = { id: uid(), role: "user", content: question };
    const previous = doc.chat;
    let added = false;
    setBusy(true); setMessage(aiMarks.length ? "正在整理标记内容并询问 DeepSeek…" : "正在询问 DeepSeek…");
    try {
      if (!pdf) throw new Error("文献仍在加载，请稍后再提问。");
      const wholePaper = paperReference(doc.name, await readWholePaper(pdf));
      let content = question;
      let images: string[] = [];
      if (aiMarks.length) {
        const context = await createAiContext(doc, pdf, aiMarks);
        images = context.images;
        user.images = images; user.pageId = aiMarks[0].pageId;
        user.quotedText = context.excerpts || `第 ${context.pageNumbers.join("、")} 页 · ${aiMarks.length} 处画笔标记`;
        content = `我的提示词：${question}\n\n文献：${doc.name}\n${context.imageLabels.join("\n")}\n\n${context.excerpts ? `定位原文（优先以此确定我所问的行或句子，截图用于核对）：\n${context.excerpts}` : "此处没有可提取的 PDF 原文，请按截图中的细框、划线或圆圈定位内容。"}`;
      } else {
        images = [...previous].reverse().find(item => item.role === "user" && item.images?.length)?.images || [];
      }
      updateDoc(current => current.id === documentId ? { ...current, chat: [...current.chat, user] } : current);
      added = true; setPrompt("");
      const messages = [...previous.slice(-12).map(item => ({ role: item.role, content: item.quotedText ? `参考内容：${item.quotedText}\n问题：${item.content}` : item.content })), { role: "user", content }];
      const answer = await askAi(messages as Pick<ChatMessage, "role" | "content">[], images, personal, wholePaper);
      updateDoc(current => current.id === documentId ? { ...current, chat: [...current.chat, { id: uid(), role: "assistant", content: answer }] } : current);
      setAiMarks([]); setAiRedoMarks([]); setMessage("");
    } catch (error) {
      setMessage((error as Error).message || "AI 请求失败。");
      setPrompt(question);
      if (added) updateDoc(current => current.id === documentId ? { ...current, chat: current.chat.filter(item => item.id !== user.id) } : current);
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
    <header className="topbar"><div className="topbar-left"><button className="plain-icon" aria-label="打开文献库" onClick={() => setLibraryOpen(!libraryOpen)}><Menu size={21} /></button><div className="brand"><span className="brand-mark"><BookOpen size={21} /></span>墨读<span className="brand-dot">.</span></div><span className="topbar-divider" /><span className="document-title" title={doc?.name}>{doc?.name || "你的文献工作台"}</span></div><div className="topbar-right"><PersonalControls personal={personal} current={doc} disabled={busy} onRestored={async () => { setDoc(null); setLibrary(await listDocuments()); setLibraryOpen(true); setSelected([]); setAiMarks([]); setAiRedoMarks([]); setPrompt(""); }} /><span className="local-pill"><i />本机保存</span><button className="header-button subtle" onClick={() => setHelp(true)}><CircleHelp size={17} /><span>使用说明</span></button><button className="header-button primary" disabled={!doc || busy} onClick={() => void exportPdf()}><ArrowDownToLine size={17} /><span>导出与分享</span></button></div></header>
    <div className="app-body">
      {libraryOpen && <aside className="library-panel"><div className="panel-heading"><div><span className="eyebrow">LIBRARY</span><h2>文献库</h2></div><button className="plain-icon compact" aria-label="关闭文献库" onClick={() => setLibraryOpen(false)}><X size={18} /></button></div><button className="import-button" disabled={busy} onClick={() => pdfInput.current?.click()}><Plus size={18} />导入 PDF 文献</button><div className="library-caption">最近阅读 <span>{library.length}</span></div><div className="library-list">{library.length ? library.map(item => <div className={`library-item ${doc?.id === item.id ? "selected" : ""}`} key={item.id}><button className="library-open" disabled={busy} onClick={() => { setDoc(item); setSelected([]); setLibraryOpen(false); }}><span className="book-thumb"><BookOpen size={22} /></span><span className="book-info"><strong>{item.name}</strong><small>{item.pages.length} 页 · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></span></button><button className="delete-small" title="删除文献" aria-label={`删除 ${item.name}`} onClick={() => void removeDoc(item.id)}><Trash2 size={15} /></button></div>) : <div className="library-empty"><FolderOpen size={28} /><p>还没有文献</p><small>导入 PDF 后，笔记会自动保存在这台设备。</small></div>}</div><div className="library-footer"><span>◈</span><p>文献和笔记仅存于本机。点击发送后，标记附近的截图和提示词会一并发送给 DeepSeek。</p></div></aside>}
      <section className="reader-area">{doc && page ? <>
        <div className="toolbar"><div className="tool-group"><ToolButton label="移动页面" active={tool === "pan"} onClick={() => setTool("pan")}><Hand size={19} /></ToolButton><ToolButton label="钢笔" active={tool === "pen"} onClick={() => setTool("pen")}><PenLine size={19} /></ToolButton><ToolButton label="荧光笔" active={tool === "highlighter"} onClick={() => setTool("highlighter")}><Highlighter size={19} /></ToolButton><ToolButton label="橡皮擦" active={tool === "eraser"} onClick={() => setTool("eraser")}><Eraser size={19} /></ToolButton><ToolButton label="套索移动" active={tool === "lasso"} onClick={() => setTool("lasso")}><Lasso size={19} /></ToolButton><ToolButton label="AI 询问画笔" active={tool === "ask"} disabled={busy} onClick={() => { setTool("ask"); setSelected([]); if (window.innerWidth > 900) setChatOpen(true); else setChatOpen(false); }}><AiPenIcon /></ToolButton></div>{tool === "eraser" && <div className="eraser-options"><button aria-label="整笔擦除" className={eraserMode === "stroke" ? "selected" : ""} onClick={() => setEraserMode("stroke")}>整笔</button><button aria-label="局部擦除" className={eraserMode === "area" ? "selected" : ""} onClick={() => setEraserMode("area")}>局部</button><input aria-label="擦除大小" type="range" min="6" max="40" step="2" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} /></div>}<span className="toolbar-divider" /><div className="color-group">{COLORS.map(paint => <button key={paint} className={`color-swatch ${color === paint ? "selected" : ""}`} style={{ background: paint }} aria-label={`颜色 ${paint}`} onClick={() => setColor(paint)} />)}</div><span className="toolbar-divider optional-divider" /><div className="size-group"><span>笔触</span><input aria-label="笔触粗细" type="range" min="1" max="7" step="0.5" value={width} onChange={event => setWidth(Number(event.target.value))} /></div><span className="toolbar-spacer" /><div className="tool-group utility"><ToolButton label="撤销" disabled={tool === "ask" && (busy || !aiMarks.length)} onClick={undo}><Undo2 size={18} /></ToolButton><ToolButton label="重做" disabled={tool === "ask" && (busy || !aiRedoMarks.length)} onClick={redo}><Redo2 size={18} /></ToolButton><ToolButton label="插入空白页" onClick={addBlankPage}><FilePlus2 size={18} /></ToolButton><ToolButton label="删除当前页" disabled={busy} onClick={deleteCurrentPage}><FileMinus2 size={18} /></ToolButton>{selected.length > 0 && <ToolButton label="删除选中对象" onClick={() => { setMarks(page.id, page.marks.filter(mark => !selected.includes(mark.id))); setSelected([]); }}><Trash2 size={18} /></ToolButton>}<ToolButton label="插入图片" onClick={() => imageInput.current?.click()}><ImagePlus size={18} /></ToolButton></div><button className={`chat-toggle ${chatOpen ? "on" : ""}`} onClick={() => setChatOpen(!chatOpen)}><MessageCircle size={18} /><span>AI 助读</span></button></div>
        <div className="reader-hint"><i /><span className="reader-hint-text">{tool === "ask" ? "划线、画圈均可连续标记；需移动页面请先选手掌工具" : tool === "lasso" ? "圈住笔迹或图片后拖动；移动页面请选手掌工具" : tool === "pan" ? "拖动后惯性滑动；双指捏合缩放，松手后恢复高清" : tool === "eraser" ? eraserMode === "stroke" ? "点中或划过笔画，整笔擦除" : "按住拖动，只擦掉碰到的笔迹；可调橡皮大小" : "Apple Pencil 书写时页面锁定；移动页面请选手掌工具"}</span>{aiMarks.length > 0 && <button className="ai-question-ready" onClick={() => setChatOpen(true)}>{aiMarks.length} 处标记 · 输入提示词</button>}</div>
        <div ref={workspace} className={`workspace ${tool === "pan" ? "navigation-mode" : "writing-mode"}`} onScroll={scheduleVisiblePdf}><div className="paper" style={{ width: page.width * scale, height: page.height * scale }}><canvas ref={canvas} className="pdf-canvas" /><canvas ref={baseCanvas} className="pdf-preview" aria-hidden="true" /><svg className="ink-layer" width={page.width * scale} height={page.height * scale} viewBox={`0 0 ${page.width} ${page.height}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} onContextMenu={event => event.preventDefault()}>{page.marks.map(mark => mark.type === "stroke" ? <path key={mark.id} d={pathFromPoints(mark.points)} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round" opacity={mark.tool === "highlighter" ? 0.38 : 1} /> : <image key={mark.id} href={mark.src} x={mark.x} y={mark.y} width={mark.width} height={mark.height} preserveAspectRatio="none" />)}{aiMarks.filter(mark => mark.pageId === page.id).flatMap(mark => (mark.selection?.boxes || []).map((box, index) => <rect key={`${mark.id}-${index}`} className="ai-text-target" x={box.x} y={box.y} width={box.width} height={box.height} fill="rgba(67,110,213,.08)" stroke="rgba(67,110,213,.35)" strokeWidth={0.5} pointerEvents="none" />))}{aiMarks.filter(mark => mark.pageId === page.id).map(mark => <path key={mark.id} className="ai-question-mark" d={pathFromPoints(mark.points)} fill="none" stroke="#436ed5" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />)}{selectionBounds && <rect x={selectionBounds.x - 8} y={selectionBounds.y - 8} width={selectionBounds.width + 16} height={selectionBounds.height + 16} rx="5" fill="none" stroke="#537abc" strokeWidth="1.5" strokeDasharray="6 5" pointerEvents="none" />}<path ref={previewPath} className="live-ink" d="" fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" /></svg></div></div>
        <footer className="page-footer"><div className="page-navigation"><button aria-label="上一页" disabled={doc.currentPage === 0} onClick={() => changePage(doc.currentPage - 1)}><ChevronLeft size={19} /></button><span><strong>{doc.currentPage + 1}</strong> / {doc.pages.length}</span><button aria-label="下一页" disabled={doc.currentPage === doc.pages.length - 1} onClick={() => changePage(doc.currentPage + 1)}><ChevronRight size={19} /></button></div><div className="zoom-controls"><button aria-label="缩小" onClick={() => navigation.zoomBy(-0.15)}><Minus size={17} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大" onClick={() => navigation.zoomBy(0.15)}><Plus size={17} /></button></div></footer>
      </> : <div className="welcome"><div className="welcome-art"><div className="art-page back" /><div className="art-page front"><div className="art-lines"><i /><i /><i /><i /></div><span>∿</span></div><b>✦</b></div><span className="eyebrow">YOUR READING DESK</span><h1>让思考留在文献旁边。</h1><p>导入 PDF，用 Apple Pencil 写下想法，标记看不懂的内容，写下提示词后向 AI 提问。</p><button className="welcome-import" onClick={() => pdfInput.current?.click()}><Plus size={19} />导入第一篇文献</button><div className="welcome-steps"><span><PenLine size={16} />自由批注</span><span><Lasso size={16} />套索整理</span><span><Paintbrush size={16} />画笔问 AI</span></div></div>}</section>
      {chatOpen && <aside className="chat-panel"><div className="chat-heading"><div className="chat-heading-icon"><Sparkles size={20} /></div><div><span className="eyebrow">READING COMPANION</span><h2>AI 助读</h2></div><button className="plain-icon compact chat-close" aria-label="关闭 AI 助读" onClick={() => setChatOpen(false)}><X size={19} /></button></div><div className="paper-context-status"><span>{paperStatus}</span><small>{aiLabel} · 提问时参考全文</small></div><div ref={chatMessages} className="chat-messages">{doc?.chat.length ? doc.chat.map(item => <div className={`chat-message ${item.role}`} key={item.id}>{item.role === "assistant" && <span className="assistant-avatar">✦</span>}<div className="message-body">{item.quotedText && <div className="message-quote">“{item.quotedText.slice(0, 230)}{item.quotedText.length > 230 ? "…" : ""}”</div>}{item.images?.length ? <div className="message-images">{item.images.map((src, index) => <img key={index} src={src} alt={`本次提问的标记内容 ${index + 1}`} loading="lazy" />)}</div> : null}<p>{item.content}</p></div></div>) : <div className="chat-empty"><span>✦</span><h3>读到哪里，问到哪里</h3><p>用 <strong>AI 询问画笔</strong> 划线或画圈，输入提示词后一起发送。也可以直接打字提问。</p><button onClick={() => setPrompt("请先通读整篇文献，概括研究问题、方法、贡献、实验结论和局限，并标注原始 PDF 页码。")}>生成全文导读 <ChevronRight size={15} /></button><button onClick={() => setPrompt("请帮我梳理这页的主要论证。")}>梳理主要论证 <ChevronRight size={15} /></button></div>}{busy && <div className="typing-indicator"><i /><i /><i /></div>}</div><div className="chat-composer">{aiMarks.length > 0 && <div className="ai-mark-summary"><div><Paintbrush size={17} /><strong>已标记 {aiMarks.length} 处</strong><span>第 {aiPageNumbers.join("、")} 页</span></div><p>已定位的原文可核对、修正，再与提示词一起发送。</p><div className="ai-excerpt-list">{aiMarks.map((mark, index) => <label className="ai-excerpt" key={mark.id}><span>标记 {index + 1} · 第 {doc ? doc.pages.findIndex(item => item.id === mark.pageId) + 1 : 1} 页{!mark.selection ? " · 正在定位…" : mark.selection.boxes.length ? " · 已定位" : " · 截图识别"}</span><textarea aria-label={`标记 ${index + 1} 的原文`} rows={2} value={mark.textOverride ?? mark.selection?.text ?? ""} disabled={busy || !mark.selection} onChange={event => setAiMarks(marks => marks.map(item => item.id === mark.id ? { ...item, textOverride: event.target.value } : item))} placeholder="此处将使用高清截图；也可补充原文" /></label>)}</div><div className="ai-mark-actions"><button aria-label="撤回上一笔 AI 标记" disabled={busy} onClick={undoAiMark}><Undo2 size={13} />撤回上一笔</button><button aria-label="清空 AI 标记" disabled={busy} onClick={clearAiMarks}><X size={13} />清空标记</button></div></div>}<div className="composer-box"><textarea aria-label="向 AI 提问" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={doc ? aiMarks.length ? "输入提示词：想怎样解读这些标记？" : "输入问题，或先用 AI 画笔标记…" : "先导入一份 PDF 文献"} disabled={!doc || busy} rows={3} /><div><span>Enter 发送 · Shift + Enter 换行</span><button aria-label="发送消息" disabled={!doc || busy || !prompt.trim()} onClick={() => void sendMessage()}><Send size={17} /></button></div></div></div></aside>}
    </div>
    {message && <div className="status-toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={() => setMessage("")}><X size={14} /></button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-modal" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭说明" onClick={() => setHelp(false)}><X size={20} /></button><span className="eyebrow">QUICK START</span><h2>在 iPad 上开始阅读</h2><p><strong>01 导入文献</strong> 若要添加到主屏幕，请先添加并从图标打开，再导入 PDF。已有文献可在“完整备份”中生成 .paperink 文件，在新入口恢复。</p><p><strong>02 手写与整理</strong> Apple Pencil 写画时页面锁定、忽略手掌。需移动页面时，先选手掌图标，再拖动或双指捏合缩放。套索圈住笔迹或图片后可拖动。</p><p><strong>03 画笔提问</strong> 选择 AI 询问画笔，在文献上划线、画圈或做标记。可连续标记多处，输入提示词后点击发送。标记截图和提示词会一起交给 DeepSeek。</p><p><strong>04 分享批注</strong> 点击“导出与分享”，生成含笔迹和插图的 PDF，可发到微信。</p><div className="help-note">离线版请等“离线就绪”后使用。建议定期保存完整备份；清除网站数据会删除本机文献、笔记和离线资源。</div><button className="help-done" onClick={() => setHelp(false)}>开始使用</button></div></div>}
  </main>;
}
