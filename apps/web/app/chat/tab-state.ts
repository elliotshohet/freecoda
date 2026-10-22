export const SCRATCH_PREFIX = "__freecoda_scratch__:";
export const FIRST_SCRATCH = `${SCRATCH_PREFIX}initial`;
export const MAX_CHAT_TABS = 32;

export type ChatTabState = {
  tabs: string[];
  active: string;
  split: string | null;
  drafts: Record<string, string>;
  nextScratch: number;
};

export function createChatTabState(initialConversationId?: string): ChatTabState {
  const scratch = FIRST_SCRATCH;
  return {
    tabs: initialConversationId ? [scratch, initialConversationId] : [scratch],
    active: initialConversationId || scratch,
    split: null,
    drafts: { [scratch]: "" },
    nextScratch: 1,
  };
}

export function openScratchTab(state: ChatTabState, canChange: boolean): ChatTabState {
  if (!canChange || state.tabs.length >= MAX_CHAT_TABS) return state;
  const key = `${SCRATCH_PREFIX}${state.nextScratch}`;
  return { ...state, tabs: [...state.tabs, key], active: key, drafts: { ...state.drafts, [key]: "" }, nextScratch: state.nextScratch + 1 };
}

export function switchChatTab(state: ChatTabState, key: string, canChange: boolean): ChatTabState {
  if (!canChange || !state.tabs.includes(key)) return state;
  return key === state.split ? { ...state, active: key, split: state.active } : { ...state, active: key };
}

export function openSplitTab(state: ChatTabState, canChange: boolean): ChatTabState {
  if (!canChange) return state;
  const existing = [...state.tabs].reverse().find((key) => key !== state.active);
  if (existing) return { ...state, split: existing };
  if (state.tabs.length >= MAX_CHAT_TABS) return state;
  const key = `${SCRATCH_PREFIX}${state.nextScratch}`;
  return { ...state, tabs: [...state.tabs, key], split: key, drafts: { ...state.drafts, [key]: "" }, nextScratch: state.nextScratch + 1 };
}

export function selectSplitTab(state: ChatTabState, key: string | null, canChange: boolean): ChatTabState {
  if (!canChange) return state;
  if (key === null) return { ...state, split: null };
  if (key === state.active || !state.tabs.includes(key)) return state;
  return { ...state, split: key };
}

export function swapSplitTabs(state: ChatTabState, canChange: boolean): ChatTabState {
  if (!canChange || !state.split || !state.tabs.includes(state.split)) return state;
  return { ...state, active: state.split, split: state.active };
}

export function updateActiveDraft(state: ChatTabState, value: string | ((current: string) => string)): ChatTabState {
  return { ...state, drafts: { ...state.drafts, [state.active]: typeof value === "function" ? value(state.drafts[state.active] || "") : value } };
}

export function closeChatTab(state: ChatTabState, key: string, canChange: boolean): ChatTabState {
  if (!canChange || !state.tabs.includes(key)) return state;
  const index = state.tabs.indexOf(key);
  let tabs = state.tabs.filter((tab) => tab !== key);
  const active = state.active === key ? (tabs[Math.max(0, index - 1)] || tabs[0] || FIRST_SCRATCH) : state.active;
  const drafts = { ...state.drafts };
  delete drafts[key];
  if (!tabs.length) { tabs = [FIRST_SCRATCH]; drafts[FIRST_SCRATCH] = ""; }
  return { ...state, tabs, active, split: state.split === key || state.split === active ? null : state.split, drafts };
}

/** Turn the active unsent scratch tab into the saved conversation created by its first send. */
export function promoteActiveScratch(state: ChatTabState, conversationId: string): ChatTabState {
  const oldKey = state.active;
  if (!oldKey.startsWith(SCRATCH_PREFIX)) return state;
  const tabs = state.tabs.map((key) => key === oldKey ? conversationId : key);
  const drafts = { ...state.drafts };
  delete drafts[oldKey];
  return { ...state, tabs: tabs.includes(conversationId) ? tabs : [...tabs, conversationId], active: conversationId, drafts };
}

export function addConversationTab(state: ChatTabState, conversationId: string): ChatTabState {
  return state.tabs.includes(conversationId) || state.tabs.length >= MAX_CHAT_TABS ? state : { ...state, tabs: [...state.tabs, conversationId] };
}

/** Add a cloud history result without stealing focus from the tab the user selected meanwhile. */
export function hydrateConversationTab(state: ChatTabState, conversationId: string): ChatTabState {
  return addConversationTab(state, conversationId);
}

export function resetChatTabState(): ChatTabState {
  return createChatTabState();
}
