import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, lstat } from "node:fs/promises";
import {
  conversationMessagesSchema,
  type ConversationRecord,
  type ConversationSummary,
} from "@freecoda/contracts";
import type { ModelMessage } from "ai";
import { redactSecrets, validateBaseURL } from "@freecoda/core";
import { savePrivate, stateDir } from "./config";
import {
  loadConversation,
  saveConversation,
  listConversations,
  deleteConversation,
  listLocalConversationRecords,
  type Conversation,
  type ConversationMode,
} from "./threads";
type Summary = ConversationSummary;
type Remote = ConversationRecord;
type SyncEntry = {
  scope: string;
  mode: "chat" | "coding";
  version: number | null;
  hash: string;
  dirty: boolean;
  deleted?: boolean;
};
type SyncState = { entries: Record<string, SyncEntry> };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const modeFor = (mode: ConversationMode) =>
  mode === "chat" ? ("chat" as const) : ("coding" as const);
class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`Conversation synchronization unavailable (${status}).`);
  }
}
async function privateJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000)
      throw Error("Invalid conversation sync cache.");
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}
export class AccountThreadSync {
  private summaries: Summary[] = [];
  private state: SyncState = { entries: {} };
  private readonly file: string;
  private constructor(
    private readonly server: string,
    private readonly token: string,
    readonly userId: string,
  ) {
    this.file = path.join(
      stateDir(),
      "account-history",
      digest(`${server}:${userId}`) + ".json",
    );
  }
  hasPending() {
    return Object.values(this.state.entries).some((entry) => entry.dirty);
  }
  scope(root: string, mode: ConversationMode) {
    return `account:${this.server}:${this.userId}:${modeFor(mode)}:${root}`;
  }
  private async request(route: string, method = "GET", body?: unknown) {
    const response = await fetch(
      `${this.server}/api/v1/conversations${route}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!response.ok) throw new SyncHttpError(response.status);
    return await response.json();
  }
  static async open(config: {
    server: string;
    token?: string;
  }): Promise<AccountThreadSync | undefined> {
    if (!config.token) return undefined;
    const server = validateBaseURL(config.server);
    const identityFile = path.join(
      stateDir(),
      "account-history",
      "identity-" + digest(`${server}:${config.token}`) + ".json",
    );
    let initial: any;
    try {
      const response = await fetch(`${server}/api/v1/conversations?mode=chat`, {
        headers: { Authorization: `Bearer ${config.token}` },
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401 || response.status === 403) return undefined;
      if (!response.ok) throw Error("Cloud history unavailable.");
      initial = await response.json();
      if (typeof initial.userId !== "string" || !initial.userId)
        throw Error("Cloud history identity unavailable.");
      await savePrivate(identityFile, { userId: initial.userId });
    } catch {
      const cached = await privateJson<{ userId?: string }>(identityFile, {});
      if (!cached.userId) return undefined;
      initial = { userId: cached.userId, conversations: [] };
    }
    const sync = new AccountThreadSync(server, config.token, initial.userId);
    sync.state = await privateJson(sync.file, { entries: {} });
    if (!sync.state.entries || typeof sync.state.entries !== "object")
      throw Error("Invalid account history cache.");
    sync.summaries = Array.isArray(initial.conversations)
      ? initial.conversations
      : [];
    if (initial.nextCursor) await sync.refresh().catch(() => {});
    await sync.migrateLegacy();
    await sync.flush();
    return sync;
  }
  private async persist() {
    await savePrivate(this.file, this.state);
  }
  private hash(conversation: Conversation, mode: "chat" | "coding") {
    return digest(
      JSON.stringify({
        title: conversation.title,
        mode,
        messages: this.clean(conversation.messages),
      }),
    );
  }
  private clean(messages: ModelMessage[]): ModelMessage[] {
    const walk = (value: any): any =>
      typeof value === "string"
        ? redactSecrets(value).split(this.token).join("[redacted credential]")
        : Array.isArray(value)
          ? value.map(walk)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, walk(v)]),
              )
            : value;
    return conversationMessagesSchema.parse(walk(messages));
  }
  private async migrateLegacy() {
    const marker = path.join(
      stateDir(),
      "account-history",
      "legacy-owner.json",
    );
    const owner = await privateJson<{
      userId?: string;
      server?: string;
      complete?: boolean;
    }>(marker, {});
    const legacyAllowed =
      !owner.userId ||
      (owner.userId === this.userId &&
        owner.server === this.server &&
        !owner.complete);
    if (legacyAllowed)
      await savePrivate(marker, {
        userId: this.userId,
        server: this.server,
        complete: false,
      });
    const tokenScope = `unverified-account:${digest(this.server + this.token)}:`;
    for (const conversation of await listLocalConversationRecords()) {
      if (
        conversation.root.startsWith("account:") ||
        !conversation.messages.length ||
        this.state.entries[conversation.id]
      )
        continue;
      let root: string;
      let chat: boolean;
      if (conversation.root.startsWith(tokenScope)) {
        const rest = conversation.root.slice(tokenScope.length);
        chat = rest.startsWith("chat:");
        if (!chat && !rest.startsWith("coding:")) continue;
        root = rest.slice(chat ? 5 : 7);
      } else {
        if (
          !legacyAllowed ||
          conversation.root.startsWith("unverified-account:")
        )
          continue;
        chat = conversation.root.startsWith("freecoda-general-chat:");
        root = chat
          ? conversation.root.slice("freecoda-general-chat:".length)
          : conversation.root;
      }
      try {
        await this.save(
          { ...conversation, root: this.scope(root, chat ? "chat" : "build") },
          chat ? "chat" : "build",
          false,
        );
      } catch {
        /* Preserve API-ineligible legacy records locally; never truncate history. */
      }
    }
    if (legacyAllowed)
      await savePrivate(marker, {
        userId: this.userId,
        server: this.server,
        complete: true,
      });
  }
  async refresh() {
    const summaries: Summary[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.request(
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : "",
      );
      if (page.userId !== this.userId)
        throw Error(
          "Account changed; restart Freecoda before syncing history.",
        );
      summaries.push(...page.conversations);
      cursor = page.nextCursor || null;
    } while (cursor && summaries.length < 10_000);
    if (cursor)
      throw Error(
        "Conversation history listing exceeded its safe limit; retry later.",
      );
    this.summaries = summaries;
    const remoteIds = new Set(summaries.map((item) => item.id));
    for (const [id, entry] of Object.entries(this.state.entries))
      if (entry.version !== null && !entry.deleted && !remoteIds.has(id)) {
        await deleteConversation(entry.scope, id);
        entry.deleted = true;
        entry.dirty = false;
      }
    await this.persist();
  }
  async list(root: string, mode: ConversationMode) {
    await this.flush();
    await this.refresh().catch(() => {});
    const local = await listConversations(this.scope(root, mode));
    const result = new Map<
      string,
      Pick<Conversation, "id" | "title" | "updatedAt">
    >(
      this.summaries
        .filter((s) => s.mode === modeFor(mode))
        .map((s) => [s.id, s]),
    );
    for (const c of local)
      if (!this.state.entries[c.id]?.deleted) result.set(c.id, c);
    return [...result.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  async load(
    root: string,
    mode: ConversationMode,
    id: string,
  ): Promise<Conversation> {
    const scope = this.scope(root, mode);
    if (this.state.entries[id]?.deleted)
      throw Error("This conversation was deleted from your account.");
    try {
      const remote = (await this.request(`/${id}`)).conversation as Remote;
      if (remote.mode !== modeFor(mode)) throw new SyncHttpError(422);
      const existing = this.state.entries[id];
      if (existing?.dirty) return await loadConversation(existing.scope, id);
      const saved = await saveConversation({
        id,
        root: scope,
        title: remote.title,
        updatedAt: remote.updatedAt,
        messages: remote.messages,
      });
      this.state.entries[id] = {
        scope,
        mode: remote.mode,
        version: remote.version,
        hash: this.hash(saved, remote.mode),
        dirty: false,
      };
      await this.persist();
      return saved;
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 422)
        throw Error("Chat and coding conversations cannot be mixed.");
      if (error instanceof SyncHttpError && [404, 410].includes(error.status)) {
        if (error.status === 404 && this.state.entries[id]?.version == null) {
          try {
            return await loadConversation(scope, id);
          } catch {
            /* No pending local copy. */
          }
        }
        await deleteConversation(scope, id);
        throw Error("This conversation was deleted from your account.");
      }
      return await loadConversation(this.state.entries[id]?.scope || scope, id);
    }
  }
  async save(
    conversation: Conversation,
    mode: ConversationMode,
    flush = true,
  ): Promise<Conversation> {
    const saved = await saveConversation(conversation);
    if (!saved.messages.length) return saved;
    const entry = this.state.entries[saved.id];
    const hash = this.hash(saved, modeFor(mode));
    if (entry?.deleted) return saved;
    this.state.entries[saved.id] = {
      scope: saved.root,
      mode: modeFor(mode),
      version: entry?.version ?? null,
      hash: entry?.hash ?? "",
      dirty: hash !== entry?.hash,
    };
    await this.persist();
    if (flush) await this.flush();
    return await loadConversation(saved.root);
  }
  async flush() {
    for (const [id, entry] of Object.entries(this.state.entries)) {
      if (entry.deleted) {
        if (entry.dirty)
          try {
            await this.request(`/${id}`, "DELETE");
            entry.dirty = false;
            await this.persist();
          } catch (error) {
            if (
              error instanceof SyncHttpError &&
              [404, 410].includes(error.status)
            ) {
              entry.dirty = false;
              await this.persist();
            } else break;
          }
        continue;
      }
      if (!entry.dirty) continue;
      let local: Conversation;
      try {
        local = await loadConversation(entry.scope, id);
      } catch {
        continue;
      }
      try {
        const result = (
          await this.request(`/${id}`, "PUT", {
            title: local.title,
            mode: entry.mode,
            messages: this.clean(local.messages),
            expectedVersion: entry.version,
          })
        ).conversation as Remote;
        entry.version = result.version;
        entry.hash = this.hash(local, entry.mode);
        entry.dirty = false;
        this.summaries = this.summaries.filter((s) => s.id !== id);
        this.summaries.push(result);
        await this.persist();
      } catch (error) {
        if (error instanceof SyncHttpError && error.status === 410) {
          await deleteConversation(entry.scope, id);
          entry.deleted = true;
          entry.dirty = false;
          await this.persist();
          continue;
        }
        if (error instanceof SyncHttpError && error.status === 409) {
          const fork = await saveConversation({
            ...local,
            id: randomUUID(),
            title: local.title + " (local copy)",
          });
          entry.dirty = false;
          this.state.entries[fork.id] = {
            ...entry,
            version: null,
            hash: "",
            dirty: true,
          };
          await this.persist();
          continue;
        }
        break;
      }
    }
  }
  async clear(root: string, mode: ConversationMode) {
    const scope = this.scope(root, mode);
    for (const item of await listConversations(scope)) {
      const entry = this.state.entries[item.id] || {
        scope,
        mode: modeFor(mode),
        version: null,
        hash: "",
        dirty: false,
      };
      this.state.entries[item.id] = { ...entry, deleted: true, dirty: true };
      await deleteConversation(scope, item.id);
    }
    await this.persist();
    await this.flush();
  }
}
