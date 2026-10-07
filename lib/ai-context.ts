import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AiMark, ReaderDocument } from "./reader-types";

/** Render only the surroundings of pending brush marks, including local notes. */
export async function createAiContext(document: ReaderDocument, pdf: PDFDocumentProxy | null, marks: AiMark[]) {
  const markedPages = document.pages.filter(page => marks.some(mark => mark.pageId === page.id));
  if (markedPages.length > 6) throw new Error("一次最多询问 6 页的标记，请先撤回部分标记。");
  if (markedPages.length === 0) throw new Error("标记所在页面已被删除，请重新标记。");
  const images: string[] = [];
  const pageNumbers: number[] = [];
  for (const page of markedPages) {
    const strokes = marks.filter(mark => mark.pageId === page.id);
    const points = strokes.flatMap(stroke => stroke.points);
    const bounds = points.reduce((box, point) => ({ left: Math.min(box.left, point.x), top: Math.min(box.top, point.y), right: Math.max(box.right, point.x), bottom: Math.max(box.bottom, point.y) }), { left: page.width, top: page.height, right: 0, bottom: 0 });
    // Underlines need the text above them; circles already contain their subject.
    const x = Math.max(0, bounds.left - 36), y = Math.max(0, bounds.top - 64);
    const right = Math.min(page.width, bounds.right + 36), bottom = Math.min(page.height, bounds.bottom + 36);
    const width = Math.max(1, right - x), height = Math.max(1, bottom - y);
    const scale = Math.min(2, 1800 / Math.max(width, height));
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成标记截图，请重试。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    if (page.sourcePage !== null) {
      if (!pdf) throw new Error("PDF 尚未加载完成，请稍后发送。");
      const source = await pdf.getPage(page.sourcePage);
      await source.render({ canvas, canvasContext: context, viewport: source.getViewport({ scale }), transform: [1, 0, 0, 1, -x * scale, -y * scale] }).promise;
    }
    context.save(); context.scale(scale, scale); context.translate(-x, -y);
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
    for (const stroke of strokes) {
      context.beginPath();
      stroke.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      if (stroke.points.length === 1) context.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y + 0.01);
      context.strokeStyle = "white"; context.lineWidth = 6; context.stroke();
      context.strokeStyle = "#436ed5"; context.lineWidth = 3; context.stroke();
    }
    context.restore();
    let encoded = canvas.toDataURL("image/jpeg", 0.85);
    if (encoded.length > 1_200_000) encoded = canvas.toDataURL("image/jpeg", 0.6);
    if (encoded.length > 1_500_000) throw new Error("标记截图过大，请缩小标记范围后重试。");
    images.push(encoded); pageNumbers.push(document.pages.findIndex(item => item.id === page.id) + 1);
    canvas.width = 0; canvas.height = 0;
  }
  if (images.reduce((total, image) => total + image.length, 0) > 6_000_000) throw new Error("本次标记内容过多，请分成两次提问。");
  return { images, pageNumbers };
}
