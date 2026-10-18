import { test, expect } from "bun:test";
import {
  validChats,
  chatContext,
  type Message,
} from "../apps/web/app/chat/history";
const chat = (messages: unknown[], id = "fixture") => ({
  id,
  title: "Fixture conversation",
  updatedAt: 1234,
  messages,
});

test("storage preserves completed long conversations and long answers beyond request limits", () => {
  const messages: Message[] = Array.from({ length: 81 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: index % 2 ? "a".repeat(64000) : "fixture",
    status: "complete",
  }));
  const result = validChats([chat(messages)]);
  expect(result).toHaveLength(1);
  expect(result[0]!.messages).toHaveLength(81);
  expect(result[0]!.messages[1]!.content).toHaveLength(64000);
  expect(
    validChats([chat([{ role: "assistant", content: "a".repeat(64000) }])]),
  ).toHaveLength(1);
  expect(
    validChats([chat([{ role: "user", content: "u".repeat(8000) }])]),
  ).toHaveLength(1);
});

test("malformed candidates including null messages never erase other valid chats or throw", () => {
  const valid = {
    id: "kept",
    title: "Fixture conversation",
    updatedAt: 1234,
    messages: [{ role: "user" as const, content: "kept" }],
  };
  expect(
    validChats([
      null,
      {},
      chat([null]),
      chat([{ role: "assistant", content: 42 }]),
      chat([{ role: "tool", content: "bad" }]),
      chat([{ role: "assistant", content: "text", status: "invented" }]),
      valid,
    ]),
  ).toEqual([valid]);
  expect(validChats(null)).toEqual([]);
  expect(
    validChats([
      chat([{ role: "assistant", content: "kept", status: "stopped" }]),
    ])[0]?.messages[0]?.status,
  ).toBe("stopped");
  expect(
    validChats([chat([{ role: "user", content: "x".repeat(8001) }]), valid]),
  ).toEqual([valid]);
  expect(
    validChats([
      chat([{ role: "assistant", content: "x".repeat(64001) }]),
      valid,
    ]),
  ).toEqual([valid]);
});

test("history is bounded and strips unexpected persisted properties", () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    chat([{ role: "user", content: "text", extra: "discard" }], String(i)),
  );
  const result = validChats(many);
  expect(result).toHaveLength(80);
  expect(result[0]!.messages[0]).toEqual({ role: "user", content: "text" });
  const large = Array.from({ length: 50 }, () => ({
    role: "assistant",
    content: "x".repeat(64000),
  }));
  expect(validChats([chat(large, "one"), chat(large, "two")])).toHaveLength(1);
  expect(
    validChats([chat([], "duplicate"), chat([], "duplicate")]),
  ).toHaveLength(1);
  expect(
    validChats([
      chat(
        Array.from({ length: 200 }, () => ({
          role: "assistant",
          content: "x".repeat(64000),
        })),
      ),
    ]),
  ).toHaveLength(0);
});

test("API context excludes partial/stopped/error answers and strips completion metadata", () => {
  const messages: Message[] = [
    { role: "user", content: "Question" },
    { role: "assistant", content: "partial", status: "partial" },
    { role: "assistant", content: "stopped", status: "stopped" },
    { role: "assistant", content: "error", status: "error" },
    { role: "assistant", content: "legacy" },
    { role: "assistant", content: "complete", status: "complete" },
    { role: "assistant", content: "   ", status: "complete" },
  ];
  expect(chatContext(messages)).toEqual([
    { role: "user", content: "Question" },
    { role: "assistant", content: "legacy" },
    { role: "assistant", content: "complete" },
  ]);
});
