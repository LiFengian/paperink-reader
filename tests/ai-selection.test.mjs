import assert from "node:assert/strict";
import test from "node:test";
import { locateAiSelection } from "../lib/ai-selection.ts";

const run = (text, x, baseline, height = 10) => ({
  text, x, y: baseline - height * 0.8, width: Array.from(text).length * 6, height, baseline,
  advances: Array.from({ length: Array.from(text).length + 1 }, (_, index) => index * 6), hasEOL: true,
});
const target = run("Target sentence here.", 40, 94);
const rows = [run("OTHER upper line.", 40, 80), target, run("OTHER lower line.", 40, 108), run("OTHER right column.", 320, 94)];

test("downward underline offsets retain the intended row and column", () => {
  for (const offset of [0, 1, 3, 6, 8, 10]) {
    const selection = locateAiSelection(rows, [{ x: 40, y: 94 + offset }, { x: 100, y: 95 + offset }, { x: 166, y: 94 + offset }]);
    assert.equal(selection.text, target.text, `offset ${offset}`);
    assert(selection.boxes.every(box => box.x < 320));
  }
});

test("a reversed stroke produces the same text", () => {
  assert.equal(locateAiSelection(rows, [{ x: 166, y: 98 }, { x: 40, y: 98 }]).text, target.text);
});

test("underlining part of a word expands to the complete word", () => {
  assert.equal(locateAiSelection(rows, [{ x: 85, y: 98 }, { x: 122, y: 98 }]).text, "sentence");
});

test("a circle excludes the neighboring rows", () => {
  const points = Array.from({ length: 25 }, (_, index) => ({ x: 103 + 70 * Math.cos(index * Math.PI / 12), y: 91 + 8 * Math.sin(index * Math.PI / 12) }));
  assert.equal(locateAiSelection(rows, points).text, target.text);
});

test("a superscript remains part of the formula", () => {
  const math = [run("E = mc", 40, 94, 12), run("2", 76, 90, 7)];
  assert(locateAiSelection(math, [{ x: 40, y: 99 }, { x: 82, y: 99 }]).text.includes("2"));
});

test("empty areas and image-only PDFs do not invent text", () => {
  assert.equal(locateAiSelection(rows, [{ x: 40, y: 200 }, { x: 150, y: 200 }]).text, "");
  assert.equal(locateAiSelection([], [{ x: 40, y: 98 }, { x: 166, y: 98 }]).text, "");
});
