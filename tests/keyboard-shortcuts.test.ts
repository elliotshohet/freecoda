import { describe, expect, it } from "bun:test";
import {
  actionForShortcut,
  decodeShortcutPreferences,
  DEFAULT_SHORTCUT_PREFERENCES,
  encodeShortcutPreferences,
  matchesShortcut,
  normalizeShortcutPreferences,
  shortcutConflicts,
} from "../apps/web/lib/keyboard-shortcuts";

const keyEvent = (key: string, options: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...options,
}) as KeyboardEvent;

describe("keyboard shortcut preferences", () => {
  it("matches the platform modifier combos and maps them to actions", () => {
    expect(actionForShortcut(keyEvent("o", { ctrlKey: true, shiftKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("new-chat");
    expect(actionForShortcut(keyEvent("k", { metaKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("search-chats");
    expect(actionForShortcut(keyEvent("\\", { ctrlKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("toggle-sidebar");
    expect(actionForShortcut(keyEvent(",", { metaKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("open-settings");
    expect(actionForShortcut(keyEvent("ArrowRight", { metaKey: true, altKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("next-chat-tab");
    expect(actionForShortcut(keyEvent("∑", { code: "KeyW", metaKey: true, altKey: true }), DEFAULT_SHORTCUT_PREFERENCES)).toBe("close-chat-tab");
    expect(matchesShortcut(keyEvent("<", { code: "Comma", metaKey: true, shiftKey: true }), "mod+shift+comma")).toBe(true);
  });

  it("never matches plain typing, composing input, or a key with the wrong modifiers", () => {
    expect(matchesShortcut(keyEvent("k"), "mod+k")).toBe(false);
    expect(matchesShortcut(keyEvent("k", { ctrlKey: true, isComposing: true }), "mod+k")).toBe(false);
    expect(matchesShortcut(keyEvent("k", { ctrlKey: true, shiftKey: true }), "mod+k")).toBe(false);
    expect(matchesShortcut(keyEvent("o", { ctrlKey: true }), "mod+shift+o")).toBe(false);
  });

  it("supports disabling shortcuts and the global shortcut switch", () => {
    const preferences = normalizeShortcutPreferences({ enabled: false, bindings: { "new-chat": null } });
    expect(actionForShortcut(keyEvent("o", { ctrlKey: true, shiftKey: true }), preferences)).toBeNull();
    const disabledBinding = normalizeShortcutPreferences({ enabled: true, bindings: { "new-chat": null } });
    expect(actionForShortcut(keyEvent("o", { ctrlKey: true, shiftKey: true }), disabledBinding)).toBeNull();
  });

  it("rejects unpermitted keys and removes conflicting stored bindings", () => {
    const normalized = normalizeShortcutPreferences({
      enabled: true,
      bindings: { "new-chat": "alt+f4", "search-chats": "mod+k", "toggle-sidebar": "mod+k" },
    });
    expect(normalized.bindings["new-chat"]).toBe(DEFAULT_SHORTCUT_PREFERENCES.bindings["new-chat"]);
    expect(normalized.bindings["search-chats"]).toBe("mod+k");
    expect(normalized.bindings["toggle-sidebar"]).toBe(DEFAULT_SHORTCUT_PREFERENCES.bindings["toggle-sidebar"]);
    const conflicting = { ...normalized, bindings: { ...normalized.bindings, "toggle-sidebar": "mod+k" } };
    expect(shortcutConflicts(conflicting)).toEqual([["search-chats", "toggle-sidebar"]]);
  });

  it("round-trips valid device preferences and falls back for corrupt storage", () => {
    const custom = normalizeShortcutPreferences({ enabled: true, bindings: { "new-chat": "mod+shift+n", "close-chat-tab": null } });
    expect(decodeShortcutPreferences(encodeShortcutPreferences(custom))).toEqual(custom);
    expect(decodeShortcutPreferences("{broken")).toEqual(DEFAULT_SHORTCUT_PREFERENCES);
    expect(decodeShortcutPreferences(null)).toEqual(DEFAULT_SHORTCUT_PREFERENCES);
  });
});
