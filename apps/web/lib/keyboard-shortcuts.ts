export const SHORTCUT_STORAGE_KEY = "freecoda.keyboard-shortcuts.v1";
export const SHORTCUT_PREFERENCES_EVENT = "freecoda:shortcut-preferences";

export const SHORTCUT_ACTIONS = [
  "new-chat",
  "search-chats",
  "toggle-sidebar",
  "open-settings",
  "close-chat-tab",
  "next-chat-tab",
  "previous-chat-tab",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutPreferences = {
  enabled: boolean;
  bindings: Record<ShortcutAction, string | null>;
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  "new-chat": "New chat",
  "search-chats": "Search chats",
  "toggle-sidebar": "Toggle sidebar",
  "open-settings": "Open settings",
  "close-chat-tab": "Close chat tab",
  "next-chat-tab": "Next chat tab",
  "previous-chat-tab": "Previous chat tab",
};

export const SHORTCUT_CHOICES: Record<ShortcutAction, readonly string[]> = {
  "new-chat": ["mod+shift+o", "mod+shift+n"],
  "search-chats": ["mod+k", "mod+shift+f"],
  "toggle-sidebar": ["mod+backslash", "mod+shift+b"],
  "open-settings": ["mod+comma", "mod+shift+comma"],
  "close-chat-tab": ["mod+alt+w", "mod+alt+backspace"],
  "next-chat-tab": ["mod+alt+arrowright", "mod+alt+arrowdown"],
  "previous-chat-tab": ["mod+alt+arrowleft", "mod+alt+arrowup"],
};

export const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferences = {
  enabled: true,
  bindings: {
    "new-chat": "mod+shift+o",
    "search-chats": "mod+k",
    "toggle-sidebar": "mod+backslash",
    "open-settings": "mod+comma",
    "close-chat-tab": "mod+alt+w",
    "next-chat-tab": "mod+alt+arrowright",
    "previous-chat-tab": "mod+alt+arrowleft",
  },
};

export function shortcutConflicts(preferences: ShortcutPreferences): ShortcutAction[][] {
  const owners = new Map<string, ShortcutAction[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const binding = preferences.bindings[action];
    if (!binding) continue;
    const actions = owners.get(binding) || [];
    actions.push(action);
    owners.set(binding, actions);
  }
  return [...owners.values()].filter(actions => actions.length > 1);
}

export function normalizeShortcutPreferences(value: unknown): ShortcutPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(DEFAULT_SHORTCUT_PREFERENCES);
  const record = value as { enabled?: unknown; bindings?: unknown };
  const source = record.bindings && typeof record.bindings === "object" && !Array.isArray(record.bindings)
    ? record.bindings as Record<string, unknown>
    : {};
  const bindings = { ...DEFAULT_SHORTCUT_PREFERENCES.bindings };
  for (const action of SHORTCUT_ACTIONS) {
    const candidate = source[action];
    if (candidate === null) bindings[action] = null;
    else if (typeof candidate === "string" && SHORTCUT_CHOICES[action].includes(candidate)) bindings[action] = candidate;
  }
  const preferences = { enabled: typeof record.enabled === "boolean" ? record.enabled : true, bindings };
  // Never activate ambiguous bindings from stale or hand-edited device data.
  for (const conflict of shortcutConflicts(preferences)) {
    for (const action of conflict.slice(1)) preferences.bindings[action] = null;
  }
  return preferences;
}

export function decodeShortcutPreferences(raw: string | null): ShortcutPreferences {
  if (!raw) return structuredClone(DEFAULT_SHORTCUT_PREFERENCES);
  try { return normalizeShortcutPreferences(JSON.parse(raw)); }
  catch { return structuredClone(DEFAULT_SHORTCUT_PREFERENCES); }
}

export function encodeShortcutPreferences(preferences: ShortcutPreferences): string {
  return JSON.stringify(normalizeShortcutPreferences(preferences));
}

function keyForShortcut(key: string, code?: string): string {
  // Option/Alt changes event.key on macOS; the configured letter stays physical.
  if (code && /^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (code === "Comma") return "comma";
  if (code === "Backslash") return "backslash";
  const normalized = key.toLocaleLowerCase();
  if (normalized === ",") return "comma";
  if (normalized === "\\") return "backslash";
  return normalized;
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing"> & Partial<Pick<KeyboardEvent, "code">>,
  binding: string | null,
): boolean {
  if (!binding || event.isComposing) return false;
  const parts = binding.split("+");
  const key = parts.at(-1);
  if (!key || !parts.includes("mod")) return false;
  const wantsAlt = parts.includes("alt"), wantsShift = parts.includes("shift");
  return (event.ctrlKey || event.metaKey) && event.altKey === wantsAlt && event.shiftKey === wantsShift && keyForShortcut(event.key, event.code) === key;
}

export function actionForShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing"> & Partial<Pick<KeyboardEvent, "code">>,
  preferences: ShortcutPreferences,
): ShortcutAction | null {
  if (!preferences.enabled || event.isComposing) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (matchesShortcut(event, preferences.bindings[action])) return action;
  }
  return null;
}

export function formatShortcut(binding: string): string {
  const labels: Record<string, string> = {
    mod: "Ctrl / ⌘", alt: "Alt / ⌥", shift: "Shift", comma: ",", backslash: "\\",
    arrowright: "→", arrowleft: "←", arrowup: "↑", arrowdown: "↓", backspace: "Backspace",
  };
  return binding.split("+").map(part => labels[part] || part.toLocaleUpperCase()).join(" + ");
}
