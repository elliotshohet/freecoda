import { filterConversationCommands, parseSkillInstallIntent, codexUnsupportedCommand } from "../../../../packages/contracts/src/conversation-commands";
import { canDeliverQueuedPrompt, settleQueuedPrompt, type QueuedPrompt } from "./prompt-queue";
import { parseMarkdownBlocks, safeMarkdownLink } from "./markdown";
import type {
  AgentMode,
  DesktopPermissionPreset,
  DesktopBridge,
  DesktopEvent,
  DesktopFile,
  DesktopState,
  DesktopWorkspace,
} from "../shared";

declare global {
  interface Window {
    freecoda: DesktopBridge;
  }
}
const bridge = window.freecoda;
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing app element: ${id}`);
  return node as T;
}
function text(id: string, value: string) {
  el(id).textContent = value;
}
function hide(id: string, hidden = true) {
  el(id).hidden = hidden;
}
function button(id: string) {
  return el<HTMLButtonElement>(id);
}
function input(id: string) {
  return el<HTMLInputElement>(id);
}
function area(id: string) {
  return el<HTMLTextAreaElement>(id);
}
const editor = area("editor");
const prompt = area("prompt");
const mode = el<HTMLSelectElement>("mode");
let state: DesktopState | null = null;
let accountProfile: { name?: string; avatar?: string } = {};
let profileSignedIn: boolean | undefined;
let accountDetailsRequest = 0;
let accountAuthGeneration = 0;
let file: DesktopFile | null = null;
let pendingFolder: DesktopWorkspace | null = null;
let filesRequest = 0;
let fileRequest = 0;
let activeRun: string | null = null;
let running = false;
let actionBusy = false;
let accountBusy = false;
let output = "";
let outputVersion = 0;
let assistantParagraph: HTMLElement | null = null;
let noticeTimer: ReturnType<typeof setTimeout>;
let approvalQueue: Extract<DesktopEvent, { type: "approval" }>[] = [];
let currentApproval: string | null = null;
let loginInProgress = false;
let commandInFlight = false;
let conversationRoot: string | null = null;
const promptQueue: QueuedPrompt[] = [];
let drainingPromptQueue = false;
let promptQueuePaused = false;
const abort = new AbortController();
const signal = abort.signal;
const modifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
text("save-shortcut", `${modifier}S`);
document
  .querySelectorAll<HTMLElement>(".welcome-shortcuts kbd")
  .forEach((node, index) => {
    node.textContent = `${modifier}${index === 0 ? "O" : "S"}`;
  });
document.querySelector<HTMLElement>(".composer-hint")!.textContent =
  "Enter to send · Ctrl+Enter to queue · Shift+Enter for a new line";

function message(error: unknown) {
  let detail = error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    : "This action could not be completed. Please try again.";
  const routingId = state?.auth.model;
  if (routingId) detail = detail.split(routingId).join("the AI service");
  return detail.replace(/reflection\/beam(?:-free|-2)?|beam free|reflection/gi, "the AI service");
}
function showError(error: unknown) {
  text("error-text", message(error));
  hide("error", false);
}
function clearError() {
  hide("error");
}
function notify(value: string) {
  clearTimeout(noticeTimer);
  text("notice", value);
  hide("notice", false);
  noticeTimer = setTimeout(() => hide("notice"), 4500);
}
function dirty() {
  return !!file && editor.value !== file.content;
}
function trusted() {
  return state?.workspace?.trusted === true;
}
function isChat() {
  return state?.conversationMode !== "coding";
}
function workspaceName() {
  return state?.workspace?.name || "Your project";
}
let workspaceNavigationKey = "";
function renderWorkspaceNavigation() {
  const workspace = state?.workspace;
  const chat = isChat();
  const blocked = running || actionBusy || commandInFlight || promptQueue.length > 0;
  const recent = [...(state?.recentFolders || [])];
  if (workspace && !recent.some(folder => folder.root === workspace.root)) recent.unshift(workspace);
  const key = JSON.stringify([chat, workspace?.root, workspace?.trusted, workspace?.files.length, recent, blocked]);
  if (key === workspaceNavigationKey) return;
  workspaceNavigationKey = key;
  const sidebar = el("project-sidebar");
  const list = el("workspace-list");
  const context = el("selected-workspace");
  const conversations = el("workspace-conversations");
  // Keep these persistent nodes and their input/listeners while rebuilding rows.
  sidebar.append(context, conversations);
  list.replaceChildren();
  hide("selected-workspace", chat || !workspace);
  button("sidebar-general-chat").setAttribute("aria-current", chat ? "page" : "false");
  button("rail-chat").setAttribute("aria-current", chat ? "page" : "false");
  text("folder-name", workspace?.name || "");
  text("folder-path", workspace?.root || "");
  text("workspace-details", workspace?.trusted ? `Trusted folder · ${workspace.files.length} files in explorer` : "Trust this folder before accessing its files.");
  text("conversation-scope-label", chat ? "Your chats" : "Conversations");
  input("thread-search").placeholder = chat ? "Search chats…" : "Search workspace chats…";
  if (!recent.length) {
    const empty = document.createElement("p"); empty.className = "workspace-empty";
    empty.textContent = "Open a folder to keep its tasks and conversations together."; list.append(empty);
  }
  for (const folder of recent) {
    const group = document.createElement("section"); group.className = "workspace-group";
    const active = !chat && workspace?.root === folder.root;
    const control = document.createElement("button"); control.type = "button";
    control.className = "workspace-select"; control.disabled = blocked;
    control.setAttribute("aria-expanded", String(active));
    if (active) control.setAttribute("aria-current", "page");
    control.title = folder.root;
    const icon = document.createElement("span"); icon.setAttribute("aria-hidden", "true"); icon.textContent = active ? "⌄" : "›";
    const name = document.createElement("span"); name.textContent = folder.name;
    control.append(icon, name);
    control.addEventListener("click", () => { if (!active) void openRecentWorkspace(folder.root); }, { signal });
    group.append(control);
    if (active) group.append(context, conversations);
    list.append(group);
  }
  if (chat) el("general-conversations").append(conversations);
  // Context remains hidden outside the active group in general chat.
  if (chat) el("general-conversations").append(context);
}
async function openRecentWorkspace(root: string) {
  if (running || actionBusy || commandInFlight || promptQueue.length) { notify("Finish the current action and queued messages before switching workspaces."); return; }
  if (dirty()) { showError(new Error("Save your editor changes before switching workspaces.")); return; }
  actionBusy = true; updateControls(); clearError();
  try {
    const workspace = await bridge.openRecentFolder(root);
    if (!workspace) return;
    renderState({ ...(await bridge.getState()), workspace });
    if (!workspace.trusted) {
      pendingFolder = workspace; input("trust-check").checked = false; button("trust-confirm").disabled = true;
      text("trust-path", workspace.root); const dialog = el<HTMLDialogElement>("trust-dialog"); dialog.returnValue = "";
      if (!dialog.open) dialog.showModal();
    } else { mode.value = "build"; notify(`Opened ${workspace.name}. Its saved conversations are in the sidebar.`); }
  } catch (error) { showError(error); }
  finally { actionBusy = false; updateControls(); }
}
function updateControls() {
  const chat = isChat();
  text("sidebar-heading-label", "Workspaces");
  hide("workspace-tools", chat);
  renderWorkspaceNavigation();
  text("sidebar-new-task", "＋ New conversation");
  const ready = (chat || trusted()) && !running && !actionBusy;
  const safe = !chat && trusted() && !running && !actionBusy;
  const readOnly = state?.permissionPreset === "read-only";
  if (!chat && trusted()) text("agent-context", `Local · ${workspaceName()} · ${mode.value === "build" ? "Build" : mode.value === "plan" ? "Plan · read only" : "Review · read only"}`);
  const localCommand = prompt.value.trim().startsWith("/") || !!parseSkillInstallIntent(prompt.value);
  button("open-folder").disabled = running || actionBusy;
  button("sidebar-general-chat").disabled = running || actionBusy || commandInFlight || promptQueue.length > 0;
  button("welcome-open").disabled = running || actionBusy;
  button("refresh-files").disabled = !safe;
  button("save-file").disabled =
    !safe || readOnly || !file || file.readOnly || !dirty();
  editor.disabled = !safe || readOnly || !file || file.readOnly;
  prompt.disabled = actionBusy;
  mode.disabled = running || actionBusy;
  button("send").disabled =
    actionBusy ||
    !prompt.value.trim() ||
    (!localCommand && (!ready || !state?.auth.signedIn || (!chat && dirty())));
  hide("send", running);
  renderPromptQueue();
  hide("stop", !running);
  button("stop").disabled = actionBusy;
  button("new-chat").disabled = !ready;
  button("sidebar-start-chat").disabled = !ready;
  button("sidebar-new-task").disabled = !ready;
  el("thread-history")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach((node) => (node.disabled = !ready));
  input("file-filter").disabled = !safe;
  input("command").disabled = !safe || readOnly;
  hide("run-command", commandInFlight);
  hide("stop-command", !commandInFlight);
  button("run-command").disabled =
    !safe || readOnly || !input("command").value.trim() || dirty();
  document
    .querySelectorAll<HTMLButtonElement>("#file-tree button")
    .forEach((node) => {
      node.disabled = !safe;
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-prompt]")
    .forEach((node) => (node.disabled = !ready));
  button("permissions-open").disabled =
    running || actionBusy || commandInFlight;
  button("permissions-apply").disabled =
    running || actionBusy || commandInFlight;
  el("permissions-dialog")
    .querySelectorAll<HTMLInputElement>("input")
    .forEach(
      (node) => (node.disabled = running || actionBusy || commandInFlight),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-conversation]")
    .forEach((node) => {
      node.hidden = false;
    });
  for (const id of ["toggle-workbench", "sidebar-files", "sidebar-output"]) {
    button(id).disabled = chat || running || actionBusy;
    hide(id, chat);
  }
  const preset = state?.permissionPreset || "default";
  text(
    "permissions-open",
    chat
      ? "No tools"
      : preset === "read-only"
        ? "Read only"
        : preset === "full-access"
          ? "Full access"
          : "Default permissions",
  );
  text(
    "permission-note",
    chat
      ? "Chat has no file, shell, or web browsing tools. Check important information."
      : preset === "read-only"
        ? "Read only · file changes and shell commands are denied."
        : preset === "full-access"
          ? "Full access · edits, commands, and external tools run without approval. Session only."
          : "Default · you approve each file change and shell command.",
  );
  hide("working", !running);
  text(
    "agent-status",
    running ? "Working" : chat || trusted() ? "Ready" : "Waiting for a folder",
  );
  text(
    "file-status",
    file?.readOnly
      ? "Read only · sensitive values hidden"
      : trusted()
        ? readOnly
          ? "Read only · no edits or commands"
          : state?.permissionPreset === "full-access"
            ? "Full access · local execution"
            : "Default · changes need approval"
        : "Local workspace",
  );
  hide("dirty-indicator", !dirty());
}
const conversationDrafts = new Map<string, string>();
function draftScope(value: DesktopState | null | undefined) { return `${value?.conversationMode === "coding" ? value.workspace?.root || "none" : "chat"}:${value?.activeThreadId || "new"}`; }
function renderState(next: DesktopState) {
  document.querySelector(".agent-pane")?.classList.toggle("general-chat", next.conversationMode === "chat");
  const previousScope = draftScope(state);
  const nextScope = draftScope(next);
  if (state && previousScope !== nextScope) conversationDrafts.set(previousScope, prompt.value.trim().startsWith("/") ? "" : prompt.value);
  const oldRoot = state?.workspace?.root;
  const oldMode = state?.conversationMode;
  const oldThread = state?.activeThreadId;
  state = structuredClone(next);
  if (oldThread !== next.activeThreadId) {
    output = "";
    text(
      "output-log",
      "Command output will appear here. Your permission preset controls local command execution.",
    );
    el("activity-log").replaceChildren();
  }
  running = next.running;
  if (oldMode !== next.conversationMode) {
    conversationRoot = null;
    clearConversation(false);
    prompt.value = "";
    if (next.conversationMode === "chat") showWorkbench(false);
  }
  if (next.conversationMode === "chat") mode.value = "chat";
  else if (mode.value === "chat") mode.value = "build";
  text(
    "chat-welcome-title",
    next.conversationMode === "coding" ? "What are we building?" : "What’s on your mind?",
  );
  text(
    "chat-welcome-description",
    next.conversationMode === "coding" && next.workspace
      ? next.workspace.trusted
        ? `Work with ${next.workspace.name}. You stay in control of edits and commands.`
        : `Trust ${next.workspace.name} to work with its files, or return to general chat.`
      : "A question, a first draft, or something you want to build.",
  );
  prompt.placeholder =
    "Ask Coda… Type / for commands";
  if (oldRoot !== next.workspace?.root) {
    file = null;
    editor.value = "";
    hide("editor-wrap");
    hide("welcome", false);
    text("file-name", "Your next big thing");
    text("cursor-position", "No file selected");
    input("file-filter").value = "";
    clearConversation(false);
    text("line-numbers", "");
    conversationRoot = null;
    prompt.value = "";
    output = "";
    text(
      "output-log",
      "Command output will appear here. Your permission preset controls local command execution.",
    );
    el("activity-log").replaceChildren();
  }
  text("folder-name", next.workspace?.name || "Open a project folder");
  text(
    "folder-path",
    next.workspace?.root || "Your files stay on this computer.",
  );
  text(
    "trust-status",
    next.workspace?.trusted
      ? "Trusted project"
      : next.workspace
        ? "Trust required"
        : "No folder open",
  );
  text(
    "agent-context",
    next.conversationMode === "chat"
      ? "Chat · saved on this computer"
      : next.workspace?.trusted
        ? `Local · ${next.workspace.name}`
        : "Choose a project with /project",
  );
  text(
    "account-label",
    next.auth.signedIn ? "Connected · free plan" : "Your account",
  );
  button("account-open").classList.toggle("connected", next.auth.signedIn);
  const scope =
    next.conversationMode === "chat" ? "chat" : next.workspace?.root;
  const conversationKey = `${scope}:${next.activeThreadId || "current"}`;
  if (
    (next.conversationMode === "chat" || next.workspace?.trusted) &&
    next.conversation &&
    conversationRoot !== conversationKey &&
    !running
  ) {
    clearConversation(false);
    for (const item of next.conversation) appendMessage(item.role, item.text);
    conversationRoot = conversationKey;
  }
  if (previousScope !== nextScope) prompt.value = conversationDrafts.get(nextScope) || "";
  renderFiles();
  renderThreads();
  text("model-privacy-note", next.auth.allowPromptTraining === false
    ? "Provider prompt training is disallowed for hosted requests. Provider operational retention may still apply."
    : next.auth.allowPromptTraining === true || !next.auth.model
      ? "The hosted provider may retain prompts and code and use them for training. Do not send sensitive content."
      : "Provider training and retention policy is unavailable. Do not send sensitive content.");
  updateControls();
  renderAccount();
  if (
    next.conversationMode === "coding" &&
    next.workspace &&
    !next.workspace.trusted &&
    !el<HTMLDialogElement>("trust-dialog").open
  ) {
    pendingFolder = next.workspace;
    input("trust-check").checked = false;
    button("trust-confirm").disabled = true;
    text("trust-path", next.workspace.root);
    el<HTMLDialogElement>("trust-dialog").returnValue = "";
    el<HTMLDialogElement>("trust-dialog").showModal();
  }
}
function renderFiles() {
  const tree = el("file-tree");
  tree.replaceChildren();
  const workspace = state?.workspace;
  const overview = el("files-overview-list"); overview.replaceChildren();
  text("files-overview-title", workspace ? workspace.name : "Your project files");
  text("files-overview-description", workspace?.trusted ? `${workspace.files.length} project files available. Choose one here or in the explorer to read and edit it.` : workspace ? "Trust this selected folder before accessing its files." : "Open a local folder to explore its files alongside your conversation.");
  hide("welcome-open", !!workspace);
  if (workspace?.trusted) {
    for (const entry of [...workspace.files].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 6)) {
      const control = document.createElement("button"); control.type = "button"; control.textContent = entry.path; control.title = entry.path;
      control.disabled = running || actionBusy;
      control.addEventListener("click", () => void openFile(entry.path), { signal }); overview.append(control);
    }
  }
  if (!workspace?.trusted) {
    const p = document.createElement("p");
    p.className = "file-empty";
    p.textContent = workspace
      ? "Trust this folder before reading its files."
      : "Open a project to explore its files.";
    tree.append(p);
    return;
  }
  const filter = input("file-filter").value.toLowerCase();
  const files = workspace.files
    .filter((f) => f.path.toLowerCase().includes(filter))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of files.slice(0, 350)) {
    const node = document.createElement("button");
    node.type = "button";
    node.title = entry.path;
    node.className = file?.path === entry.path ? "selected" : "";
    node.disabled = running || actionBusy;
    const glyph = document.createElement("span");
    glyph.className = "file-glyph";
    glyph.textContent = "⌘";
    glyph.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = entry.path;
    node.append(glyph, name);
    node.addEventListener("click", () => void openFile(entry.path), { signal });
    tree.append(node);
  }
  if (!files.length || files.length > 350) {
    const p = document.createElement("p");
    p.className = "file-empty";
    p.textContent =
      files.length > 350
        ? "Showing 350 files. Filter by path to find more."
        : filter
          ? "No files match this path."
          : "No supported files found. Ignored and credential files are excluded.";
    tree.append(p);
  }
}
async function refreshFiles() {
  if (!state?.workspace?.trusted) return;
  const root = state.workspace.root;
  const request = ++filesRequest;
  try {
    const files = await bridge.listFiles();
    if (state?.workspace?.root === root && request === filesRequest) {
      state.workspace.files = files;
      renderFiles();
    }
  } catch (error) {
    showError(error);
  }
}
async function chooseFolder() {
  if (running || actionBusy || commandInFlight || promptQueue.length) { notify("Finish the current action and queued messages before opening a folder."); return; }
  if (
    dirty() &&
    !window.confirm(
      "Discard unsaved changes in this editor before opening another folder?",
    )
  )
    return;
  actionBusy = true;
  updateControls();
  clearError();
  try {
    const next = await bridge.openFolder();
    if (!next) return;
    if (next.trusted) {
      renderState({ ...(await bridge.getState()), workspace: next });
      mode.value = "build";
      notify(`Opened ${next.name} locally. Project tools are ready.`);
    } else {
      pendingFolder = next;
      input("trust-check").checked = false;
      button("trust-confirm").disabled = true;
      text("trust-path", next.root);
      el<HTMLDialogElement>("trust-dialog").returnValue = "";
      if (!el<HTMLDialogElement>("trust-dialog").open)
        el<HTMLDialogElement>("trust-dialog").showModal();
    }
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
  }
}
async function trustFolder() {
  const next = pendingFolder;
  pendingFolder = null;
  if (!next) return;
  const dialog = el<HTMLDialogElement>("trust-dialog");
  if (dialog.returnValue !== "trust") return;
  actionBusy = true;
  updateControls();
  clearError();
  try {
    const workspace = await bridge.trustWorkspace({
      root: next.root,
      consent: true,
    });
    renderState({ ...(await bridge.getState()), workspace });
    mode.value = "build";
    notify(`Opened ${workspace.name} locally. Project tools are ready.`);
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
  }
}
async function openFile(path: string) {
  if (!trusted() || running || actionBusy) return;
  if (
    dirty() &&
    !window.confirm("Discard your unsaved changes before opening another file?")
  )
    return;
  const root = state!.workspace!.root;
  const request = ++fileRequest;
  actionBusy = true;
  updateControls();
  clearError();
  try {
    const next = await bridge.readFile(path);
    if (root !== state?.workspace?.root || request !== fileRequest) return;
    file = next;
    showWorkbench(true);
    editor.value = next.content;
    text("file-name", next.path);
    hide("welcome");
    hide("editor-wrap", false);
    updateLineNumbers();
    renderFiles();
    updateCursor();
    if (next.readOnly)
      notify("Sensitive values are hidden. This file is read only.");
  } catch (error) {
    showError(error);
  } finally {
    if (root === state?.workspace?.root && request === fileRequest) {
      actionBusy = false;
      updateControls();
    }
  }
}
async function saveFile() {
  if (!file || file.readOnly || !dirty() || running || actionBusy) return;
  const path = file.path;
  const content = editor.value;
  const root = state!.workspace!.root;
  actionBusy = true;
  updateControls();
  clearError();
  try {
    const saved = await bridge.saveFile({
      path,
      content,
      expectedHash: file.hash,
    });
    if (root === state?.workspace?.root) {
      file = saved;
      editor.value = saved.content;
      notify(`Saved ${saved.path}.`);
      await refreshFiles();
    }
  } catch (error) {
    promptQueuePaused = true;
    renderPromptQueue();
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
    renderFiles();
  }
}
function updateLineNumbers() {
  const count = editor.value.split("\n").length;
  text(
    "line-numbers",
    Array.from({ length: count }, (_, i) => String(i + 1)).join("\n"),
  );
  el("line-numbers").scrollTop = editor.scrollTop;
}
function updateCursor() {
  const before = editor.value.slice(0, editor.selectionStart);
  const lines = before.split("\n");
  text(
    "cursor-position",
    `Ln ${lines.length}, Col ${lines.at(-1)!.length + 1}`,
  );
}
function copyControl(value: () => string, label: string) {
  const node = document.createElement("button");
  node.className = "chat-copy";
  node.textContent = label;
  node.setAttribute("aria-label", label);
  node.addEventListener(
    "click",
    async () => {
      try {
        await bridge.copyText(value());
        node.textContent = "Copied";
        setTimeout(() => (node.textContent = label), 1800);
      } catch (error) {
        showError(error);
      }
    },
    { signal },
  );
  return node;
}
function inlineContent(parent: HTMLElement, value: string) {
  for (const part of value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g)) {
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link && safeMarkdownLink(link[2])) {
      const label = document.createElement("span");
      label.textContent = `${link[1]} (${link[2]})`;
      parent.append(label, copyControl(() => link[2], "Copy link"));
    } else if (part.startsWith("**") && part.endsWith("**")) {
      const node = document.createElement("strong"); node.textContent = part.slice(2, -2); parent.append(node);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      const node = document.createElement("code"); node.textContent = part.slice(1, -1); parent.append(node);
    } else parent.append(document.createTextNode(part));
  }
}
function renderRichContent(parent: HTMLElement, content: string) {
  parent.classList.remove("streaming-response");
  parent.replaceChildren(); parent.dataset.raw = content;
  for (const part of parseMarkdownBlocks(content)) {
    if (part.kind === "code") {
      const block = document.createElement("div"); block.className = "chat-code";
      const head = document.createElement("div"), label = document.createElement("span");
      label.textContent = part.language;
      head.append(label, copyControl(() => part.text, "Copy code"));
      const pre = document.createElement("pre"), code = document.createElement("code");
      code.textContent = part.text; pre.append(code); block.append(head, pre); parent.append(block);
    } else if (part.kind === "list") {
      const list = document.createElement(part.ordered ? "ol" : "ul");
      if (list instanceof HTMLOListElement) list.start = part.start;
      for (const item of part.items) { const node = document.createElement("li"); inlineContent(node, item); list.append(node); }
      parent.append(list);
    } else if (part.kind === "table") {
      const scroll = document.createElement("div"); scroll.className = "chat-table-scroll"; scroll.tabIndex = 0;
      scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Response table");
      const table = document.createElement("table"), head = document.createElement("thead"), body = document.createElement("tbody");
      const header = document.createElement("tr");
      for (const cell of part.headers) { const node = document.createElement("th"); node.scope = "col"; inlineContent(node, cell); header.append(node); }
      head.append(header);
      for (const row of part.rows) { const node = document.createElement("tr"); for (const cell of row) { const td = document.createElement("td"); inlineContent(td, cell); node.append(td); } body.append(node); }
      table.append(head, body); scroll.append(table); parent.append(scroll);
    } else {
      const node = document.createElement(part.kind === "heading" ? `h${Math.max(2, part.level)}` : part.kind === "quote" ? "blockquote" : "p");
      inlineContent(node, part.text); parent.append(node);
    }
  }
}
function appendMessage(role: "user" | "assistant" | "system", content: string) {
  hide("chat-welcome");
  const node = document.createElement("article");
  node.className = `message ${role}`;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent =
    role === "user" ? "You" : role === "assistant" ? "Coda" : "Workspace";
  const speaker = document.createElement("div");
  speaker.className = "message-speaker";
  if (role !== "system") {
    const avatar = document.createElement("span");
    avatar.className = `message-avatar ${role}`;
    avatar.setAttribute("aria-hidden", "true");
    if (role === "assistant") {
      const logo = document.createElement("img");
      logo.src = "./logo.svg"; logo.alt = ""; logo.width = 22; logo.height = 22;
      avatar.append(logo);
    } else if (accountProfile.avatar) {
      const image = document.createElement("img"); image.src = accountProfile.avatar;
      image.alt = ""; image.width = 22; image.height = 22; avatar.append(image);
    } else avatar.textContent = accountProfile.name?.slice(0, 1).toUpperCase() || "U";
    speaker.append(avatar);
  }
  speaker.append(label);
  const paragraph = document.createElement("div");
  paragraph.className = "chat-message-content";
  paragraph.dataset.raw = content;
  if (role === "assistant") renderRichContent(paragraph, content);
  else paragraph.textContent = content;
  node.append(speaker, paragraph);
  if (role === "assistant")
    node.append(
      copyControl(() => paragraph.dataset.raw || "", "Copy response"),
    );
  el("conversation").append(node);
  scrollChat();
  return paragraph;
}
function scrollChat() {
  const conversation = el("conversation");
  conversation.scrollTop = conversation.scrollHeight;
}
function appendText(value: string) {
  if (!assistantParagraph) assistantParagraph = appendMessage("assistant", "");
  assistantParagraph.classList.add("streaming-response");
  assistantParagraph.dataset.raw =
    (assistantParagraph.dataset.raw || "") + value;
  assistantParagraph.textContent = assistantParagraph.dataset.raw;
  scrollChat();
}
function clearConversation(confirm = true) {
  if (running) return;
  if (
    confirm &&
    !window.confirm(
      "Start a new conversation? Local saved history will be cleared for this project.",
    )
  )
    return;
  const conversation = el("conversation");
  for (const child of Array.from(conversation.children)) {
    if (child.id !== "chat-welcome") child.remove();
  }
  hide("chat-welcome", false);
  assistantParagraph = null;
}
async function newConversation() {
  if (running || actionBusy) return;
  if (
    !isChat() &&
    dirty() &&
    !window.confirm("Keep unsaved editor changes and start a new task?")
  )
    return;
  actionBusy = true;
  updateControls();
  try {
    renderState(await bridge.createThread());
    prompt.value = "";
    prompt.focus();
    notify("New task started. Previous conversations are saved locally.");
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
  }
}
async function sendPrompt(event?: Event) {
  event?.preventDefault();
  if (actionBusy || !prompt.value.trim()) return;
  if (running) {
    notify("A task is running. Press Ctrl+Enter to add this message to the queue.");
    return;
  }
  try {
    const commandInput = prompt.value;
    if (await runSlashCommand(commandInput.trim())) {
      if (prompt.value === commandInput) prompt.value = "";
      closeSlashMenu();
      updateControls();
      return true;
    }
  } catch (error) {
    showError(error);
    return;
  }
  if (/^\/permissions(?:\s|$)/i.test(prompt.value.trim())) {
    if (prompt.value.trim().toLowerCase() !== "/permissions") {
      showError(new Error("Use /permissions to choose a permission preset."));
      return;
    }
    openPermissions();
    prompt.value = "";
    updateControls();
    return;
  }
  if (!isChat() && !trusted()) {
    notify("Open and trust a project folder before starting a task.");
    return;
  }
  if (!isChat() && dirty()) {
    showError(
      new Error("Save or discard your file changes before starting a task."),
    );
    return;
  }
  if (!state?.auth.signedIn) {
    openAccount();
    return;
  }
  const value = prompt.value.trim();
  const chosen = mode.value as AgentMode;
  actionBusy = true;
  running = true;
  updateControls();
  renderFiles();
  clearError();
  assistantParagraph = null;
  try {
    const result = await bridge.runAgent({ prompt: value, mode: chosen });
    activeRun = result.runId;
    appendMessage("user", value);
    prompt.value = "";
    activity(
      chosen === "chat"
        ? "Conversation started."
        : `${chosen === "build" ? "Build" : chosen === "plan" ? "Plan" : "Review"} started in ${workspaceName()}.`,
    );
    return true;
  } catch (error) {
    running = false;
    activeRun = null;
    promptQueuePaused = true;
    renderPromptQueue();
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
    renderFiles();
    if (!running) void drainPromptQueue();
  }
}
function renderPromptQueue() {
  const list = el("prompt-queue");
  list.replaceChildren();
  hide("prompt-queue", promptQueue.length === 0);
  if (promptQueuePaused && promptQueue.length) {
    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "Resume queued messages";
    resume.addEventListener("click", () => {
      if (running || actionBusy) return;
      promptQueuePaused = false;
      void drainPromptQueue();
    }, { signal });
    list.append(resume);
  }
  promptQueue.forEach((value, index) => {
    const row = document.createElement("div");
    row.className = "queued-prompt";
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${value.text}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove queued message ${index + 1}`);
    remove.addEventListener("click", () => {
      promptQueue.splice(index, 1);
      renderPromptQueue();
    }, { signal });
    row.append(label, remove);
    list.append(row);
  });
}
function enqueuePrompt() {
  const value = prompt.value.trim();
  if (!value) return;
  promptQueue.push({ text: value, mode: mode.value, threadId: state?.activeThreadId, root: state?.workspace?.root });
  prompt.value = "";
  renderPromptQueue();
  updateControls();
  notify(`Queued message ${promptQueue.length}. It will run after the current task settles.`);
}
async function drainPromptQueue() {
  if (promptQueuePaused || drainingPromptQueue || running || actionBusy || !promptQueue.length) return;
  drainingPromptQueue = true;
  try {
    while (!running && !actionBusy && promptQueue.length) {
      // Never overwrite a draft typed while the previous task was running.
      if (prompt.value.trim()) { promptQueuePaused = true; renderPromptQueue(); break; }
      const next = promptQueue[0];
      if (!canDeliverQueuedPrompt(next, { mode: mode.value, threadId: state?.activeThreadId, root: state?.workspace?.root }, prompt.value)) {
        promptQueuePaused = true; renderPromptQueue();
        notify("Return to the queued message’s conversation and mode before resuming."); break;
      }
      prompt.value = next.text;
      const accepted = await sendPrompt();
      const settled = settleQueuedPrompt(promptQueue, accepted === true);
      if (settled.paused) { promptQueuePaused = true; prompt.value = ""; }
      renderPromptQueue();
      if (running || promptQueuePaused) break;
    }
  } finally {
    drainingPromptQueue = false;
  }
}
let slashSelection = 0;
let slashDismissed = false;
function slashMatches() {
  return /^\/[^\s]*$/.test(prompt.value) && !slashDismissed
    ? filterConversationCommands(prompt.value, "desktop", 30) : [];
}
function closeSlashMenu() {
  hide("slash-menu");
  prompt.setAttribute("aria-expanded", "false");
  prompt.removeAttribute("aria-activedescendant");
}
function chooseSlashCommand(name: string) {
  prompt.value = name + " ";
  closeSlashMenu();
  prompt.focus();
  updateControls();
}
function renderSlashMenu() {
  const matches = slashMatches();
  const menu = el("slash-menu");
  menu.replaceChildren();
  if (!matches.length) { closeSlashMenu(); return; }
  slashSelection = Math.min(slashSelection, matches.length - 1);
  matches.forEach((command, index) => {
    const option = document.createElement("div");
    option.id = `slash-option-${index}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === slashSelection));
    const title = document.createElement("strong"); title.textContent = command.name;
    const description = document.createElement("span"); description.textContent = command.description;
    option.append(title, description);
    option.addEventListener("mousedown", event => { event.preventDefault(); chooseSlashCommand(command.name); }, { signal });
    menu.append(option);
  });
  hide("slash-menu", false);
  prompt.setAttribute("aria-expanded", "true");
  prompt.setAttribute("aria-activedescendant", `slash-option-${slashSelection}`);
  el(`slash-option-${slashSelection}`).scrollIntoView({ block: "nearest" });
}
function handleSlashKey(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const matches = slashMatches();
  if (!matches.length || el("slash-menu").hidden) return false;
  if (event.key === "Escape") { event.preventDefault(); slashDismissed = true; closeSlashMenu(); return true; }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    slashSelection = (slashSelection + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    renderSlashMenu(); return true;
  }
  if (event.key === "Tab" || event.key === "Enter") {
    event.preventDefault(); chooseSlashCommand(matches[slashSelection].name); return true;
  }
  return false;
}
button("commands-open").addEventListener("click", () => {
  if (prompt.value.trim() && !prompt.value.startsWith("/")) { notify("Type / at the start of a message to discover commands. Your draft is unchanged."); prompt.focus(); return; }
  prompt.value = "/"; slashDismissed = false; slashSelection = 0; prompt.focus(); renderSlashMenu(); updateControls();
}, { signal });
prompt.addEventListener("blur", () => closeSlashMenu(), { signal });
prompt.addEventListener("focus", renderSlashMenu, { signal });
async function openExtensions(kind?: "skill" | "mcp", source?: string | null) {
  if (running || promptQueue.length) { notify("Finish or remove queued messages before changing tools or skills."); return; }
  hide("extension-error");
  setExtensionView(kind === "mcp" ? "mcp" : kind === "skill" ? "skills" : "all");
  renderExtensions(await bridge.listExtensions());
  renderPluginBundles(await bridge.listPlugins());
  await renderToolChoices();
  if (kind) el<HTMLSelectElement>("extension-kind").value = kind;
  if (source) input("extension-url").value = source;
  const dialog = el<HTMLDialogElement>("extensions-dialog");
  if (!dialog.open) dialog.showModal();
  if (kind) input("extension-url").focus();
}
async function runSlashCommand(value: string): Promise<boolean> {
  const installIntent = parseSkillInstallIntent(value);
  if (installIntent) { await openExtensions("skill", installIntent.source); return true; }
  if (!value.startsWith("/")) return false;
  const [command, ...args] = value.trim().split(/\s+/);
  switch (command.toLowerCase()) {
    case "/help":
      appendMessage("assistant", "Commands: /project to choose a folder, /build to work on it, /plan and /review for read-only project tasks, /chat to return to general chat, /files, /terminal, /repos, /permissions, /usage, /status, /sync status|pull, /mcp, /skills, /tools, /new, /clear, /resume, /copy, /diff, /pwd. Project access requires folder trust; changes and commands follow your permissions.");
      return true;
    case "/new":
      await newConversation();
      return true;
    case "/clear":
      await newConversation();
      return true;
    case "/resume":
      if (args.length) {
        const saved = state?.threads?.find(thread => thread.id === args.join(" "));
        if (!saved) notify("Conversation not found. Use /resume to browse this workspace’s saved conversations.");
        else if (!running && !actionBusy && !promptQueue.length) renderState(await bridge.openThread(saved.id));
        else notify("Finish the current task and queued messages before resuming another conversation.");
      } else {
        el("app").classList.remove("sidebar-hidden"); hide("project-sidebar", false);
        button("toggle-sidebar").setAttribute("aria-expanded", "true"); input("thread-search").focus();
        notify("Choose a saved conversation in this workspace’s sidebar.");
      }
      return true;
    case "/copy": {
      if (running) { notify("Wait for the response to finish before copying it."); return true; }
      const replies = el("conversation").querySelectorAll<HTMLElement>(".message.assistant .chat-message-content");
      const answer = replies[replies.length - 1]?.innerText.trim();
      if (!answer) notify("No completed assistant response to copy.");
      else { await bridge.copyText(answer); notify("Latest response copied."); }
      return true;
    }
    case "/pwd":
    case "/cwd":
      notify(isChat() ? "General chat has no attached working directory." : state?.workspace?.root || "No local workspace selected.");
      return true;
    case "/diff": {
      if (isChat() || !trusted()) { notify("Open and trust a folder with /build before reviewing its changes."); return true; }
      if (running || actionBusy || commandInFlight || dirty()) { notify("Finish the current action and save editor changes before reviewing the diff."); return true; }
      showWorkbench(true); outputTab("output");
      const result = await bridge.runCommand({ command: "git -c core.hooksPath=/dev/null diff --no-ext-diff --no-textconv HEAD && git -c core.hooksPath=/dev/null ls-files --others --exclude-standard" });
      appendOutput(`\nRepository changes (tracked diff, then untracked paths only):\n${result.output}\nExit: ${result.exitCode}\n`);
      return true;
    }
    case "/chat":
    case "/build":
    case "/plan":
    case "/review":
      await switchAgentMode(command.slice(1).toLowerCase() as AgentMode);
      return true;
    case "/project":
      await chooseFolder();
      if (trusted() && state?.conversationMode === "coding") await switchAgentMode("build");
      return true;
    case "/files":
    case "/terminal":
      if (isChat() || !trusted()) notify("Use /build, /plan, or /review to select a trusted project first.");
      else {
        showWorkbench(true);
        if (command.toLowerCase() === "/terminal") { outputTab("output"); input("command").focus(); }
      }
      return true;
    case "/repos":
      button("github-repos-open").click();
      return true;
    case "/mode": {
      const selected = args[0] as AgentMode | undefined;
      if (!selected || !["chat", "build", "plan", "review"].includes(selected)) {
        notify("Use /mode chat, build, plan, or review.");
        return true;
      }
      await switchAgentMode(selected);
      return true;
    }
    case "/update":
      await bridge.checkForUpdates();
      return true;
    case "/permissions":
      if (args.length) notify("Use /permissions to choose a permission preset.");
      else openPermissions();
      return true;
    case "/usage":
      openAccount();
      return true;
    case "/status":
      notify(`${isChat() ? "Chat" : `${mode.value} workspace · ${workspaceName()}`} · ${trusted() ? "folder trusted" : "no trusted folder"} · ${state?.permissionPreset || "default"} permissions`);
      return true;
    case "/sync": {
      const action = args[0] || "status";
      if (action !== "status" && action !== "pull") {
        notify("Use /sync status or /sync pull.");
        return true;
      }
      const result = await bridge.syncRepository(action);
      appendMessage("assistant", `${result.repository || "Repository"} · ${result.branch || "detached HEAD"} → ${result.upstream || "no upstream"}\n${result.ahead} ahead · ${result.behind} behind · ${result.dirty ? "local changes present" : "clean"} · ${result.conflicts ? "conflicts present" : "no conflicts"}${result.operationInProgress ? " · Git operation in progress" : ""}${action === "status" ? "\nCounts reflect the last fetch. /sync pull explicitly fetches and fast-forwards a clean checkout." : "\nSync finished. Nothing was uploaded."}`);
      return true;
    }
    case "/skills":
      await openExtensions("skill");
      return true;
    case "/mcp":
      await openExtensions("mcp");
      return true;
    case "/tools":
    case "/plugins":
    case "/extensions":
      await openExtensions();
      if (command.toLowerCase() === "/tools") setExtensionView("tools");
      if (command.toLowerCase() === "/plugins") setExtensionView("plugins");
      return true;
    default:
      notify(codexUnsupportedCommand(command) || `Unknown command: ${command}. Use /help to see desktop commands.`);
      return true;
  }
}
async function stopRun() {
  if (!running) return;
  button("stop").disabled = true;
  try {
    await bridge.cancelRun();
    notify("Stop requested. Waiting for the current operation to finish.");
  } catch (error) {
    showError(error);
  } finally {
    updateControls();
  }
}
function appendOutput(value: string) {
  outputVersion++;
  output = (output + value).slice(-200000);
  text("output-log", output || "No command output yet.");
  el("output-log").scrollTop = el("output-log").scrollHeight;
}
function activity(value: string) {
  const log = el("activity-log");
  if (
    log.children.length === 1 &&
    log.firstElementChild?.textContent === "No agent activity yet."
  )
    log.replaceChildren();
  const p = document.createElement("p");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const description = document.createElement("span");
  description.textContent = value;
  p.append(time, description);
  log.append(p);
  while (log.children.length > 200) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}
function outputTab(panel: "output" | "activity") {
  button("output-tab").setAttribute(
    "aria-selected",
    String(panel === "output"),
  );
  button("activity-tab").setAttribute(
    "aria-selected",
    String(panel === "activity"),
  );
  hide("output-log", panel !== "output");
  hide("command-form", panel !== "output");
  hide("activity-log", panel !== "activity");
}
async function runCommand(event: Event) {
  event.preventDefault();
  const command = input("command").value.trim();
  if (!command || !trusted() || running || actionBusy) return;
  if (dirty()) {
    showError(new Error("Save your file before running a command."));
    return;
  }
  const previousOutput = outputVersion;
  actionBusy = true;
  commandInFlight = true;
  updateControls();
  clearError();
  appendOutput(`\n› ${command}\n`);
  input("command").value = "";
  try {
    const result = await bridge.runCommand({ command });
    if (outputVersion === previousOutput + 1) {
      appendOutput(
        `${result.output}\nExit code: ${result.exitCode ?? "cancelled"}\n`,
      );
    }
    await refreshFiles();
  } catch (error) {
    showError(error);
  } finally {
    actionBusy = false;
    commandInFlight = false;
    updateControls();
  }
}
function showApproval() {
  const request = approvalQueue[0];
  const dialog = el<HTMLDialogElement>("approval-dialog");
  if (!request) {
    currentApproval = null;
    if (dialog.open) dialog.close();
    return;
  }
  if (currentApproval === request.id && dialog.open) return;
  currentApproval = request.id;
  text(
    "approval-kind",
    request.kind === "shell"
      ? "Shell command approval"
      : "File change approval",
  );
  text(
    "approval-title",
    request.kind === "shell" ? "Run this command?" : "Make this change?",
  );
  text(
    "approval-description",
    request.kind === "shell"
      ? "Review the full command before allowing it to run."
      : "Review the proposed file change before allowing the agent to write.",
  );
  text("approval-content", request.description);
  text("approval-detail-label", request.kind === "shell" ? "Command" : "Proposed changes");
  text("approval-workspace", state?.workspace?.root || "Local workspace");
  text("approval-session-label", request.kind === "shell"
    ? "Allow commands and external tools this session"
    : "Allow all file changes this session");
  text("approval-session-detail", "Applies to this category · resets on project change or restart");
  dialog.dataset.kind = request.kind;
  text(
    "approval-warning",
    request.kind === "shell"
      ? "This command runs on your computer. It may change files outside the project and is not protected by an operating system sandbox."
      : "Only allow a change you understand. Your existing checks should still be run afterward.",
  );
  button("approve-tool").disabled = false;
  button("approve-session-tool").disabled = false;
  button("deny-tool").disabled = false;
  if (!dialog.open) dialog.showModal();
  button("deny-tool").focus();
}
async function decideApproval(approved: boolean, scope: "once" | "session" = "once") {
  const id = currentApproval;
  if (!id) return;
  button("approve-tool").disabled = true;
  button("approve-session-tool").disabled = true;
  button("deny-tool").disabled = true;
  try {
    const result = await bridge.respondApproval({
      id,
      approved,
      scope,
    });
    if (!result.accepted)
      throw new Error("This permission request is no longer active.");
    approvalQueue = approvalQueue.filter((a) => a.id !== id);
    currentApproval = null;
    showApproval();
  } catch (error) {
    showError(error);
    button("approve-tool").disabled = false;
    button("approve-session-tool").disabled = false;
    button("deny-tool").disabled = false;
  }
}
let githubRepos: import("../shared").DesktopGitHubRepo[] = [];
async function refreshGitHubRepositories() {
  const data = await bridge.githubRepositories(); githubRepos = data.repos;
  button("github-connect").disabled = !data.canInstall;
  const list = el("github-repos-list"); list.replaceChildren();
  if (!data.repos.length) { const empty = document.createElement("p"); empty.textContent = "No repositories are available. Connect the GitHub App, then refresh access."; list.append(empty); }
  for (const repo of data.repos) {
    const preference = data.repositories.find(item => item.repositoryId === repo.repositoryId);
    const row = document.createElement("fieldset"); row.className = "github-repo-row"; row.dataset.repo = String(repo.repositoryId);
    const legend = document.createElement("legend"); legend.textContent = `${repo.owner}/${repo.name}${repo.private ? " · Private" : ""}`;
    const enabledLabel = document.createElement("label"); const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.name = "enabled"; enabled.checked = preference?.enabled ?? false; enabledLabel.append(enabled, " Enable for this account");
    row.append(legend, enabledLabel);
    for (const [name, title, value] of [["branch", "Branch", preference?.branch || repo.defaultBranch], ["appDirectory", "App folder (empty for repository root)", preference?.appDirectory || ""]]) {
      const label = document.createElement("label"); label.textContent = title;
      const field = document.createElement("input"); field.name = name; field.value = value; field.maxLength = 255; label.append(field); row.append(label);
    }
    const compact = document.createElement("details"); compact.dataset.repositoryName = `${repo.owner}/${repo.name}`.toLowerCase();
    const summary = document.createElement("summary"); summary.textContent = `${repo.owner}/${repo.name}${enabled.checked ? " · Enabled" : ""}`;
    compact.append(summary, row); list.append(compact);
  }
  filterRepositories();
  text("github-repos-status", "Preferences are shared with your hosted account.");
}
function filterRepositories() {
  const query = input("github-repos-search").value.trim().toLowerCase();
  let count = 0;
  el("github-repos-list").querySelectorAll<HTMLDetailsElement>("details").forEach(row => {
    row.hidden = !row.dataset.repositoryName?.includes(query);
    if (!row.hidden) count++;
  });
  text("github-repos-results", `${count} ${count === 1 ? "repository" : "repositories"}`);
}
input("github-repos-search").addEventListener("input", filterRepositories, { signal });
button("github-repos-open").addEventListener("click", async () => {
  try { await refreshGitHubRepositories(); el<HTMLDialogElement>("github-repos-dialog").showModal(); } catch (error) { showError(error); }
}, { signal });
button("github-repos-close").addEventListener("click", () => el<HTMLDialogElement>("github-repos-dialog").close(), { signal });
button("github-repos-refresh").addEventListener("click", () => { void refreshGitHubRepositories().catch(error => text("github-repos-status", error instanceof Error ? error.message : "Could not refresh repositories.")); }, { signal });
button("github-connect").addEventListener("click", () => { void bridge.connectGitHub().catch(error => text("github-repos-status", error instanceof Error ? error.message : "Could not open GitHub.")); }, { signal });
button("github-reconnect").addEventListener("click", () => { void bridge.reconnectGitHub().catch(error => text("github-repos-status", error instanceof Error ? error.message : "Could not open Freecoda settings.")); }, { signal });
el("github-repos-form").addEventListener("submit", async event => {
  event.preventDefault(); button("github-repos-save").disabled = true;
  try {
    const repositories = githubRepos.map(repo => {
      const row = el("github-repos-list").querySelector<HTMLElement>(`[data-repo="${repo.repositoryId}"]`)!;
      return { repositoryId: repo.repositoryId, installationId: repo.installationId, owner: repo.owner, name: repo.name,
        enabled: row.querySelector<HTMLInputElement>('[name="enabled"]')!.checked,
        branch: row.querySelector<HTMLInputElement>('[name="branch"]')!.value,
        appDirectory: row.querySelector<HTMLInputElement>('[name="appDirectory"]')!.value };
    });
    await bridge.saveGitHubRepositories(repositories); text("github-repos-status", "Repository preferences saved to your account.");
  } catch (error) { text("github-repos-status", error instanceof Error ? error.message : "Could not save repositories."); }
  finally { button("github-repos-save").disabled = false; }
}, { signal });
let reviewedPlugin: { source: string; manifest: Awaited<ReturnType<DesktopBridge["previewPlugin"]>> } | null = null;
function renderPluginBundles(plugins: import("../shared").DesktopPlugin[]) {
  const list = el("plugin-bundles"); list.replaceChildren();
  if (!plugins.length) { const empty = document.createElement("p"); empty.className = "settings-empty"; empty.textContent = "No plugin bundles installed. Review a manifest to add its skills and MCP connections."; list.append(empty); }
  for (const plugin of plugins) {
    const row = document.createElement("div"); row.className = "extension-row";
    const info = document.createElement("div"); const name = document.createElement("strong"); name.textContent = plugin.name;
    const detail = document.createElement("small"); detail.textContent = `Installed bundle · ${plugin.skillCount} skills · ${plugin.serverCount} MCP servers · connection status shown below`;
    info.append(name, detail);
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove bundle";
    remove.addEventListener("click", async () => {
      if (running || promptQueue.length) { notify("Finish or remove queued messages before changing plugins."); return; }
      remove.disabled = true;
      try { renderPluginBundles(await bridge.removeInstalledPlugin(plugin.id)); renderExtensions(await bridge.listExtensions()); await renderToolChoices(); }
      catch (error) { text("plugin-error", message(error)); hide("plugin-error", false); remove.disabled = false; }
    }, { signal });
    row.append(info, remove); list.append(row);
  }
}
el("plugin-form").addEventListener("submit", async event => {
  event.preventDefault(); hide("plugin-error"); reviewedPlugin = null; hide("plugin-review");
  button("plugin-preview").disabled = true;
  try {
    if (running || promptQueue.length) throw Error("Finish or remove queued messages before reviewing plugins.");
    const source = input("plugin-source").value.trim();
    const manifest = await bridge.previewPlugin(source);
    reviewedPlugin = { source, manifest };
    text("plugin-review-name", manifest.name);
    text("plugin-review-source", source);
    const list = el("plugin-review-members"); list.replaceChildren();
    for (const member of [...manifest.skills.map(skill => `Skill: ${skill.name || "SKILL.md"} — ${skill.source}`), ...manifest.servers.map(server => `MCP: ${server.name} — ${server.url}`)]) {
      const row = document.createElement("li"); row.textContent = member; list.append(row);
    }
    hide("plugin-review", false);
  } catch (error) { text("plugin-error", message(error)); hide("plugin-error", false); }
  finally { button("plugin-preview").disabled = false; }
}, { signal });
button("plugin-cancel").addEventListener("click", () => { reviewedPlugin = null; hide("plugin-review"); }, { signal });
button("plugin-confirm").addEventListener("click", async () => {
  if (!reviewedPlugin) return;
  button("plugin-confirm").disabled = true; hide("plugin-error");
  try {
    if (running || promptQueue.length) throw Error("Finish or remove queued messages before installing plugins.");
    renderPluginBundles(await bridge.installReviewedPlugin(reviewedPlugin));
    reviewedPlugin = null; hide("plugin-review"); renderExtensions(await bridge.listExtensions()); await renderToolChoices();
  } catch (error) { text("plugin-error", message(error)); hide("plugin-error", false); }
  finally { button("plugin-confirm").disabled = false; }
}, { signal });
type ExtensionView = "all" | "plugins" | "mcp" | "skills" | "tools";
let extensionView: ExtensionView = "all";
let installedExtensions: import("../shared").DesktopExtension[] = [];
function setExtensionView(view: ExtensionView) {
  extensionView = view;
  for (const control of document.querySelectorAll<HTMLButtonElement>("[data-extension-view]")) {
    control.setAttribute("aria-pressed", String(control.dataset.extensionView === view));
  }
  hide("desktop-plugin-section", view !== "all" && view !== "plugins");
  hide("desktop-extension-section", view === "plugins" || view === "tools");
  hide("extensions-form", view === "plugins" || view === "tools");
  text("extensions-list-title", view === "mcp" ? "Installed MCP connections" : view === "skills" ? "Installed skills" : "Skills and MCP connections");
  const tools = document.getElementById("tool-choices");
  if (tools) tools.hidden = view !== "all" && view !== "tools";
  if (view === "mcp" || view === "skills") el<HTMLSelectElement>("extension-kind").value = view === "mcp" ? "mcp" : "skill";
  renderExtensions(installedExtensions);
}
for (const control of document.querySelectorAll<HTMLButtonElement>("[data-extension-view]")) {
  control.addEventListener("click", () => setExtensionView(control.dataset.extensionView as ExtensionView), { signal });
}
const pluginChecks = new Map<string, { status: string; names: string[] }>();
function renderExtensions(items: import("../shared").DesktopExtension[]) {
  installedExtensions = items;
  const list = el("extensions-list"); list.replaceChildren();
  const visible = items.filter(item => extensionView === "mcp" ? item.kind === "mcp" : extensionView === "skills" ? item.kind === "skill" : true);
  if (!visible.length) { const empty = document.createElement("p"); empty.className = "settings-empty"; empty.textContent = extensionView === "mcp" ? "No MCP connections installed. Add a trusted HTTPS endpoint below." : extensionView === "skills" ? "No skills installed. Add a SKILL.md source below." : "No tools or skills installed."; list.append(empty); }
  for (const item of visible) {
    const row = document.createElement("div"); row.className = "extension-row";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.name;
    const detail = document.createElement("small"); detail.textContent = item.kind === "skill" ? `Installed skill · ${item.enabled ? "Enabled" : "Disabled"}` : `Installed MCP server · ${item.enabled ? pluginChecks.get(item.id)?.status || "Not checked · not connected" : "Disabled · not connected"}`;
    info.append(name, detail);
    const actions = document.createElement("div"); actions.className = "extension-actions";
    if (item.kind === "skill") {
      const view = document.createElement("button"); view.textContent = "View instructions";
      view.setAttribute("aria-label", `View ${item.name} instructions`);
      view.addEventListener("click", async () => {
        try {
          const skill = await bridge.readSkill(item.id);
          text("skill-reader-title", skill.name);
          text("skill-reader-content", skill.instructions);
          el<HTMLDialogElement>("skill-reader").showModal();
        } catch (error) { showError(error); }
      }, { signal });
      actions.append(view);
    }
    const toggle = document.createElement("button"); toggle.textContent = item.enabled ? "Disable" : "Enable";
    toggle.setAttribute("aria-label", `${toggle.textContent} ${item.name}`);
    const remove = document.createElement("button"); remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${item.name}`);
    for (const [control, operation] of [[toggle, () => bridge.setExtensionEnabled({ id: item.id, enabled: !item.enabled })], [remove, () => bridge.removeExtension(item.id)]] as const) {
      control.addEventListener("click", async () => {
        toggle.disabled = remove.disabled = true;
        try { if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing tools or skills."); pluginChecks.delete(item.id); renderExtensions(await operation()); renderPluginBundles(await bridge.listPlugins()); await renderToolChoices(); } catch (error) { showError(error); toggle.disabled = remove.disabled = false; }
      }, { signal });
    }
    if (item.kind === "mcp") {
      const discover = document.createElement("button"); discover.textContent = "Check & list tools";
      discover.disabled = !item.enabled || running;
      discover.addEventListener("click", async () => {
        discover.disabled = true;
        try {
          detail.textContent = "Checking connection…";
          const names = await bridge.discoverTools(item.id);
          const status = `Ready at last check · ${names.join(", ") || "No tools returned"} · connection closed`;
          pluginChecks.set(item.id, { status, names }); detail.textContent = status;
          await renderToolChoices();
        } catch (error) {
          const reason = message(error);
          const signIn = /(?:401|403|unauthori[sz]ed|authentication required|sign.in|oauth)/i.test(reason);
          const status = signIn ? `Needs sign-in · ${reason}. Check this server’s authentication requirements; authenticated server setup is not available in this form.` : `Check failed · ${reason}. Verify the HTTPS endpoint and try Check & list tools again.`;
          pluginChecks.set(item.id, { status, names: [] }); detail.textContent = status;
        }
        finally { discover.disabled = !item.enabled; }
      }, { signal });
      actions.append(discover);
    }
    actions.append(toggle, remove); row.append(info, actions); list.append(row);
  }
}
button("extensions-open").addEventListener("click", () => void openExtensions().catch(showError), { signal });
button("skill-reader-close").addEventListener("click", () => el<HTMLDialogElement>("skill-reader").close(), { signal });
button("extensions-close").addEventListener("click", () => el<HTMLDialogElement>("extensions-dialog").close(), { signal });
el("extensions-form").addEventListener("submit", async event => {
  event.preventDefault(); button("extension-install").disabled = true; hide("extension-error");
  try {
    if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing tools or skills.");
    const kind = el<HTMLSelectElement>("extension-kind").value;
    if (kind !== "skill" && kind !== "mcp") throw Error("Choose an extension type.");
    renderExtensions(await bridge.installExtension({ kind, name: input("extension-name").value, url: input("extension-url").value }));
    input("extension-name").value = ""; input("extension-url").value = "";
    notify("Extension installed. Review its enabled state before the next coding task.");
  } catch (error) { text("extension-error", message(error)); hide("extension-error", false); }
  finally { button("extension-install").disabled = false; }
}, { signal });
let cloudWorkspaceRequest = 0;
async function loadCloudWorkspaces() {
  const request = ++cloudWorkspaceRequest;
  const list = el("cloud-workspace-list"); list.replaceChildren();
  if (!state?.auth.signedIn) { const empty = document.createElement("p"); empty.className = "workspace-empty"; empty.textContent = "Sign in to load your cloud environments."; list.append(empty); return; }
  const loading = document.createElement("p"); loading.className = "workspace-empty"; loading.textContent = "Loading cloud workspaces…"; list.append(loading);
  button("cloud-workspaces-refresh").disabled = true;
  try {
    const workspaces = await bridge.listCloudWorkspaces();
    if (request !== cloudWorkspaceRequest || !state?.auth.signedIn) return;
    list.replaceChildren();
    if (!workspaces.length) { const empty = document.createElement("p"); empty.className = "workspace-empty"; empty.textContent = "No cloud workspaces yet. Import a repository in the cloud workspace."; list.append(empty); }
    for (const workspace of workspaces) {
      const control = document.createElement("button"); control.type = "button"; control.className = "cloud-workspace-link";
      control.setAttribute("aria-label", `Open cloud workspace ${workspace.name} in your browser`);
      const name = document.createElement("strong"); name.textContent = workspace.name;
      const detail = document.createElement("small"); detail.textContent = `${workspace.repository || "Cloud project"} · ${workspace.status}`;
      control.append(name, detail);
      control.addEventListener("click", async () => {
        control.disabled = true;
        try { await bridge.openCloudWorkspace(workspace.id); notify(`${workspace.name} opened in your browser. Cloud conversations remain with that project.`); }
        catch (error) { showError(error); }
        finally { control.disabled = false; }
      }, { signal });
      list.append(control);
    }
  } catch (error) {
    if (request !== cloudWorkspaceRequest) return;
    list.replaceChildren(); const problem = document.createElement("p"); problem.className = "workspace-empty"; problem.textContent = `Could not load cloud workspaces: ${message(error)}. Use Refresh to retry.`; list.append(problem);
  } finally { if (request === cloudWorkspaceRequest) button("cloud-workspaces-refresh").disabled = false; }
}
button("cloud-workspaces-refresh").addEventListener("click", () => void loadCloudWorkspaces(), { signal });
button("account-avatar-open").addEventListener("click", openAccount, { signal });
button("footer-github-login").addEventListener("click", () => { openAccount(); void login(); }, { signal });
function renderAccountAvatar() {
  const signedIn = state?.auth.signedIn;
  const avatar = el("account-avatar"); avatar.replaceChildren();
  if (signedIn && accountProfile.avatar) {
    const image = document.createElement("img"); image.src = accountProfile.avatar; image.alt = ""; image.width = 28; image.height = 28; avatar.append(image);
  } else avatar.textContent = signedIn ? accountProfile.name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U" : "○";
  text("account-footer-label", signedIn ? accountProfile.name || "Your account" : "Sign in");
  button("account-avatar-open").setAttribute("aria-label", signedIn ? `${accountProfile.name || "Your account"} · Account & settings` : "Sign in to Freecoda");
}
function renderAccount() {
  if (!state) return;
  if (profileSignedIn !== state.auth.signedIn) {
    accountDetailsRequest++;
    accountAuthGeneration++;
    profileSignedIn = state.auth.signedIn;
    accountProfile = {};
    void loadCloudWorkspaces();
    if (state.auth.signedIn) void bridge.accountProfile().then(profile => {
      if (!state?.auth.signedIn) return;
      accountProfile = profile;
      renderAccountAvatar();
      for (const avatar of document.querySelectorAll<HTMLElement>(".message-avatar.user")) {
        avatar.replaceChildren();
        if (profile.avatar) { const image = document.createElement("img"); image.src = profile.avatar; image.alt = ""; image.width = 22; image.height = 22; avatar.append(image); }
        else avatar.textContent = profile.name?.slice(0, 1).toUpperCase() || "U";
      }
    }).catch(() => {});
  }
  text(
    "account-state",
    state.auth.signedIn
      ? `Connected to ${state.auth.server}`
      : "Connect your GitHub account to use the free hosted agent. Your local project is not uploaded to GitHub.",
  );
  renderAccountAvatar();
  hide("login", state.auth.signedIn || loginInProgress);
  hide("footer-github-login", state.auth.signedIn || loginInProgress);
  hide("logout", !state.auth.signedIn);
  hide("refresh-usage", !state.auth.signedIn);
  hide("account-details", !state.auth.signedIn);
  if (!state.auth.signedIn) {
    hide("usage-view");
    for (const id of ["account-profile-details", "account-repositories", "account-cloud-workspaces", "account-devices"]) el(id).replaceChildren();
  }
}
function openAccount() {
  const dialog = el<HTMLDialogElement>("account-dialog");
  if (!dialog.open) dialog.showModal();
  void refreshAccountDetails();
  if (state?.auth.signedIn) void refreshUsage();
}
function accountRow(container: HTMLElement, title: string, detail: string) {
  const row = document.createElement("div"); row.className = "account-detail-row";
  const name = document.createElement("strong"); name.textContent = title;
  const description = document.createElement("p"); description.textContent = detail;
  row.append(name, description); container.append(row);
  return row;
}
async function refreshAccountDetails() {
  const request = ++accountDetailsRequest;
  const signedIn = !!state?.auth.signedIn;
  button("account-refresh-details").disabled = true;
  const load = async <T>(id: string, task: () => Promise<T>, render: (target: HTMLElement, value: T) => void) => {
    text(id, "Loading…");
    try {
      const value = await task();
      if (request !== accountDetailsRequest || signedIn !== !!state?.auth.signedIn) return;
      const target = el(id); target.replaceChildren(); render(target, value);
    } catch (error) {
      if (request === accountDetailsRequest) text(id, `Could not load this section. ${message(error)}`);
    }
  };
  const tasks: Promise<void>[] = [load("account-integrations", async () => {
    const [extensions, plugins] = await Promise.all([bridge.listExtensions(), bridge.listPlugins()]);
    return { extensions, plugins };
  }, (target, data) => {
    if (!data.extensions.length && !data.plugins.length) { target.textContent = "No plugins, skills, or MCP servers installed on this computer."; return; }
    for (const plugin of data.plugins) accountRow(target, plugin.name, `Plugin bundle · ${plugin.skillCount} skills · ${plugin.serverCount} MCP servers`);
    for (const item of data.extensions) accountRow(target, item.name, `${item.kind === "skill" ? "Skill" : "MCP server"} · ${item.enabled ? "Enabled" : "Disabled"}${item.kind === "mcp" ? " · Connection status is checked in Plugins & tools" : ""}`);
  })];
  if (signedIn) {
    tasks.push(load("account-profile-details", () => bridge.accountProfile(), (target, profile) => {
      accountRow(target, profile.name || "Profile name unavailable", "GitHub account · One free plan, supported by sponsors");
      accountRow(target, "Connection", state?.auth.server || "Unavailable");
      accountRow(target, "Current workspace", state?.workspace ? `${state.workspace.name} · ${state.workspace.root} · ${state.workspace.trusted ? "Trusted" : "Trust required"}` : "General chat · no local repository access");
    }));
    tasks.push(load("account-repositories", () => bridge.githubRepositories(), (target, data) => {
      if (!data.repos.length && !data.repositories.length) { target.textContent = "No GitHub repositories available. Manage repositories to connect GitHub App access."; return; }
      for (const repo of data.repos) {
        const saved = data.repositories.find(item => item.owner === repo.owner && item.name === repo.name);
        accountRow(target, `${repo.owner}/${repo.name}`, `${repo.private ? "Private" : "Public"} · ${saved ? saved.enabled ? "Enabled" : "Disabled" : "Available · not configured"} · Branch: ${saved?.branch || repo.defaultBranch || "Not specified"}${saved?.appDirectory ? ` · App folder: ${saved.appDirectory}` : ""}`);
      }
      for (const saved of data.repositories.filter(item => !data.repos.some(repo => repo.owner === item.owner && repo.name === item.name))) accountRow(target, `${saved.owner}/${saved.name}`, "Saved preference · repository is not in current GitHub App access");
    }));
    tasks.push(load("account-cloud-workspaces", () => bridge.listCloudWorkspaces(), (target, workspaces) => {
      if (!workspaces.length) { target.textContent = "No cloud workspaces in this account."; return; }
      for (const workspace of workspaces) {
        const row = accountRow(target, workspace.name, `${workspace.status}${workspace.repository ? ` · ${workspace.repository}` : ""}${workspace.branch ? ` · ${workspace.branch}` : ""}${workspace.appDirectory ? ` · ${workspace.appDirectory}` : ""}`);
        const open = document.createElement("button"); open.type = "button"; open.className = "button secondary"; open.textContent = "Open in browser ↗"; open.setAttribute("aria-label", `Open ${workspace.name} in browser`);
        open.addEventListener("click", () => { open.disabled = true; void bridge.openCloudWorkspace(workspace.id).catch(showError).finally(() => { open.disabled = false; }); }, { signal }); row.append(open);
      }
    }));
  }
  await Promise.all(tasks);
  if (request === accountDetailsRequest) button("account-refresh-details").disabled = false;
}
button("account-refresh-details").addEventListener("click", () => { void refreshAccountDetails(); void refreshUsage(); }, { signal });
button("account-browser-settings").addEventListener("click", () => void bridge.openAccountSettings().catch(showError), { signal });
button("account-manage-repositories").addEventListener("click", () => { el<HTMLDialogElement>("account-dialog").close(); button("github-repos-open").click(); }, { signal });
button("account-manage-integrations").addEventListener("click", () => { el<HTMLDialogElement>("account-dialog").close(); void openExtensions().catch(showError); }, { signal });
async function refreshUsage() {
  if (accountBusy || !state?.auth.signedIn) return;
  accountBusy = true;
  const authGeneration = accountAuthGeneration;
  text("account-devices", "Loading connected devices…");
  text("usage-percent", "Loading…");
  el("usage-progress").hidden = true;
  hide("usage-view", false);
  button("refresh-usage").disabled = true;
  try {
    const result = await bridge.usage();
    if (authGeneration !== accountAuthGeneration || !state?.auth.signedIn) return;
    const data =
      result && typeof result === "object"
        ? "usage" in result
          ? (result as { usage: unknown }).usage
          : result
        : null;
    if (!data || typeof data !== "object")
      throw new Error("Allowance details are unavailable.");
    const value = data as {
      freeRemainingMicros?: number;
      dailyLimitMicros?: number;
      resetAt?: string;
      invited?: boolean;
      devices?: { name?: unknown; createdAt?: unknown }[];
    };
    if (
      typeof value.freeRemainingMicros !== "number" ||
      typeof value.dailyLimitMicros !== "number"
    )
      throw new Error("Allowance details are unavailable.");
    const remaining = Math.max(
      0,
      Math.min(
        100,
        Math.floor(
          (value.freeRemainingMicros / Math.max(1, value.dailyLimitMicros)) *
            100,
        ),
      ),
    );
    text("usage-percent", `${remaining}% remaining`);
    el<HTMLProgressElement>("usage-progress").value = remaining;
    el("usage-progress").hidden = false;
    text(
      "usage-reset",
      value.invited === false
        ? "Hosted AI is invite-only during the beta. An invitation is still required."
        : value.resetAt
          ? `Resets ${new Date(value.resetAt).toLocaleString()}. Shared free capacity may apply.`
          : "Fair-use limits apply. No paid upgrades.",
    );
    const devices = el("account-devices"); devices.replaceChildren();
    if (!Array.isArray(value.devices)) devices.textContent = "Device details are unavailable from this server.";
    else if (!value.devices.length) devices.textContent = "No active connected devices.";
    else for (const device of value.devices) {
      const date = typeof device.createdAt === "string" ? new Date(device.createdAt) : null;
      accountRow(devices, typeof device.name === "string" ? device.name : "Connected device", date && Number.isFinite(date.getTime()) ? `Connected ${date.toLocaleString()}` : "Active device");
    }
    hide("usage-view", false);
  } catch (error) {
    if (authGeneration === accountAuthGeneration && state?.auth.signedIn) {
      text("usage-percent", "Unavailable");
      text("usage-reset", message(error));
      text("account-devices", "Could not load connected devices. Refresh details to try again.");
    }
  } finally {
    accountBusy = false;
    button("refresh-usage").disabled = false;
  }
}
async function login() {
  if (loginInProgress) return;
  loginInProgress = true;
  button("login").disabled = true;
  clearError();
  renderAccount();
  try {
    const result = await bridge.login();
    text("login-code", result.userCode);
    text(
      "login-instructions",
      "Finish connecting in the browser that just opened. Enter this code if asked:",
    );
    hide("login-view", false);
    activity("Waiting for account approval in your browser.");
  } catch (error) {
    loginInProgress = false;
    showError(error);
    renderAccount();
  } finally {
    button("login").disabled = false;
  }
}
async function logout() {
  if (running) {
    showError(new Error("Stop the current task before signing out."));
    return;
  }
  button("logout").disabled = true;
  try {
    await bridge.logout();
    loginInProgress = false;
    hide("login-view");
    renderState(await bridge.getState());
    notify("Signed out. Your local project stays on this computer.");
  } catch (error) {
    showError(error);
  } finally {
    button("logout").disabled = false;
  }
}
async function handleEvent(event: DesktopEvent) {
  switch (event.type) {
    case "state":
      renderState(event.state);
      break;
    case "run-started":
      activeRun = event.runId;
      running = true;
      assistantParagraph = null;
      updateControls();
      renderFiles();
      break;
    case "text-delta":
      if (!activeRun || event.runId === activeRun) appendText(event.text);
      break;
    case "tool-start":
      if (event.runId === activeRun) {
        activity(`Using ${event.name}.`);
        text("working-text", `Using ${event.name.replaceAll("_", " ")}…`);
      }
      break;
    case "tool-result":
      if (event.runId === activeRun) {
        activity(`Finished ${event.name}.`);
        if (event.name === "shell" && event.result) {
          const wrapped = event.result as { type?: string; value?: unknown };
          const result = (
            wrapped.type === "json" ? wrapped.value : event.result
          ) as {
            stdout?: string;
            stderr?: string;
            output?: string;
            exitCode?: number;
          };
          const value = [result.stdout, result.stderr, result.output]
            .filter((v) => typeof v === "string")
            .join("\n");
          if (value)
            appendOutput(
              `${value}\n${result.exitCode !== undefined ? `Exit code: ${result.exitCode}\n` : ""}`,
            );
        }
      }
      break;
    case "approval":
      if (!approvalQueue.some((a) => a.id === event.id)) {
        approvalQueue.push(event);
        activity(
          `Waiting for ${event.kind === "shell" ? "command" : "file change"} approval.`,
        );
        showApproval();
      }
      break;
    case "approval-resolved":
      approvalQueue = approvalQueue.filter((a) => a.id !== event.id);
      if (currentApproval === event.id) currentApproval = null;
      activity(
        event.approved
          ? "Permission granted for this action."
          : "Permission denied.",
      );
      showApproval();
      break;
    case "output":
      appendOutput(event.text);
      if (event.exitCode !== undefined)
        appendOutput(`\nExit code: ${event.exitCode ?? "cancelled"}\n`);
      break;
    case "done":
      if (!activeRun || event.runId === activeRun) {
        if (event.cancelled && event.text) appendMessage("system", event.text);
        else if (!assistantParagraph && event.text) appendText(event.text);
        if (assistantParagraph) {
          renderRichContent(
            assistantParagraph,
            assistantParagraph.dataset.raw || "",
          );
          if (event.cancelled) {
            const note = document.createElement("p");
            note.className = "chat-incomplete";
            note.textContent =
              "Incomplete response — not saved to conversation context.";
            assistantParagraph.after(note);
          }
        }
        running = false;
        activeRun = null;
        assistantParagraph = null;
        if (event.cancelled) { promptQueuePaused = true; renderPromptQueue(); }
        activity(event.cancelled ? "Task stopped." : "Task completed.");
        text("working-text", "Working in your project…");
        approvalQueue = approvalQueue.filter((a) => a.runId !== event.runId);
        showApproval();
        updateControls();
        if (!isChat()) await refreshFiles();
        if (!isChat() && file && !dirty()) {
          const path = file.path;
          try {
            const fresh = await bridge.readFile(path);
            file = fresh;
            editor.value = fresh.content;
            updateLineNumbers();
            updateCursor();
          } catch {
            /* The agent may have removed this file; preserve the visible editor. */
          }
        }
        renderState(await bridge.getState());
        if (
          state?.auth.signedIn &&
          el<HTMLDialogElement>("account-dialog").open
        )
          void refreshUsage();
        void drainPromptQueue();
      }
      break;
    case "error":
      promptQueuePaused = true;
      renderPromptQueue();
      showError(new Error(event.text));
      if (assistantParagraph) {
        const note = document.createElement("p");
        note.className = "chat-incomplete";
        note.textContent =
          "Incomplete response — not saved to conversation context.";
        assistantParagraph.after(note);
      }
      if (!event.runId || !activeRun || event.runId === activeRun) {
        running = false;
        activeRun = null;
        assistantParagraph = null;
        updateControls();
        renderFiles();
        void drainPromptQueue();
      }
      activity("The action stopped. Review the error before trying again.");
      break;
    case "auth":
      loginInProgress = false;
      hide("login-view");
      notify(event.message);
      renderState(await bridge.getState());
      if (event.signedIn) void refreshUsage();
      break;
  }
}

async function switchAgentMode(chosen: AgentMode) {
  if (running || actionBusy || commandInFlight) {
    mode.value = isChat() ? "chat" : "build";
    return;
  }
  try {
    if ((chosen === "chat") !== isChat() && dirty()) {
      mode.value = isChat() ? "chat" : "build";
      throw Error(
        "Save or discard your editor changes before switching conversation modes.",
      );
    }
    if (chosen !== "chat" && !trusted()) {
      try {
        renderState(await bridge.setConversationMode("coding"));
      } catch {
        await chooseFolder();
      }
      if (!trusted() || state?.conversationMode !== "coding") {
        mode.value = isChat() ? "chat" : "build";
        return;
      }
    }
    const desired = chosen === "chat" ? "chat" : "coding";
    if (state?.conversationMode !== desired)
      renderState(await bridge.setConversationMode(desired));
    mode.value = chosen;
    updateControls();
  } catch (error) {
    mode.value = isChat() ? "chat" : "build";
    showError(error);
  } finally {
    updateControls();
  }
}
mode.addEventListener(
  "change",
  () => void switchAgentMode(mode.value as AgentMode),
  { signal },
);

function openPermissions() {
  if (running || actionBusy || commandInFlight) return;
  const preset = state?.permissionPreset || "default";
  for (const node of el(
    "permissions-dialog",
  ).querySelectorAll<HTMLInputElement>('input[name="permission-preset"]'))
    node.checked = node.value === preset;
  const dialog = el<HTMLDialogElement>("permissions-dialog");
  if (!dialog.open) dialog.showModal();
}
button("permissions-open").addEventListener("click", openPermissions, {
  signal,
});
button("permissions-cancel").addEventListener(
  "click",
  () => el<HTMLDialogElement>("permissions-dialog").close(),
  { signal },
);
el("permissions-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    if (running || actionBusy || commandInFlight) return;
    const selected = el("permissions-dialog").querySelector<HTMLInputElement>(
      'input[name="permission-preset"]:checked',
    )?.value;
    if (
      !selected ||
      !["read-only", "default", "full-access"].includes(selected)
    )
      return;
    actionBusy = true;
    updateControls();
    try {
      renderState(
        await bridge.setPermissions(selected as DesktopPermissionPreset),
      );
      el<HTMLDialogElement>("permissions-dialog").close();
      notify("Session permissions updated.");
    } catch (error) {
      showError(error);
    } finally {
      actionBusy = false;
      updateControls();
    }
  },
  { signal },
);
prompt.addEventListener(
  "keydown",
  (event) => {
    if (event.isComposing) return;
    if (handleSlashKey(event)) return;
    if (event.key === "Enter" && event.shiftKey) return;
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      if (running) enqueuePrompt();
      else void sendPrompt();
      return;
    }
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.metaKey) {
      event.preventDefault();
      void sendPrompt();
    }
  },
  { signal },
);

function showWorkbench(open: boolean) {
  hide("workbench", !open);
  el("app").classList.toggle("tools-open", open);
  button("toggle-workbench").setAttribute("aria-expanded", String(open));
}
function renderThreads() {
  const threads = state?.threads || [];
  const search = input("thread-search").value.toLowerCase();
  hide("current-thread", threads.length > 0);
  const active = threads.find((thread) => thread.id === state?.activeThreadId);
  const title =
    active?.title ||
    state?.conversation
      ?.find((item) => item.role === "user")
      ?.text.slice(0, 70) ||
    "New task";
  text("conversation-title", title);
  text("thread-title", title);
  const history = el("thread-history");
  history.replaceChildren();
  const matches = threads.filter((thread) => thread.title.toLowerCase().includes(search));
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "workspace-empty";
    empty.textContent = search ? "No matching conversations." : "New conversations will appear here.";
    history.append(empty);
  }
  for (const thread of matches) {
    const node = document.createElement("button");
    node.className = "thread-link";
    node.textContent = thread.title || "New task";
    const updated = new Date(thread.updatedAt);
    node.title = `${thread.title || "New task"}${Number.isNaN(updated.getTime()) ? "" : ` · Updated ${updated.toLocaleString()}`}`;
    if (thread.id === state?.activeThreadId)
      node.setAttribute("aria-current", "page");
    node.disabled = running || actionBusy;
    node.addEventListener(
      "click",
      async () => {
        if (running || actionBusy || thread.id === state?.activeThreadId)
          return;
        actionBusy = true;
        updateControls();
        try {
          renderState(await bridge.openThread(thread.id));
          updateControls();
        } catch (error) {
          showError(error);
        } finally {
          actionBusy = false;
          updateControls();
        }
      },
      { signal },
    );
    const row = document.createElement("div");
    row.className = "chat-history-row";
    const remove = document.createElement("button");
    remove.className = "chat-history-delete";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${thread.title}`);
    remove.disabled = running || actionBusy;
    remove.addEventListener(
      "click",
      async () => {
        if (
          running ||
          actionBusy ||
          !window.confirm("Delete this conversation from this computer?")
        )
          return;
        actionBusy = true;
        updateControls();
        try {
          renderState(await bridge.deleteThread(thread.id));
        } catch (error) {
          showError(error);
        } finally {
          actionBusy = false;
          updateControls();
        }
      },
      { signal },
    );
    row.append(node, remove);
    history.append(row);
  }
}
input("thread-search").addEventListener("input", renderThreads, { signal });
button("toggle-workbench").addEventListener(
  "click",
  () => showWorkbench(el("workbench").hidden === true),
  { signal },
);
button("close-workbench").addEventListener(
  "click",
  () => showWorkbench(false),
  { signal },
);
button("sidebar-files").addEventListener("click", () => showWorkbench(true), {
  signal,
});
button("sidebar-output").addEventListener(
  "click",
  () => {
    showWorkbench(true);
    outputTab("output");
    input("command").focus();
  },
  { signal },
);
button("toggle-sidebar").addEventListener(
  "click",
  () => {
    const hidden = el("app").classList.toggle("sidebar-hidden");
    hide("project-sidebar", hidden);
    button("toggle-sidebar").setAttribute("aria-expanded", String(!hidden));
  },
  { signal },
);
button("sidebar-start-chat").addEventListener("click", () => button("new-chat").click(), { signal });
for (const [rail, target] of [["rail-chat", "sidebar-general-chat"], ["rail-repositories", "github-repos-open"], ["rail-plugins", "extensions-open"], ["rail-account", "account-avatar-open"]]) {
  button(rail!).addEventListener("click", () => button(target!).click(), { signal });
}
button("sidebar-general-chat").addEventListener("click", () => void switchAgentMode("chat"), { signal });
button("sidebar-plugins").addEventListener("click", () => void openExtensions().catch(showError), { signal });
button("sidebar-account").addEventListener("click", openAccount, { signal });
button("sidebar-new-task").addEventListener(
  "click",
  () => void newConversation(),
  { signal },
);
button("current-thread").addEventListener("click", () => prompt.focus(), {
  signal,
});
button("sponsor-info").addEventListener(
  "click",
  () => void bridge.openSponsor().catch(showError),
  { signal },
);
async function loadSponsor() {
  try {
    const sponsor = await bridge.getSponsor();
    text("sponsor-label", sponsor.label);
    text("sponsor-headline", sponsor.headline);
    text("sponsor-description", sponsor.description);
    el("sponsor-placement").setAttribute(
      "aria-label",
      sponsor.paid ? "Sponsored placement" : "Freecoda announcement",
    );
    if (!sponsor.paid) return;
    let visible = false;
    const report = () => {
      if (visible && document.visibilityState === "visible")
        void bridge.reportSponsorVisible().catch(() => {});
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5,
        );
        report();
      },
      { threshold: [0.5] },
    );
    observer.observe(el("sponsor-placement"));
    document.addEventListener("visibilitychange", report, { signal });
    window.addEventListener("focus", report, { signal });
    signal.addEventListener("abort", () => observer.disconnect(), {
      once: true,
    });
  } catch {
    /* The visible first-party fallback never blocks the workspace. */
  }
}

button("error-close").addEventListener("click", clearError, { signal });
for (const id of ["open-folder", "welcome-open"])
  button(id).addEventListener("click", () => void chooseFolder(), { signal });
button("refresh-files").addEventListener("click", () => void refreshFiles(), {
  signal,
});
input("file-filter").addEventListener("input", renderFiles, { signal });
button("save-file").addEventListener("click", () => void saveFile(), {
  signal,
});
editor.addEventListener(
  "input",
  () => {
    updateLineNumbers();
    updateCursor();
    updateControls();
  },
  { signal },
);
editor.addEventListener(
  "scroll",
  () => {
    el("line-numbers").scrollTop = editor.scrollTop;
  },
  { signal },
);
for (const event of ["click", "keyup", "select"])
  editor.addEventListener(event, updateCursor, { signal });
editor.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const start = editor.selectionStart,
        end = editor.selectionEnd;
      editor.setRangeText("  ", start, end, "end");
      updateLineNumbers();
      updateCursor();
      updateControls();
    }
  },
  { signal },
);
prompt.addEventListener("input", () => { slashDismissed = false; slashSelection = 0; renderSlashMenu(); updateControls(); }, { signal });
el("chat-form").addEventListener("submit", (event) => void sendPrompt(event), {
  signal,
});
button("stop").addEventListener("click", () => void stopRun(), { signal });
button("new-chat").addEventListener("click", () => void newConversation(), {
  signal,
});
button("output-tab").addEventListener("click", () => outputTab("output"), {
  signal,
});
button("activity-tab").addEventListener("click", () => outputTab("activity"), {
  signal,
});
button("clear-output").addEventListener(
  "click",
  () => {
    output = "";
    text("output-log", "Visible output cleared.");
    el("activity-log").replaceChildren();
  },
  { signal },
);
input("command").addEventListener("input", updateControls, { signal });
el("command-form").addEventListener(
  "submit",
  (event) => void runCommand(event),
  { signal },
);
input("trust-check").addEventListener(
  "change",
  () => {
    button("trust-confirm").disabled = !input("trust-check").checked;
  },
  { signal },
);
el<HTMLDialogElement>("trust-dialog").addEventListener(
  "close",
  () => void trustFolder(),
  { signal },
);
button("deny-tool").addEventListener(
  "click",
  () => void decideApproval(false),
  { signal },
);
button("approve-tool").addEventListener(
  "click",
  () => void decideApproval(true),
  { signal },
);
button("approve-session-tool").addEventListener("click", () => void decideApproval(true, "session"), { signal });
el<HTMLDialogElement>("approval-dialog").addEventListener("keydown", (event) => {
  const choices = [button("approve-tool"), button("approve-session-tool"), button("deny-tool")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length].focus();
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && ["1", "2", "3"].includes(event.key)) {
    event.preventDefault();
    choices[Number(event.key) - 1].focus();
  }
}, { signal });
el<HTMLDialogElement>("approval-dialog").addEventListener(
  "cancel",
  (event) => {
    event.preventDefault();
    void decideApproval(false);
  },
  { signal },
);
button("stop-command").addEventListener(
  "click",
  () => {
    void bridge
      .cancelRun()
      .then(() => notify("Command stop requested."))
      .catch(showError);
  },
  { signal },
);
button("account-open").addEventListener("click", openAccount, { signal });
button("account-close").addEventListener(
  "click",
  () => el<HTMLDialogElement>("account-dialog").close(),
  { signal },
);
button("login").addEventListener("click", () => void login(), { signal });
button("logout").addEventListener("click", () => void logout(), { signal });
button("refresh-usage").addEventListener("click", () => void refreshUsage(), {
  signal,
});
button("cloud-open").addEventListener(
  "click",
  () => {
    void bridge.openCloud().catch(showError);
  },
  { signal },
);
document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach((node) =>
  node.addEventListener(
    "click",
    async () => {
      await switchAgentMode((node.dataset.mode || "chat") as AgentMode);
      prompt.value = node.dataset.prompt || "";
      updateControls();
      prompt.focus();
    },
    { signal },
  ),
);
document.addEventListener(
  "keydown",
  (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveFile();
    } else if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      void chooseFolder();
    } else if (event.key === "Enter" && document.activeElement === prompt) {
      event.preventDefault();
      void sendPrompt();
    }
  },
  { signal },
);
const unsubscribe = bridge?.onEvent((event) => {
  void handleEvent(event).catch(showError);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty() || running) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener(
  "unload",
  () => {
    abort.abort();
    unsubscribe?.();
    clearTimeout(noticeTimer);
  },
  { once: true },
);
if (!bridge) {
  showError(
    new Error(
      "The secure desktop connection is unavailable. Restart Freecoda to reconnect.",
    ),
  );
  updateControls();
} else {
  void bridge.appInfo().then(({ version, packaged }) => {
    text("app-version", `v${version}${packaged ? "" : " · Local development"}`);
  }).catch(showError);
  void bridge.getState().then(renderState).catch(showError);
  void loadSponsor();
}

async function renderToolChoices() {
  let list = document.getElementById("tool-choices");
  if (!list) { list = document.createElement("div"); list.id = "tool-choices"; el("extensions-list").after(list); }
  list.replaceChildren();
  list.hidden = extensionView !== "all" && extensionView !== "tools";
  const title = document.createElement("p"); title.textContent = "Tools for the next task · session only. Mode and approval restrictions still apply. MCP tools appear after an explicit check."; list.append(title);
  for (const tool of await bridge.toolChoices()) {
    const label = document.createElement("label"); const box = document.createElement("input");
    box.type = "checkbox"; box.checked = tool.enabled; box.disabled = running;
    box.addEventListener("change", async () => {
      box.disabled = true;
      try { if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing tools."); await bridge.setToolEnabled({ name: tool.name, enabled: box.checked }); }
      catch (error) { box.checked = !box.checked; showError(error); }
      finally { box.disabled = running; }
    }, { signal });
    label.append(box, tool.name); list.append(label);
  }
}
