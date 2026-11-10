import test from "node:test";
import assert from "node:assert/strict";
import { completeDeepSeek, deepSeekJson, abortable } from "../lib/deepseek-transport.ts";

const key = "unit-test-placeholder", body = { model: "deepseek-flash", messages: [{ role: "user", content: "Explain" }] };
const delta = (content, reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: content, finish_reason: reason }] })}\r\n\r\n`;
function mockFetch(t, implementation) { const old = globalThis.fetch; globalThis.fetch = implementation; t.after(() => { globalThis.fetch = old; }); }
function stream(text, oneByte = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    if (oneByte) for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.subarray(i, i + 1)); else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

test("stream handles UTF-8 and CRLF split at every byte, keep-alives, thinking and final answer", async t => {
  const chunks = [], phases = [];
  mockFetch(t, async (_url, request) => {
    const sent = JSON.parse(request.body); assert.equal(sent.stream, true); assert.equal(request.credentials, "omit");
    return stream(": keep-alive\r\n\r\n" + delta({ reasoning_content: "private reasoning, never show as answer" }) + delta({ content: "这是答案，" }) + delta({ content: "$x=α+1$。" }) + delta({}, "stop") + "data: [DONE]\r\n\r\n", true);
  });
  const answer = await completeDeepSeek(body, key, { onPartial: value => chunks.push(value), onProgress: value => phases.push(value) });
  assert.equal(answer, "这是答案，$x=α+1$。"); assert.equal(chunks.at(-1), answer);
  assert(!chunks.join("").includes("private reasoning")); assert(phases.some(value => value.includes("思考")));
});

test("only thinking and empty answers are distinct from exhausted thinking and service interruptions", async t => {
  for (const [reason, pattern] of [["stop", /只返回了思考/], ["length", /思考用完/], ["insufficient_system_resource", /服务端中断/], ["aborted", /服务端中断/], ["content_filter", /content_filter/]]) {
    mockFetch(t, async () => stream(delta({ reasoning_content: "not an answer" }) + delta({}, reason) + "data: [DONE]\n\n"));
    await assert.rejects(completeDeepSeek(body, key), pattern);
  }
});

test("valid JSON compatibility response still requires a final answer and reports truncation", async t => {
  mockFetch(t, async () => Response.json({ choices: [{ message: { content: "Partial answer" }, finish_reason: "length" }] }));
  assert.match(await completeDeepSeek(body, key), /Partial answer[\s\S]*尚未完整/);
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: null, reasoning_content: "thinking" }, finish_reason: "stop" }] });
  await assert.rejects(completeDeepSeek(body, key), /只返回了思考/);
});

test("a truncated stream preserves received text for preview but never reports success or retries", async t => {
  let calls = 0, partial = "";
  mockFetch(t, async () => { calls++; return stream(delta({ content: "received before disconnect" })); });
  await assert.rejects(completeDeepSeek(body, key, { onPartial: value => { partial = value; } }), /提前结束/);
  assert.equal(partial, "received before disconnect"); assert.equal(calls, 1);
});

test("HTTP errors retain diagnostic code and message while redacting secrets", async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return Response.json({ error: { code: "invalid_request_error", message: "maximum context length exceeded; " + key } }, { status: 400 }); });
  await assert.rejects(completeDeepSeek(body, key), error => /400/.test(error.message) && /输入内容超出限制/.test(error.message) && /invalid_request_error/.test(error.message) && !error.message.includes(key));
  assert.equal(calls, 1);
});

test("200-with-error payload and SSE errors cannot become a generic empty-answer message", async t => {
  mockFetch(t, async () => Response.json({ error: { code: "server_error", message: "Service unavailable" } }));
  await assert.rejects(completeDeepSeek(body, key), /server_error.*Service unavailable/);
  globalThis.fetch = async () => stream('data: {"error":{"code":"overloaded","message":"Try later"}}\n\n');
  await assert.rejects(completeDeepSeek(body, key), /overloaded.*Try later/);
});

test("deadline applies while reading a slow response body and cancellation releases the request", async t => {
  mockFetch(t, async (_url, options) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
    options.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
  } }), { headers: { "content-type": "text/event-stream" } }));
  await assert.rejects(completeDeepSeek(body, key, { timeoutMs: 10 }), /等待超时/);
  const controller = new AbortController();
  const promise = completeDeepSeek(body, key, { signal: controller.signal }); controller.abort();
  await assert.rejects(promise, /已停止/);
});

test("cancelling before headers or during preparation makes no subsequent generation call", async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return Response.json({}); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(completeDeepSeek(body, key, { signal: controller.signal }), /已停止/); assert.equal(calls, 0);
  let done;
  const original = new Promise(resolve => { done = resolve; });
  await assert.rejects(abortable(original, controller.signal), /已停止/);
  done("whole paper still available"); assert.equal(await original, "whole paper still available");
});

test("invalid JSON and search authentication failures are readable and do not leak the key", async t => {
  mockFetch(t, async () => new Response("<html>Gateway error</html>"));
  await assert.rejects(deepSeekJson("https://api.deepseek.com/anthropic/v1/messages", {}, key, { label: "联网检索" }), /联网检索返回内容无法读取/);
  globalThis.fetch = async () => Response.json({ error: { message: key } }, { status: 401 });
  await assert.rejects(deepSeekJson("https://api.deepseek.com/anthropic/v1/messages", {}, key, { label: "联网检索" }), error => /401/.test(error.message) && /Key 无效/.test(error.message) && !error.message.includes(key));
});
