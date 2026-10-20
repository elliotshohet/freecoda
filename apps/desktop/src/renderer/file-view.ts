/** Lightweight presentation only: the native textarea remains the editable source of truth. */
export type FileToken = { kind: "comment" | "string" | "keyword" | "number" | "tag" | "property" | "plain"; text: string };
const keywords = new Set("as async await break case catch class const continue def default delete do else enum export extends false finally fn for from function if implements import in interface let match new None null package pass private protected pub public raise readonly return self static struct super switch this throw true try type typeof undefined use var void while with yield True False SELECT FROM WHERE INSERT INTO UPDATE DELETE CREATE TABLE JOIN ON AND OR NOT AS SET VALUES".split(" "));

export function fileLanguage(filename: string): string {
  const name = filename.split(/[\\/]/).at(-1)?.toLowerCase() || "";
  const extension = name.split(".").at(-1) || "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "swift", "kt"].includes(extension)) return "code";
  if (["json", "jsonc"].includes(extension)) return "json";
  if (["css", "scss", "less"].includes(extension)) return "css";
  if (["html", "htm", "xml", "svg", "vue", "svelte"].includes(extension)) return "markup";
  if (["py", "rb", "sh", "bash", "zsh", "yaml", "yml", "toml"].includes(extension) || name === "dockerfile" || name.startsWith(".env")) return "hash";
  if (extension === "sql") return "sql";
  return "plain";
}

/** Token text is never interpreted as markup; concatenating tokens reproduces the file exactly. */
export function tokenizeFile(source: string, filename: string): FileToken[] {
  const language = fileLanguage(filename);
  // Keep typing responsive for large files; the full content remains visible and editable.
  if (language === "plain" || source.length > 200_000) return [{ kind: "plain", text: source }];
  const comments = language === "markup" ? /<!--[\s\S]*?(?:-->|$)|/.source
    : language === "hash" ? /#[^\n]*|/.source
    : language === "sql" ? /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|/.source
    : language === "css" ? /\/\*[\s\S]*?(?:\*\/|$)|/.source
    : /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|/.source;
  const pattern = new RegExp(comments + /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|<\/?[A-Za-z][\w:.-]*|\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b[A-Za-z_$][\w$]*\b/.source, "g");
  const tokens: FileToken[] = [];
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    if (tokens.length > 20_000) return [{ kind: "plain", text: source }];
    const index = match.index!;
    if (index > end) tokens.push({ kind: "plain", text: source.slice(end, index) });
    const value = match[0];
    let kind: FileToken["kind"] = "plain";
    if ((value.startsWith("<!--") && language === "markup") || (value.startsWith("/*") && ["code", "css", "json", "sql"].includes(language)) || (value.startsWith("//") && ["code", "json"].includes(language)) || (value.startsWith("#") && language === "hash") || (value.startsWith("--") && language === "sql")) kind = "comment";
    else if (/^["'`]/.test(value)) kind = language === "json" && /^\s*:/.test(source.slice(index + value.length, index + value.length + 100)) ? "property" : "string";
    else if (value.startsWith("<") && language === "markup") kind = "tag";
    else if (/^\d/.test(value)) kind = "number";
    else if (keywords.has(value)) kind = "keyword";
    tokens.push({ kind, text: value });
    end = index + value.length;
  }
  if (end < source.length) tokens.push({ kind: "plain", text: source.slice(end) });
  return tokens;
}

export function createFileView(editor: HTMLTextAreaElement, options: { signal?: AbortSignal } = {}) {
  const surface = document.createElement("div");
  surface.className = "file-code-surface";
  const highlight = document.createElement("pre");
  highlight.className = "file-code-highlight";
  highlight.setAttribute("aria-hidden", "true");
  editor.before(surface);
  surface.append(highlight, editor);
  let previousContent: string | undefined;
  let previousPath = "";
  let filename = "";
  const syncScroll = () => {
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  };
  const update = (path = filename) => {
    filename = path;
    if (previousContent !== editor.value || previousPath !== path) {
      previousContent = editor.value;
      previousPath = path;
      const fragment = document.createDocumentFragment();
      for (const token of tokenizeFile(editor.value, path)) {
        if (token.kind === "plain") fragment.append(document.createTextNode(token.text));
        else {
          const span = document.createElement("span");
          span.className = `file-token-${token.kind}`;
          span.textContent = token.text;
          fragment.append(span);
        }
      }
      // A terminal newline needs a final empty line with the same scroll extent as textarea.
      fragment.append(document.createTextNode("\n"));
      highlight.replaceChildren(fragment);
    }
    syncScroll();
  };
  const input = () => update();
  editor.addEventListener("input", input, { signal: options.signal });
  editor.addEventListener("scroll", syncScroll, { passive: true, signal: options.signal });
  update();
  return {
    update,
    dispose() {
      editor.removeEventListener("input", input);
      editor.removeEventListener("scroll", syncScroll);
      surface.before(editor);
      surface.remove();
    },
  };
}
