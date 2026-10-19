"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
type Preference = "system" | "light" | "dark";
const valid = (value: string | null): Preference =>
  value === "light" || value === "dark" ? value : "system";
function apply(preference: Preference) {
  const theme = preference === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = preference;
  return theme === "dark";
}
export function ThemeControl() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let current: Preference = "system";
    try { current = valid(localStorage.getItem("freecoda-theme")); } catch {}
    setDark(apply(current));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemChanged = () => { if (current === "system") setDark(apply(current)); };
    const stored = (event: StorageEvent) => {
      if (event.key === "freecoda-theme" || event.key === null) {
        current = valid(event.newValue);
        setDark(apply(current));
      }
    };
    const changed = (event: Event) => {
      current = valid((event as CustomEvent<string>).detail);
      setDark(apply(current));
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
  const label = `Switch to ${dark ? "light" : "dark"} mode`;
  return (
    <button type="button" className="theme-control" aria-label={label} title={label} onClick={() => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      setDark(apply(next));
      try { localStorage.setItem("freecoda-theme", next); } catch {}
      window.dispatchEvent(new CustomEvent("freecoda-theme", { detail: next }));
    }}>
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
