"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_SHORTCUT_PREFERENCES,
  decodeShortcutPreferences,
  encodeShortcutPreferences,
  formatShortcut,
  SHORTCUT_ACTIONS,
  SHORTCUT_CHOICES,
  SHORTCUT_LABELS,
  SHORTCUT_PREFERENCES_EVENT,
  SHORTCUT_STORAGE_KEY,
  shortcutConflicts,
  type ShortcutAction,
  type ShortcutPreferences,
} from "@/lib/keyboard-shortcuts";
import styles from "./keyboard-shortcuts.module.css";

function readPreferences(): ShortcutPreferences {
  try { return decodeShortcutPreferences(window.localStorage.getItem(SHORTCUT_STORAGE_KEY)); }
  catch { return structuredClone(DEFAULT_SHORTCUT_PREFERENCES); }
}

export function KeyboardShortcuts() {
  const [preferences, setPreferences] = useState<ShortcutPreferences>(DEFAULT_SHORTCUT_PREFERENCES);
  const [storageAvailable, setStorageAvailable] = useState(true);

  useEffect(() => {
    const sync = () => setPreferences(readPreferences());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SHORTCUT_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function save(next: ShortcutPreferences) {
    const conflicts = shortcutConflicts(next);
    if (conflicts.length) return;
    setPreferences(next);
    try {
      window.localStorage.setItem(SHORTCUT_STORAGE_KEY, encodeShortcutPreferences(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    window.dispatchEvent(new CustomEvent(SHORTCUT_PREFERENCES_EVENT));
  }

  function changeBinding(action: ShortcutAction, value: string) {
    const binding = value || null;
    if (binding && SHORTCUT_ACTIONS.some(other => other !== action && preferences.bindings[other] === binding)) return;
    save({ ...preferences, bindings: { ...preferences.bindings, [action]: binding } });
  }

  return <div className={styles.root}>
    <div className={styles.intro}>
      <p>Choose shortcuts for common chat actions. They stay on this device and sync to other tabs in this browser.</p>
      <label className={styles.enabled}>
        <input type="checkbox" checked={preferences.enabled} onChange={event => save({ ...preferences, enabled: event.currentTarget.checked })} />
        <span><strong>Enable keyboard shortcuts</strong><small>Shortcuts use Ctrl on Windows/Linux and ⌘ on Mac, and work while typing.</small></span>
      </label>
    </div>
    <div className={styles.rows}>
      {SHORTCUT_ACTIONS.map(action => <label className={styles.row} key={action}>
        <span><strong>{SHORTCUT_LABELS[action]}</strong><small>Default: {formatShortcut(DEFAULT_SHORTCUT_PREFERENCES.bindings[action]!)}</small></span>
        <select aria-label={`${SHORTCUT_LABELS[action]} shortcut`} value={preferences.bindings[action] || ""} disabled={!preferences.enabled} onChange={event => changeBinding(action, event.currentTarget.value)}>
          <option value="">Disabled</option>
          {SHORTCUT_CHOICES[action].map(binding => {
            const conflict = SHORTCUT_ACTIONS.some(other => other !== action && preferences.bindings[other] === binding);
            return <option value={binding} disabled={conflict} key={binding}>{formatShortcut(binding)}{conflict ? " · used by another action" : ""}</option>;
          })}
        </select>
      </label>)}
    </div>
    <div className={styles.footer}>
      <button type="button" onClick={() => save(structuredClone(DEFAULT_SHORTCUT_PREFERENCES))}>Reset defaults</button>
      <span role="status">{!storageAvailable ? "Could not save shortcuts in this browser." : "Settings are saved on this device."}</span>
    </div>
  </div>;
}
