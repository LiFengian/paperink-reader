import test from "node:test";
import assert from "node:assert/strict";
import { pdfImportErrorMessage } from "../lib/pdf-errors.ts";

test("browser and asset failures are not reported as damaged PDFs", () => {
  assert.match(pdfImportErrorMessage(new TypeError("Promise.withResolvers is not a function")), /不兼容/);
  assert.match(pdfImportErrorMessage(new Error("Setting up fake worker failed: Load failed")), /组件加载失败/);
  assert.match(pdfImportErrorMessage(new Error("Failed to fetch dynamically imported module"), "engine"), /联网重开/);
});

test("file read, password, invalid PDF and storage failures have distinct messages", () => {
  assert.match(pdfImportErrorMessage(new DOMException("", "NotReadableError"), "read"), /下载/);
  assert.match(pdfImportErrorMessage({ name: "PasswordException" }), /需要密码/);
  assert.match(pdfImportErrorMessage({ name: "InvalidPDFException" }), /结构损坏/);
  assert.match(pdfImportErrorMessage(new DOMException("", "QuotaExceededError"), "save"), /存储空间不足/);
  assert.match(pdfImportErrorMessage(new Error("IndexedDB disabled"), "save"), /已解析，但本机保存失败/);
  assert.match(pdfImportErrorMessage(new Error("Unexpected page structure"), "pages"), /页面读取失败：Unexpected page structure/);
});
