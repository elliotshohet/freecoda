import { expect, test } from "bun:test";
import { fileLanguage, tokenizeFile } from "../apps/desktop/src/renderer/file-view";

test("desktop file highlighting preserves whitespace, source characters and markup safely", () => {
  const source = 'const message = "<script>alert(1)</script>";\n\t// Keep  two spaces\nreturn 42;\n';
  const tokens = tokenizeFile(source, "src/example.ts");
  expect(tokens.map(token => token.text).join("")).toBe(source);
  expect(tokens).toContainEqual({ kind: "keyword", text: "const" });
  expect(tokens).toContainEqual({ kind: "string", text: '"<script>alert(1)</script>"' });
  expect(tokens).toContainEqual({ kind: "comment", text: "// Keep  two spaces" });
  expect(tokens).toContainEqual({ kind: "number", text: "42" });
});

test("desktop file highlighting understands JSON properties and common file types", () => {
  const source = '{\n  "name": "Freecoda", "enabled": true\n}\n';
  const tokens = tokenizeFile(source, "package.json");
  expect(tokens.map(token => token.text).join("")).toBe(source);
  expect(tokens).toContainEqual({ kind: "property", text: '"name"' });
  expect(fileLanguage("styles/app.css")).toBe("css");
  expect(fileLanguage("/project/.env.local")).toBe("hash");
  expect(fileLanguage("Dockerfile")).toBe("hash");
  for (const [file, content] of [["app.py", '# comment\nreturn "value"'], ["page.html", '<!-- comment -->\n<div class="safe">Text</div>'], ["query.sql", '-- comment\nSELECT 10 FROM table'], ["app.ts", '/* unfinished comment\n    ']]) {
    expect(tokenizeFile(content, file).map(token => token.text).join("")).toBe(content);
  }
});

test("desktop file highlighting keeps large, unknown and empty files as exact plaintext", () => {
  for (const [file, source] of [["notes.txt", '<b>literal & text</b>\n\t'], ["large.ts", "const value = 1;\n".repeat(15_000)], ["empty.ts", ""]]) {
    const tokens = tokenizeFile(source, file);
    expect(tokens.map(token => token.text).join("")).toBe(source);
    if (source.length > 200_000 || file.endsWith(".txt")) expect(tokens).toEqual([{ kind: "plain", text: source }]);
  }
});
