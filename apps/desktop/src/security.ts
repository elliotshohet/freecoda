/** Navigation policy is intentionally independent of Electron for regression tests. */
export const APP_ORIGIN = "freecoda://desktop";
export const APP_URL = `${APP_ORIGIN}/index.html`;
export function isAppDocument(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "freecoda:" && u.hostname === "desktop" && u.pathname === "/index.html" && !u.username && !u.password && !u.search;
  } catch { return false; }
}
export function externalURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid link.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== "https://freecoda.com" || url.username || url.password)
    throw new Error("Only Freecoda HTTPS links can be opened here.");
  return url.toString();
}
export function assetPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "freecoda:" || u.hostname !== "desktop" || u.username || u.password || u.search) return null;
    const allowed = new Set(["/index.html", "/renderer.js", "/styles.css", "/icon.png", "/logo.svg"]);
    return allowed.has(u.pathname) ? u.pathname.slice(1) : null;
  } catch { return null; }
}
