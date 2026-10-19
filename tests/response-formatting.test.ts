import { expect, test } from "bun:test";
import { parseMarkdownBlocks, safeMarkdownLink } from "../apps/desktop/src/renderer/markdown";
import { terminalMarkdownLines } from "../packages/cli/src/ui";

test("desktop groups paragraphs and preserves code, lists and tables", () => {
  const blocks = parseMarkdownBlocks("# Title\n\nFirst line\nsecond line\n\n3. one\n4. two\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```ts\nconst x = '<script>';\n  keep();\n```");
  expect(blocks).toEqual([
    { kind: "heading", level: 1, text: "Title" },
    { kind: "paragraph", text: "First line\nsecond line" },
    { kind: "list", ordered: true, start: 3, items: ["one", "two"] },
    { kind: "table", headers: ["A", "B"], rows: [["x", "y"]] },
    { kind: "code", language: "ts", text: "const x = '<script>';\n  keep();" },
  ]);
});
test("unclosed streaming fences retain partial code and HTML is literal text", () => {
  expect(parseMarkdownBlocks("<img src=x onerror=alert(1)>\n\n```js\n  partial")).toEqual([
    { kind: "paragraph", text: "<img src=x onerror=alert(1)>" },
    { kind: "code", language: "js", text: "  partial" },
  ]);
  expect(safeMarkdownLink("javascript:alert(1)")).toBeNull();
  expect(safeMarkdownLink("data:text/html,x")).toBeNull();
  expect(safeMarkdownLink("https://token@example.com")).toBeNull();
  expect(safeMarkdownLink("https://example.com")).toBe("https://example.com/");
});
test("terminal format preserves fenced code and strips injected terminal controls", () => {
  const lines = terminalMarkdownLines("## Heading\n- **Item**\n```sh\n  echo '**literal**'\n```\n\u001b[2J[Docs](https://example.com)");
  expect(lines).toEqual([
    { text: "Heading", kind: "heading" },
    { text: "• Item", kind: "text" },
    { text: "── sh ──", kind: "heading" },
    { text: "  echo '**literal**'", kind: "code" },
    { text: "── End code ──", kind: "heading" },
    { text: "Docs (https://example.com)", kind: "text" },
  ]);
});
