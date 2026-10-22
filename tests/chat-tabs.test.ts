import { describe, expect, it } from "bun:test";
import {
  closeChatTab,
  createChatTabState,
  hydrateConversationTab,
  openScratchTab,
  openSplitTab,
  promoteActiveScratch,
  resetChatTabState,
  switchChatTab,
  selectSplitTab,
  swapSplitTabs,
  updateActiveDraft,
  FIRST_SCRATCH,
} from "../apps/web/app/chat/tab-state";

describe("chat tab state", () => {
  it("keeps independent scratch drafts and promotes the first-send tab to its conversation", () => {
    let state = updateActiveDraft(createChatTabState(), "unsent draft one");
    state = openScratchTab(state, true);
    const secondScratch = state.active;
    state = updateActiveDraft(state, "unsent draft two");
    state = switchChatTab(state, FIRST_SCRATCH, true);
    state = switchChatTab(state, secondScratch, true);
    expect(state.active).toBe(secondScratch);
    expect(state.drafts[state.active]).toBe("unsent draft two");
    state = switchChatTab(state, FIRST_SCRATCH, true);
    state = promoteActiveScratch(state, "conversation-1");

    expect(state.active).toBe("conversation-1");
    expect(state.tabs).toEqual(["conversation-1", secondScratch]);
    expect(state.drafts[secondScratch]).toBe("unsent draft two");
    expect(state.drafts[FIRST_SCRATCH]).toBeUndefined();
  });

  it("clears all open tabs and drafts when account state is reset", () => {
    const state = updateActiveDraft(openScratchTab(createChatTabState("thread-a"), true), "private draft");
    const reset = resetChatTabState();
    expect(reset.tabs).toEqual([FIRST_SCRATCH]);
    expect(reset.active).toBe(FIRST_SCRATCH);
    expect(reset.drafts).toEqual({ [FIRST_SCRATCH]: "" });
    expect(state.drafts[state.active]).toBe("private draft");
  });

  it("chooses a neighboring tab when closing active and creates a scratch tab when closing the last", () => {
    let state = createChatTabState("thread-a");
    state = closeChatTab(state, "thread-a", true);
    expect(state.active).toBe(FIRST_SCRATCH);
    expect(state.tabs).toEqual([FIRST_SCRATCH]);

    state = closeChatTab(state, FIRST_SCRATCH, true);
    expect(state.tabs).toEqual([FIRST_SCRATCH]);
    expect(state.active).toBe(FIRST_SCRATCH);
    expect(state.drafts[FIRST_SCRATCH]).toBe("");
  });

  it("blocks switch, close, and new-tab mutations while sending or queued", () => {
    const state = createChatTabState("thread-a");
    expect(switchChatTab(state, "thread-a", false)).toBe(state);
    expect(closeChatTab(state, "thread-a", false)).toBe(state);
    expect(openScratchTab(state, false)).toBe(state);
  });

  it("hydrates delayed history without stealing focus or replacing a draft", () => {
    let state = createChatTabState();
    state = updateActiveDraft(state, "working draft");
    state = openScratchTab(state, true);
    const selectedWhileLoading = state.active;
    state = hydrateConversationTab(state, "loaded-thread");
    state = hydrateConversationTab(state, "loaded-thread");
    expect(state.active).toBe(selectedWhileLoading);
    expect(state.drafts[selectedWhileLoading]).toBe("");
    expect(state.drafts[FIRST_SCRATCH]).toBe("working draft");
    expect(state.tabs.filter(tab => tab === "loaded-thread")).toHaveLength(1);
  });

  it("opens a secondary view, selects another tab, and swaps pane ownership without moving drafts", () => {
    let state = updateActiveDraft(createChatTabState("thread-a"), "draft A");
    state = updateActiveDraft(switchChatTab(state, FIRST_SCRATCH, true), "scratch draft");
    state = openSplitTab(state, true);
    expect(state.active).toBe(FIRST_SCRATCH);
    expect(state.split).toBe("thread-a");
    state = selectSplitTab(state, "thread-a", true);
    state = swapSplitTabs(state, true);
    expect(state.active).toBe("thread-a");
    expect(state.split).toBe(FIRST_SCRATCH);
    expect(state.drafts["thread-a"]).toBe("draft A");
    expect(state.drafts[FIRST_SCRATCH]).toBe("scratch draft");
  });

  it("creates a second scratch tab for split view and clears the pane when its tab closes", () => {
    let state = openSplitTab(createChatTabState(), true);
    expect(state.split).not.toBeNull();
    expect(state.active).toBe(FIRST_SCRATCH);
    const secondary = state.split!;
    state = updateActiveDraft({ ...state, active: secondary }, "comparison draft");
    state = closeChatTab(state, secondary, true);
    expect(state.split).toBeNull();
    expect(state.drafts[secondary]).toBeUndefined();
  });

  it("keeps split view unchanged while sending and resets it with account state", () => {
    const state = openSplitTab(createChatTabState(), true);
    expect(selectSplitTab(state, null, false)).toBe(state);
    expect(swapSplitTabs(state, false)).toBe(state);
    expect(resetChatTabState().split).toBeNull();
  });

  it("closes only the split pane and preserves its conversation and draft", () => {
    let state = createChatTabState("thread-a");
    state = selectSplitTab(state, FIRST_SCRATCH, true);
    state = updateActiveDraft({ ...state, active: FIRST_SCRATCH }, "saved scratch text");
    state = selectSplitTab(state, null, true);
    expect(state.split).toBeNull();
    expect(state.tabs).toEqual([FIRST_SCRATCH, "thread-a"]);
    expect(state.drafts[FIRST_SCRATCH]).toBe("saved scratch text");
  });
});
