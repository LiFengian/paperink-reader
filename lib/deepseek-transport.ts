type RequestOptions = { signal?: AbortSignal; timeoutMs?: number; label?: string };
export type CompletionOptions = RequestOptions & { onProgress?: (text: string) => void; onPartial?: (text: string) => void };
export class DeepSeekError extends Error {}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const message = (value: unknown) => typeof value === "string" ? value : "";

export function aiOutputBudget(effort: string) { return effort === "none" ? 8000 : effort === "max" ? 131072 : 65536; }

function providerError(payload: unknown, status: number, key: string, label: string) {
  const error = record(payload) ? payload.error : undefined;
  const raw = typeof error === "string" ? error : record(error) ? message(error.message) : "";
  const code = record(error) ? message(error.code) || message(error.type) : "";
  const hint = status === 401 ? "Key 无效或已失效，请在“离线与备份”中重新填写。"
    : status === 402 ? "账户余额不足，请检查 DeepSeek 账户。"
    : status === 429 ? "请求过于频繁或服务繁忙，请稍后重试。"
    : status === 413 || /context.*(?:length|limit)|too many tokens/i.test(raw) ? "输入内容超出限制，请减少对话上下文或拆分文献后重试。"
    : status === 403 ? "请求被服务端拒绝，请检查账户权限。"
    : status >= 500 ? "DeepSeek 服务暂时异常，请稍后重试。" : "请根据接口提示调整后重试。";
  let detail = [code, raw].filter(Boolean).join(" · ");
  if (key) detail = detail.split(key).join("[已隐藏 Key]");
  detail = detail.replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏 Key]").replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]").replace(/[\r\n]+/g, " ").slice(0, 320);
  return new DeepSeekError(`${label}失败${status ? `（${status}）` : ""}：${hint}${detail ? `\n接口说明：${detail}` : ""}`);
}

// The deadline covers headers AND body consumption. Never automatically repeat a
// generation after a broken connection: the provider may already have billed it.
export async function deepSeekRequest<T>(url: string, body: object, key: string, consume: (response: Response) => Promise<T>, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController(), label = options.label || "DeepSeek 请求";
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 12 * 60_000);
  try {
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await fetch(url, {
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(url.includes("/anthropic/") ? { "anthropic-version": "2023-06-01", "x-api-key": key } : {}) },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw providerError(await response.json().catch(() => null), response.status, key, label);
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new DeepSeekError(options.signal?.aborted ? "已停止本次提问，提示词和标记已保留。" : `${label}等待超时，提示词和标记已保留。请稍后重试，或在设置中选择“快速回答”。`);
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError(`${label}连接中断或无法访问。请检查网络后重试；提示词和标记已保留。`);
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
  }
}

export async function deepSeekJson(url: string, body: object, key: string, options: RequestOptions = {}) {
  return deepSeekRequest(url, body, key, async response => {
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new DeepSeekError(`${options.label || "DeepSeek 请求"}返回内容无法读取，请重试。`); }
    if (record(payload) && payload.error) throw providerError(payload, 0, key, options.label || "DeepSeek 请求");
    return payload;
  }, options);
}

function finishAnswer(content: string, reason: string, thinking: boolean) {
  if (reason === "content_filter") throw new DeepSeekError("DeepSeek 未能完成此问题的回答（content_filter），请调整问题后重试。");
  if (["insufficient_system_resource", "aborted"].includes(reason)) throw new DeepSeekError(`DeepSeek 服务端中断了生成（${reason}）。提示词和标记已保留，请稍后重试。`);
  if (!content.trim()) throw new DeepSeekError(reason === "length"
    ? "DeepSeek 的思考用完了本次输出预算，未生成答案正文。请缩小问题范围，或选择“快速回答”后重试。"
    : thinking ? "DeepSeek 只返回了思考内容，未生成答案正文。请重试，或在设置中选择“快速回答”。"
      : "DeepSeek 返回了空的答案正文，请重试。提示词和标记已保留。");
  return content.trim() + (reason === "length" ? "\n\n> 本次回答达到输出上限，内容尚未完整，可继续提问。" : "");
}

export async function completeDeepSeek(body: object, key: string, options: CompletionOptions = {}) {
  options.onProgress?.(options.label ? `${options.label}…` : "正在等待 DeepSeek 响应…");
  return deepSeekRequest("https://api.deepseek.com/chat/completions", { ...body, stream: true }, key, async response => {
    // Also accept a complete JSON response, e.g. from a compatible API gateway.
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new DeepSeekError("DeepSeek 返回内容无法读取，请重试。"); }
      if (record(payload) && payload.error) throw providerError(payload, 0, key, options.label || "DeepSeek 请求");
      const choice = record(payload) && Array.isArray(payload.choices) ? payload.choices[0] : null;
      const answer = record(choice) && record(choice.message) ? choice.message : {};
      return finishAnswer(message(answer.content), record(choice) ? message(choice.finish_reason) : "", !!message(answer.reasoning_content));
    }
    if (!response.body) throw new DeepSeekError("DeepSeek 响应连接为空，请重试。");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", content = "", reason = "", thinking = false, done = false, status = "";
    const progress = (value: string) => { if (status !== value) { status = value; options.onProgress?.(value); } };
    const event = (block: string) => {
      const data = block.split(/\r\n|\r|\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data.trim()) return; // SSE keep-alive comments are not JSON.
      if (data.trim() === "[DONE]") { done = true; return; }
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { throw new DeepSeekError("DeepSeek 返回的数据片段无法读取，请重试。"); }
      if (!record(payload)) return;
      if (payload.error) throw providerError(payload, 0, key, options.label || "DeepSeek 请求");
      const choice = Array.isArray(payload.choices) ? payload.choices.find(item => record(item) && (item.index === 0 || item.index === undefined)) : undefined;
      if (!record(choice)) return;
      if (record(choice.delta)) {
        if (message(choice.delta.reasoning_content)) { thinking = true; if (!content) progress("DeepSeek 正在深度思考…"); }
        if (typeof choice.delta.content === "string" && choice.delta.content) {
          content += choice.delta.content; progress("正在接收 DeepSeek 答案…"); options.onPartial?.(content);
        }
      }
      if (typeof choice.finish_reason === "string") reason = choice.finish_reason;
    };
    try {
      while (!done) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        let separator: RegExpMatchArray | null;
        while ((separator = buffer.match(/\r\n\r\n|\n\n|\r\r/))) {
          event(buffer.slice(0, separator.index)); buffer = buffer.slice(separator.index! + separator[0].length);
          if (done) break;
        }
        if (buffer.length > 1_000_000) throw new DeepSeekError("DeepSeek 响应格式异常，请重试。");
        if (chunk.done) { if (buffer.trim()) event(buffer); break; }
      }
      if (!reason) throw new DeepSeekError("DeepSeek 的回答连接提前结束，内容未接收完整。提示词和标记已保留，请重试。");
      return finishAnswer(content, reason, thinking);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }, options);
}

// Cancelling preparation must not destroy the shared background PDF text task.
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DeepSeekError("已停止本次提问，提示词和标记已保留。"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    task.then(value => { if (!signal.aborted) resolve(value); }, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
