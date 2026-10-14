export type PdfImportStage = "read" | "engine" | "parse" | "pages" | "save";

export function pdfImportErrorMessage(error: unknown, stage: PdfImportStage = "parse") {
  const detail = error && typeof error === "object" ? error as { name?: string; message?: string } : {};
  if (detail.name === "PasswordException") return "这个 PDF 需要密码，暂时无法导入。";
  if (detail.name === "InvalidPDFException") return "PDF 文件内容无效或结构损坏，无法导入。";
  if (detail.name === "QuotaExceededError") return "设备存储空间不足，无法保存 PDF。请释放空间后重试。";
  if (stage === "read" || detail.name === "NotReadableError") return "无法读取所选 PDF。请先将文件下载到 iPad 的“文件”中，再重新选择。";
  if (stage === "save") return "PDF 已解析，但本机保存失败。请确认 Safari 允许网站保存数据，并检查设备剩余空间。";
  if (stage === "engine" || /worker|dynamically imported|module script|fetch|network|Load failed/i.test(detail.message || "")) return "PDF 阅读组件加载失败。请联网重开，在“离线与备份”中更新阅读器后重试。";
  if (/withResolvers|Promise\.try|is not a function|is not defined/i.test(detail.message || "")) return "当前浏览器与 PDF 阅读组件不兼容。请先更新墨读；仍失败时请提供 iPadOS 版本。";
  const reason = (detail.message || detail.name || "未知错误").replace(/[\r\n]+/g, " ").slice(0, 160);
  return `PDF ${stage === "pages" ? "页面读取" : "解析"}失败：${reason}`;
}
