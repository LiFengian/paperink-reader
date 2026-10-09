import type { NoteImage } from "./reader-types";

export async function readNoteImage(file: File): Promise<NoteImage> {
  const url = URL.createObjectURL(file), image = new Image(), canvas = document.createElement("canvas");
  try {
    image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("无法读取图片。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = /image\/(jpeg|heic|heif)/i.test(file.type) ? "image/jpeg" : "image/png";
    const src = canvas.toDataURL(mime, 0.9);
    if (!src.startsWith("data:image/")) throw new Error("无法读取图片。");
    return { id: crypto.randomUUID(), src, width: canvas.width, height: canvas.height, name: file.name };
  } finally { URL.revokeObjectURL(url); image.src = ""; canvas.width = 1; canvas.height = 1; }
}
