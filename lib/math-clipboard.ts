import { normalizeAiMarkdown } from "./ai-markdown.ts";

export function containsMath(text: string) {
  return /\$\$|\$[^$\n]+\$/.test(normalizeAiMarkdown(text));
}

// Read the original TeX annotation once, rather than the positioned glyphs.
export function mathClipboardText(root: Node): string {
  function read(node: Node): string {
    if (node.nodeType === 3) return node.textContent || "";
    if (node.nodeType !== 1 && node.nodeType !== 11) return "";
    const element = node.nodeType === 1 ? node as Element : null;
    if (element?.matches("script,style,button")) return "";
    if (element?.matches(".katex-display,.katex")) {
      const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (tex !== undefined && tex !== null) return element.matches(".katex-display") ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    }
    if (element?.tagName === "BR") return "\n";
    if (element?.tagName === "TABLE") {
      const rows = Array.from(element.querySelectorAll("tr"), row => Array.from(row.children, cell => read(cell).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
      return `\n\n${[line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
    }
    const content = Array.from(node.childNodes, read).join("");
    if (!element) return content;
    if (element.tagName === "PRE") {
      const code = element.querySelector("code"), language = code?.className.match(/language-(\S+)/)?.[1] || "";
      return `\n\n\`\`\`${language}\n${element.textContent?.trimEnd() || ""}\n\`\`\`\n\n`;
    }
    if (element.tagName === "CODE") return `\`${content}\``;
    if (element.tagName === "STRONG" || element.tagName === "B") return `**${content}**`;
    if (element.tagName === "EM" || element.tagName === "I") return `*${content}*`;
    if (/^H[1-6]$/.test(element.tagName)) return `${"#".repeat(Number(element.tagName[1]))} ${content}\n\n`;
    if (element.tagName === "LI") return `- ${content.trim()}\n`;
    if (element.tagName === "TR") return content + "\n";
    if (element.tagName === "TD" || element.tagName === "TH") return content + "\t";
    if (/^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|TABLE)$/.test(element.tagName)) return content + "\n\n";
    return content;
  }
  return read(root).replace(/\n{3,}/g, "\n\n").trim();
}

export function selectedMathText(root: HTMLElement, selection: Selection | null): string | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const formula = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest(".katex-display,.katex");
  const start = formula(range.startContainer), end = formula(range.endContainer);
  if (start && root.contains(start)) range.setStartBefore(start.closest(".katex-display") || start);
  if (end && root.contains(end)) range.setEndAfter(end.closest(".katex-display") || end);
  return mathClipboardText(range.cloneContents());
}

export function recoverMathPaste(plain: string, html: string): string {
  if (!html || !html.includes("katex")) return plain;
  const template = document.createElement("template"); template.innerHTML = html;
  if (!template.content.querySelector('.katex annotation[encoding="application/x-tex"]')) return plain;
  return mathClipboardText(template.content) || plain;
}

export async function copyMathText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Safari fallback stays within this user gesture. */ }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea"); input.value = text; input.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
  document.body.appendChild(input); input.select();
  try { return document.execCommand("copy"); } catch { return false; }
  finally { input.remove(); previous?.focus(); }
}
