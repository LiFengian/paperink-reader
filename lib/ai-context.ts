import type { PDFDocumentProxy } from "pdfjs-dist";
import { identifyAiMark } from "./ai-selection";
import type { AiMark, PageRect, ReaderDocument, ReaderPage } from "./reader-types";

const union = (a: PageRect, b: PageRect): PageRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) });
const overlaps = (a: PageRect, b: PageRect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
type Region = { page: ReaderPage; rect: PageRect; marks: AiMark[]; indices: number[] };

/** Pair coordinate-based text selection with clean, tightly cropped images. */
export async function createAiContext(document: ReaderDocument, pdf: PDFDocumentProxy | null, marks: AiMark[]) {
  const markedPages = document.pages.filter(page => marks.some(mark => mark.pageId === page.id));
  if (markedPages.length > 6) throw new Error("一次最多询问 6 页的标记，请先撤回部分标记。");
  if (!markedPages.length) throw new Error("标记所在页面已被删除，请重新标记。");
  const regions: Region[] = [], references: string[] = [];
  const label = (page: ReaderPage) => `阅读器第 ${document.pages.findIndex(item => item.id === page.id) + 1} 页 · ${page.sourcePage === null ? "空白笔记页" : `原始 PDF 第 ${page.sourcePage} 页`}`;
  const pageNumbers = markedPages.map(page => document.pages.findIndex(item => item.id === page.id) + 1);
  for (const page of markedPages) {
    const pageRegions: Region[] = [];
    for (let index = 0; index < marks.length; index++) {
      const mark = marks[index]; if (mark.pageId !== page.id) continue;
      const selection = mark.selection || await identifyAiMark(pdf, page, mark.points);
      const resolved = { ...mark, selection };
      const text = (mark.textOverride ?? selection.text).trim();
      if (text) references.push(`【${label(page)} · 标记 ${index + 1}】\n${text}`);
      const targets = selection.boxes.length ? selection.boxes : mark.points.map(point => ({ x: point.x, y: point.y, width: 0.01, height: 0.01 }));
      const target = targets.reduce(union);
      const padX = selection.boxes.length ? 12 : 36, padTop = selection.boxes.length ? 3 : 64, padBottom = selection.boxes.length ? 3 : 36;
      const x = Math.max(0, target.x - padX), y = Math.max(0, target.y - padTop);
      const right = Math.min(page.width, target.x + target.width + padX), bottom = Math.min(page.height, target.y + target.height + padBottom);
      let region: Region = { page, rect: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }, marks: [resolved], indices: [index + 1] };
      for (let i = pageRegions.length - 1; i >= 0; i--) if (overlaps(region.rect, pageRegions[i].rect)) {
        const previous = pageRegions.splice(i, 1)[0];
        region = { page, rect: union(region.rect, previous.rect), marks: [...previous.marks, ...region.marks], indices: [...previous.indices, ...region.indices] };
      }
      pageRegions.push(region);
    }
    regions.push(...pageRegions);
  }
  if (regions.length > 24) throw new Error("本次标记分布较多，请分成两次提问。");
  const images: string[] = [], imageLabels: string[] = [];
  for (const region of regions) {
    const { page, rect } = region;
    const scale = Math.min(3, 2400 / Math.max(rect.width, rect.height));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(rect.width * scale); canvas.height = Math.ceil(rect.height * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("无法生成标记截图，请重试。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    if (page.sourcePage !== null) {
      if (!pdf) throw new Error("PDF 尚未加载完成，请稍后发送。");
      const source = await pdf.getPage(page.sourcePage);
      await source.render({ canvas, canvasContext: context, viewport: source.getViewport({ scale }), transform: [1, 0, 0, 1, -rect.x * scale, -rect.y * scale] }).promise;
    }
    context.save(); context.scale(scale, scale); context.translate(-rect.x, -rect.y);
    context.lineCap = "round"; context.lineJoin = "round";
    for (const mark of page.marks) {
      context.save();
      if (mark.type === "stroke") {
        context.beginPath();
        mark.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        if (mark.points.length === 1) context.lineTo(mark.points[0].x + 0.01, mark.points[0].y + 0.01);
        context.strokeStyle = mark.color; context.lineWidth = mark.width;
        context.globalAlpha = mark.tool === "highlighter" ? 0.38 : 1; context.stroke();
      } else {
        const image = new Image(); image.src = mark.src; await image.decode();
        context.drawImage(image, mark.x, mark.y, mark.width, mark.height);
      }
      context.restore();
    }
    // Clean glyphs remain visible; only thin target frames are added.
    context.strokeStyle = "#436ed5"; context.lineWidth = 0.7;
    for (const mark of region.marks) {
      if (mark.selection!.boxes.length) {
        for (const box of mark.selection!.boxes) context.strokeRect(box.x - 1.5, box.y - 1.5, box.width + 3, box.height + 3);
      } else {
        context.beginPath(); mark.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
      }
    }
    context.restore();
    let encoded = canvas.toDataURL("image/png");
    if (encoded.length > 1_200_000) encoded = canvas.toDataURL("image/jpeg", 0.9);
    if (encoded.length > 1_500_000) encoded = canvas.toDataURL("image/jpeg", 0.7);
    if (encoded.length > 1_500_000) throw new Error("标记截图过大，请缩小标记范围后重试。");
    images.push(encoded);
    imageLabels.push(`图片 ${images.length}：${label(page)}，标记 ${region.indices.sort((a, b) => a - b).join("、")}。细蓝框是定位出的提问对象；没有框时，细划线对应其上方紧邻的文字，圆圈对应圈内内容。`);
    canvas.width = 0; canvas.height = 0;
  }
  if (images.reduce((total, image) => total + image.length, 0) > 6_000_000) throw new Error("本次标记内容过多，请分成两次提问。");
  return { images, pageNumbers, excerpts: references.join("\n\n"), imageLabels };
}
