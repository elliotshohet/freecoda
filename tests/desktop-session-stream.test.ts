import { describe, expect, test } from "bun:test";
import { createHydrationBuffer, mergeSessionStream, type SessionStream } from "../apps/desktop/src/renderer/session-stream";

describe("desktop session stream reconciliation", () => {
  const runId = "run-a";
  test("a delayed hydration snapshot cannot replace newer background text", () => {
    const live = { runId, text: "A complete thought", revision: 4 };
    expect(mergeSessionStream(live, { runId, text: "A complete", revision: 2 })).toBe(live);
  });
  test("a snapshot followed by duplicate and reordered cumulative deltas never repeats text", () => {
    let stream: SessionStream | undefined = { runId, text: "Hello", revision: 1 };
    for (const incoming of [
      { runId, text: "Hello", revision: 1 },
      { runId, text: "Hello world", revision: 3 },
      { runId, text: "Hello wor", revision: 2 },
      { runId, text: "Hello world", revision: 3 },
    ]) stream = mergeSessionStream(stream, incoming);
    expect(stream).toEqual({ runId, text: "Hello world", revision: 3 });
  });
  test("revision zero preserves the empty turn and later content replaces it", () => {
    const empty = mergeSessionStream(undefined, { runId, text: "", revision: 0 });
    expect(mergeSessionStream(empty, { runId, text: "First words", revision: 1 }).text).toBe("First words");
  });
  test("a new run starts a distinct stream instead of inheriting an older run's revision", () => {
    expect(mergeSessionStream({ runId, text: "Previous response", revision: 90 }, { runId: "run-b", text: "New response", revision: 1 })).toEqual({ runId: "run-b", text: "New response", revision: 1 });
  });
  test("noninteger or negative watermarks are rejected", () => {
    for (const revision of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => mergeSessionStream(undefined, { runId, text: "", revision })).toThrow("Invalid stream revision");
  });
  test("new events survive while replay has consumed the previous tail and awaits IPC", async () => {
    const buffer = createHydrationBuffer<SessionStream>((a, b) => a.runId === b.runId);
    buffer.push({ runId, text: "Before", revision: 1 });
    expect(buffer.take()?.revision).toBe(1);
    await Promise.resolve();
    buffer.push({ runId, text: "Before and after", revision: 2 });
    expect(buffer.hasNext()).toBe(true);
    expect(buffer.take()?.text).toBe("Before and after");
  });
  test("consecutive unread updates coalesce but lifecycle barriers retain order", () => {
    const buffer = createHydrationBuffer<{ type: string; revision?: number }>((a, b) => a.type === "text" && b.type === "text");
    buffer.push({ type: "text", revision: 1 }); buffer.push({ type: "text", revision: 2 });
    buffer.push({ type: "done" }); buffer.push({ type: "text", revision: 3 });
    expect([buffer.take(), buffer.take(), buffer.take()]).toEqual([{ type: "text", revision: 2 }, { type: "done" }, { type: "text", revision: 3 }]);
  });
});
