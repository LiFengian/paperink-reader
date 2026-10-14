import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { normalizeAiMarkdown } from "../lib/ai-markdown.ts";

test("common model math wrappers and historical TeX code render as math", () => {
  const source = String.raw`行内 \(\alpha_i = \frac{x}{y}\)。
\[\dot{x}=Ax+Bu\]

\`\theta\`

\`\`\`latex
\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\`\`\`
`.replaceAll("\\`", "`");
  const markdown = normalizeAiMarkdown(source);
  assert(markdown.includes(String.raw`$\alpha_i = \frac{x}{y}$`));
  assert(markdown.includes("$$\n" + String.raw`\dot{x}=Ax+Bu` + "\n$$"));
  assert(markdown.includes(String.raw`$\theta$`));
  assert(markdown.includes("$$\n" + String.raw`\begin{bmatrix}`));
  assert(!markdown.includes("```latex"));
  assert.equal(normalizeAiMarkdown('`' + String.raw`\(x_i\)` + '`'), '$x_i$');
  assert.equal(normalizeAiMarkdown('`' + String.raw`\eta` + '`'), String.raw`$\eta$`);
});

test("ordinary code, unclosed code fences and existing dollar math are preserved", () => {
  for (const source of [
    '`const x = 1` and `snake_case`',
    '```python\nprint("' + String.raw`\alpha` + '")\n```',
    '````js\nconst tex = "' + String.raw`\[x\]` + '";\n`````',
    '```latex\n' + String.raw`\frac{x}{y}`,
    String.raw`$x_i$ and $$\frac{1}{2}$$`,
  ]) assert.equal(normalizeAiMarkdown(source), source);
});

// Exercise the same React component used by the reader without a paid AI call.
const source = await readFile(new URL("../components/ai-message.tsx", import.meta.url), "utf8");
const javascript = ts.transpileModule(source.replace('import "katex/dist/katex.min.css";', ""), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/from "([^"]+)"/g, (_, name) => `from ${JSON.stringify(name === "../lib/ai-markdown" ? new URL("../lib/ai-markdown.ts", import.meta.url).href : import.meta.resolve(name))}`);
const { default: AiMessage } = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));

test("reply renders fractions, Greek symbols, matrices and Markdown structure", () => {
  const reply = '# 公式解读\n\n变量 ' + String.raw`\(\alpha_i\)` + '。\n\n' + String.raw`\[\frac{1}{2} + \sqrt{x}\]` + '\n\n```tex\n' + String.raw`\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}` + '\n```\n\n- **要点**\n\n```python\nprint(1)\n```';
  const html = renderToStaticMarkup(createElement(AiMessage, { content: reply }));
  assert.equal((html.match(/class="katex"/g) || []).length, 3);
  assert(!html.includes('class="katex-error"'));
  assert(html.includes('class="mfrac"'));
  assert(html.includes("<h1>公式解读</h1>"));
  assert(html.includes("<strong>要点</strong>"));
  assert(html.includes('class="language-python"'));
  assert(html.includes("<math"));
});

test("unsupported math stays readable without throwing or executing reply HTML", () => {
  const html = renderToStaticMarkup(createElement(AiMessage, { content: String.raw`$\unknowncommand{x}$` + '\n<script>alert(1)</script>' }));
  assert(html.includes("unknowncommand"));
  assert(!html.includes("<script"));
});
