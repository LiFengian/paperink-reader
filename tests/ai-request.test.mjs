import test from "node:test";
import assert from "node:assert/strict";
import { buildAiRequest, DEFAULT_AI_SETTINGS } from "../lib/ai-client.ts";
const messages = [{ role: "user", content: "解释标记" }], image = "data:image/png;base64,AA==";
test("default Flash thinks deeply and receives whole paper before the targeted question and image", () => {
  const body = buildAiRequest(messages, [image], DEFAULT_AI_SETTINGS, "第 1 页…第 50 页结论…");
  assert.equal(body.model, "deepseek-flash"); assert.equal(body.thinking.type, "enabled"); assert.equal(body.reasoning_effort, "high");
  assert.match(body.messages[1].content, /第 50 页/); assert.equal(body.messages.at(-1).content[1].image_url.url, image);
  assert.ok(body.max_tokens > 10000);
});
test("Pro must get a text transcription rather than an unsupported image request", () => {
  assert.throws(() => buildAiRequest(messages, [image], { model: "deepseek-v4-pro", effort: "high" }), /不支持直接输入图片/);
  const body = buildAiRequest(messages, [], { model: "deepseek-v4-pro", effort: "max" }, "全文", "图表转写证据");
  assert.equal(body.model, "deepseek-v4-pro"); assert.match(body.messages.at(-1).content, /图表转写证据/);
});
test("quick mode explicitly disables thinking", () => {
  assert.equal(buildAiRequest(messages, [], { model: "deepseek-flash", effort: "none" }).thinking.type, "disabled");
});
