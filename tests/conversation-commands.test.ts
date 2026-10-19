import { describe, expect, test } from "bun:test";
import { conversationCommandsFor, filterConversationCommands, parseConversationCommand, parseSkillInstallIntent, parsePluginInstallIntent, codexUnsupportedCommand } from "../packages/contracts/src/conversation-commands";

describe("conversation command discovery", () => {
  test("advertises only capabilities implemented on the selected client", () => {
    expect(conversationCommandsFor("web").some(command => command.name === "/terminal")).toBe(false);
    expect(conversationCommandsFor("web").some(command => command.name === "/update")).toBe(false);
    expect(conversationCommandsFor("cli").some(command => command.name === "/update")).toBe(true);
    expect(conversationCommandsFor("desktop").some(command => command.name === "/suspend")).toBe(false);
    expect(conversationCommandsFor("desktop").some(command => command.name === "/project")).toBe(true);
    expect(new Set(conversationCommandsFor("web").map(command => command.name)).size).toBe(conversationCommandsFor("web").length);
  });
  test("filters names and descriptions with bounded suggestion lists", () => {
    expect(filterConversationCommands("/perm", "web")[0]?.name).toBe("/permissions");
    expect(filterConversationCommands("repository", "desktop").some(command => command.name === "/project")).toBe(true);
    expect(filterConversationCommands("/skills install", "web")).toEqual([]);
    expect(filterConversationCommands("/", "web", 3)).toHaveLength(3);
  });
  test("parses intent without executing, authorizing, or treating unknown commands as prompts", () => {
    expect(parseConversationCommand("hello /tools")).toBeNull();
    expect(parseConversationCommand(" /SYNC pull ")).toEqual({ name: "/sync", argument: "pull" });
    expect(parseConversationCommand("/unknown data")).toEqual({ name: "/unknown", argument: "data" });
    expect(parseSkillInstallIntent("Install this skill https://github.com/example/skill")).toEqual({ source: "https://github.com/example/skill" });
    expect(parseSkillInstallIntent("/skills install")).toEqual({ source: null });
    expect(parseSkillInstallIntent("please explain how to install this skill")).toBeNull();
    expect(parsePluginInstallIntent("/plugins install https://example.com/plugin.json")).toEqual({ source: "https://example.com/plugin.json" });
    expect(parsePluginInstallIntent("install this plugin")).toEqual({ source: null });
  });
  test("keeps saved-chat resume separate from cloud compute", () => {
    for (const client of ["web", "desktop", "cli"] as const) {
      const commands = conversationCommandsFor(client);
      expect(commands.find(command => command.name === "/resume")?.description).toContain("saved conversation");
      for (const name of ["/clear", "/copy", "/diff", "/pwd", "/cwd"]) {
        expect(commands.some(command => command.name === name)).toBe(true);
      }
    }
    expect(conversationCommandsFor("web").find(command => command.name === "/start")?.description).toContain("compute");
    expect(conversationCommandsFor("desktop").some(command => command.name === "/start")).toBe(false);
  });
  test("returns honest limitations without advertising unsupported commands", () => {
    const unsupported = ["/fork", "/compact", "/agents", "/subagents", "/goal", "/worktree", "/fast", "/apps", "/init", "/rename", "/archive", "/delete", "/import", "/approve"];
    for (const name of unsupported) {
      expect(codexUnsupportedCommand(name)).toContain("Freecoda does not");
      for (const client of ["web", "desktop", "cli"] as const) {
        expect(conversationCommandsFor(client).some(command => command.name === name)).toBe(false);
      }
    }
    expect(codexUnsupportedCommand(" /APPROVE ")).toContain("specific pending action");
    expect(codexUnsupportedCommand("goal")).toContain("goal budgets");
    expect(codexUnsupportedCommand("/resume")).toBeNull();
    expect(codexUnsupportedCommand("/not-a-command")).toBeNull();
    expect(codexUnsupportedCommand("/__proto__")).toBeNull();
    expect(codexUnsupportedCommand("/approve this")).toBeNull();
  });

});
