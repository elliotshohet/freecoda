"use client";

import { useEffect, useState } from "react";
import {
  interfaceSizeEvent,
  interfaceSizeStorageKey,
  parseInterfaceSize,
  parseThemePreference,
  resolveTheme,
  scaleForInterfaceSize,
  themePreferenceEvent,
  themePreferenceStorageKey,
  type InterfaceSize,
  type ThemePreference,
} from "./appearance-preferences-core";
import styles from "./appearance-preferences.module.css";

function readPreference<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  try { return parse(localStorage.getItem(key)); } catch { return fallback; }
}

function setThemePreference(value: ThemePreference) {
  const preference = parseThemePreference(value);
  const theme = resolveTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = theme;
  try { localStorage.setItem(themePreferenceStorageKey, preference); } catch { /* The page still changes when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(themePreferenceEvent, { detail: preference }));
}

function setInterfaceSize(value: InterfaceSize) {
  const size = parseInterfaceSize(value);
  applyInterfaceSize(size);
  try { localStorage.setItem(interfaceSizeStorageKey, size); } catch { /* The page still changes when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(interfaceSizeEvent, { detail: size }));
}

function applyInterfaceSize(size: InterfaceSize) {
  const root = document.documentElement;
  const scale = scaleForInterfaceSize(size);
  root.dataset.interfaceSize = size;
  root.style.setProperty("--interface-font-scale", String(scale));
  // Scale rem-based interface geometry and the inherited body text baseline.
  root.style.fontSize = `${16 * scale}px`;
  if (document.body) document.body.style.fontSize = `${14 * scale}px`;
}

/** Keeps local appearance preferences in sync across routes and browser tabs. */
export function AppearanceBridge() {
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (value: ThemePreference) => {
      const preference = parseThemePreference(value);
      const theme = resolveTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = theme;
      root.dataset.themePreference = preference;
      root.style.colorScheme = theme;
    };
    const sync = () => {
      applyTheme(readPreference(themePreferenceStorageKey, parseThemePreference, "system"));
      applyInterfaceSize(readPreference(interfaceSizeStorageKey, parseInterfaceSize, "standard"));
    };
    const themeChanged = (event: Event) => applyTheme(parseThemePreference((event as CustomEvent<unknown>).detail));
    const sizeChanged = (event: Event) => applyInterfaceSize(parseInterfaceSize((event as CustomEvent<unknown>).detail));
    const systemChanged = () => {
      if (root.dataset.themePreference === "system") applyTheme("system");
    };
    const storedChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === themePreferenceStorageKey || event.key === interfaceSizeStorageKey) sync();
    };
    sync();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", systemChanged);
    window.addEventListener(themePreferenceEvent, themeChanged);
    window.addEventListener(interfaceSizeEvent, sizeChanged);
    window.addEventListener("storage", storedChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener(themePreferenceEvent, themeChanged);
      window.removeEventListener(interfaceSizeEvent, sizeChanged);
      window.removeEventListener("storage", storedChanged);
    };
  }, []);
  return null;
}

export function AppearancePreferences() {
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [size, setSize] = useState<InterfaceSize>("standard");

  useEffect(() => {
    const sync = () => {
      setTheme(readPreference(themePreferenceStorageKey, parseThemePreference, "system"));
      setSize(readPreference(interfaceSizeStorageKey, parseInterfaceSize, "standard"));
    };
    const themeChanged = (event: Event) => setTheme(parseThemePreference((event as CustomEvent<unknown>).detail));
    const sizeChanged = (event: Event) => setSize(parseInterfaceSize((event as CustomEvent<unknown>).detail));
    const storedChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === themePreferenceStorageKey || event.key === interfaceSizeStorageKey) sync();
    };
    sync();
    window.addEventListener(themePreferenceEvent, themeChanged);
    window.addEventListener(interfaceSizeEvent, sizeChanged);
    window.addEventListener("storage", storedChanged);
    return () => {
      window.removeEventListener(themePreferenceEvent, themeChanged);
      window.removeEventListener(interfaceSizeEvent, sizeChanged);
      window.removeEventListener("storage", storedChanged);
    };
  }, []);

  return <div className={styles.controls}>
    <label className={styles.control}>
      <span><strong>Color theme</strong><small>Use your device setting or choose a theme.</small></span>
      <select aria-label="Color theme" value={theme} onChange={event => setThemePreference(event.currentTarget.value as ThemePreference)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
    <label className={styles.control}>
      <span><strong>Interface text size</strong><small>Adjust the base size of the interface. This stays on this device.</small></span>
      <select aria-label="Interface text size" value={size} onChange={event => setInterfaceSize(event.currentTarget.value as InterfaceSize)}>
        <option value="small">Small</option>
        <option value="standard">Standard</option>
        <option value="large">Large</option>
      </select>
    </label>
  </div>;
}
