import { describe, expect, test } from "bun:test";
import { CHAT_TAB_SESSION_MAX_TABS, decodeChatTabSession, encodeChatTabSession, restoreExplicitThread } from "../apps/web/app/chat/tab-session";
import { createChatTabState, FIRST_SCRATCH, MAX_CHAT_TABS, openScratchTab, selectSplitTab } from "../apps/web/app/chat/tab-state";

describe("chat tab session explicit thread restoration", () => {
  test("switching to the linked secondary pane swaps the pane keys and keeps the session valid", () => {
    let state = createChatTabState("conversation-a");
    state = { ...state, tabs: [...state.tabs, "conversation-b"], drafts: { ...state.drafts, "conversation-b": "draft B" } };
    state = selectSplitTab(state, "conversation-b", true);

    const restored = restoreExplicitThread(state, "conversation-b");

    expect(restored.unavailable).toBe(false);
    expect(restored.state.active).toBe("conversation-b");
    expect(restored.state.split).toBe("conversation-a");
    expect(restored.state.drafts["conversation-b"]).toBe("draft B");
    expect(decodeChatTabSession(encodeChatTabSession(restored.state, "owner-a"), "owner-a")).toEqual(restored.state);
  });

  test("a full session preserves every tab and draft when a missing explicit thread cannot be opened", () => {
    let state = createChatTabState();
    state = { ...state, drafts: { ...state.drafts, [FIRST_SCRATCH]: "draft 0" } };
    while (state.tabs.length < MAX_CHAT_TABS) {
      state = openScratchTab(state, true);
      state = { ...state, drafts: { ...state.drafts, [state.active]: `draft ${state.tabs.length}` } };
    }
    const before = structuredClone(state);

    const restored = restoreExplicitThread(state, "missing-conversation");

    expect(restored.unavailable).toBe(true);
    expect(restored.state).toBe(state);
    expect(restored.state).toEqual(before);
    const encoded = encodeChatTabSession(restored.state, "owner-a");
    expect(encoded).not.toBeNull();
    expect(decodeChatTabSession(encoded, "owner-a")).toEqual(before);
    expect(restored.state.tabs).toHaveLength(CHAT_TAB_SESSION_MAX_TABS);
  });
});
