"use client";
import { useEffect, useRef, useState } from "react";
import { Plug, Plus, Trash2 } from "lucide-react";
import styles from "./extensions.module.css";
type ToolEntry = { name: string; description?: string; label?: string; buildOnly?: boolean };
type Entry = { id: string; name: string; enabled: boolean; url?: string; source?: string; tools?: ToolEntry[]; checkedAt?: string | null; status?: string };
type Registry = { skills: Entry[]; servers: Entry[]; builtins?: ToolEntry[]; disabledTools?: string[] };
type View = "all" | "mcp" | "tools" | "skills";
export function ProjectExtensions({ projectId, disabled, onToolsChanged, requestedView = "all", openSignal = 0, mode = "build" }: {
  projectId: string; disabled: boolean; onToolsChanged: (enabled: boolean) => void; requestedView?: View; openSignal?: number; mode?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<View>(requestedView);
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
  useEffect(() => { if (openSignal) { setView(requestedView); if (details.current) details.current.open = true; } }, [openSignal, requestedView]);
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
    const previous = registry;
    if (action.action === "toggle") setRegistry(current => ({ ...current, skills: current.skills.map(item => item.id === action.id ? { ...item, enabled: action.enabled === true } : item), servers: current.servers.map(item => item.id === action.id ? { ...item, enabled: action.enabled === true } : item) }));
    if (action.action === "tool-toggle") setRegistry(current => ({ ...current, disabledTools: action.enabled ? (current.disabledTools || []).filter(name => name !== action.name) : [...new Set([...(current.disabledTools || []), String(action.name)])] }));
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/web/projects/${projectId}/extensions`, { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Could not save extensions.");
      if (abort.signal.aborted || !alive.current) return false;
      accept(value); setNotice(action.action === "remove" ? "Extension removed." : action.action === "discover" ? "Server checked and tool list refreshed. No tool was executed." : "Selection saved. Changes apply to your next coding run.");
      return true;
    } catch (error) { if (alive.current && !abort.signal.aborted) { setRegistry(previous); setError(error instanceof Error ? error.message : "Could not save extensions."); } return false; }
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
  const enabled = (name: string) => !registry.disabledTools?.includes(name);
  const toolRow = (tool: ToolEntry, available: boolean) => <li key={tool.name}>
    <label><input type="checkbox" checked={enabled(tool.name)} disabled={locked} onChange={event => void change({ action: "tool-toggle", name: tool.name, enabled: event.target.checked })} /><span><strong>{tool.label || tool.name}</strong><small>{!available ? "Unavailable in the current mode or disabled connection" : enabled(tool.name) ? "Selected for the next run" : "Disabled for the next run"}{tool.description ? ` · ${tool.description}` : ""}</small></span></label>
  </li>;
  return <details ref={details} className={styles.panel}>
    <summary><Plug size={17} aria-hidden="true" /><strong>Tools & skills</strong><span>{registry.servers.length} servers · {registry.skills.length} skills</span></summary>
    <div className={styles.body}>
      <div className={styles.switcher} role="group" aria-label="Extension settings">{(["all", "mcp", "tools", "skills"] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === "all" ? "Overview" : tab === "mcp" ? "MCP connections" : tab === "tools" ? "Tools" : "Skills"}</button>)}</div>
      <p>Install extensions for this project. Enabled skills guide coding runs; external MCP tools are available in Build mode after you allow them for the run. Installing does not execute a tool.</p>
      <p className={styles.note}>MCP servers receive tool arguments and may perform external actions. Skills cannot override permissions. Use only sources you trust. General chat remains tool-free.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading && <p role="status">Loading installed tools and skills…</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Saving or checking this selection…</p>}
      {(view === "all" || view === "mcp") && <section aria-label="MCP connections"><h3>MCP connections</h3><p className={styles.note}>Enable a connection for the next Build run. Checking contacts its endpoint to list tools; toggling does not execute tools or grant account access.</p>
      <ul className={styles.list}>{registry.servers.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled} disabled={locked} onChange={event => void change({ action: "toggle", id: item.id, enabled: event.target.checked })} /><span><strong>{item.name}</strong><small>{item.url}</small><small>{item.enabled ? "Enabled for next Build run" : "Disabled"} · {item.checkedAt ? `Last checked ${new Date(item.checkedAt).toLocaleString()} · ${item.tools?.length || 0} tools` : "Connection not checked"}</small></span></label>
        <div className={styles.connectionActions}><button type="button" disabled={locked} onClick={() => void change({ action: "discover", id: item.id })}>Check & list tools</button><button type="button" aria-label={`Remove ${item.name}`} disabled={locked} onClick={() => void change({ action: "remove", id: item.id })}><Trash2 size={16} /></button></div>
      </li>)}</ul>{!registry.servers.length && <p>No MCP connections configured.</p>}</section>}
      {(view === "all" || view === "tools") && <section aria-label="Available tools"><h3>Tools for the next run</h3><p className={styles.note}>Build tools remain subject to mode, cloud consent, and per-run external-tool approval. Active runs keep their existing selection.</p><ul className={styles.list}>{(registry.builtins || []).map(tool => toolRow(tool, !tool.buildOnly || mode === "build"))}</ul>{registry.servers.map(server => <div key={server.id}><h4>{server.name}</h4>{!server.checkedAt ? <p>Check this connection in MCP connections to discover its actual tools.</p> : <ul className={styles.list}>{(server.tools || []).map(tool => toolRow(tool, server.enabled && mode === "build"))}</ul>}</div>)}</section>}
      {(view === "all" || view === "skills") && <section aria-label="Installed skills"><h3>Skills</h3><ul className={styles.list}>{registry.skills.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled} disabled={locked} onChange={event => void change({ action: "toggle", id: item.id, enabled: event.target.checked })} /><span><strong>{item.name}</strong><small>Skill{item.source ? ` · ${item.source}` : ""}</small></span></label>
        <button type="button" aria-label={`Remove ${item.name}`} disabled={locked} onClick={() => void change({ action: "remove", id: item.id })}><Trash2 size={16} /></button>
      </li>)}</ul>{!registry.skills.length && <p>No skills installed.</p>}</section>}
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
      <p className={styles.note}>This form supports public HTTPS MCP endpoints. Credentialed MCP services need a configured server-side connection; no new OAuth scopes or credentials are granted here.</p>
    </div>
  </details>;
}
