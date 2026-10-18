import {
  realpath,
  stat,
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  chmod,
  open,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { platform, arch } from "node:os";
import {
  Workspace,
  runShell,
  runAgent as executeAgent,
  hostedModel,
  validateBaseURL,
  redactSecrets,
  type Approval,
} from "../../../packages/core/src";
import type { ModelMessage } from "ai";
import type {
  DesktopState,
  DesktopSponsor,
  DesktopWorkspace,
  DesktopEvent,
  DesktopFile,
  DesktopSaveInput,
  DesktopRunInput,
  DesktopApprovalResponse,
  DesktopLogin,
  ApprovalKind,
} from "./shared";

const MAX_FILE = 128 * 1024;
const MAX_HISTORY = 4 * 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const text = (value: unknown, name: string, maximum: number) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new Error(`${name} is invalid.`);
  return value;
};
type Config = {
  server: string;
  token?: string;
  trustedRoots: string[];
  recentRoots: string[];
};
type PendingApproval = { root: string; resolve: (approved: boolean) => void };
export type LocalAgentOptions = {
  dataDirectory: string;
  emit: (event: DesktopEvent) => void;
  openExternal: (url: string) => Promise<void>;
  serverUrl?: string;
  /** Dependency injection for transport tests. Never exposed through IPC. */
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(new Error("Cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** Main-process service. No filesystem handles or account credentials cross IPC. */
export class LocalAgentService {
  private readonly directory: string;
  private readonly server: string;
  private readonly transport: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  private readonly pause: typeof wait;
  private initialized?: Promise<void>;
  private config: Config;
  private root: string | null = null;
  private messages: ModelMessage[] = [];
  private threads: {
    id: string;
    title: string;
    updatedAt: string;
    messages: ModelMessage[];
  }[] = [];
  private activeThreadId?: string;
  private selectedModel?: string;
  private activeController?: AbortController;
  private manualCompletion?: Promise<void>;
  private authChanging = false;
  private activeRun?: { id: string; completion: Promise<void> };
  private loginController?: AbortController;
  private pending = new Map<string, PendingApproval>();
  private sessionApprovals = new Set<ApprovalKind>();
  private secrets = new Set<string>();
  private disposed = false;
  private workspaceChanging = false;

  constructor(private readonly options: LocalAgentOptions) {
    this.directory = path.resolve(
      text(options.dataDirectory, "Application data directory", 4096),
    );
    this.server = validateBaseURL(options.serverUrl || "https://freecoda.com");
    this.transport = options.fetch || globalThis.fetch;
    this.pause = options.wait || wait;
    this.config = { server: this.server, trustedRoots: [], recentRoots: [] };
  }
  initialize() {
    return (this.initialized ??= this.load());
  }
  private async load() {
    await this.ensurePrivateDirectory(this.directory);
    try {
      const filename = path.join(this.directory, "desktop.json");
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024)
        throw new Error("Invalid desktop configuration.");
      const stored = JSON.parse(
        await readFile(filename, "utf8"),
      ) as Partial<Config>;
      if (stored.server !== this.server)
        throw new Error(
          "The saved connection belongs to another Freecoda server.",
        );
      const roots = (value: unknown, maximum: number): string[] => {
        if (
          !Array.isArray(value) ||
          value.length > maximum ||
          value.some(
            (root) =>
              typeof root !== "string" ||
              !path.isAbsolute(root) ||
              root.length > 4096 ||
              root.includes("\0"),
          )
        )
          throw new Error("Invalid saved workspace list.");
        return [...new Set(value)];
      };
      if (
        stored.token !== undefined &&
        (typeof stored.token !== "string" ||
          !/^[A-Za-z0-9_-]{32,100}$/.test(stored.token))
      )
        throw new Error("Invalid saved connection.");
      this.config = {
        server: this.server,
        trustedRoots: roots(stored.trustedRoots, 50),
        recentRoots: roots(stored.recentRoots, 12),
        ...(stored.token ? { token: stored.token } : {}),
      };
      if (stored.token) this.secrets.add(stored.token);
      await chmod(filename, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private async ensurePrivateDirectory(directory: string) {
    try {
      if ((await lstat(directory)).isSymbolicLink())
        throw new Error("Refusing a symlinked application data directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  }
  private async savePrivate(filename: string, value: unknown) {
    await this.ensurePrivateDirectory(path.dirname(filename));
    try {
      if ((await lstat(filename)).isSymbolicLink())
        throw new Error("Refusing a symlinked application state file.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(path.dirname(filename), `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  private saveConfig() {
    return this.savePrivate(
      path.join(this.directory, "desktop.json"),
      this.config,
    );
  }
  private historyFile() {
    return path.join(this.directory, "sessions", hash(this.root!) + ".json");
  }
  private check() {
    if (this.disposed) throw new Error("The desktop service is closed.");
  }
  private trustedRoot() {
    this.check();
    if (!this.root || !this.config.trustedRoots.includes(this.root))
      throw new Error(
        "Trust the selected repository before reading files or running a task.",
      );
    return this.root;
  }
  private clean(value: string) {
    let result = redactSecrets(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    for (const secret of this.secrets)
      result = result.split(secret).join("[redacted credential]");
    return result;
  }
  private emit(event: DesktopEvent) {
    if (!this.disposed) this.options.emit(event);
  }
  private async emitState() {
    this.emit({ type: "state", state: await this.getState() });
  }
  private async workspace(): Promise<DesktopWorkspace | null> {
    if (!this.root) return null;
    const trusted = this.config.trustedRoots.includes(this.root);
    return {
      root: this.root,
      name: path.basename(this.root) || this.root,
      trusted,
      files: trusted ? await this.listFiles() : [],
    };
  }
  async getState(): Promise<DesktopState> {
    await this.initialize();
    this.check();
    return {
      workspace: await this.workspace(),
      recentFolders: this.config.recentRoots.map((root) => ({
        root,
        name: path.basename(root) || root,
        trusted: this.config.trustedRoots.includes(root),
      })),
      auth: {
        signedIn: !!this.config.token,
        server: this.server,
        ...(this.selectedModel ? { model: this.selectedModel } : {}),
      },
      running: !!this.activeController,
      threads: this.threads.map(({ id, title, updatedAt }) => ({
        id,
        title: this.clean(title),
        updatedAt,
      })),
      activeThreadId: this.activeThreadId,
      conversation: this.messages
        .flatMap((message) => {
          if (message.role !== "user" && message.role !== "assistant")
            return [];
          const content =
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((part) => part.type === "text")
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join("\n");
          return content
            ? [
                {
                  role: message.role,
                  text: this.clean(content).slice(0, 10000),
                },
              ]
            : [];
        })
        .slice(-40),
    };
  }
  /** Called only after main's native folder picker or a trusted native menu action. */
  async selectWorkspace(directory: string) {
    await this.initialize();
    this.check();
    if (this.activeController || this.workspaceChanging || this.authChanging)
      throw new Error(
        "Cancel the current action before switching repositories.",
      );
    this.workspaceChanging = true;
    try {
      const root = await realpath(
        text(directory, "Repository directory", 4096),
      );
      if (!(await stat(root)).isDirectory())
        throw new Error("Choose a repository folder.");
      this.root = root;
      this.messages = [];
      this.threads = [];
      this.activeThreadId = undefined;
      this.sessionApprovals.clear();
      this.config.recentRoots = [
        root,
        ...this.config.recentRoots.filter((item) => item !== root),
      ].slice(0, 12);
      await this.saveConfig();
      if (this.config.trustedRoots.includes(root)) await this.restoreHistory();
      const workspace = (await this.workspace())!;
      await this.emitState();
      return workspace;
    } finally {
      this.workspaceChanging = false;
    }
  }
  async trustWorkspace(input: { root: string; consent: true }) {
    await this.initialize();
    this.check();
    if (
      !input ||
      input.consent !== true ||
      text(input.root, "Repository directory", 4096) !== this.root
    )
      throw new Error(
        "Trust must apply to the folder selected in the native picker.",
      );
    if (this.activeController || this.workspaceChanging || this.authChanging)
      throw new Error(
        "Wait for the current action before trusting a repository.",
      );
    this.workspaceChanging = true;
    try {
      if (!this.config.trustedRoots.includes(this.root!)) {
        if (this.config.trustedRoots.length >= 50)
          throw new Error("The trusted repository limit has been reached.");
        this.config.trustedRoots.push(this.root!);
        await this.saveConfig();
        await this.restoreHistory();
      }
      const workspace = (await this.workspace())!;
      await this.emitState();
      return workspace;
    } finally {
      this.workspaceChanging = false;
    }
  }
  async listFiles() {
    await this.initialize();
    const root = this.trustedRoot();
    const ws = await Workspace.open(root, async () => false);
    const files = await ws.files();
    if (this.root !== root) throw new Error("The selected repository changed.");
    return files.map((file) => ({
      path: file,
      type: "file" as const,
    }));
  }
  private async rawFile(
    relative: string,
  ): Promise<{ content: string; target: string }> {
    const root = this.trustedRoot();
    const ws = await Workspace.open(root, async () => false);
    const target = await ws.resolve(text(relative, "File path", 500));
    const handle = await open(
      target,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_FILE)
        throw new Error("Open a text file under 128 KiB.");
      const buffer = Buffer.alloc(MAX_FILE + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE)
        throw new Error("Open a text file under 128 KiB.");
      const content = buffer.subarray(0, bytesRead).toString("utf8");
      if (content.includes("\0"))
        throw new Error("Binary files cannot be edited as text.");
      if (this.root !== root)
        throw new Error("The selected repository changed.");
      return { content, target };
    } finally {
      await handle.close();
    }
  }
  async readFile(relative: string): Promise<DesktopFile> {
    await this.initialize();
    const file = await this.rawFile(relative);
    const content = this.clean(file.content);
    return {
      path: relative,
      content,
      hash: hash(file.content),
      readOnly: content !== file.content,
    };
  }
  private approval(controller: AbortController, runId?: string): Approval {
    return async (kind, description) => {
      controller.signal.throwIfAborted();
      const root = this.trustedRoot();
      if (this.sessionApprovals.has(kind)) return true;
      const id = randomUUID();
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (approved: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", aborted);
          this.pending.delete(id);
          this.approvalKinds.delete(id);
          this.emit({ type: "approval-resolved", id, approved });
          resolve(approved);
        };
        const aborted = () => finish(false);
        const timer = setTimeout(() => finish(false), 120_000);
        this.pending.set(id, { root, resolve: finish });
        this.approvalKinds.set(id, kind);
        controller.signal.addEventListener("abort", aborted, { once: true });
        this.emit({
          type: "approval",
          id,
          runId,
          kind,
          description: this.clean(description).slice(0, 100_000),
        });
      });
    };
  }
  async respondApproval(input: DesktopApprovalResponse) {
    if (
      !input ||
      typeof input.id !== "string" ||
      input.id.length > 100 ||
      typeof input.approved !== "boolean" ||
      !["once", "session"].includes(input.scope)
    )
      throw new Error("Invalid approval response.");
    const request = this.pending.get(input.id);
    if (!request || request.root !== this.root) return { accepted: false };
    // The kind is captured by the approval event; session grants are intentionally
    // constrained below instead of accepting a renderer-supplied category.
    const kind = this.approvalKinds.get(input.id);
    if (input.approved && input.scope === "session" && kind)
      this.sessionApprovals.add(kind);
    request.resolve(input.approved);
    this.approvalKinds.delete(input.id);
    return { accepted: true };
  }
  private approvalKinds = new Map<string, ApprovalKind>();
  async saveFile(input: DesktopSaveInput): Promise<DesktopFile> {
    await this.initialize();
    this.trustedRoot();
    if (this.activeController || this.workspaceChanging || this.authChanging)
      throw new Error("Wait for the active action before saving.");
    if (
      !input ||
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content) > MAX_FILE ||
      !(
        input.expectedHash === null ||
        (typeof input.expectedHash === "string" &&
          /^[a-f0-9]{64}$/.test(input.expectedHash))
      )
    )
      throw new Error("Invalid file update.");
    text(input.path, "File path", 500);
    const controller = (this.activeController = new AbortController());
    let finish!: () => void;
    const completion = (this.manualCompletion = new Promise<void>((resolve) => {
      finish = resolve;
    }));
    try {
      let original = "";
      try {
        original = (await this.rawFile(input.path)).content;
        if (
          input.expectedHash === null ||
          hash(original) !== input.expectedHash
        )
          throw new Error("File changed. Reload it before saving.");
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" ||
          input.expectedHash !== null
        )
          throw error;
      }
      if (this.clean(original) !== original)
        throw new Error(
          "Files containing redacted credentials are read-only in the editor.",
        );
      const ws = await Workspace.open(
        this.trustedRoot(),
        this.approval(controller),
        controller.signal,
      );
      const result = await ws.write(input.path, input.content, original);
      if (result.startsWith("User declined"))
        throw new Error("The file change was declined.");
      return await this.readFile(input.path);
    } finally {
      this.activeController = undefined;
      try {
        await this.emitState();
      } finally {
        if (this.manualCompletion === completion)
          this.manualCompletion = undefined;
        finish();
      }
    }
  }
  async runCommand(input: { command: string }) {
    await this.initialize();
    const root = this.trustedRoot();
    if (this.activeController || this.workspaceChanging || this.authChanging)
      throw new Error("Wait for the active action before running a command.");
    const command = text(input?.command, "Command", 4000);
    const controller = (this.activeController = new AbortController());
    let finish!: () => void;
    const completion = (this.manualCompletion = new Promise<void>((resolve) => {
      finish = resolve;
    }));
    try {
      const result = await runShell(
        command,
        root,
        this.approval(controller),
        controller.signal,
      );
      const output = this.clean(result.output);
      this.emit({ type: "output", text: output, exitCode: result.exitCode });
      return { ...result, output };
    } finally {
      this.activeController = undefined;
      try {
        await this.emitState();
      } finally {
        if (this.manualCompletion === completion)
          this.manualCompletion = undefined;
        finish();
      }
    }
  }
  async runAgent(input: DesktopRunInput) {
    await this.initialize();
    const root = this.trustedRoot();
    if (
      this.activeController ||
      this.workspaceChanging ||
      this.authChanging ||
      this.loginController
    )
      throw new Error("A task or repository change is already running.");
    if (!input || !["build", "plan", "review"].includes(input.mode))
      throw new Error("Choose build, plan, or review mode.");
    const prompt = text(input.prompt, "Prompt", 20_000);
    if (!this.config.token)
      throw new Error("Sign in to Freecoda before running a task.");
    const id = randomUUID(),
      controller = (this.activeController = new AbortController());
    const completion = (async () => {
      try {
        const catalog = (await this.api(
          "models",
          undefined,
          controller.signal,
        )) as { models?: { id: string }[]; hostedEnabled?: boolean };
        const chosen = catalog.models?.[0];
        if (
          !catalog.hostedEnabled ||
          !chosen ||
          typeof chosen.id !== "string" ||
          chosen.id.length > 150
        )
          throw new Error(
            "Hosted models are not available for this account yet.",
          );
        this.selectedModel = chosen.id;
        const next: ModelMessage[] = [
          ...this.messages,
          { role: "user", content: prompt },
        ];
        const result = await executeAgent({
          root,
          model: hostedModel(this.server, chosen.id, this.config.token!),
          messages: next,
          mode: input.mode,
          approve: this.approval(controller, id),
          signal: controller.signal,
          redactText: (value) => this.clean(value),
          onText: (content) =>
            this.emit({
              type: "text-delta",
              runId: id,
              text: this.clean(content),
            }),
          onTool: (name) => this.emit({ type: "tool-start", runId: id, name }),
          onToolResult: (name, result) =>
            this.emit({
              type: "tool-result",
              runId: id,
              name,
              result: this.publicValue(result),
            }),
        });
        this.messages = result.messages;
        await this.saveHistory();
        this.emit({ type: "done", runId: id, text: this.clean(result.text) });
      } catch (error) {
        if (controller.signal.aborted)
          this.emit({
            type: "done",
            runId: id,
            text: "Task cancelled. Review any changes already approved.",
            cancelled: true,
          });
        else
          this.emit({
            type: "error",
            runId: id,
            text: this.clean(
              error instanceof Error
                ? error.message
                : "The task could not complete.",
            ).slice(0, 1000),
          });
      } finally {
        if (this.activeRun?.id === id) this.activeRun = undefined;
        if (this.activeController === controller)
          this.activeController = undefined;
        await this.emitState().catch(() => {});
      }
    })();
    this.activeRun = { id, completion };
    this.emit({ type: "run-started", runId: id });
    await this.emitState();
    return { runId: id };
  }
  private publicValue(value: unknown): unknown {
    const serialized = this.clean(JSON.stringify(value) || "null");
    return serialized.length > 32_000
      ? { summary: serialized.slice(0, 32_000), truncated: true }
      : JSON.parse(serialized);
  }
  async cancelRun() {
    this.activeController?.abort();
    for (const request of this.pending.values()) request.resolve(false);
    await Promise.all([this.activeRun?.completion, this.manualCompletion]);
  }
  private async restoreHistory() {
    this.messages = [];
    this.threads = [];
    this.activeThreadId = undefined;
    try {
      const filename = this.historyFile(),
        info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_HISTORY)
        throw Error("Invalid saved conversation.");
      const saved = JSON.parse(await readFile(filename, "utf8"));
      if (saved.root !== this.root) throw Error("Invalid saved conversation.");
      if (Array.isArray(saved.threads)) {
        if (
          saved.threads.length > 100 ||
          saved.threads.some(
            (t: any) =>
              !t ||
              typeof t.id !== "string" ||
              !/^[a-f0-9-]{36}$/.test(t.id) ||
              typeof t.title !== "string" ||
              t.title.length > 120 ||
              !Number.isFinite(Date.parse(t.updatedAt)) ||
              !Array.isArray(t.messages) ||
              t.messages.length > 500,
          ) ||
          new Set(saved.threads.map((t: any) => t.id)).size !==
            saved.threads.length
        )
          throw Error("Invalid saved thread history.");
        this.threads = saved.threads;
        this.activeThreadId = this.threads.some(
          (t) => t.id === saved.activeThreadId,
        )
          ? saved.activeThreadId
          : this.threads[0]?.id;
      } else {
        if (!Array.isArray(saved.messages) || saved.messages.length > 500)
          throw Error("Invalid saved conversation.");
        const thread = {
          id: randomUUID(),
          title: "Previous conversation",
          updatedAt: new Date().toISOString(),
          messages: saved.messages,
        };
        this.threads = [thread];
        this.activeThreadId = thread.id;
      }
      this.messages =
        this.threads.find((t) => t.id === this.activeThreadId)?.messages || [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private async saveHistory() {
    if (!this.activeThreadId) {
      this.activeThreadId = randomUUID();
      this.threads.push({
        id: this.activeThreadId,
        title: "New conversation",
        updatedAt: new Date().toISOString(),
        messages: [],
      });
    }
    const thread = this.threads.find((t) => t.id === this.activeThreadId)!;
    thread.messages = this.messages;
    thread.updatedAt = new Date().toISOString();
    const first = this.messages.find((m) => m.role === "user");
    if (first && typeof first.content === "string")
      thread.title =
        this.clean(first.content).replace(/\s+/g, " ").trim().slice(0, 120) ||
        "New conversation";
    const value = {
      root: this.root,
      activeThreadId: this.activeThreadId,
      threads: this.threads,
    };
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_HISTORY)
      throw Error(
        "Conversation history reached its limit. Clear a thread before starting a new task.",
      );
    await this.savePrivate(this.historyFile(), value);
  }
  private threadChangeAllowed() {
    this.trustedRoot();
    if (this.activeController || this.workspaceChanging || this.authChanging)
      throw Error("Finish the current action before switching conversations.");
  }
  private async changeThread<T>(action: () => Promise<T>): Promise<T> {
    await this.initialize();
    this.threadChangeAllowed();
    this.workspaceChanging = true;
    try {
      return await action();
    } finally {
      this.workspaceChanging = false;
    }
  }
  async createThread(): Promise<DesktopState> {
    return this.changeThread(async () => {
      if (this.threads.length >= 100)
        throw Error("The conversation limit has been reached.");
      this.messages = [];
      this.activeThreadId = randomUUID();
      this.threads.unshift({
        id: this.activeThreadId,
        title: "New conversation",
        updatedAt: new Date().toISOString(),
        messages: [],
      });
      await this.saveHistory();
      await this.emitState();
      return this.getState();
    });
  }
  async openThread(id: string): Promise<DesktopState> {
    return this.changeThread(async () => {
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
        throw Error("Invalid conversation.");
      const thread = this.threads.find((t) => t.id === id);
      if (!thread)
        throw Error("Conversation does not belong to the selected repository.");
      this.activeThreadId = id;
      this.messages = thread.messages;
      await this.saveHistory();
      await this.emitState();
      return this.getState();
    });
  }
  async clearHistory() {
    return this.changeThread(async () => {
      this.messages = [];
      const t = this.threads.find((t) => t.id === this.activeThreadId);
      if (t) t.title = "New conversation";
      await this.saveHistory();
      await this.emitState();
    });
  }
  private sponsor?: {
    public: DesktopSponsor;
    href: string;
    token?: string;
    impressed: boolean;
  };
  private sponsorLoading?: Promise<DesktopSponsor>;
  async getSponsor(): Promise<DesktopSponsor> {
    await this.initialize();
    if (this.sponsor) return structuredClone(this.sponsor.public);
    if (this.sponsorLoading) return this.sponsorLoading;
    this.sponsorLoading = (async () => {
      const plain = (value: string) =>
        value
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      try {
        const response = await this.transport(
          `${this.server}/api/v1/ads?placement=terminal`,
          {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            signal: AbortSignal.timeout(4000),
          },
        );
        if (!response.ok) throw Error("Sponsor unavailable");
        const reader = response.body?.getReader();
        if (!reader) throw Error("Empty sponsor response");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 16_384) {
            await reader.cancel();
            throw Error("Sponsor response too large");
          }
          chunks.push(part.value);
        }
        const ad = JSON.parse(Buffer.concat(chunks).toString());
        for (const [key, limit] of [
          ["sponsor", 60],
          ["headline", 90],
          ["description", 180],
          ["href", 1200],
        ] as const)
          if (typeof ad[key] !== "string" || ad[key].length > limit)
            throw Error("Invalid sponsor response");
        const paid =
          typeof ad.id === "string" && ad.id.length > 0 && ad.id.length <= 200;
        if (ad.id !== null && !paid) throw Error("Invalid sponsor identity");
        const href = new URL(ad.href, this.server);
        if (
          href.origin !== new URL(this.server).origin ||
          href.username ||
          href.password ||
          href.hash
        )
          throw Error("Invalid sponsor destination");
        if (paid) {
          if (
            typeof ad.token !== "string" ||
            !ad.token ||
            ad.token.length > 800 ||
            href.pathname !== "/api/v1/ads/click" ||
            href.searchParams.get("token") !== ad.token ||
            [...href.searchParams.keys()].some((key) => key !== "token")
          )
            throw Error("Invalid sponsor click link");
        } else if (href.pathname !== "/advertise" || href.search)
          throw Error("Invalid announcement destination");
        this.sponsor = {
          public: {
            label: paid
              ? `Sponsored by ${plain(ad.sponsor)}`
              : "Freecoda announcement",
            headline: plain(ad.headline),
            description: plain(ad.description),
            paid,
          },
          href: href.toString(),
          ...(paid ? { token: ad.token } : {}),
          impressed: false,
        };
      } catch {
        this.sponsor = {
          public: {
            label: "Freecoda announcement",
            headline: "Help keep Freecoda free.",
            description:
              "Reach people who build. Sponsor a placement without access to their code or conversations.",
            paid: false,
          },
          href: `${this.server}/advertise`,
          impressed: false,
        };
      }
      return structuredClone(this.sponsor.public);
    })();
    try {
      return await this.sponsorLoading;
    } finally {
      this.sponsorLoading = undefined;
    }
  }
  async reportSponsorVisible(): Promise<void> {
    // Only the cached signed token is eligible. No renderer-supplied identity/context is accepted.
    const ad = this.sponsor;
    if (!ad?.public.paid || !ad.token || ad.impressed) return;
    ad.impressed = true;
    try {
      await this.transport(`${this.server}/api/v1/ads/impression`, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ad.token }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* Ads never block a task. */
    }
  }
  async openSponsor(): Promise<void> {
    await this.getSponsor();
    await this.options.openExternal(this.sponsor!.href);
  }
  private async api(endpoint: string, body?: unknown, signal?: AbortSignal) {
    const response = await this.transport(`${this.server}/api/v1/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.config.token
          ? { Authorization: `Bearer ${this.config.token}` }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });
    const reader = response.body?.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    if (!reader) throw new Error("The server returned an empty response.");
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel();
        throw new Error("The server response is too large.");
      }
      chunks.push(part.value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new Error("The server returned an invalid response.");
    }
    if (!response.ok)
      throw new Error(
        this.clean(
          typeof (value as { error?: unknown })?.error === "string"
            ? (value as { error: string }).error
            : `Request failed (${response.status}).`,
        ).slice(0, 1000),
      );
    return value;
  }
  async login(): Promise<DesktopLogin> {
    await this.initialize();
    if (this.activeController || this.authChanging)
      throw new Error("Wait for the active action before signing in.");
    this.authChanging = true;
    try {
      return await this.startLogin();
    } catch (error) {
      this.loginController?.abort();
      this.loginController = undefined;
      throw error;
    } finally {
      this.authChanging = false;
    }
  }
  private async startLogin(): Promise<DesktopLogin> {
    this.check();
    this.loginController?.abort();
    const controller = (this.loginController = new AbortController());
    const data = (await this.api(
      "device/start",
      { name: `${platform()} ${arch()} Freecoda Desktop` },
      controller.signal,
    )) as Record<string, unknown>;
    const deviceCode = text(data.deviceCode, "Device response", 100),
      userCode = text(data.userCode, "Device code", 20);
    if (
      !/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode) ||
      !Number.isInteger(data.expiresIn) ||
      Number(data.expiresIn) < 1 ||
      Number(data.expiresIn) > 600
    )
      throw new Error(
        "The server returned invalid device authorization details.",
      );
    this.secrets.add(deviceCode);
    const uri = new URL(text(data.verificationUri, "Verification URL", 1000));
    const expected = new URL(this.server + "/device");
    if (
      uri.origin !== expected.origin ||
      uri.pathname !== expected.pathname ||
      uri.searchParams.get("code") !== userCode ||
      uri.username ||
      uri.password ||
      uri.hash
    )
      throw new Error("The server returned an untrusted verification URL.");
    const loginId = randomUUID(),
      expires = Date.now() + Number(data.expiresIn) * 1000;
    await this.options.openExternal(uri.toString());
    void (async () => {
      try {
        while (Date.now() < expires && !controller.signal.aborted) {
          await this.pause(
            Math.max(5, Math.min(Number(data.interval) || 5, 60)) * 1000,
            controller.signal,
          );
          const result = (await this.api(
            "device/poll",
            { deviceCode },
            controller.signal,
          )) as { status?: string; token?: string };
          if (result.status === "pending") continue;
          if (
            result.status !== "approved" ||
            !result.token ||
            !/^[A-Za-z0-9_-]{32,100}$/.test(result.token)
          )
            throw new Error("The server returned an invalid device token.");
          this.config.token = result.token;
          this.secrets.add(result.token);
          await this.saveConfig();
          this.emit({
            type: "auth",
            signedIn: true,
            message: "Desktop connected to your Freecoda account.",
          });
          await this.emitState();
          return;
        }
        if (!controller.signal.aborted)
          this.emit({
            type: "auth",
            signedIn: !!this.config.token,
            message: "The sign-in code expired. Start sign-in again.",
          });
      } catch (error) {
        if (!controller.signal.aborted)
          this.emit({
            type: "auth",
            signedIn: !!this.config.token,
            message: this.clean(
              error instanceof Error
                ? error.message
                : "Sign-in could not complete.",
            ),
          });
      } finally {
        if (this.loginController === controller)
          this.loginController = undefined;
      }
    })();
    return {
      loginId,
      userCode,
      verificationUri: uri.toString(),
      expiresAt: new Date(expires).toISOString(),
    };
  }
  async logout() {
    await this.initialize();
    if (this.authChanging)
      throw new Error("An account change is already running.");
    this.authChanging = true;
    try {
      await this.performLogout();
    } finally {
      this.authChanging = false;
    }
  }
  private async performLogout() {
    this.loginController?.abort();
    this.loginController = undefined;
    await this.cancelRun();
    let revoked = true;
    try {
      if (this.config.token) await this.api("devices/logout", {});
    } catch {
      revoked = false;
    }
    delete this.config.token;
    this.selectedModel = undefined;
    await this.saveConfig();
    this.emit({
      type: "auth",
      signedIn: false,
      message: revoked
        ? "Signed out."
        : "Signed out on this device. Revoke this desktop device in your workspace if remote sign-out remains unavailable.",
    });
    await this.emitState();
  }
  async usage() {
    await this.initialize();
    if (!this.config.token)
      throw new Error("Sign in to see your hosted allowance.");
    return this.publicValue(await this.api("usage"));
  }
  async dispose() {
    this.disposed = true;
    this.loginController?.abort();
    await this.cancelRun();
    this.disposed = true;
    this.sessionApprovals.clear();
    this.secrets.clear();
  }
}
