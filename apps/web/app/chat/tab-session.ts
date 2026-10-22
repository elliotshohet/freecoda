import { addConversationTab, FIRST_SCRATCH, MAX_CHAT_TABS, SCRATCH_PREFIX, switchChatTab, type ChatTabState } from "./tab-state";

export const CHAT_TAB_SESSION_VERSION = 1;
export const CHAT_TAB_SESSION_MAX_TABS = MAX_CHAT_TABS;
export const CHAT_TAB_DRAFT_MAX_LENGTH = 8000;
export const CHAT_TAB_SESSION_MAX_SERIALIZED_LENGTH = 2_000_000;

export function restoreExplicitThread(state: ChatTabState, threadId: string): { state: ChatTabState; unavailable: boolean } {
  if (state.tabs.includes(threadId)) return { state: switchChatTab(state, threadId, true), unavailable: false };
  if (state.tabs.length >= MAX_CHAT_TABS) return { state, unavailable: true };
  const opened = addConversationTab(state, threadId);
  return { state: switchChatTab(opened, threadId, true), unavailable: false };
}

type StoredChatTabState = ChatTabState & { version: number; owner: string };

export function chatTabSessionKey(owner: string): string {
  return `freecoda.chat-tabs.v${CHAT_TAB_SESSION_VERSION}.${encodeURIComponent(owner)}`;
}

function validTabKey(key: unknown): key is string {
  if (typeof key !== "string" || !key || key.length > 200) return false;
  if (key.startsWith(SCRATCH_PREFIX)) return key === FIRST_SCRATCH || new RegExp(`^${SCRATCH_PREFIX}[1-9][0-9]{0,8}$`).test(key);
  return true;
}

export function encodeChatTabSession(state: ChatTabState, owner: string): string | null {
  if (!owner || owner.length > 200 || state.tabs.length > CHAT_TAB_SESSION_MAX_TABS || !state.tabs.length) return null;
  if (new Set(state.tabs).size !== state.tabs.length || !state.tabs.every(validTabKey)) return null;
  if (!state.tabs.includes(state.active) || (state.split !== null && (!state.tabs.includes(state.split) || state.split === state.active))) return null;
  if (!Number.isInteger(state.nextScratch) || state.nextScratch < 1 || state.nextScratch > 1_000_000_000) return null;
  const scratchNumbers = state.tabs.filter(key => key.startsWith(SCRATCH_PREFIX) && key !== FIRST_SCRATCH).map(key => Number(key.slice(SCRATCH_PREFIX.length)));
  if (scratchNumbers.some(number => number >= state.nextScratch)) return null;
  const entries = Object.entries(state.drafts);
  if (entries.length > CHAT_TAB_SESSION_MAX_TABS || entries.some(([key, draft]) => !state.tabs.includes(key) || typeof draft !== "string" || draft.length > CHAT_TAB_DRAFT_MAX_LENGTH)) return null;
  const stored: StoredChatTabState = { ...state, version: CHAT_TAB_SESSION_VERSION, owner };
  const raw = JSON.stringify(stored);
  return raw.length <= CHAT_TAB_SESSION_MAX_SERIALIZED_LENGTH ? raw : null;
}

export function decodeChatTabSession(raw: string | null, expectedOwner: string): ChatTabState | null {
  if (!raw || raw.length > CHAT_TAB_SESSION_MAX_SERIALIZED_LENGTH || !expectedOwner || expectedOwner.length > 200) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredChatTabState>;
    if (!stored || stored.version !== CHAT_TAB_SESSION_VERSION || stored.owner !== expectedOwner ||
      !Array.isArray(stored.tabs) || !stored.tabs.length || stored.tabs.length > CHAT_TAB_SESSION_MAX_TABS ||
      !stored.tabs.every(validTabKey) || new Set(stored.tabs).size !== stored.tabs.length ||
      typeof stored.active !== "string" || !stored.tabs.includes(stored.active) ||
      !(stored.split === null || (typeof stored.split === "string" && stored.tabs.includes(stored.split) && stored.split !== stored.active)) ||
      !Number.isInteger(stored.nextScratch) || Number(stored.nextScratch) < 1 || Number(stored.nextScratch) > 1_000_000_000 ||
      !stored.drafts || typeof stored.drafts !== "object" || Array.isArray(stored.drafts)) return null;
    const scratchNumbers = stored.tabs.filter(key => key.startsWith(SCRATCH_PREFIX) && key !== FIRST_SCRATCH).map(key => Number(key.slice(SCRATCH_PREFIX.length)));
    if (scratchNumbers.some(number => number >= Number(stored.nextScratch))) return null;
    const drafts = stored.drafts as Record<string, unknown>;
    const entries = Object.entries(drafts);
    if (entries.length > CHAT_TAB_SESSION_MAX_TABS || entries.some(([key, draft]) => !stored.tabs!.includes(key) || typeof draft !== "string" || draft.length > CHAT_TAB_DRAFT_MAX_LENGTH)) return null;
    return {
      tabs: [...stored.tabs],
      active: stored.active,
      split: stored.split,
      nextScratch: Number(stored.nextScratch),
      drafts: Object.fromEntries(entries as [string, string][]),
    };
  } catch {
    return null;
  }
}
