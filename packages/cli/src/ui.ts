import { createInterface, type Interface } from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { PassThrough } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import c from "picocolors";
import { CLI_VERSION } from "./version";
import type { Approval } from "@freecoda/core";
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
const SLASH_COMMANDS = [
  "/help",
  "/theme",
  "/new",
  "/clear",
  "/usage",
  "/status",
  "/model",
  "/mode",
  "/plan",
  "/review",
  "/exit",
];
type Entry = {
  role: "you" | "freecoda" | "tool" | "approval" | "notice" | "error";
  text: string;
};
type Question = {
  label: string;
  kind: "composer" | "approval";
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
  private entries: Entry[] = [];
  private question?: Question;
  private value = "";
  private cursor = 0;
  private history: string[] = [];
  private historyIndex = -1;
  private draft = "";
  private scroll = 0;
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
  private mode = "build";
  private permissions = "Ask before writes and commands";
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
      "Your local coding workspace. /help lists commands. Writes and shell commands require your approval.",
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
  permit(kind: string) {
    this.permissions = `${kind} allowed this session · other actions ask`;
    this.schedule();
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
    this.value = "";
    this.cursor = 0;
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
    if (!this.question) return;
    const chars = Array.from(this.value);
    const inserted = Array.from(safeTerminalText(text)).slice(
      0,
      Math.max(0, 32000 - chars.length),
    );
    chars.splice(this.cursor, 0, ...inserted);
    this.cursor += inserted.length;
    this.value = chars.join("");
    this.historyIndex = -1;
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
  private onKey = (str: string, key: Key = {}) => {
    if (key.ctrl && key.name === "o") {
      this.onOpenSponsor?.(this.sponsor.href);
      return;
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
    if (!this.question) return;
    const chars = Array.from(this.value);
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
      this.question.kind === "composer"
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
    if (
      key.name === "tab" &&
      this.value.startsWith("/") &&
      !this.value.includes(" ")
    ) {
      const matches = SLASH_COMMANDS.filter((command) =>
        command.startsWith(this.value),
      );
      if (matches.length === 1) {
        this.value = matches[0] + " ";
        this.cursor = this.value.length;
        this.schedule();
      } else if (matches.length) this.append("notice", matches.join("  "));
      return;
    }
    if (!key.ctrl && !key.meta && str && !str.includes("\x1b"))
      this.insert(str);
  };
  private submit(answer: string) {
    const q = this.question;
    if (!q) return;
    this.question = undefined;
    this.value = "";
    this.cursor = 0;
    if (q.kind === "composer" && answer.trim()) {
      this.history.push(answer);
      if (this.history.length > 100) this.history.shift();
    }
    q.resolve(answer.trim());
    this.schedule();
  }
  render() {
    if (this.closed) return;
    const palette = terminalPalette(this.theme);
    const columns = Math.max(40, Math.min(240, process.stdout.columns || 80));
    const rows = Math.max(16, process.stdout.rows || 24);
    const inner = columns - 4;
    const lines: string[] = [];
    lines.push(
      c.bold(palette.accent("  ▰ freecoda")) +
        palette.muted(`  ${CLI_VERSION}`) +
        palette.muted(clip("  " + this.status, columns - 24)),
    );
    lines.push(palette.muted("  " + clip(this.root, columns - 3)));
    lines.push(
      "  " +
        palette.info(this.mode.toUpperCase()) +
        palette.muted(" · " + clip(this.model, columns - 14)),
    );
    lines.push(palette.muted("─".repeat(columns)));
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
      for (const line of wrapTerminalText(entry.text, inner)) {
        const styled =
          entry.role === "error"
            ? palette.error(line)
            : entry.role === "notice" || entry.role === "tool"
              ? palette.muted(line)
              : entry.role === "approval" && line.startsWith("+")
                ? palette.success(line)
                : entry.role === "approval" && line.startsWith("-")
                  ? palette.error(line)
                  : line;
        transcript.push("  " + styled);
      }
      transcript.push("");
    }
    const contentRows = rows - 14;
    this.scroll = Math.min(
      this.scroll,
      Math.max(0, transcript.length - contentRows),
    );
    const end = transcript.length - this.scroll;
    const visible = transcript.slice(Math.max(0, end - contentRows), end);
    while (visible.length < contentRows) visible.unshift("");
    lines.push(...visible);
    lines.push(palette.muted("─".repeat(columns)));
    lines.push(
      "  " +
        c.bold(
          clip(
            this.question?.label ||
              (this.busy ? "Working · Esc or Ctrl+C to cancel" : "Ready"),
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
    const inputStart = Math.max(0, cursorRow - 2);
    const inputScreenRow = lines.length + 1;
    for (let i = 0; i < 3; i++) {
      const line = inputLines[inputStart + i] || "";
      lines.push((inputStart + i === 0 ? palette.accent("› ") : "  ") + line);
    }
    lines.push(
      palette.muted(
        "  " +
          clip(
            this.question?.kind === "approval"
              ? "y once · s this category/session · n decline"
              : `Enter send · Ctrl+J newline · ↑ history · PgUp scroll · /help · ${this.permissions}`,
            inner,
          ),
      ),
    );
    lines.push(palette.muted("─".repeat(columns)));
    lines.push(
      palette.muted(
        "  " + clip(this.sponsor.label + " · " + this.sponsor.headline, inner),
      ),
    );
    lines.push(palette.muted("  " + clip(this.sponsor.description, inner)));
    lines.push(
      palette.muted("  " + clip("Ctrl+O open · " + this.sponsor.href, inner)),
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
export function approvals(): Approval {
  const allowed = new Set<string>();
  return async (kind, description) => {
    if (allowed.has(kind)) return true;
    if (active) active.append("approval", description);
    else console.log(c.dim("\n" + safeTerminalText(description)));
    if (!process.stdin.isTTY) return false;
    const answer = await ask(
      `Allow ${kind}? [y] once / [s] this category for the session / [n] no:`,
    );
    if (answer.toLowerCase() === "s") {
      allowed.add(kind);
      active?.permit(kind);
      return true;
    }
    return answer.toLowerCase() === "y";
  };
}
