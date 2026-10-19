import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { signInPath } from "./sign-in-return";

export async function requireBrowserSession(returnTo = "/app") {
  const requestHeaders = await headers();
  let user;
  try {
    user = (await getAuth()?.api.getSession({ headers: requestHeaders }))?.user;
  } catch {
    redirect(signInPath(returnTo, true));
  }
  if (!user) redirect(signInPath(returnTo));
  return user;
}

/** Keep local OAuth on its configured cookie host; never change the tunnel port. */
export function canonicalLocalAuthOrigin(requestHost: string | null, configuredURL: string, environment = process.env.NODE_ENV): string | null {
  if (environment === "production" || !requestHost) return null;
  try {
    const configured = new URL(configuredURL);
    const requested = new URL(`http://${requestHost}`);
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (configured.protocol !== "http:" || !loopback.has(configured.hostname) || !loopback.has(requested.hostname) || configured.port !== requested.port || configured.host === requested.host) return null;
    return configured.origin;
  } catch {
    return null;
  }
}
