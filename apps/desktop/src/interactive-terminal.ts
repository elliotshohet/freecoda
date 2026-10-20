import { spawn, execFile, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { externalAgentArguments, findExternalAgentExecutable, type ExternalAgentId } from "./external-agents";

export type TerminalLaunchRequest = { root: string; mode: "build"; agentId?: ExternalAgentId };
export type TerminalSession = {
  id: string;
  ownerKey: string;
  root: string;
  agentId?: ExternalAgentId;
  startedAt: string;
  transport: "macos-script-pty";
  resizable: false;
};
export type TerminalEvent =
  | { type: "started"; sessionId: string; ownerKey: string; session: TerminalSession }
  | { type: "data"; sessionId: string; ownerKey: string; data: string }
  | { type: "exit"; sessionId: string; ownerKey: string; exitCode: number | null; signal: string | null }
  | { type: "error"; sessionId: string; ownerKey: string; message: string };
type Grant = { root: string; ownerKey: string; release?(): void; isCurrent?(): boolean };
type RunningTerminal = { session: TerminalSession; child: ChildProcessWithoutNullStreams; closing?: Promise<void>; release(): void };
const execFileAsync = promisify(execFile);

/** A real OS PTY through macOS script(1), with a streaming relay to the renderer.
 * This is not an OS sandbox or a managed agent-tool approval channel. The native
 * host must authorize each launch and bind the grant to its current account,
 * trusted coding folder, build mode and write/command permissions. Grants must
 * never come directly from renderer-supplied booleans. Do not persist transcripts.
 */
export class DesktopTerminalManager {
  private sessions = new Map<string, RunningTerminal>();
  private launching = new Set<string>();
  private disposed = false;
  constructor(private options: {
    authorize(request: TerminalLaunchRequest): Promise<Grant>;
    emit(event: TerminalEvent): void;
    /** Main-process-only test seam. Never accepted from IPC or renderer input. */
    spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithoutStdio & { stdio: ["pipe", "pipe", "pipe"] }) => ChildProcessWithoutNullStreams;
  }) {}

  async availability(): Promise<{ available: boolean; detail: string; resizable: false }> {
    if (process.platform !== "darwin") return {
      available: false, resizable: false,
      detail: "Interactive PTY sessions currently require macOS. The command-output panel remains available on this platform.",
    };
    try {
      await access("/usr/bin/script", constants.X_OK);
      return { available: true, resizable: false, detail: "macOS PTY relay. Runs as your user; not sandboxed. Fixed terminal dimensions; full-screen TUI rendering and resize are not qualified." };
    } catch {
      return { available: false, resizable: false, detail: "The macOS script utility is unavailable. No pipe-only terminal fallback is substituted." };
    }
  }

  list(ownerKey: string): TerminalSession[] {
    return [...this.sessions.values()].filter(item => item.session.ownerKey === ownerKey).map(item => ({ ...item.session }));
  }

  async start(request: TerminalLaunchRequest): Promise<TerminalSession> {
    if (this.disposed) throw Error("Terminal manager is closed.");
    if (!request || request.mode !== "build" || typeof request.root !== "string" || !path.isAbsolute(request.root) || request.root.includes("\0"))
      throw Error("Interactive terminals require an explicit coding folder in Build mode.");
    if (request.agentId !== undefined && request.agentId !== "codex" && request.agentId !== "claude") throw Error("Unknown external agent.");
    const availability = await this.availability();
    if (!availability.available) throw Error(availability.detail);
    const root = await realpath(request.root);
    if (!(await stat(root)).isDirectory()) throw Error("Terminal folder is unavailable.");
    if (this.launching.has(root) || [...this.sessions.values()].some(item => item.session.root === root))
      throw Error("This folder already has an interactive session. Close it before starting another to avoid uncoordinated writes.");
    this.launching.add(root);
    let release = () => {};
    try {
      const grant = await this.options.authorize({ ...request, root });
      let released = false;
      release = () => { if (!released) { released = true; grant?.release?.(); } };
      if (this.disposed) throw Error("Terminal manager is closed.");
      if (!grant || !grant.ownerKey || await realpath(grant.root) !== root) throw Error("Terminal launch authorization no longer matches the selected folder.");
      const executable = request.agentId
        ? await findExternalAgentExecutable(request.agentId)
        : "/bin/zsh";
      if (!executable) throw Error("The selected external agent is not installed on PATH. No installation was attempted.");
      const args = request.agentId ? externalAgentArguments(request.agentId) : ["-i"];
      // Do not export Freecoda, provider/API, cloud, Electron or Node credentials.
      // An external CLI may read its own existing sign-in/configuration only after
      // the user's explicit native account/cost and user-privilege consent.
      const env: NodeJS.ProcessEnv = {};
      for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]) {
        if (process.env[key]) env[key] = process.env[key];
      }
      env.TERM = "dumb";
      env.SHELL = "/bin/zsh";
      if (this.disposed || grant.isCurrent?.() === false) throw Error("The account, workspace, or terminal permission changed. Connect again explicitly.");
      const child = (this.options.spawnProcess ?? spawn)("/usr/bin/script", ["-q", "/dev/null", executable, ...args], {
        cwd: root, env, stdio: ["pipe", "pipe", "pipe"], detached: true,
      });
      const session: TerminalSession = {
        id: randomUUID(), ownerKey: grant.ownerKey, root, agentId: request.agentId,
        startedAt: new Date().toISOString(), transport: "macos-script-pty", resizable: false,
      };
      const running: RunningTerminal = { session, child, release };
      this.sessions.set(session.id, running);
      const emit = (event: TerminalEvent) => {
        if (this.disposed) return;
        try { this.options.emit(event); } catch { /* A destroyed renderer cannot break process cleanup. */ }
      };
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      const onData = (data: string) => {
        for (let offset = 0; offset < data.length; offset += 8192) emit({ type: "data", sessionId: session.id, ownerKey: session.ownerKey, data: data.slice(offset, offset + 8192) });
      };
      child.stdout.on("data", onData); child.stderr.on("data", onData);
      child.stdin.on("error", () => { /* Closing a PTY may close stdin first. */ });
      child.on("error", () => {
        release();
        this.sessions.delete(session.id);
        emit({ type: "error", sessionId: session.id, ownerKey: session.ownerKey, message: "The interactive process could not start. Verify that the installed executable and folder remain available." });
      });
      child.on("close", (exitCode, signal) => {
        release();
        this.sessions.delete(session.id);
        emit({ type: "exit", sessionId: session.id, ownerKey: session.ownerKey, exitCode, signal });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      if (this.disposed || grant.isCurrent?.() === false) {
        await this.terminate(running);
        throw Error("The account or workspace changed during launch. The interactive session was stopped.");
      }
      emit({ type: "started", sessionId: session.id, ownerKey: session.ownerKey, session });
      return { ...session };
    } catch (error) { release(); throw error; }
    finally { this.launching.delete(root); }
  }

  write(input: { id: string; data: string }, ownerKey: string): void {
    const running = this.owned(input?.id, ownerKey);
    if (running.closing) throw Error("Terminal is closing.");
    if (typeof input.data !== "string" || !input.data.length || input.data.length > 8192 || input.data.includes("\0")) throw Error("Terminal input must be 1–8,192 characters without NUL bytes.");
    if (running.child.stdin.writableLength > 64 * 1024) throw Error("Terminal input is busy. Wait before sending more input.");
    running.child.stdin.write(input.data);
  }

  async close(id: string, ownerKey: string): Promise<void> {
    const running = this.owned(id, ownerKey);
    await this.terminate(running);
  }

  async closeOwner(ownerKey: string): Promise<void> {
    await Promise.all([...this.sessions.values()].filter(item => item.session.ownerKey === ownerKey).map(item => this.terminate(item)));
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.sessions.values()].map(item => this.terminate(item)));
  }

  private owned(id: string, ownerKey: string): RunningTerminal {
    const item = this.sessions.get(id);
    if (!item || item.session.ownerKey !== ownerKey || !ownerKey || this.disposed) throw Error("This interactive session is unavailable in the current account and workspace.");
    return item;
  }

  private terminate(item: RunningTerminal): Promise<void> {
    if (item.closing) return item.closing;
    item.closing = (async () => {
      const pid = item.child.pid;
      if (!pid || item.child.exitCode !== null || item.child.signalCode !== null) { item.release(); return; }
      // forkpty creates a separate child session/process group. Stop descendant
      // groups too, not just the script relay; do not inspect process arguments.
      const groups = new Set<number>([pid]);
      try {
        const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,pgid="], { maxBuffer: 4 * 1024 * 1024, timeout: 2000 });
        const rows = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
        const descendants = new Set([pid]);
        let added = true;
        while (added) {
          added = false;
          for (const [childPid, parentPid] of rows) {
            if (descendants.has(parentPid) && !descendants.has(childPid)) {
              descendants.add(childPid); added = true;
            }
          }
        }
        for (const [, , group] of rows) if (group > 1 && descendants.has(group)) groups.add(group);
      } catch { /* Still terminate the known isolated relay group. */ }
      if (item.child.exitCode !== null || item.child.signalCode !== null) { item.release(); return; }
      const signalGroups = (signal: NodeJS.Signals) => {
        for (const group of [...groups].reverse()) {
          try { process.kill(-group, signal); } catch { /* Already exited. */ }
        }
      };
      signalGroups("SIGTERM");
      // Keep the workspace lease through the full shutdown grace period, even
      // if the relay exits before one of its descendant jobs.
      await new Promise<void>(resolve => setTimeout(resolve, 1200));
      signalGroups("SIGKILL");
      item.release();
      this.sessions.delete(item.session.id);
    })();
    return item.closing;
  }
}
