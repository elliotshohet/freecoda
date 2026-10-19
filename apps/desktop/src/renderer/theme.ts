import type { DesktopBridge } from "../shared";
type Preference = "system" | "light" | "dark";
const key = "freecoda-theme";
const valid = (value: string | null): Preference =>
  value === "light" || value === "dark" ? value : "system";
let preference: Preference = "system";
try {
  preference = valid(localStorage.getItem(key));
} catch {
  /* Follow the system if storage is unavailable. */
}
const media = window.matchMedia("(prefers-color-scheme: dark)");
function renderTheme() {
  document.documentElement.dataset.theme =
    preference === "system" ? (media.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.themePreference = preference;
  const dark = document.documentElement.dataset.theme === "dark";
  const label = `Switch to ${dark ? "light" : "dark"} mode`;
  const button = document.getElementById("theme-toggle");
  button?.setAttribute("aria-label", label);
  button?.setAttribute("title", label);
  document.getElementById("theme-dark-icon")?.toggleAttribute("hidden", dark);
  document.getElementById("theme-light-icon")?.toggleAttribute("hidden", !dark);
}
function apply() {
  renderTheme();
  const api = (window as Window & { freecoda?: DesktopBridge }).freecoda;
  if (api?.setTheme) void api.setTheme(preference).then(() => {
    // Electron applies nativeTheme asynchronously; resample system appearance
    // after Chromium has processed the resulting media-query update.
    requestAnimationFrame(renderTheme);
  }).catch(() => {});
}
apply();
media.addEventListener("change", () => {
  if (preference === "system") renderTheme();
});
window.addEventListener("storage", (event) => {
  if (event.key !== key && event.key !== null) return;
  preference = valid(event.newValue);
  apply();

});
window.addEventListener(
  "DOMContentLoaded",
  () => {
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    renderTheme();
    button.addEventListener("click", () => {
      preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      apply();
      try {
        localStorage.setItem(key, preference);
      } catch {
        /* The current window can still change theme. */
      }
    });
  },
  { once: true },
);
