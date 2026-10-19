"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, GitBranch, Trash2 } from "lucide-react";
import { GitHubSignIn } from "./github-sign-in";
import styles from "./connected-repositories.module.css";
type Repository = { repositoryId: number; installationId: number; owner: string; name: string; defaultBranch: string };
type Setting = Omit<Repository, "defaultBranch"> & { branch: string; appDirectory: string; enabled: boolean };
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/v1/github/${path}`, { method: body === undefined ? "GET" : "PUT", cache: "no-store", signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Repository access is unavailable.");
  return data;
}
export function ConnectedRepositories() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [installUrl, setInstallUrl] = useState("");
  const [error, setError] = useState("");
  const [accessWarning, setAccessWarning] = useState("");
  const [reconnectGitHub, setReconnectGitHub] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setAccessWarning(""); setReconnectGitHub(false); setLoaded(false);
    try {
      const [accessResult, configuredResult] = await Promise.allSettled([
        request("repos", undefined, signal),
        request("repositories", undefined, signal),
      ]);
      if (signal?.aborted) return;
      if (configuredResult.status === "rejected") throw configuredResult.reason;
      const configured = configuredResult.value;
      setSettings(configured.repositories || []);
      setLoaded(true);
      if (accessResult.status === "rejected") {
        setRepos([]);
        const reason = accessResult.reason;
        const authorizationExpired = reason instanceof Error && /authorization expired or was revoked/i.test(reason.message);
        setReconnectGitHub(authorizationExpired);
        setAccessWarning(authorizationExpired
          ? "GitHub account authorization expired or was revoked. Reconnect your GitHub account, then refresh access. This leaves your desktop sign-in and saved repository settings intact."
          : "GitHub App repository access could not be refreshed. You can still remove saved configurations below; check the App installation and repository permissions to edit them.");
        return;
      }
      const access = accessResult.value;
      setRepos(access.repos || []);
      if (access.warning) setAccessWarning(access.warning);
      const link = access.installUrl ? new URL(access.installUrl) : null;
      setInstallUrl(link?.protocol === "https:" && link.hostname === "github.com" && !link.username && !link.password && !link.search && !link.hash && /^\/apps\/[a-zA-Z0-9_-]+\/installations\/new$/.test(link.pathname) ? link.toString() : "");
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "Repository access is unavailable."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function update(repo: Repository, patch: Partial<Setting>) {
    setNotice("");
    setSettings(current => {
      const existing = current.find(item => item.repositoryId === repo.repositoryId);
      return [...current.filter(item => item.repositoryId !== repo.repositoryId), { repositoryId: repo.repositoryId, installationId: repo.installationId, owner: repo.owner, name: repo.name, branch: repo.defaultBranch, appDirectory: "", enabled: true, ...existing, ...patch }];
    });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const saved = await request("repositories", { repositories: settings }); setSettings(saved.repositories); setNotice("Repository settings saved for your web, desktop, and CLI account."); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not save repository settings."); }
    finally { setBusy(false); }
  }
  return <section className="panel" id="connections">
    <div className={styles.heading}><h2>Connected repositories</h2><button type="button" className="button secondary" disabled={busy || loading} onClick={() => void load()}><RefreshCw size={15} />Refresh access</button></div>
    <p>Choose your repositories, working branch, and app folder. These account settings are shared by the web, desktop app, and CLI. They do not clone code or grant local folder trust.</p>
    {installUrl && <p><a className="text-link" href={installUrl} target="_blank" rel="noopener noreferrer">Manage GitHub App repository access</a></p>}
    {error && <p role="alert">{error}</p>}{accessWarning && <p role="status">{accessWarning}</p>}{notice && <p role="status">{notice}</p>}
    {reconnectGitHub && <GitHubSignIn callbackURL="/settings#connections" label="Reconnect GitHub account" />}
    {loading ? <p role="status">Loading repositories…</p> : <form onSubmit={save}>
      {!repos.length && <p>No repositories available. Connect the Freecoda GitHub App, then refresh access.</p>}
      {repos.map(repo => { const setting = settings.find(item => item.repositoryId === repo.repositoryId); return <fieldset key={`${repo.installationId}:${repo.repositoryId}`} className={styles.repository} disabled={busy}>
        <legend><GitBranch size={15} aria-hidden="true" /> {repo.owner}/{repo.name}</legend>
        <label className={styles.toggle}><input type="checkbox" checked={setting?.enabled || false} onChange={event => update(repo, { enabled: event.target.checked })} />Use this repository</label>
        {setting && <div className={styles.fields}><label>Working branch<input required value={setting.branch} maxLength={255} onChange={event => update(repo, { branch: event.target.value })} /></label><label>App folder<input value={setting.appDirectory} maxLength={300} placeholder="Repository root" onChange={event => update(repo, { appDirectory: event.target.value })} /><small>Relative path, such as apps/web. Leave empty for the root.</small></label><button type="button" className="button secondary" onClick={() => setSettings(current => current.filter(item => item.repositoryId !== repo.repositoryId))}><Trash2 size={15} />Remove configuration</button></div>}
      </fieldset>; })}
      {settings.filter(setting => !repos.some(repo => repo.repositoryId === setting.repositoryId)).map(setting => <p key={setting.repositoryId}>{setting.owner}/{setting.name} · Access unavailable <button type="button" className="button secondary" disabled={busy} onClick={() => setSettings(current => current.filter(item => item.repositoryId !== setting.repositoryId))}>Remove saved configuration</button></p>)}
      <button type="submit" className="button purple" disabled={busy || loading || !loaded}>{busy ? "Saving…" : "Save repository settings"}</button>
    </form>}
  </section>;
}
