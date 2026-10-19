"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Recheck restored tabs and expired sessions before exposing private UI. */
export function SessionBoundary({ userId, children }: {
  userId: string;
  children: React.ReactNode;
}) {
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [accountChanged, setAccountChanged] = useState(false);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (controller) return;
      const current = new AbortController();
      controller = current;
      setError(false);
      try {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store", signal: current.signal,
        });
        if (!response.ok) throw new Error("Session unavailable");
        const session = await response.json();
        if (!alive) return;
        if (!session?.user?.id) {
          window.location.replace("/?signin=required");
          return;
        }
        if (session.user.id !== userId) {
          setVerifiedFor(null);
          setAccountChanged(true);
          return;
        }
        clearTimeout(expiry);
        const remaining = new Date(session.session?.expiresAt).getTime() - Date.now();
        if (!Number.isFinite(remaining) || remaining <= 0) {
          setVerifiedFor(null);
          setError(true);
          return;
        }
        expiry = setTimeout(check, Math.min(remaining, 2_147_483_647));
        setAccountChanged(false);
        setVerifiedFor(userId);
      } catch (error) {
        if (alive && !(error instanceof DOMException && error.name === "AbortError"))
          setError(true);
      } finally {
        if (controller === current) controller = undefined;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      controller?.abort();
      clearTimeout(expiry);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId]);
  if (verifiedFor !== userId) return (
    <main className="page-shell" id="main">
      <section className="panel" role={error ? "alert" : "status"}>
        <h1>{accountChanged ? "Your signed-in account changed." : error ? "We couldn’t verify your session." : "Opening your account…"}</h1>
        {(error || accountChanged) && <><p>{accountChanged ? "Reload once to open the current account’s workspace." : "Your workspace stays private until your session is verified."}</p>
          <button className="button secondary" onClick={() => window.location.reload()}>Try again</button>{" "}
          <Link className="button purple" href="/">Back to sign in</Link></>}
      </section>
    </main>
  );
  return <>
    {error && <div className="session-check-warning" role="status"
      style={{ position: "fixed", zIndex: 50, top: 8, left: "50%", transform: "translateX(-50%)", padding: "8px 12px", borderRadius: 8, background: "#3b2b12", color: "#fff", maxWidth: "min(90vw, 620px)" }}>
        We couldn’t refresh your session status. Your workspace is still open; try again if an action is rejected.
    </div>}
    {children}
  </>;
}
