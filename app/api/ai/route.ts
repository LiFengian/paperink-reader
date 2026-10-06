import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type SafeMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: NextRequest) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return NextResponse.json({ error: "站点尚未配置 DeepSeek API Key。" }, { status: 503 });
  if (Number(request.headers.get("content-length") || 0) > 3_000_000) {
    return NextResponse.json({ error: "请求内容过大。" }, { status: 413 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const mode = body?.mode === "ocr" ? "ocr" : "chat";
    let messages: unknown[];
    if (mode === "ocr") {
      const image = body.image;
      if (typeof image !== "string" || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2_500_000) {
        return NextResponse.json({ error: "圈选图片无效或过大。" }, { status: 400 });
      }
      messages = [
        { role: "system", content: "你是严格的OCR转写器。只返回图片中实际可见的文字，保持阅读顺序；不要解释、补全或回答问题。" },
        { role: "user", content: [
          { type: "text", text: "请转写这张文献截图中的文字。" },
          { type: "image_url", image_url: { url: image, detail: "original" } },
        ] },
      ];
    } else {
      const rawMessages = body.messages;
      if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 20) {
        return NextResponse.json({ error: "聊天记录无效。" }, { status: 400 });
      }
      const safe: SafeMessage[] = rawMessages.map((message: unknown) => {
        const item = message as Record<string, unknown>;
        return { role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 16000) };
      });
      if (safe.at(-1)?.role !== "user" || !safe.at(-1)?.content.trim()) {
        return NextResponse.json({ error: "请输入问题。" }, { status: 400 });
      }
      messages = [
        { role: "system", content: "你是学术文献阅读助手。优先准确解释用户提供的原文、术语、方法和推导。区分原文明确陈述与自己的推断；不虚构论文内容或引用。默认用中文回答，必要时保留英文术语和公式。" },
        ...safe,
      ];
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        messages,
        max_tokens: mode === "ocr" ? 1400 : 2200,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `DeepSeek 请求失败（${response.status}）。请检查 Key 或稍后重试。` }, { status: 502 });
    }
    const result = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) return NextResponse.json({ error: "DeepSeek 未返回内容。" }, { status: 502 });
    return NextResponse.json({ content }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "请求处理失败，请重试。" }, { status: 500 });
  }
}
