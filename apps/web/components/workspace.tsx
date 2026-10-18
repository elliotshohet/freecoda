"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  KeyRound,
  Terminal,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { SponsorPlacement } from "./sponsor-placement";
type Snapshot = {
  user?: { name: string };
  configured: boolean;
  services: { label: string; ready: boolean }[];
  usage?: {
    freeRemainingMicros: number;
    dailyLimitMicros: number;
    resetAt: string;
    invited: boolean;
    devices: { id: string; name: string; createdAt: string }[];
  };
  error?: string;
};
export function Workspace() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      setError("");
      const r = await fetch("/api/v1/workspace");
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      setError("Could not reach your workspace. Refresh to try again.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(url: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error || "Please try again.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const { createAuthClient } = await import("better-auth/react");
      await createAuthClient().signIn.social(
        { provider: "github", callbackURL: "/dashboard" },
        {
          onError: (ctx) => {
            setError(ctx.error.message);
            setBusy(false);
          },
        },
      );
    } catch {
      setError("GitHub sign-in is not available yet.");
      setBusy(false);
    }
  }
  const remaining = data?.usage
    ? Math.max(
        0,
        Math.min(
          100,
          Math.floor(
            (data.usage.freeRemainingMicros /
              Math.max(1, data.usage.dailyLimitMicros)) *
              100,
          ),
        ),
      )
    : 0;
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>
            {data?.user
              ? `Welcome, ${data.user.name.split(" ")[0]}.`
              : "A home for your next idea."}
          </h1>
          <p>Your daily allowance, your devices, your next thing.</p>
        </div>
        <span className="status-badge">Free forever</span>
      </div>
      {!data && !error ? (
        <div className="panel" role="status">
          <Loader2 size={20} aria-hidden="true" /> Loading your workspace…
        </div>
      ) : (
        <div className="workspace-grid">
          <section className="panel login-panel">
            {data?.user ? (
              <>
                <div className="empty-icon">
                  <Terminal size={25} />
                </div>
                <h2>Your daily allowance</h2>
                <div className="allowance-value">
                  {remaining}% <span className="metric-label">remaining</span>
                </div>
                <div
                  className="usage-bar"
                  role="progressbar"
                  aria-valuenow={remaining}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Daily allowance remaining"
                >
                  <span style={{ width: `${remaining}%` }} />
                </div>
                <p>
                  {data.usage?.invited
                    ? "A little room to build, funded by sponsors."
                    : "Your account is ready. Hosted AI is invite-only during the beta."}{" "}
                  {data.usage?.resetAt &&
                    `Resets ${new Date(data.usage.resetAt).toLocaleString()}.`}
                </p>
                <Link className="button purple" href="/docs">
                  Connect your terminal <ArrowUpRight size={15} />
                </Link>
                <p>No paid upgrades. No card required.</p>
              </>
            ) : (
              <>
                <div className="empty-icon">
                  <Terminal size={29} />
                </div>
                <h2>Your terminal is the starting line.</h2>
                <p>
                  Sign in to see your daily allowance and connect your CLI.
                  Freecoda has one free plan, supported by direct sponsors. No
                  API key required. Hosted access is invite-only during beta.
                </p>
                <button
                  className="button dark"
                  disabled={busy || !data?.configured}
                  onClick={signIn}
                >
                  <KeyRound size={16} />
                  {data?.configured
                    ? "Continue with GitHub"
                    : "Hosted sign-in opens with the beta"}
                </button>
                <Link
                  href="/docs"
                  className="text-link"
                  style={{ marginTop: 18 }}
                >
                  Read the getting started guide <ArrowUpRight size={14} />
                </Link>
              </>
            )}
          </section>
          <aside>
            <section className="panel">
              <ShieldCheck size={23} color="var(--purple)" />
              <h2 style={{ marginTop: 14 }}>A clear view of the service.</h2>
              <p>
                These checks reflect this running instance. No sample activity
                or connected devices.
              </p>
              <ul className="setup-list">
                {data?.services.map((s) => (
                  <li key={s.label}>
                    <span>{s.label}</span>
                    <span>
                      <i className="status-dot" />
                      {s.ready ? "Configured" : "Not connected"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data?.user && (
        <section className="panel" style={{ marginTop: 22 }}>
          <h2>Connected devices</h2>
          {data.usage?.devices.length ? (
            data.usage.devices.map((d) => (
              <div key={d.id} className="device-row">
                <span>
                  {d.name}{" "}
                  <small>· {new Date(d.createdAt).toLocaleDateString()}</small>
                </span>
                <button
                  disabled={busy}
                  onClick={() => action("/api/v1/devices/revoke", { id: d.id })}
                >
                  Revoke
                </button>
              </div>
            ))
          ) : (
            <p>
              No devices yet. Run <code>freecoda login</code> to connect your
              terminal.
            </p>
          )}
          <div className="inline-form" style={{ marginTop: 25 }}>
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const { createAuthClient } =
                    await import("better-auth/react");
                  const result = await createAuthClient().signOut();
                  if (result.error)
                    throw new Error(
                      result.error.message || "Could not sign out.",
                    );
                  window.location.replace("/");
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not sign out. Please try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Sign out
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm("Delete your account and revoke all devices?")
                )
                  void action("/api/v1/account/delete");
              }}
            >
              Delete account
            </button>
          </div>
        </section>
      )}
      <SponsorPlacement />
    </>
  );
}
