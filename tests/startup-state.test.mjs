import test from "node:test";
import assert from "node:assert/strict";
import { lastDocumentToOpen, beginDocumentOpen, finishDocumentOpen } from "../lib/startup-state.ts";

test("interrupted document open is remembered until that document renders successfully", () => {
  const values = new Map([["paperink-last-document", "large-paper"], ["paperink-personal-deepseek-key", "test-key"]]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  try {
    assert.deepEqual(lastDocumentToOpen(), { id: "large-paper", interrupted: false });
    beginDocumentOpen("large-paper");
    assert.equal(lastDocumentToOpen().interrupted, true);
    finishDocumentOpen("another-paper");
    assert.equal(lastDocumentToOpen().interrupted, true);
    finishDocumentOpen("large-paper");
    assert.equal(lastDocumentToOpen().interrupted, false);
    assert.equal(values.get("paperink-personal-deepseek-key"), "test-key");
  } finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete globalThis.localStorage; }
});

test("blocked preference storage cannot prevent the reading interface from starting", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new DOMException("Blocked", "SecurityError"); } });
  try {
    assert.deepEqual(lastDocumentToOpen(), { id: null, interrupted: false });
    assert.doesNotThrow(() => beginDocumentOpen("paper"));
    assert.doesNotThrow(() => finishDocumentOpen("paper"));
  } finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete globalThis.localStorage; }
});
