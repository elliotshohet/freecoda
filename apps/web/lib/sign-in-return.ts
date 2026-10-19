const localOrigin = "https://freecoda.invalid";
const destinations = new Set(["/app", "/chat", "/settings"]);

/** Only known local application pages may receive an authentication redirect. */
export function safeSignInReturn(value: string | null | undefined): string {
  if (!value || value.length > 4096 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/app";
  try {
    const url = new URL(value, localOrigin);
    if (url.origin !== localOrigin || !destinations.has(url.pathname)) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/app";
  }
}

export function signInPath(returnTo: string, unavailable = false): string {
  const query = new URLSearchParams({ returnTo: safeSignInReturn(returnTo) });
  if (unavailable) query.set("reason", "unavailable");
  return `/sign-in?${query.toString()}`;
}

export function browserEntryPath(path: "/app" | "/chat", params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return safeSignInReturn(`${path}${query.size ? `?${query.toString()}` : ""}`);
}
