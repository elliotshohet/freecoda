import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile, rename, unlink, chmod } from "node:fs/promises";
import path from "node:path";

export type ComposerDraft = { key: string; text: string; revision: number };
export function composerDraftKey(scope: { server: string; account: string; workspace: string; thread: string }): string {
  return createHash("sha256").update(JSON.stringify(scope)).digest("hex");
}
/** Local-only store. The caller supplies an opaque account/conversation scope. */
export class ComposerDraftStore {
  private queue: Promise<unknown> = Promise.resolve();
  private revisions = new Map<string, number>();
  constructor(private readonly directory: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => {});
    return next;
  }
  private filename(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw Error("Invalid composer draft scope.");
    return path.join(this.directory, `${key}.json`);
  }
  private async read(key: string): Promise<ComposerDraft> {
    const filename = this.filename(key);
    try {
      const parent = await lstat(this.directory);
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error("Invalid composer draft directory.");
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw Error("Invalid composer draft file.");
      const value = JSON.parse(await readFile(filename, "utf8"));
      if (value.key !== key || typeof value.text !== "string" || value.text.length > 20000 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error("Invalid composer draft file.");
      this.revisions.set(key, Math.max(this.revisions.get(key) || 0, value.revision));
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { key, text: "", revision: this.revisions.get(key) || 0 };
    }
  }
  load(key: string): Promise<ComposerDraft> { return this.serialize(() => this.read(key)); }
  save(draft: ComposerDraft): Promise<{ saved: boolean }> {
    return this.serialize(async () => {
      const filename = this.filename(draft.key);
      if (typeof draft.text !== "string" || draft.text.length > 20000 || !Number.isSafeInteger(draft.revision) || draft.revision < 1) throw Error("Invalid composer draft.");
      if (!this.revisions.has(draft.key)) await this.read(draft.key);
      if (draft.revision <= (this.revisions.get(draft.key) || 0)) return { saved: false };
      try {
        if ((await lstat(this.directory)).isSymbolicLink()) throw Error("Invalid composer draft directory.");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(draft), { mode: 0o600, flag: "wx" });
        await rename(temporary, filename);
        this.revisions.set(draft.key, draft.revision);
      } finally { await unlink(temporary).catch(() => {}); }
      return { saved: true };
    });
  }
  flush(): Promise<unknown> { return this.queue; }
}
