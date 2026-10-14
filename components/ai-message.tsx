"use client";

import { memo, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeAiMarkdown } from "../lib/ai-markdown";
import "katex/dist/katex.min.css";

const mathOptions = { trust: false, strict: "ignore" as const, maxExpand: 1000, maxSize: 20 };
const remarkPlugins = [remarkGfm, remarkMath];

export default memo(function AiMessage({ content }: { content: string }) {
  const markdown = useMemo(() => normalizeAiMarkdown(content), [content]);
  return <div className="ai-answer"><Markdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={[[rehypeKatex, mathOptions]]}
    skipHtml
    components={{
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt || ""}</span>,
      table: ({ children }) => <div className="ai-table-scroll"><table>{children}</table></div>,
    }}
  >{markdown}</Markdown></div>;
});
