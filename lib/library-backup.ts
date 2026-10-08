import { getPdf, listDocuments, restoreDocuments, saveDocument } from "./local-store.ts";
import { PDFDocument } from "pdf-lib";
import type { ReaderDocument } from "./reader-types";

const MAGIC = "PINKBK01";
const encoder = new TextEncoder();
type Entry = { document: ReaderDocument; bytes: number; sha256: string };
const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const image = (value: unknown): value is string => typeof value === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value);
const stroke = (value: unknown): boolean => record(value) && value.type === "stroke" && typeof value.id === "string" && !!value.id
  && finite(value.width) && value.width > 0 && typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
  && ["pen", "highlighter"].includes(String(value.tool)) && Array.isArray(value.points) && !!value.points.length
  && value.points.every(point => record(point) && finite(point.x) && finite(point.y));

export function validateBackupDocument(value: unknown): asserts value is ReaderDocument {
  const fail = () => { throw new Error("备份中的文献数据不完整或格式不受支持。"); };
  if (!record(value) || typeof value.id !== "string" || !value.id || typeof value.name !== "string" || !finite(value.createdAt) || !finite(value.updatedAt)
    || !Array.isArray(value.pages) || !value.pages.length || !Array.isArray(value.chat) || !Number.isInteger(value.currentPage)
    || (value.currentPage as number) < 0 || (value.currentPage as number) >= value.pages.length) return fail();
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!record(page) || typeof page.id !== "string" || !page.id || ids.has(page.id) || !finite(page.width) || page.width <= 0 || !finite(page.height) || page.height <= 0
      || !(page.sourcePage === null || (Number.isInteger(page.sourcePage) && (page.sourcePage as number) >= 1)) || !Array.isArray(page.marks)) return fail();
    ids.add(page.id);
    const marks = new Set<string>();
    for (const mark of page.marks) {
      if (!record(mark) || typeof mark.id !== "string" || !mark.id || marks.has(mark.id)) return fail();
      marks.add(mark.id);
      if (mark.type === "stroke") {
        if (!stroke(mark)) return fail();
      } else if (mark.type === "image") {
        if (!image(mark.src) || !finite(mark.x) || !finite(mark.y) || !finite(mark.width) || mark.width <= 0 || !finite(mark.height) || mark.height <= 0) return fail();
      } else if (mark.type === "note") {
        if (!finite(mark.x) || !finite(mark.y) || !finite(mark.width) || mark.width <= 0 || !finite(mark.height) || mark.height <= 0
          || typeof mark.text !== "string" || !finite(mark.noteWidth) || mark.noteWidth <= 0 || mark.noteWidth > 4096
          || !finite(mark.noteHeight) || mark.noteHeight <= 0 || mark.noteHeight > 4096
          || !Array.isArray(mark.strokes) || mark.strokes.some(item => !stroke(item))
          || new Set(mark.strokes.map(item => item.id)).size !== mark.strokes.length) return fail();
      } else return fail();
    }
  }
  for (const chat of value.chat) {
    if (!record(chat) || typeof chat.id !== "string" || !["user", "assistant"].includes(String(chat.role)) || typeof chat.content !== "string"
      || (chat.quotedText !== undefined && typeof chat.quotedText !== "string") || (chat.pageId !== undefined && typeof chat.pageId !== "string")
      || (chat.images !== undefined && (!Array.isArray(chat.images) || chat.images.some(src => !image(src))))) return fail();
  }
}

export async function createLibraryBackup(current?: ReaderDocument | null): Promise<Blob> {
  if (current) await saveDocument(current);
  const documents = await listDocuments();
  if (!documents.length) throw new Error("文献库为空，请先导入 PDF。");
  const entries: Entry[] = [], pdfs: Blob[] = [];
  for (const document of documents) {
    const pdf = await getPdf(document.id);
    if (!pdf) throw new Error(`“${document.name}”的原始 PDF 缺失，备份未完成。`);
    entries.push({ document, bytes: pdf.size, sha256: await hash(pdf) }); pdfs.push(pdf);
  }
  const manifest = encoder.encode(JSON.stringify({ format: "paperink-library", version: 1, createdAt: Date.now(), entries }));
  if (manifest.length > 64_000_000) throw new Error("笔记及聊天内容过大，请分批导出文献。");
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, manifest.length);
  return new Blob([encoder.encode(MAGIC), length, manifest, ...pdfs], { type: "application/octet-stream" });
}

export async function readLibraryBackup(file: Blob): Promise<{ document: ReaderDocument; pdf: Blob }[]> {
  if (file.size < 12 || file.size > 2_000_000_000) throw new Error("备份文件大小无效。");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC) throw new Error("请选择墨读导出的 .paperink 完整备份文件。");
  const length = new DataView(header.buffer).getUint32(8);
  if (!length || length > 64_000_000 || 12 + length > file.size) throw new Error("备份文件损坏。");
  let manifest: unknown;
  try { manifest = JSON.parse(await file.slice(12, 12 + length).text()); } catch { throw new Error("备份文件损坏。"); }
  if (!record(manifest) || manifest.format !== "paperink-library" || manifest.version !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error("备份版本不受支持或文献库为空。");
  let offset = 12 + length;
  const entries: { document: ReaderDocument; pdf: Blob }[] = [];
  for (const entry of manifest.entries) {
    if (!record(entry) || !Number.isSafeInteger(entry.bytes) || (entry.bytes as number) <= 0 || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("备份文件损坏。");
    validateBackupDocument(entry.document);
    const end = offset + (entry.bytes as number);
    if (end > file.size) throw new Error("备份文件不完整。");
    const pdf = file.slice(offset, end, "application/pdf"); offset = end;
    if (!(await pdf.slice(0, 1024).text()).includes("%PDF-") || await hash(pdf) !== entry.sha256) throw new Error(`“${entry.document.name}”的 PDF 校验失败，原文献库未改动。`);
    let pageCount: number;
    try { pageCount = (await PDFDocument.load(await pdf.arrayBuffer(), { updateMetadata: false })).getPageCount(); }
    catch { throw new Error(`“${entry.document.name}”的 PDF 无法读取，原文献库未改动。`); }
    if (entry.document.pages.some(page => page.sourcePage !== null && page.sourcePage > pageCount)) throw new Error("备份的页面引用无效，原文献库未改动。");
    // Fresh document IDs allow repeat restores without overwriting local work.
    entries.push({ document: { ...entry.document, id: crypto.randomUUID() }, pdf });
  }
  if (offset !== file.size) throw new Error("备份包含无法识别的附加数据。");
  return entries;
}

export async function importLibraryBackup(file: Blob): Promise<number> {
  const entries = await readLibraryBackup(file);
  await restoreDocuments(entries);
  return entries.length;
}

export async function shareBackup(blob: Blob): Promise<void> {
  const filename = `墨读备份-${new Date().toISOString().slice(0, 10)}.paperink`;
  const file = new File([blob], filename, { type: "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "墨读完整备份" }); return; }
    catch (error) { if ((error as Error).name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; window.document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
