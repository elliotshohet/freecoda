"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Recheck restored tabs and expired sessions before exposing private UI. */
export function SessionBoundary({ userId, children }: {
  userId: string;
  children: React.ReactNode;
}) {
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    let controller: AbortController | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      setVerified(false);
      setError(false);
      try {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Session unavailable");
        const session = await response.json();
        if (!alive) return;
        if (!session?.user?.id) {
          window.location.replace("/?signin=required");
          return;
        }
        if (session.user.id !== userId) {
          window.location.reload();
          return;
        }
        clearTimeout(expiry);
        const remaining = new Date(session.session?.expiresAt).getTime() - Date.now();
        if (Number.isFinite(remaining)) expiry = setTimeout(check, Math.max(0, remaining));
        setVerified(true);
      } catch (error) {
        if (alive && !(error instanceof DOMException && error.name === "AbortError"))
          setError(true);
      }
    };
    const hide = () => setVerified(false);
    const visible = () => {
      if (document.visibilityState === "visible") void check();
      else hide();
    };
    void check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      controller?.abort();
      clearTimeout(expiry);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId]);
  if (!verified) return (
    <main className="page-shell" id="main">
      <section className="panel" role={error ? "alert" : "status"}>
        <h1>{error ? "We couldn’t verify your session." : "Opening your account…"}</h1>
        {error && <><p>Your workspace stays private until your session is verified.</p>
          <button className="button secondary" onClick={() => window.location.reload()}>Try again</button>{" "}
          <Link className="button purple" href="/">Back to sign in</Link></>}
      </section>
    </main>
  );
  return children;
}
