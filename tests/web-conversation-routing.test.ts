import { describe, expect, test } from "bun:test";
import { interceptWebConversationInput } from "../apps/web/app/app/conversation-routing";

describe("unified web conversation routing", () => {
  test("project commands bypass inference and preserve queued prompts", () => {
    const queue = [{ id: "pending", text: "Keep this message", model: "beam" }];
    const project: string[] = [];
    const conversation: string[] = [];
    function submit(text: string) {
      if (interceptWebConversationInput(text, { project: value => project.push(value), conversation: value => conversation.push(value) })) return;
      queue.push({ id: "next", text, model: "beam" });
    }
    for (const text of ["/project", "/build", "/plan", "/review", "/files", "/tools", "/mcp", "/permissions", "/sync pull", "/mode plan"]) submit(text);
    expect(project).toEqual(["/project", "/build", "/plan", "/review", "/files", "/tools", "/mcp", "/permissions", "/sync pull", "/mode plan"]);
    expect(conversation).toEqual([]);
    expect(queue).toEqual([{ id: "pending", text: "Keep this message", model: "beam" }]);
    submit("Explain a closure");
    expect(queue.at(-1)?.text).toBe("Explain a closure");
    expect(project).toHaveLength(10);
  });

  test("skill installation opens review without treating instructions as a model prompt", () => {
    const project: string[] = [];
    const conversation: string[] = [];
    const handlers = { project: (value: string) => project.push(value), conversation: (value: string) => conversation.push(value) };
    expect(interceptWebConversationInput("install this skill https://github.com/example/skills/blob/main/SKILL.md", handlers)).toBe(true);
    expect(project).toEqual(["/skills install https://github.com/example/skills/blob/main/SKILL.md"]);
    expect(interceptWebConversationInput("/skills install https://example.com/SKILL.md", handlers)).toBe(true);
    expect(project[1]).toBe("/skills install https://example.com/SKILL.md");
    expect(conversation).toEqual([]);
  });

  test("general chat and unknown commands never grant project access", () => {
    const project: string[] = [];
    const conversation: string[] = [];
    const handlers = { project: (value: string) => project.push(value), conversation: (value: string) => conversation.push(value) };
    for (const value of ["/chat", "/new", "/unknown", "/UPDATE", "/", "/model reflection/beam-2"]) expect(interceptWebConversationInput(value, handlers)).toBe(true);
    expect(project).toEqual([]);
    expect(conversation).toEqual(["/chat", "/new", "/unknown", "/UPDATE", "/", "/model reflection/beam-2"]);
    expect(interceptWebConversationInput("Explain my repository", handlers)).toBe(false);
    expect(project).toEqual([]);
  });
  test("Codex resume opens history while start controls cloud compute and diff opens inspection", () => {
    const project: string[] = [], conversation: string[] = [];
    const handlers = { project: (value: string) => project.push(value), conversation: (value: string) => conversation.push(value) };
    for (const value of ["/resume", "/start", "/diff", "/copy", "/clear", "/fork"]) expect(interceptWebConversationInput(value, handlers)).toBe(true);
    expect(project).toEqual(["/start", "/diff"]);
    expect(conversation).toEqual(["/resume", "/copy", "/clear", "/fork"]);
  });

});
