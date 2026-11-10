import test from "node:test";
import assert from "node:assert/strict";
import { buildAiRequest, DEFAULT_AI_SETTINGS, askAi } from "../lib/ai-client.ts";
const messages = [{ role: "user", content: "解释标记" }], image = "data:image/png;base64,AA==";
test("default Flash thinks deeply and receives whole paper before the targeted question and image", () => {
  const body = buildAiRequest(messages, [image], DEFAULT_AI_SETTINGS, "第 1 页…第 50 页结论…");
  assert.equal(body.model, "deepseek-flash"); assert.equal(body.thinking.type, "enabled"); assert.equal(body.reasoning_effort, "high");
  assert.match(body.messages[1].content, /第 50 页/); assert.equal(body.messages.at(-1).content[1].image_url.url, image);
  assert.equal(body.max_tokens, 65536);
});
test("Pro must get a text transcription rather than an unsupported image request", () => {
  assert.throws(() => buildAiRequest(messages, [image], { model: "deepseek-v4-pro", effort: "high" }), /不支持直接输入图片/);
  const body = buildAiRequest(messages, [], { model: "deepseek-v4-pro", effort: "max" }, "全文", "图表转写证据");
  assert.equal(body.model, "deepseek-v4-pro"); assert.match(body.messages.at(-1).content, /图表转写证据/);
  assert.equal(body.max_tokens, 131072);
});
test("quick mode explicitly disables thinking", () => {
  assert.equal(buildAiRequest(messages, [], { model: "deepseek-flash", effort: "none" }).thinking.type, "disabled");
});

test("explicit quick retry uses one non-thinking generation without changing saved settings", async t => {
  const oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage, online = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  t.after(() => { globalThis.fetch = oldFetch; if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage; if (online) Object.defineProperty(navigator, "onLine", online); else delete navigator.onLine; });
  globalThis.localStorage = { getItem: name => name === "paperink-personal-deepseek-key" ? "unit-test-placeholder" : name === "paperink-ai-settings" ? JSON.stringify(DEFAULT_AI_SETTINGS) : null, setItem: () => { throw Error("must not change saved settings"); } };
  let calls = 0;
  globalThis.fetch = async (_url, request) => {
    calls++; const body = JSON.parse(request.body);
    assert.equal(body.model, DEFAULT_AI_SETTINGS.model); assert.equal(body.thinking.type, "disabled"); assert.equal(body.reasoning_effort, "none"); assert.equal(body.max_tokens, 8000);
    return Response.json({ choices: [{ message: { content: "A quick answer" }, finish_reason: "stop" }] });
  };
  assert.equal(await askAi(messages, [], true, "Full paper", { quickAnswer: true }), "A quick answer"); assert.equal(calls, 1);
});
