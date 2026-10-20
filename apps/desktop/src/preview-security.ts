export type PreviewBounds = { x: number; y: number; width: number; height: number };
export function previewURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw Error("Enter an HTTP or HTTPS preview URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw Error("Enter an HTTP or HTTPS preview URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) throw Error("Enter an HTTP or HTTPS preview URL without credentials.");
  return url.toString();
}
export function previewBounds(value: unknown, width: number, height: number): PreviewBounds {
  const bounds = value as PreviewBounds | undefined;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(n => typeof n === "number" && Number.isFinite(n)) || bounds.width <= 0 || bounds.height <= 0) throw Error("Preview requires a visible content area.");
  const x = Math.max(0, Math.min(width - 1, Math.round(bounds.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(bounds.y)));
  return { x, y, width: Math.max(1, Math.min(width - x, Math.round(bounds.width))), height: Math.max(1, Math.min(height - y, Math.round(bounds.height))) };
}
