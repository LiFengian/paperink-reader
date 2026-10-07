// Keep visible PDF pixels dense without allocating an enormous full-page canvas.
export function pdfRaster(width: number, height: number, deviceRatio: number) {
  const ratio = Math.min(Math.max(deviceRatio || 1, 3), 4096 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height)));
  return { ratio, width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
