"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Preference = "system" | "light" | "dark";
type Theme = "light" | "dark";
const storageKey = "freecoda-theme";
const themeEvent = "freecoda-theme";

function preference(value: string | null | undefined): Preference {
  return value === "light" || value === "dark" ? value : "system";
}

function storedPreference(): Preference {
  try {
    return preference(localStorage.getItem(storageKey));
  } catch {
    return preference(document.documentElement.dataset.themePreference);
  }
}

function apply(value: Preference): Theme {
  const theme = value === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : value;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePreference = value;
  root.style.colorScheme = theme;
  return theme;
}

function currentTheme(): Theme {
  const selected = document.documentElement.dataset.theme;
  if (selected === "light" || selected === "dark") return selected;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(changed: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = (value: Preference) => {
    apply(value);
    changed();
  };
  const systemChanged = () => {
    if (document.documentElement.dataset.themePreference === "system") update("system");
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) update(storedPreference());
  };
  const themeChanged = (event: Event) => {
    update(preference((event as CustomEvent<string>).detail));
  };
  update(storedPreference());
  media.addEventListener("change", systemChanged);
  window.addEventListener("storage", storageChanged);
  window.addEventListener(themeEvent, themeChanged);
  return () => {
    media.removeEventListener("change", systemChanged);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(themeEvent, themeChanged);
  };
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  apply(next);
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    // The current page still switches when persistent storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(themeEvent, { detail: next }));
}

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  return (
    <button
      type="button"
      className="theme-control"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
    >
      {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
