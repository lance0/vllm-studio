const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

export function normalizeAssistantMarkdownForRender(content: string): string {
  if (!content) return '';
  let text = stripBoxTags(content);

  // Fix common "no newline after fence language" issue (e.g., ```html<!DOCTYPE html>)
  text = text.replace(/```(html|svg|jsx|tsx|react|javascript|js)(?=\S)/gi, '```$1\n');

  // Some models output `mermaidgraph` instead of `mermaid`.
  text = text.replace(/```mermaidgraph\b/gi, '```mermaid');
  // And sometimes they omit the `graph` keyword: ```mermaidgraph LR A-->B
  text = text.replace(/```mermaid\s*(?:graph\s+)?(?=[A-Z]{1,3}\b)/gi, '```mermaid\ngraph ');

  // Repair standalone `mermaidgraph` blocks that aren't fenced, and fix ` `` ` closers.
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  const isFenceCloser = (line: string) => /^\s*```\s*$/.test(line) || /^\s*``\s*$/.test(line);
  const isFenceOpener = (line: string) => /^\s*```/.test(line);

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (/^mermaidgraph\b/i.test(trimmed)) {
      const rest = trimmed.replace(/^mermaidgraph\b/i, '').trim();
      out.push('```mermaid');
      if (rest) out.push(`graph ${rest}`);
      else out.push('graph TD');
      i++;

      while (i < lines.length) {
        const l = lines[i];
        if (isFenceOpener(l) || isFenceCloser(l)) {
          i++;
          break;
        }
        out.push(l);
        i++;
      }

      out.push('```');
      continue;
    }

    if (/^\s*``\s*$/.test(raw)) {
      out.push('```');
      i++;
      continue;
    }

    out.push(raw);
    i++;
  }

  return out.join('\n');
}
