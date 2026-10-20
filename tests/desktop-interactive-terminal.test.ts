import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { DesktopTerminalManager, type TerminalEvent } from "../apps/desktop/src/interactive-terminal";

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: undefined, exitCode: null as number | null, signalCode: null,
  });
  return child;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "freecoda-terminal-boundary-"));
  const root = await realpath(directory);
  let releases = 0, launches = 0;
  const events: TerminalEvent[] = [];
  const child = fakeChild();
  const manager = new DesktopTerminalManager({
    async authorize() { return { root, ownerKey: "account-a/session-a", release() { releases++; } }; },
    emit(event) { events.push(event); },
    spawnProcess(command, args, options) {
      launches++;
      expect(command).toBe("/usr/bin/script");
      expect(args).toEqual(["-q", "/dev/null", "/bin/zsh", "-i"]);
      expect(options.cwd).toBe(root);
      expect(options.env?.FREECODA_TEST_CREDENTIAL).toBeUndefined();
      queueMicrotask(() => child.emit("spawn"));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });
  // Exercise permission/lifecycle logic on every host; no OS process is started.
  manager.availability = async () => ({ available: true, detail: "Fixture PTY transport", resizable: false });
  return { root, child, manager, events, releases: () => releases, launches: () => launches,
    async cleanup() { await manager.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test("terminal denial and non-Build requests never launch a process", async () => {
  const f = await fixture();
  try {
    await expect(f.manager.start({ root: f.root, mode: "plan" as "build" })).rejects.toThrow("Build");
    const denied = new DesktopTerminalManager({ authorize: async () => { throw Error("User declined terminal connection."); }, emit() {}, spawnProcess() { throw Error("must not spawn"); } });
    denied.availability = f.manager.availability;
    await expect(denied.start({ root: f.root, mode: "build" })).rejects.toThrow("declined");
    expect(f.launches()).toBe(0);
    await denied.dispose();
  } finally { await f.cleanup(); }
});

test("stale account authorization releases its lease without starting a shell", async () => {
  const f = await fixture();
  let releases = 0;
  const manager = new DesktopTerminalManager({
    async authorize() { return { root: f.root, ownerKey: "old-account", isCurrent: () => false, release() { releases++; } }; },
    emit() {}, spawnProcess() { throw Error("A stale grant must never spawn."); },
  });
  manager.availability = f.manager.availability;
  try {
    await expect(manager.start({ root: f.root, mode: "build" })).rejects.toThrow("changed");
    expect(releases).toBe(1);
    expect(manager.list("old-account")).toEqual([]);
  } finally { await manager.dispose(); await f.cleanup(); }
  expect(releases).toBe(1);
});

test("terminal input and exit stay owner-scoped and release the lease exactly once", async () => {
  const f = await fixture();
  const previous = process.env.FREECODA_TEST_CREDENTIAL;
  process.env.FREECODA_TEST_CREDENTIAL = "fixture-value-must-not-be-forwarded";
  try {
    const session = await f.manager.start({ root: f.root, mode: "build" });
    expect(f.launches()).toBe(1);
    expect(f.releases()).toBe(0);
    expect(f.manager.list("other-account")).toEqual([]);
    expect(() => f.manager.write({ id: session.id, data: "echo approved\n" }, "other-account")).toThrow("current account");
    await expect(f.manager.close(session.id, "other-account")).rejects.toThrow("current account");
    expect(() => f.manager.write({ id: session.id, data: "x".repeat(8193) }, session.ownerKey)).toThrow("8,192");
    const input: string[] = [];
    f.child.stdin.on("data", data => input.push(String(data)));
    f.manager.write({ id: session.id, data: "hello\n" }, session.ownerKey);
    expect(input.join("")).toBe("hello\n");
    f.child.stdout.write("fixture output");
    expect(f.events.some(event => event.type === "data" && event.ownerKey === session.ownerKey && event.data === "fixture output")).toBe(true);
    f.child.exitCode = 0; f.child.emit("close", 0, null);
    expect(f.releases()).toBe(1);
    expect(f.manager.list(session.ownerKey)).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.FREECODA_TEST_CREDENTIAL;
    else process.env.FREECODA_TEST_CREDENTIAL = previous;
    await f.cleanup();
  }
  expect(f.releases()).toBe(1);
});

test("spawn errors release the workspace lease once and surface failure", async () => {
  const f = await fixture();
  let releases = 0;
  const child = fakeChild();
  const manager = new DesktopTerminalManager({
    async authorize() { return { root: f.root, ownerKey: "owner", release() { releases++; } }; }, emit() {},
    spawnProcess() { queueMicrotask(() => child.emit("error", Error("fixture spawn failed"))); return child as unknown as ChildProcessWithoutNullStreams; },
  });
  manager.availability = f.manager.availability;
  try {
    await expect(manager.start({ root: f.root, mode: "build" })).rejects.toThrow("fixture spawn failed");
    expect(releases).toBe(1);
    child.emit("close", null, null);
    expect(releases).toBe(1);
  } finally { await manager.dispose(); await f.cleanup(); }
});


test("account changes during spawn stop the session and release its lease", async () => {
  const f = await fixture();
  let releases = 0, current = true;
  const child = fakeChild();
  const manager = new DesktopTerminalManager({
    async authorize() { return { root: f.root, ownerKey: "old-account", isCurrent: () => current, release() { releases++; } }; },
    emit() {},
    spawnProcess() {
      queueMicrotask(() => { current = false; child.emit("spawn"); });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });
  manager.availability = f.manager.availability;
  try {
    await expect(manager.start({ root: f.root, mode: "build" })).rejects.toThrow("changed during launch");
    expect(releases).toBe(1);
    child.emit("close", null, null);
    expect(manager.list("old-account")).toEqual([]);
  } finally { await manager.dispose(); await f.cleanup(); }
  expect(releases).toBe(1);
});
