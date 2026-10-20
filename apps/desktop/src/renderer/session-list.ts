import type { DesktopSessionSnapshot, DesktopSessionSummary } from "../desktop-sessions";
import type { DesktopBridge } from "../shared";

/** Renders real service sessions, never infers concurrency from workspace tabs. */
export function createSessionList(options: {
  bridge: DesktopBridge;
  host: HTMLElement;
  count: HTMLElement;
  newChat: HTMLButtonElement;
  newProject: HTMLButtonElement;
  projectRoot(): string | undefined;
  prepareSwitch(): Promise<boolean>;
  busyChanged(busy: boolean): void;
  activated(session: DesktopSessionSummary): Promise<void>;
  error(error: unknown): void;
  signal: AbortSignal;
}) {
  let snapshot: DesktopSessionSnapshot | undefined;
  let busy = false;
  let generation = 0;
  let renderKey = "";
  const render = () => {
    const sessions = snapshot?.sessions || [];
    const nextKey = JSON.stringify([busy, options.projectRoot(), snapshot?.activeSessionId, sessions.map(({ id, title, root, conversationMode, status, pendingApprovals }) => ({ id, title, root, conversationMode, status, pendingApprovals }))]);
    if (renderKey === nextKey) return;
    renderKey = nextKey;
    options.count.textContent = String(sessions.length);
    options.newChat.disabled = busy;
    options.newProject.disabled = busy || !options.projectRoot();
    options.newProject.title = options.projectRoot() ? "Create an independent session for this project" : "Open and trust a project folder first";
    options.host.replaceChildren();
    for (const session of sessions) {
      const row = document.createElement("div"); row.className = "desktop-session-row";
      const select = document.createElement("button"); select.className = "desktop-session-select";
      select.disabled = busy;
      if (session.id === snapshot?.activeSessionId) select.setAttribute("aria-current", "page");
      const title = document.createElement("strong"); title.textContent = session.title || (session.conversationMode === "chat" ? "General chat" : "Project session");
      const status = document.createElement("span"); status.textContent = `${session.status}${session.pendingApprovals ? ` · ${session.pendingApprovals} approval${session.pendingApprovals === 1 ? "" : "s"}` : ""}`;
      const scope = document.createElement("small"); scope.textContent = session.root || "General chat · no repository access";
      select.append(title, status, scope);
      select.addEventListener("click", () => { if (session.id !== snapshot?.activeSessionId) void change(() => options.bridge.selectSession(session.id)); }, { signal: options.signal });
      row.append(select);
      const active = session.status === "running" || session.status === "queued";
      const control = document.createElement("button"); control.className = "desktop-session-control";
      control.textContent = active ? "Stop" : "Close";
      control.setAttribute("aria-label", `${active ? "Stop" : "Close"} ${session.title || "session"}`);
      control.disabled = busy || (!active && !!session.pendingApprovals);
      control.addEventListener("click", () => {
        if (active) void options.bridge.cancelSession(session.id).catch(options.error);
        else void change(() => options.bridge.closeSession(session.id));
      }, { signal: options.signal });
      row.append(control); options.host.append(row);
    }
  };
  const update = async (next: DesktopSessionSnapshot) => {
    const changed = !snapshot || snapshot.activeSessionId !== next.activeSessionId;
    snapshot = next; render();
    if (changed) {
      const active = next.sessions.find(session => session.id === next.activeSessionId);
      if (active) await options.activated(active);
    }
  };
  const change = async (operation: () => Promise<DesktopSessionSnapshot>) => {
    if (busy) return;
    busy = true; options.busyChanged(true); render();
    const current = ++generation;
    try {
      if (!await options.prepareSwitch()) throw Error("Save your file and finish pending commands, queued messages, voice or approvals before switching sessions. Agent work can continue in the background.");
      const next = await operation();
      if (current === generation) await update(next);
    } catch (error) { options.error(error); }
    finally { if (current === generation) { busy = false; options.busyChanged(false); render(); } }
  };
  options.newChat.addEventListener("click", () => void change(() => options.bridge.createSession({ mode: "chat" })), { signal: options.signal });
  options.newProject.addEventListener("click", () => {
    const root = options.projectRoot();
    if (root) void change(() => options.bridge.createSession({ root, mode: "coding" }));
  }, { signal: options.signal });
  return { update, refresh: render };
}
