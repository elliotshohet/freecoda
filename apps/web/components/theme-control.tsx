"use client";
import { useEffect, useState } from "react";
type Preference = "system" | "light" | "dark";
const valid = (value: string | null): Preference =>
  value === "light" || value === "dark" ? value : "system";
function apply(preference: Preference) {
  const theme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
}
export function ThemeControl() {
  const [preference, setPreference] = useState<Preference>("system");
  useEffect(() => {
    let current: Preference = "system";
    try {
      current = valid(localStorage.getItem("freecoda-theme"));
    } catch {
      /* System remains usable if storage is blocked. */
    }
    setPreference(current);
    apply(current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemChanged = () => {
      if (current === "system") apply(current);
    };
    const stored = (event: StorageEvent) => {
      if (event.key === "freecoda-theme" || event.key === null) {
        current = valid(event.newValue);
        setPreference(current);
        apply(current);
      }
    };
    const changed = (event: Event) => {
      current = valid((event as CustomEvent<string>).detail);
    };
    media.addEventListener("change", systemChanged);
    window.addEventListener("storage", stored);
    window.addEventListener("freecoda-theme", changed);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", stored);
      window.removeEventListener("freecoda-theme", changed);
    };
  }, []);
  return (
    <label className="theme-control">
      <span aria-hidden="true">◐</span>
      <span className="sr-only">Color theme</span>
      <select
        aria-label="Color theme"
        value={preference}
        onChange={(event) => {
          const next = valid(event.target.value);
          setPreference(next);
          apply(next);
          try {
            localStorage.setItem("freecoda-theme", next);
          } catch {}
          window.dispatchEvent(
            new CustomEvent("freecoda-theme", { detail: next }),
          );
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
