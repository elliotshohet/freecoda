import { test, expect } from "bun:test";
import { canDeliverQueuedPrompt, settleQueuedPrompt } from "../apps/desktop/src/renderer/prompt-queue";

test("desktop queued tasks retain FIFO after rejection and cannot cross conversation, folder, mode, or draft boundaries", () => {
  const context = { mode: "build", threadId: "thread-a", root: "/trusted/a" };
  const first = { ...context, text: "first" }, second = { ...context, text: "second" };
  const queue = [first, second];
  expect(canDeliverQueuedPrompt(first, context, "")).toBe(true);
  expect(canDeliverQueuedPrompt(first, { ...context, threadId: "thread-b" }, "")).toBe(false);
  expect(canDeliverQueuedPrompt(first, { ...context, root: "/trusted/b" }, "")).toBe(false);
  expect(canDeliverQueuedPrompt(first, { ...context, mode: "review" }, "")).toBe(false);
  expect(canDeliverQueuedPrompt(first, context, "unsent user draft")).toBe(false);
  expect(settleQueuedPrompt(queue, false)).toEqual({ paused: true, remaining: 2 });
  expect(queue).toEqual([first, second]);
  expect(settleQueuedPrompt(queue, true)).toEqual({ paused: false, remaining: 1 });
  expect(queue).toEqual([second]);
});
