import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createElement } = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
mock.module("../apps/web/components/markdown-message.module.css", () => ({ default: {} }));
const { MarkdownMessage } = requireWeb("./components/markdown-message.tsx");
const render = (text: string) => renderToStaticMarkup(createElement(MarkdownMessage, { text }));

test("model Markdown stays inert while links and structured output remain readable", () => {
  const html = render('# Heading\n\n<script>alert(1)</script>\n\n[x](javascript:alert) [safe](https://example.com)\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n- One\n- Two');
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain("<table>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<h1>");
});
test("escaped quote text and incomplete streamed fences render without freezing or executing HTML", () => {
  expect(render("&gt; literal text")).toContain("literal text");
  const html = render('```typescript\nconst text = "<img src=x onerror=alert(1)>";');
  expect(html).toContain("Copy code");
  expect(html).toContain("typescript");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});
