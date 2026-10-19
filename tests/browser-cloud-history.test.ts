import { test, expect } from "bun:test";
import { cloudConversationBody, displayCloudConversation, cloudHistory } from "../apps/web/app/chat/cloud-history";
import { chatContext } from "../apps/web/app/chat/history";
test("cross-platform coding history is readable without injecting tools or reasoning into general chat", () => {
  const conversation = displayCloudConversation({ id: crypto.randomUUID(), title: "Shared coding task", mode: "coding", version: 3, updatedAt: new Date().toISOString(), messages: [
    { role: "system", content: "private instructions" },
    { role: "user", content: [{ type: "text", text: "Fix the app" }] },
    { role: "assistant", content: [{ type: "reasoning", text: "internal" }, { type: "tool-call", toolName: "shell" }, { type: "text", text: "Fixed it" }] },
    { role: "tool", content: [{ type: "tool-result", output: { value: "private tool context" } }] },
  ] });
  expect(conversation.messages.map(message => message.content)).toEqual(["Fix the app", "Fixed it"]);
  expect(() => cloudConversationBody(conversation)).toThrow("read-only");
});
test("cloud chat sync preserves interrupted history without trusting it as continuation", () => {
  const body = cloudConversationBody({ id: crypto.randomUUID(), title: "Chat", updatedAt: Date.now(), cloudVersion: 4, messages: [
    { role: "user", content: "Hello" }, { role: "assistant", content: "unfinished", status: "partial" },
  ] });
  expect(body.expectedVersion).toBe(4);
  expect(body.messages).toEqual([{ role: "user", content: "Hello" }, { role: "assistant", content: "unfinished", status: "partial" }]);
  expect(chatContext(body.messages)).toEqual([{ role: "user", content: "Hello" }]);
  expect(() => cloudConversationBody({ id: crypto.randomUUID(), title: "Deleted", updatedAt: 1, cloudDeleted: true, messages: [] })).toThrow("read-only");
});
test("cloud sidebar loads every page for both modes and refuses another account", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input); urls.push(url);
    const pageTwo = url.includes("cursor=");
    const coding = url.includes("mode=coding");
    return Response.json({ userId: "owner", conversations: [{ id: `${coding ? "coding" : "chat"}-${pageTwo ? 2 : 1}`, title: "Cloud conversation", mode: coding ? "coding" : "chat", version: 1, updatedAt: new Date().toISOString() }], nextCursor: !coding && !pageTwo ? "next-page" : null });
  }) as typeof fetch;
  try {
    const all = await cloudHistory("owner");
    expect(all).toHaveLength(3); expect(urls).toHaveLength(3);
    expect(all.every(chat => chat.cloudLoaded === false && chat.messages.length === 0)).toBe(true);
    await expect(cloudHistory("different-owner")).rejects.toThrow("account changed");
  } finally { globalThis.fetch = original; }
});
