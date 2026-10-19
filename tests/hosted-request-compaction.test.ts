import { describe, expect, test } from "bun:test";
import {
  compactHostedRequest,
  MAX_HOSTED_REQUEST_BYTES,
} from "../packages/core/src/model";

function request(prompt: Array<{ role: string; content: string }>) {
  return {
    protocol: 1 as const,
    operation: "stream",
    model: "reflection/beam-free",
    options: { prompt } as unknown as Parameters<typeof compactHostedRequest>[0]["options"],
  };
}

describe("hosted inference request compaction", () => {
  test("removes complete older turns while keeping instructions and latest request", () => {
    const original = request([
      { role: "system", content: "Keep this instruction." },
      { role: "user", content: "old question" },
      { role: "assistant", content: "x".repeat(45_000) },
      { role: "user", content: "current question" },
      { role: "assistant", content: "y".repeat(45_000) },
    ]);

    const compacted = compactHostedRequest(original);
    const prompt = compacted.options.prompt as Array<{
      role: string;
      content: string;
    }>;
    const serialized = new TextEncoder().encode(JSON.stringify(compacted));

    expect(serialized.byteLength).toBeLessThanOrEqual(MAX_HOSTED_REQUEST_BYTES);
    expect(prompt[0]).toEqual({ role: "system", content: "Keep this instruction." });
    expect(prompt.some((message) => message.content === "old question")).toBe(false);
    expect(prompt.some((message) => message.content === "current question")).toBe(true);
  });

  test("keeps the conversation untouched when it already fits", () => {
    const original = request([{ role: "user", content: "hello" }]);
    expect(compactHostedRequest(original)).toBe(original);
  });

  test("explains when the current request alone is too large", () => {
    const original = request([
      { role: "system", content: "Instructions" },
      { role: "user", content: "x".repeat(MAX_HOSTED_REQUEST_BYTES) },
    ]);
    expect(() => compactHostedRequest(original)).toThrow(
      "Shorten the current message or reduce attached context",
    );
  });
});
