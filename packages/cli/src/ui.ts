import { createInterface, type Interface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import c from "picocolors";
import { TurnQueue, type QueuedTurn } from "./turn-queue";
import {
  SessionPermissions,
  PERMISSION_PRESETS,
  type PermissionPreset,
} from "./permissions";
import type { ThemePreference } from "./config";

export function resolveTerminalTheme(
  preference: ThemePreference,
  colorFgBg = process.env.COLORFGBG,
): "dark" | "light" {
  if (preference !== "auto") return preference;
  const background = Number(colorFgBg?.split(";").at(-1));
  return background === 7 || background === 15 ? "light" : "dark";
}
function terminalPalette(preference: ThemePreference) {
  const light = resolveTerminalTheme(preference) === "light";
  const supports256 =
    /(?:256color|direct)/.test(process.env.TERM || "") ||
    /truecolor|24bit/.test(process.env.COLORTERM || "");
  const color =
    (index: number, fallback: (text: string) => string) => (text: string) =>
      !c.isColorSupported
        ? text
        : supports256
          ? `\x1b[38;5;${index}m${text}\x1b[39m`
          : fallback(text);
  return {
    accent: color(light ? 55 : 147, c.magenta),
    muted: color(light ? 240 : 248, c.dim),
    info: color(light ? 24 : 117, c.cyan),
    warning: color(light ? 130 : 221, c.yellow),
    error: color(light ? 160 : 210, c.red),
    success: color(light ? 28 : 114, c.green),
  };
}
let reader: Interface | undefined;
let active: TerminalScreen | undefined;
export class TerminalExit extends Error {}
export function safeTerminalText(value: string) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\t/g, "    ");
}
export function terminalMarkdownLines(value: string): { text: string; kind: "text" | "heading" | "code" }[] {
  let fence: string | null = null;
  return safeTerminalText(value).split("\n").map(line => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker && !fence) {
      fence = marker[1];
      return { text: `── ${marker[2].trim() || "Code"} ──`, kind: "heading" };
    }
    if (fence) {
      if (line.trim().startsWith(fence) && /^\s*[`~]+\s*$/.test(line)) { fence = null; return { text: "── End code ──", kind: "heading" }; }
      return { text: line, kind: "code" };
    }
    const heading = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line);
    const text = (heading?.[1] || line)
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, "$1 ($2)")
      .replace(/^(\s*)[-+*]\s+/, "$1• ");
    return { text, kind: heading ? "heading" : "text" };
  });
}
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function width(value: string) {
  if (/^\p{Mark}+$/u.test(value)) return 0;
  const code = value.codePointAt(0) || 0;
  return /\p{Extended_Pictographic}/u.test(value) ||
    (code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe6f) ||
        (code >= 0xff01 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x3fffd)))
    ? 2
    : 1;
}
export function wrapTerminalText(value: string, columns: number) {
  const lines: string[] = [];
  let line = "",
    used = 0;
  for (const { segment } of segmenter.segment(safeTerminalText(value))) {
    if (segment === "\n") {
      lines.push(line);
      line = "";
      used = 0;
      continue;
    }
    const size = width(segment);
    if (used + size > columns && line) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += segment;
    used += size;
  }
  lines.push(line);
  return lines;
}
const clip = (value: string, columns: number) =>
  wrapTerminalText(value, Math.max(1, columns))[0] || "";
const textWidth = (value: string) =>
  [...segmenter.segment(value)].reduce(
    (sum, item) => sum + width(item.segment),
    0,
  );
export const TERMINAL_COMMANDS = [
  { command: "/help", description: "Show commands and keyboard shortcuts" },
  { command: "/new", description: "Start a new task in this project" },
  { command: "/resume", description: "Open a saved task" },
  { command: "/voice", description: "Open browser dictation or a live voice conversation" },
  { command: "/chat", description: "Continue without repository access" },
  { command: "/build", description: "Work in the trusted checkout with approvals" },
  { command: "/mcp", description: "List, discover, or enable MCP connections" },
  { command: "/tools", description: "Select tools for following turns" },
  { command: "/extensions", description: "Browse installed tools and skills" },
  { command: "/plugins", description: "Browse plugins or install <manifest URL>" },
  { command: "/skills", description: "Search skills or show <id> instructions" },
  { command: "/install", description: "Install skill <source> or mcp <name> <url>", argument: true },
  { command: "/queue", description: "List, resume, or remove queued turns" },
  {
    command: "/mode",
    description: "Choose chat, build, plan, or review",
    argument: true,
  },
  {
    command: "/plan",
    description: "Plan a change without editing files",
    argument: true,
  },
  {
    command: "/review",
    description: "Review the project without editing files",
  },
  {
    command: "/theme",
    description: "Choose auto, light, or dark",
    argument: true,
  },
  { command: "/usage", description: "Check the free allowance and reset time" },
  {
    command: "/permissions",
    description: "Choose this session’s tool permissions",
  },
  { command: "/status", description: "Show project, connection, and permissions" },
  { command: "/copy", description: "Copy the latest assistant response (macOS)" },
  { command: "/diff", description: "Show tracked diff and untracked paths in trusted workspace" },
  { command: "/pwd", description: "Show the selected directory" },
  { command: "/cwd", description: "Show the selected directory" },
  { command: "/clear", description: "Start a fresh chat, preserving saved history" },
  { command: "/update", description: "Check and install a verified CLI update" },
  { command: "/exit", description: "Close Freecoda" },
  { command: "/quit", description: "Close Freecoda" },
];
type Entry = {
  role: "you" | "freecoda" | "tool" | "approval" | "notice" | "error";
  text: string;
};
type Question = {
  label: string;
  kind: "composer" | "approval" | "permissions";
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};
export type SponsorBanner = {
  label: string;
  headline: string;
  description: string;
  href: string;
};
export class TerminalScreen {
  readonly queue = new TurnQueue();
  dequeuedTurn?: QueuedTurn;
  captureTurn?: () => unknown;
  private composerDraft = "";
  private entries: Entry[] = [];
  private question?: Question;
  private value = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private scroll = 0;
  private commandIndex = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private keyStream = new PassThrough();
  private decoder = new StringDecoder("utf8");
  private paste = false;
  private pasteText = "";
  private pending = "";
  private escapeTimer?: ReturnType<typeof setTimeout>;
  private lastInterrupt = 0;
  private closed = false;
  private busy = false;
  private status = "Ready";
  private model = "";
  private mode = "chat";
  private permissions = "Default · ask before edits and commands";
  private permissionIndex = 1;
  private approvalIndex = 0;
  private approvalCategory?: "write" | "shell";
  private sponsor: SponsorBanner = {
    label: "Freecoda announcement",
    headline: "Free forever. Supported by sponsors.",
    description: "Your code and prompts are never used to target ads.",
    href: "https://freecoda.com/advertise",
  };
  onCancel?: () => void;
  onOpenSponsor?: (href: string) => void;
  constructor(
    private root: string,
    model: string,
    private theme: ThemePreference = "auto",
  ) {
    this.model = model;
  }
  static available() {
    return (
      !!process.stdin.isTTY &&
      !!process.stdout.isTTY &&
      process.env.TERM !== "dumb" &&
      (process.stdout.columns || 80) >= 44 &&
      (process.stdout.rows || 24) >= 16
    );
  }
  start() {
    closeReader();
    active = this;
    emitKeypressEvents(this.keyStream);
    this.keyStream.on("keypress", this.onKey);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);
    process.once("exit", this.onProcessExit);
    process.once("SIGTERM", this.onTerminate);
    process.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[?25l");
    this.append(
      "notice",
      "Your Freecoda conversation. Chat has no project access or tools. /mode build opens coding; /help lists commands.",
    );
    this.render();
    return this;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.escapeTimer);
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    process.off("exit", this.onProcessExit);
    process.off("SIGTERM", this.onTerminate);
    this.keyStream.removeAllListeners();
    this.keyStream.destroy();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[?2004l\x1b[?25h\x1b[?1049l");
    if (active === this) active = undefined;
    this.question?.reject(new TerminalExit("Terminal closed."));
    this.question = undefined;
  }
  append(role: Entry["role"], text: string) {
    this.entries.push({ role, text: safeTerminalText(text) });
    if (this.entries.length > 300)
      this.entries.splice(0, this.entries.length - 300);
    this.scroll = 0;
    this.schedule();
  }
  appendText(text: string) {
    if (this.entries.at(-1)?.role !== "freecoda")
      this.entries.push({ role: "freecoda", text: "" });
    const entry = this.entries.at(-1)!;
    entry.text = (entry.text + text).slice(-100000);
    this.scroll = 0;
    this.schedule();
  }
  setBusy(value: boolean, status = value ? "Working" : "Ready") {
    this.busy = value;
    this.status = status;
    this.schedule();
  }
  setTheme(value: ThemePreference) {
    this.theme = value;
    this.schedule();
  }
  setModel(value: string) {
    this.model = value;
    this.schedule();
  }
  setMode(value: string) {
    this.mode = value;
    this.schedule();
  }
  setPermissions(description: string) {
    this.permissions = description;
    this.schedule();
  }
  choosePermissions(preset: PermissionPreset) {
    this.permissionIndex = PERMISSION_PRESETS.findIndex(
      (item) => item.id === preset,
    );
    return this.prompt("Permissions · this session only", "permissions");
  }
  async chooseApproval(kind: "write" | "shell") {
    this.approvalCategory = kind;
    this.approvalIndex = 0;
    try {
      return await this.prompt(
        kind === "shell" ? "Allow command execution?" : "Allow file changes?",
        "approval",
      );
    } finally {
      this.approvalCategory = undefined;
    }
  }
  showSponsor(ad: SponsorBanner) {
    if (this.closed) return false;
    this.sponsor = ad;
    this.render();
    return true;
  }
  clear() {
    this.entries = [];
    this.scroll = 0;
    this.schedule();
  }
  prompt(label = "Message Freecoda", kind: Question["kind"] = "composer") {
    if (this.question)
      throw new Error("A terminal question is already active.");
    if (kind !== "composer") this.composerDraft = this.value;
    else {
      this.dequeuedTurn = this.queue.next();
      if (this.dequeuedTurn) return Promise.resolve(this.dequeuedTurn.input);
    }
    this.value = kind === "composer" ? this.composerDraft || this.value : "";
    if (kind === "composer") this.composerDraft = "";
    this.cursor = Array.from(this.value).length;
    this.historyIndex = -1;
    return new Promise<string>((resolve, reject) => {
      this.question = {
        label: safeTerminalText(label).trim(),
        kind,
        resolve,
        reject,
      };
      this.render();
    });
  }
  insertVoiceDraft(text: string) {
    if (this.closed || (this.question && this.question.kind !== "composer")) throw Error("Finish the current confirmation before dictating.");
    if (!this.question && !this.busy) throw Error("Wait for the composer before dictating.");
    this.insert(text);
  }
  submitVoiceTurn(text: string) {
    if (this.closed || this.busy || !this.question || this.question.kind !== "composer" || this.queue.items.length) throw Error("Wait for the current turn and queued messages before speaking.");
    // Voice text is always a normal message, never a terminal slash command.
    const question = this.question;
    this.question = undefined;
    // Keep the visible draft in place while the spoken turn runs. Existing
    // approval prompts already preserve this value and restore it afterward.
    question.resolve(`Voice message:\n${safeTerminalText(text)}`);
    this.schedule();
  }
  private schedule() {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.render();
    }, 35);
  }
  private onResize = () => this.render();
  private onProcessExit = () => this.close();
  private onTerminate = () => {
    this.onCancel?.();
    this.close();
    process.exit(143);
  };
  private insert(text: string) {
    if (!this.question && !this.busy) return;
    const chars = Array.from(this.value);
    const inserted = Array.from(safeTerminalText(text)).slice(
      0,
      Math.max(0, 32000 - chars.length),
    );
    chars.splice(this.cursor, 0, ...inserted);
    this.cursor += inserted.length;
    this.value = chars.join("");
    this.historyIndex = -1;
    this.commandIndex = 0;
    this.schedule();
  }
  private onData = (data: Buffer) => {
    let text = this.pending + this.decoder.write(data);
    this.pending = "";
    clearTimeout(this.escapeTimer);
    for (;;) {
      if (this.paste) {
        const end = text.indexOf("\x1b[201~");
        if (end < 0) {
          this.pasteText = (this.pasteText + text).slice(0, 64000);
          return;
        }
        this.insert(this.pasteText + text.slice(0, end));
        this.pasteText = "";
        this.paste = false;
        text = text.slice(end + 6);
        continue;
      }
      const start = text.indexOf("\x1b[200~");
      if (start >= 0) {
        this.normalData(text.slice(0, start));
        this.paste = true;
        text = text.slice(start + 6);
        continue;
      }
      const marker = "\x1b[200~";
      let held = 0;
      for (let i = 1; i < marker.length; i++)
        if (text.endsWith(marker.slice(0, i))) held = i;
      if (held) {
        this.pending = text.slice(-held);
        this.normalData(text.slice(0, -held));
        this.escapeTimer = setTimeout(() => {
          const pending = this.pending;
          this.pending = "";
          this.normalData(pending);
        }, 80);
      } else this.normalData(text);
      return;
    }
  };
  private normalData(text: string) {
    if (!text) return;
    if (
      text.length > 1 &&
      text.includes("\n") &&
      !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
    )
      this.insert(text.replace(/\r\n?/g, "\n"));
    else this.keyStream.write(text);
  }
  private commandMatches() {
    return this.question?.kind === "composer" && /^\/[a-z]*$/.test(this.value)
      ? TERMINAL_COMMANDS.filter((item) => item.command.startsWith(this.value))
      : [];
  }
  private onKey = (str: string, key: Key = {}) => {
    if (key.ctrl && key.name === "o") {
      this.onOpenSponsor?.(this.sponsor.href);
      return;
    }
    if (this.question?.kind === "approval" && this.approvalCategory) {
      if (key.name === "escape") {
        this.submit("n");
        return;
      }
      if (key.name === "up" || key.name === "down") {
        this.approvalIndex =
          (this.approvalIndex + (key.name === "down" ? 1 : 2)) % 3;
        this.value = "";
        this.cursor = 0;
        this.schedule();
        return;
      }
      if (/^[123]$/.test(str) || /^[ysn]$/i.test(str)) {
        this.approvalIndex = /^[123]$/.test(str)
          ? Number(str) - 1
          : ["y", "s", "n"].indexOf(str.toLowerCase());
        this.value = "";
        this.cursor = 0;
        this.schedule();
        return;
      }
      if (key.name === "return") {
        this.submit(["y", "s", "n"][this.approvalIndex]!);
        return;
      }
    }
    if (this.question?.kind === "permissions") {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        this.submit("");
        return;
      }
      if (key.name === "up" || key.name === "down") {
        this.permissionIndex =
          (this.permissionIndex + (key.name === "down" ? 1 : 2)) % 3;
        this.value = "";
        this.cursor = 0;
        this.schedule();
        return;
      }
      if (/^[123]$/.test(str)) {
        this.permissionIndex = Number(str) - 1;
        this.value = "";
        this.cursor = 0;
        this.schedule();
        return;
      }
      if (key.name === "return") {
        this.submit(
          this.value.trim() || PERMISSION_PRESETS[this.permissionIndex]!.id,
        );
        return;
      }
    }
    if (key.ctrl && key.name === "c") {
      if (this.busy) {
        const q = this.question;
        this.question = undefined;
        q?.reject(new Error("Request cancelled."));
        this.onCancel?.();
        return;
      }
      if (this.value) {
        this.value = "";
        this.cursor = 0;
        this.schedule();
        return;
      }
      if (Date.now() - this.lastInterrupt < 1500) {
        const q = this.question;
        this.question = undefined;
        q?.reject(new TerminalExit("Exited."));
        return;
      }
      this.lastInterrupt = Date.now();
      this.append("notice", "Press Ctrl+C again to exit.");
      return;
    }
    if (key.name === "escape") {
      if (this.question?.kind === "approval") {
        this.submit("n");
        this.onCancel?.();
        return;
      }
      if (this.busy) this.onCancel?.();
      else {
        this.value = "";
        this.cursor = 0;
        this.schedule();
      }
      return;
    }
    if (key.ctrl && key.name === "d" && !this.value && !this.busy) {
      const q = this.question;
      this.question = undefined;
      q?.reject(new TerminalExit("Exited."));
      return;
    }
    if (key.name === "pageup" || key.name === "pagedown") {
      this.scroll = Math.max(
        0,
        this.scroll +
          (key.name === "pageup" ? 1 : -1) *
            Math.max(5, (process.stdout.rows || 24) - 14),
      );
      this.schedule();
      return;
    }
    if (key.ctrl && key.name === "l") {
      this.render();
      return;
    }
    if (!this.question && !this.busy) return;
    const chars = Array.from(this.value);
    const commands = this.commandMatches();
    this.commandIndex = Math.min(
      this.commandIndex,
      Math.max(0, commands.length - 1),
    );
    if (commands.length && (key.name === "up" || key.name === "down")) {
      this.commandIndex =
        (this.commandIndex + (key.name === "down" ? 1 : commands.length - 1)) %
        commands.length;
      this.schedule();
      return;
    }
    if (
      commands.length &&
      (key.name === "tab" || (key.name === "return" && !key.meta && !key.shift))
    ) {
      const selected = commands[this.commandIndex]!;
      this.value =
        selected.command + (selected.argument || key.name === "tab" ? " " : "");
      this.cursor = this.value.length;
      if (key.name === "return" && !selected.argument)
        this.submit(selected.command);
      else this.schedule();
      return;
    }
    if (key.name === "return" && !key.meta && !key.shift) {
      this.submit(this.value);
      return;
    }
    if (
      (key.ctrl && key.name === "j") ||
      (key.name === "return" && (key.meta || key.shift))
    ) {
      this.insert("\n");
      return;
    }
    if (key.name === "backspace") {
      if (this.cursor > 0) {
        chars.splice(--this.cursor, 1);
        this.value = chars.join("");
      }
      this.schedule();
      return;
    }
    if (key.name === "delete") {
      chars.splice(this.cursor, 1);
      this.value = chars.join("");
      this.schedule();
      return;
    }
    if (key.name === "left") {
      this.cursor = Math.max(0, this.cursor - 1);
      this.schedule();
      return;
    }
    if (key.name === "right") {
      this.cursor = Math.min(chars.length, this.cursor + 1);
      this.schedule();
      return;
    }
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      this.cursor = 0;
      this.schedule();
      return;
    }
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      this.cursor = chars.length;
      this.schedule();
      return;
    }
    if (key.ctrl && key.name === "u") {
      this.value = chars.slice(this.cursor).join("");
      this.cursor = 0;
      this.schedule();
      return;
    }
    if (key.ctrl && key.name === "k") {
      this.value = chars.slice(0, this.cursor).join("");
      this.schedule();
      return;
    }
    if (key.ctrl && key.name === "w") {
      let start = this.cursor;
      while (start > 0 && /\s/.test(chars[start - 1])) start--;
      while (start > 0 && !/\s/.test(chars[start - 1])) start--;
      chars.splice(start, this.cursor - start);
      this.cursor = start;
      this.value = chars.join("");
      this.schedule();
      return;
    }
    if (
      (key.name === "up" || key.name === "down") &&
      this.question?.kind === "composer"
    ) {
      if (key.name === "up" && this.history.length) {
        if (this.historyIndex < 0) {
          this.draft = this.value;
          this.historyIndex = this.history.length - 1;
        } else this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.value = this.history[this.historyIndex];
      }
      if (key.name === "down" && this.historyIndex >= 0) {
        this.historyIndex++;
        if (this.historyIndex >= this.history.length) {
          this.historyIndex = -1;
          this.value = this.draft;
        } else this.value = this.history[this.historyIndex];
      }
      this.cursor = Array.from(this.value).length;
      this.schedule();
      return;
    }
    if (!key.ctrl && !key.meta && str && !str.includes("\x1b"))
      this.insert(str);
  };
  private submit(answer: string) {
    const q = this.question;
    if (!q) {
      if (!this.busy || !answer.trim()) return;
      if (answer.trim().startsWith("/")) {
        this.append("notice", "Commands are available after the current turn. Escape cancels and pauses the queue.");
        return;
      }
      try {
        const item = this.queue.add(answer.trim(), this.captureTurn?.());
        this.append("notice", `Queued ${item.id.slice(0, 8)} · ${answer.trim().slice(0, 160)}`);
        this.value = "";
        this.cursor = 0;
      } catch (error) { this.append("notice", error instanceof Error ? error.message : "Could not queue turn."); }
      return;
    }
    this.question = undefined;
    this.value = "";
    this.cursor = 0;
    if (q.kind === "composer" && answer.trim()) {
      this.history.push(answer);
      if (this.history.length > 100) this.history.shift();
    }
    q.resolve(answer.trim());
    if (q.kind !== "composer") {
      this.value = this.composerDraft;
      this.composerDraft = "";
      this.cursor = Array.from(this.value).length;
    }
    this.schedule();
  }
  render() {
    if (this.closed) return;
    const palette = terminalPalette(this.theme);
    const columns = Math.max(40, Math.min(240, process.stdout.columns || 80));
    const rows = Math.max(16, process.stdout.rows || 24);
    const inner = columns - 4;
    const inputRowCount = rows < 20 ? 2 : 3;
    const lines: string[] = [];
    const cardWidth = Math.min(columns, 76);
    const card = (text: string, accent = false) => {
      const content = clip(text, cardWidth - 4);
      return (
        palette.muted("│ ") +
        (accent ? c.bold(palette.accent(content)) : content) +
        " ".repeat(Math.max(0, cardWidth - 3 - textWidth(content))) +
        palette.muted("│")
      );
    };
    lines.push("  " + c.bold(palette.accent("freecoda")) + palette.muted("  /help for commands"));
    lines.push(palette.muted("╭" + "─".repeat(cardWidth - 2) + "╮"));
    lines.push(card(this.mode === "chat" ? "General chat · no repository tools" : `${this.mode === "build" ? "Build" : this.mode === "plan" ? "Plan" : "Review"} · ${this.permissions}`, true));
    lines.push(card(`Workspace: ${this.root}`));
    lines.push(palette.muted("╰" + "─".repeat(cardWidth - 2) + "╯"));
    const commands = this.commandMatches();
    const menuSize = Math.min(
      commands.length,
      Math.max(1, Math.min(5, rows - 22)),
    );
    const menuRows =
      this.question?.kind === "approval" && this.approvalCategory
        ? 5
        : this.question?.kind === "permissions"
          ? 4
          : commands.length
            ? menuSize + 1
            : 0;
    const transcript: string[] = [];
    for (const entry of this.entries) {
      const label = {
        you: "you",
        freecoda: "freecoda",
        tool: "tool",
        approval: "approval",
        notice: "",
        error: "error",
      }[entry.role];
      if (label)
        transcript.push(
          "  " +
            (entry.role === "you"
              ? c.bold(palette.info(label))
              : entry.role === "approval"
                ? c.bold(palette.warning(label))
                : entry.role === "error"
                  ? palette.error(label)
                  : c.bold(label)),
        );
      const formatted = entry.role === "freecoda" ? terminalMarkdownLines(entry.text) : entry.text.split("\n").map(text => ({ text, kind: "text" }));
      for (const part of formatted) for (const line of wrapTerminalText(part.text, inner)) {
        const styled =
          entry.role === "error"
            ? palette.error(line)
            : entry.role === "notice" || entry.role === "tool"
              ? palette.muted(line)
              : entry.role === "approval" && line.startsWith("+")
                ? palette.success(line)
                : entry.role === "approval" && line.startsWith("-")
                  ? palette.error(line)
                  : part.kind === "heading"
                    ? c.bold(line)
                    : part.kind === "code"
                      ? palette.info(line)
                      : line;
        transcript.push("  " + styled);
      }
      transcript.push("");
    }
    const contentRows = Math.max(0, rows - 12 - inputRowCount - menuRows);
    this.scroll = Math.min(
      this.scroll,
      Math.max(0, transcript.length - contentRows),
    );
    const end = transcript.length - this.scroll;
    const visible = transcript.slice(Math.max(0, end - contentRows), end);
    while (visible.length < contentRows) visible.unshift("");
    lines.push(...visible);
    if (commands.length) {
      this.commandIndex = Math.min(this.commandIndex, commands.length - 1);
      const offset = Math.max(0, this.commandIndex - menuSize + 1);
      lines.push(
        palette.muted("  Commands · ↑/↓ choose · Enter run · Tab complete"),
      );
      for (const [i, item] of commands
        .slice(offset, offset + menuSize)
        .entries()) {
        const selected = i + offset === this.commandIndex;
        const text = clip(
          `${selected ? "›" : " "} ${item.command.padEnd(10)} ${item.description}`,
          columns - 2,
        );
        lines.push(
          "  " +
            (selected ? c.bold(palette.accent(text)) : palette.muted(text)),
        );
      }
    }
    if (this.question?.kind === "approval" && this.approvalCategory) {
      const category =
        this.approvalCategory === "shell"
          ? "commands and external tools"
          : "file edits";
      lines.push(
        palette.warning("  Approval required · review the action above"),
      );
      for (const [index, choice] of [
        "Yes, allow once",
        `Yes, allow ALL ${category} for this session`,
        "No, decline this action",
      ].entries()) {
        const text = clip(
          `${index === this.approvalIndex ? "›" : " "} ${index + 1}. ${choice}`,
          inner,
        );
        lines.push(
          "  " +
            (index === this.approvalIndex
              ? c.bold(palette.accent(text))
              : palette.muted(text)),
        );
      }
      lines.push(
        palette.muted(
          "  Session approval covers ALL commands/external tools or ALL file edits.",
        ),
      );
    }
    if (this.question?.kind === "permissions") {
      lines.push(
        palette.muted(
          "  Permissions · ↑/↓ choose · Enter confirm · Esc cancel",
        ),
      );
      for (const [index, item] of PERMISSION_PRESETS.entries()) {
        const text = clip(
          `${index === this.permissionIndex ? "›" : " "} ${index + 1}. ${item.label} · ${item.description}`,
          inner,
        );
        lines.push(
          "  " +
            (index === this.permissionIndex
              ? c.bold(palette.accent(text))
              : palette.muted(text)),
        );
      }
    }
    lines.push(
      palette.muted(
        "  " + clip(this.sponsor.label + " · " + this.sponsor.headline, inner),
      ),
    );
    lines.push(palette.muted("  " + clip(this.sponsor.description, inner)));
    lines.push(
      palette.muted(
        "  " + clip("Ctrl+O sponsor · " + this.sponsor.href, inner),
      ),
    );
    lines.push(palette.muted("─".repeat(columns)));
    lines.push(
      "  " +
        c.bold(
          clip(
            this.question?.kind === "approval" ||
              this.question?.kind === "permissions"
              ? this.question.label
              : this.busy
                ? `${this.status} · ${this.queue.items.length} queued${this.queue.paused ? " (paused)" : ""} · Esc to interrupt`
                : `${this.mode === "chat" ? "Chat · no project access or tools" : (this.mode === "build" ? "Agent" : this.mode === "plan" ? "Plan" : "Review") + " · " + (this.mode === "build" ? this.permissions : "read-only turn · " + this.permissions)}`,
            inner,
          ),
        ),
    );
    const before = Array.from(this.value).slice(0, this.cursor).join("");
    let cursorRow = 0,
      cursorCol = 0;
    for (const { segment } of segmenter.segment(before)) {
      if (segment === "\n") {
        cursorRow++;
        cursorCol = 0;
        continue;
      }
      const w = width(segment);
      if (cursorCol + w > inner) {
        cursorRow++;
        cursorCol = 0;
      }
      cursorCol += w;
      if (cursorCol === inner) {
        cursorRow++;
        cursorCol = 0;
      }
    }
    const inputLines = wrapTerminalText(this.value, inner);
    while (inputLines.length <= cursorRow) inputLines.push("");
    const inputStart = Math.max(0, cursorRow - inputRowCount + 1);
    const inputScreenRow = lines.length + 1;
    for (let i = 0; i < inputRowCount; i++) {
      const line = inputLines[inputStart + i] || "";
      const placeholder = !this.value && i === 0 && this.question?.kind === "composer"
        ? this.busy ? "Add to the current task…" : "Ask Coda… / for commands"
        : "";
      const content = line || placeholder;
      lines.push(palette.muted("│ ") + (placeholder ? palette.muted(content) : content) + " ".repeat(Math.max(0, columns - 3 - textWidth(content))) + palette.muted("│"));
    }
    lines.push(palette.muted("─".repeat(columns)));
    lines.push(
      palette.muted(
        "  " +
          clip(
            this.question?.kind === "approval"
              ? this.approvalCategory
                ? "↑/↓ or 1–3 choose · Enter confirm · Esc decline · y/s/n"
                : "Enter confirm · Esc decline"
              : this.question?.kind === "permissions"
                ? "1–3 select · Enter confirm · Esc keeps current permissions"
                : `Enter send · Ctrl+J newline · ↑ history · PgUp scroll · /help · ${this.mode === "chat" ? "Chat · no tools" : this.permissions}`,
            inner,
          ),
      ),
    );
    process.stdout.write(
      "\x1b[?25l\x1b[H" +
        lines
          .slice(0, rows)
          .map((line) => line + "\x1b[K")
          .join("\r\n") +
        "\x1b[J",
    );
    if (this.question) {
      const y = inputScreenRow + cursorRow - inputStart;
      process.stdout.write(
        `\x1b[${Math.min(rows, y)};${Math.min(columns, cursorCol + 3)}H\x1b[?25h`,
      );
    }
  }
}
export function closeTerminal() {
  active?.close();
}
export function closeReader() {
  reader?.close();
  reader = undefined;
}
export async function ask(prompt: string) {
  if (!process.stdin.isTTY)
    throw new Error("This action requires an interactive terminal.");
  if (active) return active.prompt(prompt, "approval");
  reader ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await reader.question(prompt)).trim();
}
export async function secret(prompt: string) {
  if (!process.stdin.isTTY)
    throw new Error("Use FREECODA_PROVIDER_KEY in a noninteractive terminal.");
  closeReader();
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (data: Buffer) => {
      for (const char of data.toString()) {
        if (char === "\u0003") {
          done();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          done();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}
export function approvals() {
  return new SessionPermissions(
    async (kind, description) => {
      if (active) active.append("approval", description);
      else console.log(c.dim("\n" + safeTerminalText(description)));
      if (!process.stdin.isTTY) return "n";
      if (active) return active.chooseApproval(kind);
      const answer = await ask(
        `${kind === "shell" ? "Allow command execution?" : "Allow file changes?"}\n` +
          `1. Yes, allow once\n2. Yes, allow ALL ${kind === "shell" ? "commands and external tools" : "file edits"} for this session\n3. No, decline this action\n` +
          "Session approval covers the entire category. [1/y, 2/s, 3/n]: ",
      );
      return (
        ({ "1": "y", "2": "s", "3": "n" } as Record<string, string>)[answer] ||
        answer
      );
    },
    (description) => active?.setPermissions(description),
  );
}
