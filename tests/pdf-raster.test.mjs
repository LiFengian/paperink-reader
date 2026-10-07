import assert from "node:assert/strict";
import test from "node:test";
import { pdfRaster } from "../lib/pdf-raster.ts";

test("visible iPad PDF area receives three raster pixels per CSS pixel", () => {
  const raster = pdfRaster(1024, 800, 2);
  assert.equal(raster.ratio, 3);
  assert.equal(raster.width, 3072);
  assert.equal(raster.height, 2400);
});
test("large screens remain within canvas dimension and memory budgets", () => {
  const raster = pdfRaster(3000, 2400, 4);
  assert.ok(raster.width <= 4096 && raster.height <= 4096);
  assert.ok(raster.width * raster.height <= 12_000_000);
});
