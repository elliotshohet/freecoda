"use client";

import { safeSignInReturn, signInPath } from "./sign-in-return";

/** Share the canonical-origin check across every browser GitHub entry point. */
export async function startGitHubSignIn(callbackURL = "/app") {
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (window.location.protocol === "http:" && localHosts.has(window.location.hostname)) {
    const response = await fetch("/api/auth/local-origin", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not check the local sign-in address. Try again.");
    const metadata = await response.json();
    if (typeof metadata.canonicalOrigin === "string") {
      const target = new URL(metadata.canonicalOrigin);
      if (target.protocol === "http:" && localHosts.has(target.hostname) &&
        target.port === window.location.port && target.origin !== window.location.origin) {
        window.location.assign(`${target.origin}${signInPath(safeSignInReturn(callbackURL))}`);
        return;
      }
    }
  }
  const { createAuthClient } = await import("better-auth/react");
  const result = await createAuthClient().signIn.social({
    provider: "github",
    callbackURL: safeSignInReturn(callbackURL),
    disableRedirect: true,
  });
  if (result.error) throw new Error(result.error.message || "Sign-in failed.");
  if (!result.data?.url) throw new Error("GitHub sign-in did not return an authorization URL.");
  const authorization = new URL(result.data.url);
  const callback = authorization.searchParams.get("redirect_uri");
  if (callback) {
    const target = new URL(callback);
    if (window.location.protocol === "http:" && target.protocol === "http:" &&
      localHosts.has(window.location.hostname) && localHosts.has(target.hostname) &&
      target.port === window.location.port && target.origin !== window.location.origin) {
      // Start a fresh flow on the same host that receives the OAuth callback.
      window.location.assign(`${target.origin}${signInPath(safeSignInReturn(callbackURL))}`);
      return;
    }
  }
  window.location.assign(authorization.href);
}
