"use client";

import { useEffect } from "react";
import { actionForShortcut, decodeShortcutPreferences, SHORTCUT_PREFERENCES_EVENT, SHORTCUT_STORAGE_KEY } from "@/lib/keyboard-shortcuts";

export function ShortcutBridge() {
  useEffect(() => {
    const read = () => {
      try { return decodeShortcutPreferences(window.localStorage.getItem(SHORTCUT_STORAGE_KEY)); }
      catch { return decodeShortcutPreferences(null); }
    };
    let preferences = read();
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHORTCUT_STORAGE_KEY || event.key === null) {
        preferences = decodeShortcutPreferences(event.key === null ? null : event.newValue);
      }
    };
    const onPreferencesChanged = () => { preferences = read(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const action = actionForShortcut(event, preferences);
      if (!action) return;
      const shortcut = new CustomEvent("freecoda:shortcut", { detail: { action }, cancelable: true });
      window.dispatchEvent(shortcut);
      if (shortcut.defaultPrevented) event.preventDefault();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(SHORTCUT_PREFERENCES_EVENT, onPreferencesChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(SHORTCUT_PREFERENCES_EVENT, onPreferencesChanged);
    };
  }, []);
  return null;
}
