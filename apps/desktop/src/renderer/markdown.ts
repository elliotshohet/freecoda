export type MarkdownBlock =
  | { kind: "paragraph" | "quote"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "code"; text: string; language: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
const divider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const text: string[] = []; i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && new RegExp(`^${fence[1][0]}+\\s*$`).test(lines[i].trim()))) text.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: "code", text: text.join("\n"), language: fence[2].trim() || "Code" }); continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] }); i++; continue; }
    if (i + 1 < lines.length && line.includes("|") && divider(lines[i + 1])) {
      const headers = cells(line); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", headers, rows }); continue;
    }
    const list = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) {
      const items: string[] = []; const ordered = Boolean(list[2]); const start = Number(list[2] || 1);
      while (i < lines.length) {
        const item = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(lines[i]);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]); i++;
      }
      blocks.push({ kind: "list", ordered, start, items }); continue;
    }
    if (/^\s*>/.test(line)) {
      const text: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) text.push(lines[i++].replace(/^\s*> ?/, ""));
      blocks.push({ kind: "quote", text: text.join("\n") }); continue;
    }
    const text = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+\.\s)/.test(lines[i]) && !(i + 1 < lines.length && divider(lines[i + 1]))) text.push(lines[i++]);
    blocks.push({ kind: "paragraph", text: text.join("\n") });
  }
  return blocks;
}
export function safeMarkdownLink(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
