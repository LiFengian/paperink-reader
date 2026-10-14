const TEX_COMMAND = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|iint|lim|partial|nabla|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega|dot|ddot|vec|hat|bar|overline|underline|mathbf|mathrm|mathbb|mathcal|mathsf|text|begin|end|left|right|cdot|times|leq|geq|neq|approx|equiv|infty|forall|exists|in|notin|subset|supset|ell|sin|cos|tan|log|exp|det)\b/;

function unwrapMath(value: string) {
  const text = value.trim();
  for (const [open, close] of [["\\[", "\\]"], ["\\(", "\\)"], ["$$", "$$"], ["$", "$"]]) {
    if (text.startsWith(open) && text.endsWith(close)) return text.slice(open.length, -close.length).trim();
  }
  return text;
}

function normalizeText(value: string) {
  const delimiters = (text: string) => text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math.trim().replace(/\r?\n/g, " ")}$`);
  // Preserve real inline code; historical replies sometimes put TeX in backticks.
  let result = "", start = 0;
  const code = /(`+)([^`]*?)\1/g;
  for (const match of value.matchAll(code)) {
    result += delimiters(value.slice(start, match.index));
    const math = unwrapMath(match[2]);
    result += TEX_COMMAND.test(match[2]) || math !== match[2].trim() ? `$${math.replace(/\r?\n/g, " ")}$` : match[0];
    start = match.index! + match[0].length;
  }
  return result + delimiters(value.slice(start));
}

// Keep the stored reply unchanged. Normalize only common model math wrappers.
export function normalizeAiMarkdown(content: string) {
  const lines = content.split("\n"), result: string[] = [], prose: string[] = [];
  const flush = () => { if (prose.length) { result.push(normalizeText(prose.join("\n"))); prose.length = 0; } };
  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/);
    if (!opening) { prose.push(lines[index]); continue; }
    flush();
    const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
    let end = index + 1;
    while (end < lines.length && !closing.test(lines[end])) end++;
    if (end === lines.length) { result.push(lines.slice(index).join("\n")); return result.join("\n"); }
    const language = opening[2].trim(), body = lines.slice(index + 1, end).join("\n");
    if (/^(?:latex|tex|math)$/i.test(language) || (!language && TEX_COMMAND.test(body))) {
      result.push(`\n$$\n${unwrapMath(body)}\n$$\n`);
    } else result.push(lines.slice(index, end + 1).join("\n"));
    index = end;
  }
  flush();
  return result.join("\n");
}
