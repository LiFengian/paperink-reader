import test from "node:test";
import assert from "node:assert/strict";
import { eraseMarks } from "../lib/eraser.ts";
const stroke = { id: "line", type: "stroke", tool: "pen", color: "#202a35", width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
let counter = 0; const id = () => `fragment-${++counter}`;
test("area erase cuts the middle of a sparse stroke without deleting the ends", () => {
  const parts = eraseMarks([stroke], { x: 50, y: 0 }, { x: 50, y: 0 }, 5, "area", id);
  assert.equal(parts.length, 2); assert.ok(Math.abs(parts[0].points.at(-1).x - 44) < 1e-8); assert.ok(Math.abs(parts[1].points[0].x - 56) < 1e-8);
  assert.notEqual(parts[0].id, parts[1].id); assert.equal(stroke.points.length, 2);
});
test("a fast sweeping erase does not leave ink between pointer samples", () => {
  assert.equal(eraseMarks([stroke], { x: 0, y: -20 }, { x: 100, y: 20 }, 30, "area", id).length, 0);
});
test("whole stroke mode deletes the hit stroke and preserves unrelated ink and images", () => {
  const other = { ...stroke, id: "other", points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] }, image = { id: "image", type: "image", src: "data:image/png;base64,AA==", x: 0, y: 0, width: 100, height: 100 };
  assert.deepEqual(eraseMarks([stroke, other, image], { x: 50, y: 0 }, { x: 50, y: 0 }, 5, "stroke", id), [other, image]);
});
test("erasing empty space preserves the original collection and thin dots can be removed", () => {
  const marks = [stroke]; assert.equal(eraseMarks(marks, { x: 0, y: 80 }, { x: 100, y: 80 }, 5, "area", id), marks);
  assert.equal(eraseMarks([{ ...stroke, points: [{ x: 50, y: 0 }] }], { x: 50, y: 0 }, { x: 50, y: 0 }, 5, "area", id).length, 0);
});
test("an extended sweep line cannot erase ink outside the finite eraser sweep", () => {
  const marks = [stroke];
  assert.equal(eraseMarks(marks, { x: 50, y: 100 }, { x: 50, y: 200 }, 5, "stroke", id), marks);
});
