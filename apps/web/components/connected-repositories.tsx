"use client";
import { useEffect, useState } from "react";

export function ConnectedRepositories() {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/web/github/repos", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Repository access is unavailable.");
        setNames((data.repos || []).map((repo: { fullName?: string; owner: string; name: string }) =>
          repo.fullName || `${repo.owner}/${repo.name}`));
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, []);
  return <section className="panel" id="connections">
    <h2>Connected repositories</h2>
    <p>Only repositories available through your existing Freecoda GitHub App access appear here.</p>
    {error ? <p role="status">{error}</p> : names === null ? <p role="status">Loading repositories…</p>
      : names.length ? <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>
        : <p>No repositories are connected.</p>}
    <a className="text-link" href="/app">Open the coding workspace to manage repository access</a>
  </section>;
}
