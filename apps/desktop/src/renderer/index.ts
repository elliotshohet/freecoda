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
  `${modifier} Enter to send`;

function message(error: unknown) {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      )
    : "This action could not be completed. Please try again.";
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
function updateControls() {
  const chat = isChat();
  text("sidebar-heading-label", chat ? "Your chats" : "Workspace");
  hide("coding-section-label", chat);
  text("sidebar-new-task", chat ? "＋ New chat" : "＋ New task");
  if (chat) {
    text("folder-name", "Coding workspace");
    text("folder-path", "Chat history stays on this computer.");
  }
  const ready = (chat || trusted()) && !running && !actionBusy;
  const safe = !chat && trusted() && !running && !actionBusy;
  const readOnly = state?.permissionPreset === "read-only";
  const localCommand = /^\/permissions(?:\s|$)/i.test(prompt.value.trim());
  button("open-folder").disabled = running || actionBusy;
  button("folder-picker").disabled = running || actionBusy;
  button("welcome-open").disabled = running || actionBusy;
  button("refresh-files").disabled = !safe;
  button("save-file").disabled =
    !safe || readOnly || !file || file.readOnly || !dirty();
  editor.disabled = !safe || readOnly || !file || file.readOnly;
  prompt.disabled = running || actionBusy;
  mode.disabled = running || actionBusy;
  button("send").disabled =
    running ||
    actionBusy ||
    !prompt.value.trim() ||
    (!localCommand && (!ready || !state?.auth.signedIn || (!chat && dirty())));
  hide("send", running);
  hide("stop", !running);
  button("stop").disabled = actionBusy;
  button("new-chat").disabled = !ready;
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
      node.hidden = node.dataset.conversation !== (chat ? "chat" : "coding");
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
          ? "Full access · local edits and shell commands run without approval. Session only."
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
function renderState(next: DesktopState) {
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
    next.conversationMode === "chat"
      ? "What can I help with?"
      : "What are we building?",
  );
  text(
    "chat-welcome-description",
    next.conversationMode === "chat"
      ? "A little room to think, write, and build."
      : "Ask about your project, plan a change, or build something new.",
  );
  prompt.placeholder =
    next.conversationMode === "chat"
      ? "Message Freecoda…"
      : "Ask about your project…";
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
        ? next.workspace.name
        : "Open a folder to start",
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
  renderFiles();
  renderThreads();
  text("model-label", next.auth.model || "Freecoda model");
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
  if (running || actionBusy) return;
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
      notify(`Opened ${next.name}.`);
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
    notify(`Opened ${workspace.name}.`);
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
  for (const part of value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (part.startsWith("**") && part.endsWith("**")) {
      const node = document.createElement("strong");
      node.textContent = part.slice(2, -2);
      parent.append(node);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      const node = document.createElement("code");
      node.textContent = part.slice(1, -1);
      parent.append(node);
    } else parent.append(document.createTextNode(part));
  }
}
function renderRichContent(parent: HTMLElement, content: string) {
  parent.replaceChildren();
  parent.dataset.raw = content;
  for (const part of content.split(/(```[\s\S]*?```)/g)) {
    if (part.startsWith("```") && part.endsWith("```")) {
      const body = part.slice(3, -3),
        newline = body.indexOf("\n");
      const code = newline >= 0 ? body.slice(newline + 1) : body;
      const block = document.createElement("div");
      block.className = "chat-code";
      const head = document.createElement("div");
      const label = document.createElement("span");
      label.textContent =
        newline >= 0 ? body.slice(0, newline).trim() || "Code" : "Code";
      head.append(
        label,
        copyControl(() => code, "Copy code"),
      );
      const pre = document.createElement("pre"),
        codeNode = document.createElement("code");
      codeNode.textContent = code;
      pre.append(codeNode);
      block.append(head, pre);
      parent.append(block);
    } else
      for (const line of part.split("\n")) {
        const node = document.createElement(/^#{1,3} /.test(line) ? "h3" : "p");
        inlineContent(node, line.replace(/^#{1,3} /, "") || "\u00a0");
        parent.append(node);
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
    role === "user" ? "You" : role === "assistant" ? "Freecoda" : "Workspace";
  const paragraph = document.createElement("div");
  paragraph.className = "chat-message-content";
  paragraph.dataset.raw = content;
  if (role === "assistant") renderRichContent(paragraph, content);
  else paragraph.textContent = content;
  node.append(label, paragraph);
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
  if (running || actionBusy || !prompt.value.trim()) return;
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
  } catch (error) {
    running = false;
    activeRun = null;
    showError(error);
  } finally {
    actionBusy = false;
    updateControls();
    renderFiles();
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
  text(
    "approval-warning",
    request.kind === "shell"
      ? "This command runs on your computer. It may change files outside the project and is not protected by an operating system sandbox."
      : "Only allow a change you understand. Your existing checks should still be run afterward.",
  );
  button("approve-tool").disabled = false;
  button("deny-tool").disabled = false;
  if (!dialog.open) dialog.showModal();
  button("deny-tool").focus();
}
async function decideApproval(approved: boolean) {
  const id = currentApproval;
  if (!id) return;
  button("approve-tool").disabled = true;
  button("deny-tool").disabled = true;
  try {
    const result = await bridge.respondApproval({
      id,
      approved,
      scope: "once",
    });
    if (!result.accepted)
      throw new Error("This permission request is no longer active.");
    approvalQueue = approvalQueue.filter((a) => a.id !== id);
    currentApproval = null;
    showApproval();
  } catch (error) {
    showError(error);
    button("approve-tool").disabled = false;
    button("deny-tool").disabled = false;
  }
}
function renderAccount() {
  if (!state) return;
  text(
    "account-state",
    state.auth.signedIn
      ? `Connected to ${state.auth.server}${state.auth.model ? `\nModel: ${state.auth.model}` : ""}`
      : "Connect your GitHub account to use the free hosted agent. Your local project is not uploaded to GitHub.",
  );
  hide("login", state.auth.signedIn || loginInProgress);
  hide("logout", !state.auth.signedIn);
  hide("refresh-usage", !state.auth.signedIn);
  if (!state.auth.signedIn) hide("usage-view");
}
function openAccount() {
  const dialog = el<HTMLDialogElement>("account-dialog");
  if (!dialog.open) dialog.showModal();
  if (state?.auth.signedIn) void refreshUsage();
}
async function refreshUsage() {
  if (accountBusy || !state?.auth.signedIn) return;
  accountBusy = true;
  button("refresh-usage").disabled = true;
  try {
    const result = await bridge.usage();
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
    text(
      "usage-reset",
      value.invited === false
        ? "Hosted AI is invite-only during the beta. An invitation is still required."
        : value.resetAt
          ? `Resets ${new Date(value.resetAt).toLocaleString()}. Shared free capacity may apply.`
          : "Fair-use limits apply. No paid upgrades.",
    );
    hide("usage-view", false);
  } catch (error) {
    showError(error);
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
      }
      break;
    case "error":
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
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      /^\/permissions(?:\s|$)/i.test(prompt.value.trim())
    ) {
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
  if (threads.length) {
    const heading = document.createElement("div");
    heading.className = "sidebar-section-label";
    heading.textContent = "Conversations";
    history.append(heading);
  }
  for (const thread of threads.filter((t) =>
    t.title.toLowerCase().includes(search),
  )) {
    const node = document.createElement("button");
    node.className = "thread-link";
    node.textContent = thread.title || "New task";
    node.title = thread.title || "New task";
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
          prompt.value = "";
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
for (const id of ["open-folder", "welcome-open", "folder-picker"])
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
prompt.addEventListener("input", updateControls, { signal });
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
  void bridge.getState().then(renderState).catch(showError);
  void loadSponsor();
}
