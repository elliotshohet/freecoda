import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { LocalAgentService, type LocalAgentOptions } from "./local-agent";
import type { DesktopApprovalResponse, DesktopEvent, DesktopState } from "./shared";
import type { DesktopCreateSessionInput, DesktopSessionEvent, DesktopSessionSnapshot, DesktopSessionSummary } from "./desktop-sessions";
export type { DesktopSessionSummary, DesktopSessionSnapshot, DesktopSessionEvent, DesktopCreateSessionInput } from "./desktop-sessions";

type Entry = { summary: DesktopSessionSummary; service?: LocalAgentService; state?: DesktopState; approvals: Map<string, Extract<DesktopEvent, { type: "approval" }>>; pending?: AbortController; inFlight?: { prompt: string; text: string; revision: number; conversation: NonNullable<DesktopState["conversation"]> } };
type Lease = { root: string; repository: string; owner: string; external: boolean };
type WaitingLease = { root: string; repository: string; owner: string; signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void; abort: () => void };
export type DesktopSessionManagerOptions = LocalAgentOptions & {
  emitSession?: (event: DesktopSessionEvent) => void;
  emitSessions?: (snapshot: DesktopSessionSnapshot) => void;
};
const PRIMARY = "primary";
const overlaps = (first: string, second: string) => {
  const relative = path.relative(first, second), reverse = path.relative(second, first);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) || (!reverse.startsWith(`..${path.sep}`) && reverse !== ".." && !path.isAbsolute(reverse));
};
const conflicts = (root: string, repository: string, other: { root: string; repository: string }) => overlaps(root, other.root) || repository === other.repository;
const writeMethods = new Set(["saveFile", "runCommand", "syncRepository"]);
const scopeMethods = new Set(["selectWorkspace", "openRecentFolder", "trustWorkspace", "setConversationMode", "createThread", "openThread", "setThreadArchived", "deleteThread", "clearHistory", "refreshConversations", "setPermissions"]);

/** Main-process coordinator. Private service directories isolate history, drafts and config writes.
 * Repository leases serialize complete turns and manual mutations; they are not an OS sandbox.
 */
export class DesktopSessionManager {
  readonly activeService: LocalAgentService;
  private readonly entries = new Map<string, Entry>();
  private activeId = PRIMARY;
  private initialized?: Promise<void>;
  private loaded = false;
  private recordsWritable = true;
  private readonly leases = new Set<Lease>();
  private readonly conversationOwners = new Map<string, string>();
  private readonly waiting: WaitingLease[] = [];
  private persistence = Promise.resolve();
  private changingAccount = false;
  private accountEpoch = 0;
  private disposed = false;
  private creating = false;
  private readonly directory: string;
  private readonly primary: LocalAgentService;

  constructor(private readonly options: DesktopSessionManagerOptions) {
    this.directory = path.resolve(options.dataDirectory);
    this.entries.set(PRIMARY, this.entry(PRIMARY, "Main conversation"));
    this.primary = new LocalAgentService(this.serviceOptions(PRIMARY, this.directory));
    this.entries.get(PRIMARY)!.service = this.primary;
    this.activeService = new Proxy(this.primary, {
      get: (_target, property) => {
        if (typeof property !== "string") return undefined;
        if (property === "dispose") return () => this.dispose();
        if (property === "initialize") return () => this.initialize();
        // Return bound functions only: private service state is never shared through the facade.
        const method = (this.primary as unknown as Record<string, unknown>)[property];
        if (typeof method !== "function") return undefined;
        return (...args: unknown[]) => this.invoke(property, args);
      },
    });
  }
  private entry(id: string, title: string): Entry {
    return { summary: { id, title, root: null, conversationMode: "chat", status: "idle", updatedAt: new Date().toISOString(), pendingApprovals: 0 }, approvals: new Map() };
  }
  private serviceOptions(id: string, dataDirectory: string): LocalAgentOptions {
    return {
      ...this.options, dataDirectory, sessionId: id === PRIMARY ? undefined : id, emit: event => this.onEvent(id, event),
      acquireExecutionLease: (root, signal) => this.acquire(root, id, signal),
      ownConversation: conversationId => {
        const owner = this.conversationOwners.get(conversationId);
        if (owner && owner !== id) throw Error("This conversation is already owned by another open session.");
        this.conversationOwners.set(conversationId, id);
      },
      canAccessConversation: conversationId => !this.conversationOwners.has(conversationId) || this.conversationOwners.get(conversationId) === id,
    };
  }
  initialize(): Promise<void> { return this.initialized ??= this.load(); }
  private async load(): Promise<void> {
    await this.primary.initialize();
    await this.capture(PRIMARY);
    const filename = path.join(this.directory, "desktop-sessions.json");
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw Error("Invalid desktop session records.");
      const saved: unknown = JSON.parse(await readFile(filename, "utf8"));
      if (!saved || typeof saved !== "object") throw Error("Invalid desktop session records.");
      const record = saved as { accountScope?: unknown; sessions?: unknown };
      // An old account's session titles/folders must not appear under a new account.
      if (record.accountScope === await this.primary.sessionAccountScope() && Array.isArray(record.sessions)) {
        for (const value of record.sessions.slice(0, 25)) {
          if (!value || typeof value !== "object") continue;
          const item = value as Partial<DesktopSessionSummary>;
          if (item.id === PRIMARY) {
            if (item.status === "running" || item.status === "queued") this.entries.get(PRIMARY)!.summary.status = "interrupted";
            continue;
          }
          if (typeof item.id !== "string" || !/^[0-9a-f-]{36}$/.test(item.id) || typeof item.title !== "string" || item.title.length > 160 || (item.root !== null && (typeof item.root !== "string" || !path.isAbsolute(item.root) || item.root.length > 4096))) continue;
          const entry = this.entry(item.id, item.title);
          entry.summary = { ...entry.summary, root: item.root ?? null, conversationMode: item.conversationMode === "coding" ? "coding" : "chat", status: "interrupted", restored: true };
          // Recovery is a record only. No credentials are loaded, run replayed or tools invoked.
          this.entries.set(item.id, entry);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.recordsWritable = false;
        this.options.emit({ type: "error", text: "Saved session records could not be read safely. The main conversation is available; new session recovery records will not be saved until the existing file is repaired. Existing records are preserved." });
      }
    }
    this.loaded = true;
    this.publish();
  }
  currentService(): LocalAgentService {
    this.check();
    const service = this.entries.get(this.activeId)?.service;
    if (!service) throw Error("The selected session is interrupted.");
    return service;
  }
  snapshot(): DesktopSessionSnapshot {
    return { activeSessionId: this.activeId, sessions: [...this.entries.values()].map(entry => ({ ...entry.summary })) };
  }
  async listSessions(): Promise<DesktopSessionSnapshot> { await this.initialize(); return this.snapshot(); }
  private publish(): void {
    if (this.disposed || !this.loaded) return;
    const snapshot = this.snapshot();
    this.options.emitSessions?.(snapshot);
    if (!this.recordsWritable) return;
    // Serialize manifest writes so rapid streams cannot rename older records over newer ones.
    this.persistence = this.persistence.catch(() => {}).then(async () => {
      const filename = path.join(this.directory, "desktop-sessions.json");
      const info = await lstat(filename).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (info?.isSymbolicLink()) throw Error("Refusing symlinked desktop session records.");
      const temporary = path.join(this.directory, `.desktop-sessions-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ accountScope: await this.primary.sessionAccountScope(), sessions: snapshot.sessions }) + "\n", { mode: 0o600, flag: "wx" });
        await rename(temporary, filename);
      } finally { await unlink(temporary).catch(() => {}); }
    });
    // Failures remain observable at shutdown; never become unhandled rejections in the UI loop.
    void this.persistence.catch(() => {});
  }
  private onEvent(id: string, event: DesktopEvent): void {
    const entry = this.entries.get(id);
    if (!entry || this.disposed) return;
    if (event.type === "state") this.applyState(entry, event.state);
    if (event.type === "voice-turn") { delete entry.summary.runId; entry.inFlight = { prompt: event.text, text: "", revision: 0, conversation: [...(entry.state?.conversation ?? [])] }; }
    if (event.type === "text-delta" && entry.inFlight) { entry.inFlight.text += event.text; entry.inFlight.revision++; }
    if (event.type === "run-started") { entry.summary.status = "running"; entry.summary.runId = event.runId; }
    if (event.type === "done") { entry.summary.status = event.cancelled ? "cancelled" : "completed"; entry.inFlight = undefined; }
    if (event.type === "error" && event.runId) { entry.summary.status = "failed"; entry.inFlight = undefined; }
    if (event.type === "approval") entry.approvals.set(event.id, event);
    if (event.type === "approval-resolved") entry.approvals.delete(event.id);
    entry.summary.pendingApprovals = entry.approvals.size;
    entry.summary.updatedAt = new Date().toISOString();
    const scopedEvent = event.type === "state" ? { ...event, state: this.stateFor(entry) }
      : event.type === "text-delta" && entry.inFlight ? { ...event, streamText: entry.inFlight.text, streamRevision: entry.inFlight.revision }
      : event;
    this.options.emitSession?.({ sessionId: id, event: scopedEvent });
    if (id === this.activeId) this.options.emit(scopedEvent);
    if (!["text-delta", "output", "tool-start", "tool-result"].includes(event.type)) this.publish();
  }
  private stateFor(entry: Entry): DesktopState {
    const state = entry.state!;
    if (!entry.inFlight) return state;
    return { ...state, running: true, ...(entry.summary.runId ? { activeStream: { runId: entry.summary.runId, text: entry.inFlight.text, revision: entry.inFlight.revision } } : {}), conversation: [...entry.inFlight.conversation, { role: "user", text: entry.inFlight.prompt }, ...(entry.inFlight.text ? [{ role: "assistant" as const, text: entry.inFlight.text }] : [])] };
  }
  private applyState(entry: Entry, state: DesktopState): void {
    entry.state = state;
    entry.summary.root = state.workspace?.root ?? null;
    entry.summary.conversationMode = state.conversationMode;
  }
  private async capture(id: string): Promise<void> {
    const entry = this.entries.get(id)!;
    if (entry.service) this.applyState(entry, await entry.service.getState());
  }
  private check(): void { if (this.disposed) throw Error("Desktop sessions are closed."); if (this.changingAccount) throw Error("Wait for the account change before using sessions."); }
  async createSession(input: DesktopCreateSessionInput = {}): Promise<DesktopSessionSnapshot> {
    await this.initialize(); this.check();
    if (this.creating) throw Error("Wait for the current session to open.");
    if (this.entries.size >= 25) throw Error("Close a session before opening another (maximum 25).");
    if (input.mode !== undefined && input.mode !== "chat" && input.mode !== "coding") throw Error("Choose chat or coding mode.");
    if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160 || input.title.includes("\0"))) throw Error("Choose a session title under 160 characters.");
    const source = this.entries.get(this.activeId)?.service ?? this.primary;
    const sourceState = await source.getState();
    this.check();
    if (this.creating) throw Error("Wait for the current session to open.");
    const coding = input.mode === "coding" || input.root !== undefined;
    const root = input.root ?? (coding ? sourceState.workspace?.root : undefined);
    if (coding && (!root || !sourceState.openFolders.some(folder => folder.root === root))) throw Error("Choose the workspace in the native folder picker before opening a session.");
    this.creating = true;
    const id = randomUUID();
    const entry = this.entry(id, input.title?.trim() || (root ? path.basename(root) : "New chat session"));
    this.entries.set(id, entry);
    try {
      // Each session owns config, drafts, history and cloud thread IDs in its private directory.
      const sessionDirectory = path.join(this.directory, "parallel-sessions", id);
      await mkdir(path.dirname(sessionDirectory), { recursive: true, mode: 0o700 });
      if ((await lstat(path.dirname(sessionDirectory))).isSymbolicLink()) throw Error("Refusing symlinked desktop session storage.");
      entry.service = await source.forkSession(this.serviceOptions(id, sessionDirectory));
      if (root) await entry.service.openRecentFolder(root);
      if (!root || sourceState.openFolders.find(folder => folder.root === root)?.trusted) await entry.service.createThread();
      await this.capture(id);
      this.activeId = id;
      this.options.emit({ type: "state", state: this.stateFor(entry) });
      this.publish();
      return this.snapshot();
    } catch (error) { await entry.service?.clearSessionCredentials().catch(() => {}); await entry.service?.dispose(); this.entries.delete(id); throw error; }
    finally { this.creating = false; }
  }
  async selectSession(id: string): Promise<DesktopSessionSnapshot> {
    await this.initialize(); this.check();
    const entry = this.entries.get(id);
    if (entry?.summary.restored) return this.resumeSession(id);
    if (!entry?.service) throw Error("Choose an existing session.");
    this.activeId = id;
    await this.capture(id);
    this.options.emit({ type: "state", state: this.stateFor(entry) });
    this.publish(); return this.snapshot();
  }
  /** Explicit recovery opens saved context at idle; it never replays a prompt or tool call. */
  async resumeSession(id: string): Promise<DesktopSessionSnapshot> {
    await this.initialize(); this.check();
    const entry = this.entries.get(id);
    if (!entry?.summary.restored || entry.service) throw Error("Choose an interrupted saved session.");
    if (this.creating) throw Error("Wait for the current session to open.");
    this.creating = true;
    try {
      const state = await this.primary.getState();
      const root = entry.summary.root;
      if (root && !state.openFolders.some(folder => folder.root === root)) throw Error("Open this saved workspace in the native folder picker before resuming its session.");
      const parent = path.join(this.directory, "parallel-sessions");
      if ((await lstat(parent)).isSymbolicLink()) throw Error("Refusing symlinked desktop session storage.");
      entry.service = await this.primary.forkSession(this.serviceOptions(id, path.join(parent, id)));
      if (root) await entry.service.openRecentFolder(root);
      await this.capture(id);
      entry.summary.restored = false;
      entry.summary.status = "idle";
      delete entry.summary.runId;
      this.activeId = id;
      this.options.emit({ type: "state", state: this.stateFor(entry) });
      this.publish(); return this.snapshot();
    } catch (error) {
      await entry.service?.clearSessionCredentials().catch(() => {});
      await entry.service?.dispose();
      entry.service = undefined;
      throw error;
    } finally { this.creating = false; }
  }
  async cancelSession(id: string): Promise<void> {
    await this.initialize();
    const entry = this.entries.get(id);
    if (!entry) throw Error("Choose an existing session.");
    entry.pending?.abort();
    await entry.service?.cancelRun();
    await entry.service?.stopVoice();
    entry.summary.status = "cancelled"; this.publish();
  }
  async closeSession(id: string): Promise<DesktopSessionSnapshot> {
    await this.initialize(); this.check();
    if (id === PRIMARY) throw Error("The main conversation cannot be closed.");
    const entry = this.entries.get(id);
    if (!entry) throw Error("Choose an existing session.");
    await this.cancelSession(id);
    await entry.service?.clearSessionCredentials();
    await entry.service?.dispose();
    // Keep the private history/draft files; closing a tab does not delete conversations.
    this.entries.delete(id);
    for (const [thread, owner] of this.conversationOwners) if (owner === id) this.conversationOwners.delete(thread);
    if (this.activeId === id) { this.activeId = PRIMARY; await this.capture(PRIMARY); this.options.emit({ type: "state", state: this.stateFor(this.entries.get(PRIMARY)!) }); }
    this.publish(); return this.snapshot();
  }
  async listSessionApprovals(id = this.activeId): Promise<Extract<DesktopEvent, { type: "approval" }>[]> {
    await this.initialize(); this.check();
    const entry = this.entries.get(id);
    if (!entry?.service) throw Error("Choose an open session.");
    return [...entry.approvals.values()].map(approval => ({ ...approval }));
  }
  async respondToSessionApproval(input: DesktopApprovalResponse & { sessionId: string }): Promise<void> {
    await this.initialize(); this.check();
    const entry = this.entries.get(input.sessionId);
    if (!entry?.service || !entry.approvals.has(input.id)) throw Error("This approval does not belong to that session.");
    await entry.service.respondApproval({ id: input.id, approved: input.approved, scope: input.scope });
  }
  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    await this.initialize(); this.check();
    if (method === "login" || method === "logout") return this.changeAccount(method);
    const epoch = this.accountEpoch;
    const id = this.activeId;
    const entry = this.entries.get(id)!;
    if (!entry.service) throw Error("This interrupted session must be reopened explicitly.");
    if (method === "runAgent" && (entry.summary.status === "queued" || entry.summary.status === "running")) throw Error("This session already has a queued or running action.");
    if (entry.pending && (writeMethods.has(method) || scopeMethods.has(method) || method === "runAgent")) throw Error("Wait for this session's queued action or cancel it.");
    const target = entry.service as unknown as Record<string, (...values: unknown[]) => unknown>;
    if (typeof target[method] !== "function") throw Error("Unknown desktop session action.");
    if (method === "runAgent") { entry.summary.status = "queued"; delete entry.summary.runId; this.publish(); }
    let release: (() => void) | undefined;
    let controller: AbortController | undefined;
    try {
      if (writeMethods.has(method) && !(method === "syncRepository" && args[0] === "status")) {
        controller = new AbortController(); entry.pending = controller;
        const before = await entry.service.getState();
        release = await this.acquire(before.workspace?.root ?? null, id, controller.signal);
        controller.signal.throwIfAborted();
        entry.summary.status = "running"; this.publish();
        const current = await entry.service.getState();
        if (before.workspace?.root !== current.workspace?.root || before.activeThreadId !== current.activeThreadId) throw Error("The session changed while the action was queued.");
      }
      if (method === "runAgent") {
        const input = args[0] as { prompt?: unknown } | undefined;
        if (typeof input?.prompt === "string") entry.inFlight = { prompt: input.prompt, text: "", revision: 0, conversation: [...((await entry.service.getState()).conversation ?? [])] };
      }
      const value = await target[method]!.apply(entry.service, args);
      if (epoch !== this.accountEpoch) throw Error("The account changed while this action was completing.");
      if (method === "getState" && value) { this.applyState(entry, value as DesktopState); return this.stateFor(entry); }
      if (method === "cancelRun" && entry.summary.status === "queued") { entry.summary.status = "cancelled"; entry.inFlight = undefined; this.publish(); }
      return value;
    } catch (error) {
      if (method === "runAgent" || controller) { if (entry.summary.status !== "cancelled") entry.summary.status = controller?.signal.aborted ? "cancelled" : "failed"; entry.inFlight = undefined; this.publish(); }
      throw error;
    } finally {
      release?.();
      if (controller && (entry.summary.status === "queued" || entry.summary.status === "running")) { entry.summary.status = controller.signal.aborted ? "cancelled" : "completed"; this.publish(); }
      if (entry.pending === controller) entry.pending = undefined;
    }
  }
  private async changeAccount(method: "login" | "logout"): Promise<unknown> {
    if (this.creating) throw Error("Wait for the session to finish opening before changing accounts.");
    this.changingAccount = true;
    this.accountEpoch++;
    try {
      for (const entry of this.entries.values()) { entry.pending?.abort(); await entry.service?.cancelRun(); await entry.service?.stopVoice(); }
      for (const [id, entry] of this.entries) if (id !== PRIMARY) { await entry.service?.clearSessionCredentials(); await entry.service?.dispose(); this.entries.delete(id); }
      this.activeId = PRIMARY;
      this.conversationOwners.clear();
      this.publish();
      await this.persistence;
      const result = await this.primary[method]();
      this.publish(); return result;
    } finally { this.changingAccount = false; }
  }
  private async repositoryLeaseRoot(root: string): Promise<string> {
    // Sibling selected subfolders and existing linked checkouts can share one Git repository.
    // Resolve their common metadata to a single conservative repository lease boundary.
    for (let directory = root; ; directory = path.dirname(directory)) {
      const marker = path.join(directory, ".git");
      const info = await lstat(marker).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (info) {
        let gitDirectory: string | undefined;
        if (info.isDirectory() || info.isSymbolicLink()) gitDirectory = await realpath(marker);
        else if (info.isFile() && info.size <= 16 * 1024) {
          const match = /^gitdir: ([^\r\n]+)\s*$/.exec(await readFile(marker, "utf8"));
          if (match) gitDirectory = await realpath(path.resolve(directory, match[1]!));
        }
        if (!gitDirectory) throw Error("The repository metadata cannot be safely coordinated.");
        const commonFile = path.join(gitDirectory, "commondir");
        const commonInfo = await lstat(commonFile).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
        if (commonInfo) {
          if (!commonInfo.isFile() || commonInfo.isSymbolicLink() || commonInfo.size > 4096) throw Error("The shared repository metadata cannot be safely coordinated.");
          const relative = (await readFile(commonFile, "utf8")).trim();
          if (!relative || relative.includes("\0") || relative.includes("\n")) throw Error("Invalid shared repository metadata.");
          gitDirectory = await realpath(path.resolve(gitDirectory, relative));
        }
        return path.dirname(gitDirectory);
      }
      if (path.dirname(directory) === directory) return root;
    }
  }
  private async acquire(root: string | null, owner: string, signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (!root) return () => {};
    const repository = await this.repositoryLeaseRoot(root);
    signal.throwIfAborted();
    if ([...this.leases].some(lease => lease.external && conflicts(root, repository, lease))) return Promise.reject(Error("Close the interactive terminal for this workspace before running an agent or changing files."));
    const conflicted = [...this.leases].some(lease => conflicts(root, repository, lease));
    if (!conflicted && !this.waiting.some(item => conflicts(root, repository, item))) return Promise.resolve(this.grant(root, repository, owner, false));
    const entry = this.entries.get(owner);
    if (entry) { entry.summary.status = "queued"; this.publish(); }
    return new Promise((resolve, reject) => {
      const item: WaitingLease = { root, repository, owner, signal, resolve, reject, abort: () => {} };
      item.abort = () => {
        const index = this.waiting.indexOf(item); if (index >= 0) this.waiting.splice(index, 1);
        item.signal.removeEventListener("abort", item.abort);
        const entry = this.entries.get(owner); if (entry) { entry.summary.status = "cancelled"; entry.inFlight = undefined; this.publish(); }
        reject(Error("Queued session action cancelled.")); this.drain();
      };
      this.waiting.push(item); signal.addEventListener("abort", item.abort, { once: true });
      if (signal.aborted) item.abort();
    });
  }
  private grant(root: string, repository: string, owner: string, external: boolean): () => void {
    const lease = { root, repository, owner, external }; this.leases.add(lease);
    let released = false;
    return () => { if (released) return; released = true; this.leases.delete(lease); this.drain(); };
  }
  private drain(): void {
    if (this.disposed) return;
    for (const item of [...this.waiting]) {
      if ([...this.leases].some(lease => conflicts(item.root, item.repository, lease))) continue;
      if (this.waiting.slice(0, this.waiting.indexOf(item)).some(earlier => conflicts(item.root, item.repository, earlier))) continue;
      this.waiting.splice(this.waiting.indexOf(item), 1);
      item.signal.removeEventListener("abort", item.abort);
      if (item.signal.aborted) { item.reject(Error("Queued session action cancelled.")); continue; }
      item.resolve(this.grant(item.root, item.repository, item.owner, false));
    }
  }
  /** The parent must retain/release this lease for the complete PTY lifetime. */
  async reserveExternalWorkspace(root: string, ownerId: string): Promise<() => void> {
    await this.initialize(); this.check();
    const state = await this.entries.get(this.activeId)!.service!.getState();
    if (state.workspace?.root !== root || !state.workspace.trusted || await realpath(root) !== root) throw Error("Select and trust this exact workspace before opening a terminal.");
    const repository = await this.repositoryLeaseRoot(root);
    if ([...this.leases].some(lease => conflicts(root, repository, lease)) || this.waiting.some(item => conflicts(root, repository, item))) throw Error("Wait for this workspace's agents and queued actions before opening a terminal.");
    return this.grant(root, repository, ownerId, true);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of [...this.waiting]) { item.signal.removeEventListener("abort", item.abort); item.abort(); }
    for (const entry of this.entries.values()) { entry.pending?.abort(); await entry.service?.dispose(); }
    await this.persistence;
  }
}
