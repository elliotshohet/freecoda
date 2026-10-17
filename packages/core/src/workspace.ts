import {
  realpath,
  readFile,
  readdir,
  lstat,
  mkdir,
  writeFile,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ignore from "ignore";
import { createPatch } from "diff";
import { tryToDoStringReplacementWithExtraIndentation } from "../../../vendor/codebuff/indentation";
export type Approval = (
  kind: "write" | "shell",
  description: string,
) => Promise<boolean>;
const defaults = [
  ".git/",
  "node_modules/",
  ".next/",
  "dist/",
  "vendor/",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  ".npmrc",
  ".netrc",
  ".aws/",
  ".ssh/",
  "credentials*",
  "secrets*",
  "bun.lock",
  "package-lock.json",
];
const MAX_FILE = 128 * 1024;
export class Workspace {
  private constructor(
    public readonly root: string,
    private approve: Approval,
    private signal?: AbortSignal,
  ) {}
  static async open(root: string, approve: Approval, signal?: AbortSignal) {
    return new Workspace(await realpath(root), approve, signal);
  }
  private check() {
    this.signal?.throwIfAborted();
  }
  async resolve(relative: string, write = false): Promise<string> {
    this.check();
    if (path.isAbsolute(relative) || relative.includes("\0"))
      throw new Error("Use a workspace-relative path.");
    const target = path.resolve(this.root, relative);
    const rel = path.relative(this.root, target);
    if (rel.startsWith("..") || path.isAbsolute(rel) || !rel)
      throw new Error("Path must be inside the workspace.");
    let cursor = this.root;
    for (const part of rel.split(path.sep)) {
      cursor = path.join(cursor, part);
      try {
        const info = await lstat(cursor);
        if (info.isSymbolicLink())
          throw new Error("Symlinks are excluded from repository tools.");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (!write) throw e;
        break;
      }
    }
    if (await this.ignored(rel))
      throw new Error("This path is ignored or may contain credentials.");
    return target;
  }
  async ignored(relative: string) {
    const posix = relative.split(path.sep).join("/");
    if (ignore().add(defaults).ignores(posix)) return true;
    const parts = relative.split(path.sep);
    for (let level = 0; level < parts.length; level++) {
      const dir = path.join(this.root, ...parts.slice(0, level));
      const local = parts.slice(level).join("/");
      for (const name of [".gitignore", ".freecodaignore"]) {
        try {
          const filename = path.join(dir, name);
          const info = await lstat(filename);
          if (info.isSymbolicLink() || info.size > MAX_FILE) continue;
          const rules = ignore().add(await readFile(filename, "utf8"));
          if (rules.ignores(local)) return true;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    }
    return false;
  }
  async files() {
    const files: string[] = [];
    let scanned = 0;
    const walk = async (relative: string) => {
      for (const entry of await readdir(path.join(this.root, relative), {
        withFileTypes: true,
      })) {
        this.check();
        if (++scanned > 10000)
          throw new Error(
            "Repository is too large; add exclusions to .freecodaignore.",
          );
        const rel = path.join(relative, entry.name);
        if (entry.isSymbolicLink() || (await this.ignored(rel))) continue;
        if (entry.isDirectory()) await walk(rel);
        else if (entry.isFile()) files.push(rel.split(path.sep).join("/"));
      }
    };
    await walk("");
    return files.sort();
  }
  async read(relative: string) {
    const target = await this.resolve(relative);
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_FILE)
      throw new Error("Read requires a text file under 128 KiB.");
    const text = await readFile(target, "utf8");
    if (text.includes("\0")) throw new Error("Binary files are excluded.");
    return redactSecrets(text);
  }
  async search(query: string) {
    if (!query || query.length > 200)
      throw new Error("Search query must be 1–200 characters.");
    const hits: { path: string; line: number; text: string }[] = [];
    for (const file of await this.files()) {
      let text;
      try {
        text = await this.read(file);
      } catch {
        continue;
      }
      for (const [i, line] of text.split("\n").entries()) {
        if (line.toLowerCase().includes(query.toLowerCase()))
          hits.push({ path: file, line: i + 1, text: line.slice(0, 400) });
        if (hits.length >= 50) return hits;
      }
    }
    return hits;
  }
  async write(relative: string, content: string, expected?: string) {
    if (Buffer.byteLength(content) > MAX_FILE)
      throw new Error("Write is limited to 128 KiB.");
    const target = await this.resolve(relative, true);
    let old = "";
    try {
      old = await readFile(target, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (expected !== undefined && old !== expected)
      throw new Error("File changed since it was read. Read it again.");
    if (old === content) return "No change.";
    const patch = createPatch(relative, old, content);
    if (!(await this.approve("write", redactSecrets(patch))))
      return "User declined the change. Do not retry it.";
    this.check();
    await this.resolve(relative, true);
    let current = "";
    try {
      current = await readFile(target, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (current !== old)
      throw new Error("File changed while waiting for approval.");
    await mkdir(path.dirname(target), { recursive: true });
    await this.resolve(relative, true);
    const temp = path.join(
      path.dirname(target),
      `.freecoda-${randomUUID()}.tmp`,
    );
    try {
      const mode = await stat(target)
        .then((s) => s.mode & 0o777)
        .catch(() => 0o644);
      await writeFile(temp, content, { mode, flag: "wx" });
      this.check();
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
    return `Updated ${relative}.`;
  }
  async replace(relative: string, search: string, replacement: string) {
    if (!search) throw new Error("Search text must not be empty.");
    const target = await this.resolve(relative);
    const original = await readFile(target, "utf8");
    if (Buffer.byteLength(original) > MAX_FILE)
      throw new Error("File exceeds editing limit.");
    let from = search,
      to = replacement;
    if (!original.includes(from)) {
      const adjusted = tryToDoStringReplacementWithExtraIndentation({
        oldFileContent: original,
        searchContent: search,
        replaceContent: replacement,
      });
      if (!adjusted)
        throw new Error("Search text was not found. Read the file first.");
      from = adjusted.searchContent;
      to = adjusted.replaceContent;
    }
    if (original.split(from).length !== 2)
      throw new Error("Search text is ambiguous; include more context.");
    return this.write(
      relative,
      original.replace(from, () => to),
      original,
    );
  }
}
export function redactSecrets(value: string) {
  return value
    .replace(
      /\b(sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
      "[redacted credential]",
    )
    .replace(
      /((?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
      "$1[redacted]",
    );
}
