import type { DesktopBridge, DesktopState, AgentMode } from "../shared";
import type { TerminalEvent, TerminalSession } from "../interactive-terminal";
import type { ExternalAgentAvailability, ExternalAgentId } from "../external-agents";

type View = { session: TerminalSession; output: string; running: boolean };
export function createTerminalPanel(options: { bridge: DesktopBridge; host: HTMLElement; error(error: unknown): void; signal: AbortSignal }) {
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const agentStatus = document.createElement("p"); agentStatus.className = "terminal-boundary";
  const boundary = document.createElement("p"); boundary.className = "terminal-boundary";
  boundary.textContent = "Interactive processes run as your user, outside Freecoda tool approvals. External agents use their own account, permissions and billing. Fixed-size plain output; full-screen terminal apps are unsupported. No sign-in or process starts until you choose Connect and confirm.";
  const launch = document.createElement("div"); launch.className = "terminal-launch";
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [id, label] of [["shell", "Connect shell"], ["codex", "Connect Codex"], ["claude", "Connect Claude Code"]]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.disabled = true; buttons.set(id, button); launch.append(button);
    button.addEventListener("click", () => void start(id === "shell" ? undefined : id as ExternalAgentId), { signal: options.signal });
  }
  const list = document.createElement("select"); list.setAttribute("aria-label", "Interactive session");
  const output = document.createElement("pre"); output.className = "terminal-transcript"; output.tabIndex = 0; output.setAttribute("aria-label", "Interactive session output");
  const form = document.createElement("form"); form.className = "terminal-input";
  const input = document.createElement("input"); input.type = "text"; input.maxLength = 8191; input.autocomplete = "off"; input.setAttribute("aria-label", "Input for selected interactive session"); input.placeholder = "Type a line for the selected session…";
  const send = document.createElement("button"); send.type = "submit"; send.textContent = "Send line";
  const interrupt = document.createElement("button"); interrupt.type = "button"; interrupt.textContent = "Ctrl-C";
  const close = document.createElement("button"); close.type = "button"; close.textContent = "Stop process";
  const refresh = document.createElement("button"); refresh.type = "button"; refresh.textContent = "Refresh availability";
  form.append(input, send, interrupt, close); options.host.append(boundary, launch, refresh, status, agentStatus, list, output, form);
  let owner = "", state: DesktopState | null = null, mode: AgentMode = "chat", auth = "", generation = 0;
  let selected = "", busy = false, available = false, availabilityDetail = "Choose Refresh availability to inspect installed tools.";
  let agents: ExternalAgentAvailability[] = [];
  const cache = new Map<string, Map<string, View>>();
  const views = () => cache.get(owner) || new Map<string, View>();
  const current = () => views().get(selected);
  const allowed = () => !!state?.auth.signedIn && state.conversationMode === "coding" && !!state.workspace?.trusted && mode === "build" && state.permissionPreset === "full-access" && !state.running;
  const render = () => {
    const followOutput = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    const sessions = views();
    if (!sessions.has(selected)) selected = [...sessions.keys()][0] || "";
    list.replaceChildren();
    for (const [id, view] of sessions) { const option = document.createElement("option"); option.value = id; option.textContent = `${view.session.agentId || "Shell"} · ${view.running ? "running" : "stopped"} · ${view.session.root}`; list.append(option); }
    list.value = selected; list.disabled = !sessions.size;
    output.textContent = current()?.output || "No interactive process output in this view.";
    if (followOutput) output.scrollTop = output.scrollHeight;
    const writable = !!current()?.running && current()?.session.root === state?.workspace?.root && !busy && !!state?.auth.signedIn && state.conversationMode === "coding" && !!state.workspace?.trusted && mode === "build" && state.permissionPreset === "full-access";
    input.disabled = send.disabled = interrupt.disabled = !writable; close.disabled = !current()?.running || busy;
    for (const [id, button] of buttons) {
      const agent = agents.find(item => item.id === id);
      button.disabled = busy || !available || !allowed() || (id !== "shell" && !agent?.installed);
      button.title = id === "shell" ? availabilityDetail : agent?.detail || "Refresh availability first.";
    }
    status.textContent = !allowed() ? "To connect: sign in, open a trusted coding folder, select Build and Full access, then finish any running agent task. Each launch still requires confirmation." : availabilityDetail;
    agentStatus.textContent = agents.map(agent => `${agent.name}: ${agent.installed ? "installed · account not checked" : "not installed"}. ${agent.detail}`).join("\n");
  };
  async function refreshState() {
    const request = ++generation, key = owner;
    busy = true; render();
    try {
      const [capability, installed, sessions] = await Promise.all([options.bridge.terminalAvailability(), options.bridge.listExternalAgents(), options.bridge.terminalList()]);
      if (request !== generation || key !== owner) return;
      available = capability.available; availabilityDetail = capability.detail; agents = installed;
      const entries = cache.get(owner) || new Map<string, View>();
      for (const view of entries.values()) view.running = sessions.some(session => session.id === view.session.id);
      for (const session of sessions) if (session.ownerKey === owner) entries.set(session.id, { session, output: entries.get(session.id)?.output || "", running: true });
      cache.set(owner, entries);
    } catch (error) { if (request === generation) options.error(error); }
    finally { if (request === generation) { busy = false; render(); } }
  }
  async function start(agentId?: ExternalAgentId) {
    if (!allowed() || busy || !available) return;
    const key = owner; busy = true; render();
    try {
      const session = await options.bridge.terminalStart({ root: state!.workspace!.root, mode: "build", ...(agentId ? { agentId } : {}) });
      if (session.ownerKey !== key || owner !== key) return;
      const entries = cache.get(key) || new Map<string, View>(); entries.set(session.id, { session, running: true, output: entries.get(session.id)?.output || "" }); cache.set(key, entries); selected = session.id;
    } catch (error) { options.error(error); }
    finally { busy = false; render(); }
  }
  async function write(data: string) {
    const view = current(); if (!view?.running || input.disabled || view.session.ownerKey !== owner) return;
    await options.bridge.terminalWrite({ id: view.session.id, data });
  }
  form.addEventListener("submit", event => { event.preventDefault(); const value = input.value; void write(value + "\n").then(() => { if (input.value === value) input.value = ""; }).catch(options.error); }, { signal: options.signal });
  interrupt.addEventListener("click", () => void write("\u0003").catch(options.error), { signal: options.signal });
  input.addEventListener("keydown", event => { if (event.ctrlKey && event.key.toLowerCase() === "c" && !input.value) { event.preventDefault(); void write("\u0003").catch(options.error); } }, { signal: options.signal });
  close.addEventListener("click", () => { const id = current()?.session.id; if (id) void options.bridge.terminalClose(id).then(refreshState).catch(options.error); }, { signal: options.signal });
  list.addEventListener("change", () => { selected = list.value; render(); }, { signal: options.signal });
  refresh.addEventListener("click", () => void refreshState(), { signal: options.signal });
  return {
    refresh: refreshState,
    context(key: string, next: DesktopState | null, nextMode: AgentMode) {
      const nextAuth = JSON.stringify([next?.auth.server, next?.auth.accountScope, next?.auth.signedIn]);
      if (auth && auth !== nextAuth) { cache.clear(); selected = ""; input.value = ""; generation++; busy = false; }
      auth = nextAuth;
      if (owner !== key) { owner = key; selected = ""; input.value = ""; generation++; busy = false; }
      state = next; mode = nextMode; render();
    },
    event(event: TerminalEvent) {
      if (!state?.auth.signedIn) return;
      const entries = cache.get(event.ownerKey) || new Map<string, View>();
      if (event.type === "started") entries.set(event.sessionId, { session: event.session, output: entries.get(event.sessionId)?.output || "", running: true });
      else {
        const view = entries.get(event.sessionId); if (!view) return;
        if (event.type === "data") view.output = (view.output + event.data.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|$))/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")).slice(-128_000);
        else { view.running = false; view.output = (view.output + `\n${event.type === "error" ? event.message : `Process exited (${event.exitCode ?? event.signal ?? "stopped"}).`}\n`).slice(-128_000); }
      }
      cache.set(event.ownerKey, entries); if (event.ownerKey === owner) render();
    },
  };
}
