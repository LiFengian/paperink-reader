"use client";

import { memo, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeAiMarkdown } from "../lib/ai-markdown";
import { copyMathText, selectedMathText } from "../lib/math-clipboard";
import "katex/dist/katex.min.css";

const mathOptions = { trust: false, strict: "ignore" as const, maxExpand: 1000, maxSize: 20 };
const remarkPlugins = [remarkGfm, remarkMath];

export default memo(function AiMessage({ content, copyable = true }: { content: string; copyable?: boolean }) {
  const markdown = useMemo(() => normalizeAiMarkdown(content), [content]);
  const answer = useRef<HTMLDivElement>(null), [copied, setCopied] = useState("");
  return <div className="ai-message-content"><div ref={answer} className="ai-answer" onCopy={event => {
    const text = answer.current && selectedMathText(answer.current, window.getSelection());
    if (text) { event.clipboardData.setData("text/plain", text); event.preventDefault(); }
  }}><Markdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={[[rehypeKatex, mathOptions]]}
    skipHtml
    components={{
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt || ""}</span>,
      table: ({ children }) => <div className="ai-table-scroll"><table>{children}</table></div>,
    }}
  >{markdown}</Markdown></div>{copyable && <div className="ai-answer-actions"><button className="ai-copy-button" aria-label="复制 AI 回答" onClick={async () => setCopied(await copyMathText(markdown) ? "已复制" : "复制失败，请长按选取内容")}><Copy size={13} />复制回答</button><span role="status">{copied}</span></div>}</div>;
});
