"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

/** Account entry must not depend on chat availability or its status request. */
export function GitHubSignIn({
  callbackURL = "/chat",
  label = "Continue with GitHub",
}: {
  callbackURL?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { createAuthClient } = await import("better-auth/react");
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL,
      });
      if (result.error) throw new Error(result.error.message || "Sign-in failed.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Sign-in failed.");
      setBusy(false);
    }
  }
  return (
    <div className="entry-sign-in">
      <button className="button purple" disabled={busy} onClick={signIn}>
        <KeyRound size={16} aria-hidden="true" />
        {busy ? "Opening GitHub…" : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
