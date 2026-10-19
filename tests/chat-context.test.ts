import { describe, expect, test } from "bun:test";
import { boundedChatContext } from "../apps/web/app/chat/history";

describe("bounded web chat context", () => {
  test("drops complete older turns and preserves the latest request", () => {
    const messages = [
      { role: "user" as const, content: "old question" },
      { role: "assistant" as const, content: "x".repeat(45_000) },
      { role: "user" as const, content: "current question" },
      { role: "assistant" as const, content: "y".repeat(45_000) },
      { role: "user" as const, content: "newest request" },
    ];
    const context = boundedChatContext(messages);
    expect(context).not.toBeNull();
    expect(context?.some((message) => message.content === "old question")).toBe(false);
    expect(context?.some((message) => message.content === "current question")).toBe(true);
    expect(context?.at(-1)).toEqual({ role: "user", content: "newest request" });
    expect(messages).toHaveLength(5);
  });

  test("returns null when the latest request alone exceeds the safe limit", () => {
    expect(
      boundedChatContext([{ role: "user", content: "x".repeat(80_000) }]),
    ).toBeNull();
  });

  test("enforces both byte and message limits", () => {
    const context = boundedChatContext(
      Array.from({ length: 42 }, (_, index) => ({
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        content: String(index),
      })),
    );
    expect(context?.length).toBeLessThanOrEqual(40);
    expect(context?.at(-1)).toEqual({ role: "assistant", content: "41" });
  });
});
