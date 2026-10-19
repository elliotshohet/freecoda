"use client";
import { useEffect, useRef, useState } from "react";
import type { PluginManifest } from "@freecoda/contracts";
import { BookOpen, Check, ChevronDown, Eye, Layers, Plug, Plus, RefreshCw, Trash2, Wrench, X } from "lucide-react";
import styles from "./extensions.module.css";
type ToolEntry = { name: string; description?: string; label?: string; buildOnly?: boolean };
type Entry = { id: string; name: string; enabled: boolean; url?: string; source?: string; tools?: ToolEntry[]; checkedAt?: string | null; status?: string };
type PluginEntry = { id: string; name: string; source: string; skillIds: string[]; serverIds: string[] };
type Registry = { plugins?: PluginEntry[]; skills: Entry[]; servers: Entry[]; builtins?: ToolEntry[]; disabledTools?: string[] };
type View = "all" | "mcp" | "tools" | "skills";
export function ProjectExtensions({ projectId, disabled, onToolsChanged, requestedView = "all", openSignal = 0, skillSource = null, mode = "build" }: {
  projectId: string; disabled: boolean; onToolsChanged: (enabled: boolean) => void; requestedView?: View; openSignal?: number; skillSource?: string | null; mode?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<View>(requestedView);
  const [registry, setRegistry] = useState<Registry>({ skills: [], servers: [] });
  const [pluginSource, setPluginSource] = useState("");
  const [pluginPreview, setPluginPreview] = useState<{ source: string; manifest: PluginManifest } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [kind, setKind] = useState("mcp");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedChecks, setFailedChecks] = useState<string[]>([]);
  const [reading, setReading] = useState<{ id: string; name: string; instructions: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => { if (openSignal) { setView(requestedView); if (details.current) details.current.open = true; } }, [openSignal, requestedView]);
  useEffect(() => { if (openSignal) { if (requestedView === "skills") { setKind("skill-url"); if (skillSource) setSource(skillSource); } else if (requestedView === "mcp") setKind("mcp"); } }, [openSignal, requestedView, skillSource]);
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
      if (action.action === "discover") setFailedChecks(current => current.filter(id => id !== action.id));
      accept(value); setNotice(action.action === "remove" ? "Extension removed." : action.action === "discover" ? "Server checked and tool list refreshed. No tool was executed." : "Selection saved. Changes apply to your next coding run.");
      return true;
    } catch (error) { if (alive.current && !abort.signal.aborted) { if (action.action === "discover") setFailedChecks(current => [...new Set([...current, String(action.id)])]); setRegistry(previous); setError(error instanceof Error ? error.message : "Could not save extensions."); } return false; }
    finally { requests.current.delete(abort); if (alive.current) setBusy(false); }
  }
  async function previewPlugin(event: React.FormEvent) {
    event.preventDefault();
    if (disabled || busy || loading || previewBusy) return;
    const abort = new AbortController(); requests.current.add(abort);
    setPreviewBusy(true); setError(""); setPluginPreview(null);
    try {
      const response = await fetch(`/api/web/projects/${projectId}/plugins/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: pluginSource }), signal: abort.signal });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Could not read the plugin manifest.");
      if (alive.current && !abort.signal.aborted) setPluginPreview(value);
    } catch (error) { if (alive.current && !abort.signal.aborted) setError(error instanceof Error ? error.message : "Could not read the plugin manifest."); }
    finally { requests.current.delete(abort); if (alive.current) setPreviewBusy(false); }
  }
  async function installReviewedPlugin() {
    if (!pluginPreview) return;
    if (await change({ action: "plugin-install", source: pluginPreview.source, manifest: pluginPreview.manifest })) {
      setPluginPreview(null); setPluginSource(""); setNotice("Plugin installed. Review enabled skills and check each MCP connection before use. Execution permissions still apply.");
    }
  }
  async function readSkill(id: string) {
    const abort = new AbortController(); requests.current.add(abort);
    setError("");
    try {
      const response = await fetch(`/api/web/projects/${projectId}/extensions?skill=${encodeURIComponent(id)}`, { cache: "no-store", signal: abort.signal });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Could not read this skill.");
      if (alive.current && !abort.signal.aborted) setReading(value.skill);
    } catch (error) { if (alive.current && !abort.signal.aborted) setError(error instanceof Error ? error.message : "Could not read this skill."); }
    finally { requests.current.delete(abort); }
  }
  async function install(event: React.FormEvent) {
    event.preventDefault();
    const action = kind === "mcp" ? { action: "mcp", name, url: source }
      : kind === "skill-url" ? { action: "skill-url", source }
      : { action: "skill-text", name, instructions };
    if (await change(action)) { setName(""); setSource(""); setInstructions(""); }
  }
  const locked = busy || disabled || loading || previewBusy;
  const enabled = (name: string) => !registry.disabledTools?.includes(name);
  const toolRow = (tool: ToolEntry, available: boolean) => <li key={tool.name}>
    <label><input type="checkbox" checked={enabled(tool.name)} disabled={locked} onChange={event => void change({ action: "tool-toggle", name: tool.name, enabled: event.target.checked })} /><span><strong>{tool.label || tool.name}</strong><small>{!available ? "Unavailable in the current mode or disabled connection" : enabled(tool.name) ? "Selected for the next run" : "Disabled for the next run"}{tool.description ? ` · ${tool.description}` : ""}</small></span></label>
  </li>;
  return <details ref={details} className={styles.panel}>
    <summary><Plug size={17} aria-hidden="true" /><strong>Plugins & connections</strong><span>{loading ? "Loading…" : error && !registry.servers.length && !registry.skills.length ? "Check status below" : `${registry.plugins?.length || 0} plugins · ${registry.servers.length} MCP · ${registry.skills.length} skills`}</span><ChevronDown className={styles.chevron} size={16} aria-hidden="true" /></summary>
    <div className={styles.body}>
      <div className={styles.switcher} role="group" aria-label="Plugin settings">{(["all", "mcp", "tools", "skills"] as const).map(tab => <button key={tab} type="button" aria-pressed={view === tab} onClick={() => { setView(tab); if (tab === "mcp") setKind("mcp"); if (tab === "skills") setKind("skill-url"); }}>{tab === "all" ? <Layers size={15} aria-hidden="true" /> : tab === "mcp" ? <Plug size={15} aria-hidden="true" /> : tab === "tools" ? <Wrench size={15} aria-hidden="true" /> : <BookOpen size={15} aria-hidden="true" />}{tab === "all" ? "Overview" : tab === "mcp" ? "MCP connections" : tab === "tools" ? "Tools" : "Skills"}</button>)}</div>
      <p>Manage plugins and connections for this workspace. Enabled skills guide coding runs; external MCP tools are available in Build mode after you allow them for the run. Installing does not execute a tool.</p>
      <p className={styles.note}>MCP servers receive tool arguments and may perform external actions. Skills cannot override permissions. Use only sources you trust. General chat remains tool-free.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading && <p role="status">Loading installed plugins, connections, and skills…</p>}
      {notice && <p role="status" className={styles.feedback}><Check size={16} aria-hidden="true" />{notice}</p>}
      {busy && <p role="status">Saving or checking this selection…</p>}
      {view === "all" && <section aria-label="Installed plugins"><h3>Installed plugins</h3>
        {(registry.plugins || []).map(plugin => <div key={plugin.id} className={styles.pluginCard}><strong>{plugin.name}</strong><p className={styles.note}>Installed · {plugin.skillIds.length} skills · {plugin.serverIds.length} MCP connections</p><p className={styles.note}>{plugin.source}</p><button type="button" disabled={locked} onClick={() => void change({ action: "plugin-remove", id: plugin.id })}><Trash2 size={16} aria-hidden="true" />Remove plugin and its members</button></div>)}
        {!loading && !error && !registry.plugins?.length && <p className={styles.empty}>No bundled plugins installed. Review a plugin manifest below, or add a connection or skill individually.</p>}
      </section>}
      {(view === "all" || view === "mcp") && <section aria-label="MCP connections"><h3>MCP connections</h3><p className={styles.note}>Enable a connection for the next Build run. Checking contacts its endpoint to list tools; toggling does not execute tools or grant account access.</p>
      <ul className={styles.list}>{registry.servers.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled} disabled={locked} onChange={event => void change({ action: "toggle", id: item.id, enabled: event.target.checked })} /><span><strong>{item.name}</strong><small>{item.url}</small><small>Installed · {item.enabled ? "enabled for next Build run" : "disabled"} · {failedChecks.includes(item.id) ? "Last connection check failed · retry below" : item.checkedAt ? `Last checked ${new Date(item.checkedAt).toLocaleString()} · ${item.tools?.length || 0} tools` : "Connection not checked"}</small></span></label>
        <div className={styles.connectionActions}><button type="button" disabled={locked} onClick={() => void change({ action: "discover", id: item.id })}><RefreshCw size={15} aria-hidden="true" />Check & list tools</button><button type="button" aria-label={`Remove ${item.name}`} disabled={locked} onClick={() => void change({ action: "remove", id: item.id })}><Trash2 size={16} aria-hidden="true" /></button></div>
      </li>)}</ul>{!loading && !error && !registry.servers.length && <p className={styles.empty}>No MCP connections configured. Add a public HTTPS endpoint below, then check it to discover its tools.</p>}</section>}
      {(view === "all" || view === "tools") && <section aria-label="Available tools"><h3>Tools for the next run</h3><p className={styles.note}>Build tools remain subject to mode, cloud consent, and per-run external-tool approval. Active runs keep their existing selection.</p><ul className={styles.list}>{(registry.builtins || []).map(tool => toolRow(tool, !tool.buildOnly || mode === "build"))}</ul>{registry.servers.map(server => <div key={server.id}><h4>{server.name}</h4>{!server.checkedAt ? <p>Check this connection in MCP connections to discover its actual tools.</p> : <ul className={styles.list}>{(server.tools || []).map(tool => toolRow(tool, server.enabled && mode === "build"))}</ul>}</div>)}</section>}
      {(view === "all" || view === "skills") && <section aria-label="Installed skills"><h3>Skills</h3><ul className={styles.list}>{registry.skills.map(item => <li key={item.id}>
        <label><input type="checkbox" checked={item.enabled} disabled={locked} onChange={event => void change({ action: "toggle", id: item.id, enabled: event.target.checked })} /><span><strong>{item.name}</strong><small>Installed · {item.enabled ? "enabled" : "disabled"}{item.source ? ` · ${item.source}` : ""}</small></span></label>
        <button type="button" disabled={loading} onClick={() => void readSkill(item.id)} aria-label={`Read ${item.name} instructions`}><BookOpen size={16} aria-hidden="true" />Read skill</button>
        <button type="button" aria-label={`Remove ${item.name}`} disabled={locked} onClick={() => void change({ action: "remove", id: item.id })}><Trash2 size={16} aria-hidden="true" /></button>
      </li>)}</ul>{!loading && !error && !registry.skills.length && <p className={styles.empty}>No skills installed. Add a SKILL.md URL, or paste or upload instructions below.</p>}</section>}
      {reading && <section aria-label={`Skill instructions: ${reading.name}`}><h3>{reading.name}</h3><button type="button" onClick={() => setReading(null)}><X size={16} aria-hidden="true" />Close instructions</button><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "320px", overflowY: "auto" }}>{reading.instructions}</pre><p className={styles.note}>These instructions cannot override project permissions.</p></section>}
      {view === "all" && <section aria-label="Install a plugin"><h3>Install a plugin</h3><p className={styles.note}>A plugin bundles skills and MCP connections. Review every source before installing. Installation does not sign in, connect, or execute tools.</p>
        <form onSubmit={previewPlugin} className={styles.form}><label>Plugin manifest URL<input type="url" required value={pluginSource} disabled={locked} onChange={event => { setPluginSource(event.target.value); setPluginPreview(null); }} placeholder="https://example.com/plugin.json" /></label><button className="button secondary" type="submit" disabled={locked}><Eye size={16} aria-hidden="true" />{previewBusy ? "Reading…" : "Review plugin"}</button></form>
        {pluginPreview && <div className={styles.pluginCard}><h4>Review {pluginPreview.manifest.name}</h4><p className={styles.note}>{pluginPreview.source}</p><ul>{pluginPreview.manifest.skills.map((skill, index) => <li key={`skill-${index}`}>Skill: {skill.name || "SKILL.md"} · {skill.source}</li>)}{pluginPreview.manifest.servers.map((server, index) => <li key={`server-${index}`}>MCP: {server.name} · {server.url}</li>)}</ul><p className={styles.note}>Remote skills are downloaded as instructions. MCP endpoints receive arguments only when enabled tools run with your approval.</p><button className="button secondary" type="button" disabled={locked} onClick={() => void installReviewedPlugin()}><Plus size={16} aria-hidden="true" />Install reviewed plugin</button><button type="button" onClick={() => setPluginPreview(null)}><X size={16} aria-hidden="true" />Cancel</button></div>}
      </section>}
      <h3>Add a connection or skill</h3>
      <form onSubmit={install} className={styles.form}>
        <label>Extension type<select value={kind} onChange={event => setKind(event.target.value)} disabled={locked}><option value="mcp">MCP server · HTTP</option><option value="skill-url">SKILL.md · URL</option><option value="skill-text">SKILL.md · paste or upload</option></select></label>
        {kind !== "skill-url" && <label>Name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={locked} /></label>}
        {kind === "skill-text" ? <>
          <label>Upload SKILL.md<input type="file" accept=".md,text/markdown,text/plain" disabled={locked} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 48000) { setError("SKILL.md must be smaller than 48 KB."); return; } const contents = await file.text(); if (alive.current) setInstructions(contents); }} /></label>
          <label>Skill instructions<textarea required value={instructions} maxLength={48000} rows={5} onChange={event => setInstructions(event.target.value)} disabled={locked} /></label>
        </> : <label>{kind === "mcp" ? "MCP endpoint" : "SKILL.md URL"}<input type="url" required placeholder={kind === "mcp" ? "https://example.com/mcp" : "https://github.com/owner/repo/blob/main/SKILL.md"} value={source} onChange={event => setSource(event.target.value)} disabled={locked} /><small>Public HTTPS, without credentials or query parameters.</small></label>}
        <button className="button secondary" disabled={locked} type="submit"><Plus size={16} aria-hidden="true" />{busy ? "Saving…" : kind === "mcp" ? "Add MCP connection" : "Install skill"}</button>
      </form>
      <p className={styles.note}>This form supports public HTTPS MCP endpoints. MCP services that require sign-in need a configured server-side connection; no new OAuth scopes or credentials are granted here.</p>
    </div>
  </details>;
}
