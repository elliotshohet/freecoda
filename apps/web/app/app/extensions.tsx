"use client";
import { useEffect, useRef, useState } from "react";
import { Plug, Plus, Trash2 } from "lucide-react";
import styles from "./extensions.module.css";
type Entry = { id: string; name: string; enabled: boolean; url?: string; source?: string };
type Registry = { skills: Entry[]; servers: Entry[] };
export function ProjectExtensions({ projectId, disabled, onToolsChanged }: {
  projectId: string; disabled: boolean; onToolsChanged: (enabled: boolean) => void;
}) {
  const [registry, setRegistry] = useState<Registry>({ skills: [], servers: [] });
  const [kind, setKind] = useState("mcp");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  function accept(next: Registry) { setRegistry(next); onToolsChanged(next.servers.some(server => server.enabled)); }
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    const abort = new AbortController();
    void fetch(`/api/web/projects/${projectId}/extensions`, { signal: abort.signal, cache: "no-store" })
      .then(async response => { const value = await response.json(); if (!response.ok) throw Error(value.error || "Could not load extensions."); return value as Registry; })
      .then(next => { if (!abort.signal.aborted) accept(next); })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => { alive.current = false; abort.abort(); for (const request of requests.current) request.abort(); };
  }, [projectId, onToolsChanged]);
  async function change(action: Record<string, unknown>) {
    if (loading || disabled || busy) return false;
    const abort = new AbortController(); requests.current.add(abort);
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/web/projects/${projectId}/extensions`, { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Could not save extensions.");
      if (abort.signal.aborted || !alive.current) return false;
      accept(value); setNotice(action.action === "remove" ? "Extension removed." : "Extensions saved. Changes apply to your next coding run.");
      return true;
    } catch (error) { if (alive.current && !abort.signal.aborted) setError(error instanceof Error ? error.message : "Could not save extensions."); return false; }
    finally { requests.current.delete(abort); if (alive.current) setBusy(false); }
  }
  async function install(event: React.FormEvent) {
    event.preventDefault();
    const action = kind === "mcp" ? { action: "mcp", name, url: source }
      : kind === "skill-url" ? { action: "skill-url", source }
      : { action: "skill-text", name, instructions };
    if (await change(action)) { setName(""); setSource(""); setInstructions(""); }
  }
  const locked = busy || disabled || loading;
  return <details className={styles.panel}>
    <summary><Plug size={17} aria-hidden="true" /><strong>Tools & skills</strong><span>{registry.servers.length} servers · {registry.skills.length} skills</span></summary>
    <div className={styles.body}>
      <p>Install extensions for this project. Enabled skills guide coding runs; external MCP tools are available in Build mode after you allow them for the run. Installing does not execute a tool.</p>
      <p className={styles.note}>MCP servers receive tool arguments and may perform external actions. Skills cannot override permissions. Use only sources you trust. General chat remains tool-free.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading && <p role="status">Loading installed tools and skills…</p>}
      {notice && <p role="status">{notice}</p>}
      <ul className={styles.list}>{[...registry.servers.map(item => ({ ...item, kind: "MCP server" })), ...registry.skills.map(item => ({ ...item, kind: "Skill" }))].map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled} disabled={locked} onChange={event => void change({ action: "toggle", id: item.id, enabled: event.target.checked })} /><span><strong>{item.name}</strong><small>{item.kind}{item.url ? ` · ${item.url}` : ""}</small></span></label>
        <button type="button" aria-label={`Remove ${item.name}`} disabled={locked} onClick={() => void change({ action: "remove", id: item.id })}><Trash2 size={16} /></button>
      </li>)}</ul>
      {!registry.servers.length && !registry.skills.length && <p>No extensions installed. Add an MCP server or a skill below.</p>}
      <form onSubmit={install} className={styles.form}>
        <label>Extension type<select value={kind} onChange={event => setKind(event.target.value)} disabled={locked}><option value="mcp">MCP server · HTTP</option><option value="skill-url">SKILL.md · URL</option><option value="skill-text">SKILL.md · paste or upload</option></select></label>
        {kind !== "skill-url" && <label>Name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={locked} /></label>}
        {kind === "skill-text" ? <>
          <label>Upload SKILL.md<input type="file" accept=".md,text/markdown,text/plain" disabled={locked} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 48000) { setError("SKILL.md must be smaller than 48 KB."); return; } const contents = await file.text(); if (alive.current) setInstructions(contents); }} /></label>
          <label>Skill instructions<textarea required value={instructions} maxLength={48000} rows={5} onChange={event => setInstructions(event.target.value)} disabled={locked} /></label>
        </> : <label>{kind === "mcp" ? "MCP endpoint" : "SKILL.md URL"}<input type="url" required placeholder={kind === "mcp" ? "https://example.com/mcp" : "https://github.com/owner/repo/blob/main/SKILL.md"} value={source} onChange={event => setSource(event.target.value)} disabled={locked} /><small>Public HTTPS, without credentials or query parameters.</small></label>}
        <button className="button secondary" disabled={locked} type="submit"><Plus size={16} />{busy ? "Saving…" : "Install extension"}</button>
      </form>
    </div>
  </details>;
}
