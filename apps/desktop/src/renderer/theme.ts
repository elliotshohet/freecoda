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
  const select = document.getElementById(
    "theme-select",
  ) as HTMLSelectElement | null;
  if (select) select.value = preference;
});
window.addEventListener(
  "DOMContentLoaded",
  () => {
    const select = document.getElementById(
      "theme-select",
    ) as HTMLSelectElement | null;
    if (!select) return;
    select.value = preference;
    select.addEventListener("change", () => {
      preference = valid(select.value);
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
