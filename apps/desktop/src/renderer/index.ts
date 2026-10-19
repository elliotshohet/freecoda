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
    text("folder-path", "Signed-in chats sync across your devices.");
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
  text("model-privacy-note", next.auth.allowPromptTraining === false
    ? "Provider prompt training is disallowed for this hosted model. Provider operational retention may still apply."
    : next.auth.allowPromptTraining === true || !next.auth.model
      ? "Hosted Beam Free may retain prompts and code and use them for training. Do not send sensitive content."
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
  if (await runSlashCommand(prompt.value.trim())) {
    prompt.value = "";
    updateControls();
    return true;
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
async function runSlashCommand(value: string): Promise<boolean> {
  if (!value.startsWith("/")) return false;
  const [command, ...args] = value.trim().split(/\s+/);
  switch (command.toLowerCase()) {
    case "/help":
      appendMessage("assistant", "Desktop commands: /help, /new, /clear, /mode chat|build|plan|review, /model, /permissions, /usage, /status, /sync status|pull, /mcp, /tools, /extensions. Tool access still follows the selected mode, trusted folder, and permission approvals.");
      return true;
    case "/new":
      await newConversation();
      return true;
    case "/clear":
      clearConversation(false);
      notify("Visible conversation cleared. Saved conversation history is unchanged.");
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
    case "/model":
      await openModels();
      return true;
    case "/permissions":
      if (args.length) notify("Use /permissions to choose a permission preset.");
      else openPermissions();
      return true;
    case "/usage":
      openAccount();
      return true;
    case "/status":
      notify(`${isChat() ? "Chat" : `${mode.value} workspace · ${workspaceName()}`} · ${trusted() ? "folder trusted" : "no trusted folder"} · ${state?.permissionPreset || "default"} permissions · ${state?.auth.model || "Beam Free"}`);
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
    case "/mcp":
    case "/tools":
    case "/extensions":
      button("extensions-open").click();
      return true;
    default:
      notify(`Unknown command: ${command}. Use /help to see desktop commands.`);
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
button("refresh-conversations").addEventListener("click", async () => {
  button("refresh-conversations").disabled = true;
  try { renderState(await bridge.refreshConversations()); } catch (error) { showError(error); }
  finally { button("refresh-conversations").disabled = false; }
}, { signal });
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
    list.append(row);
  }
  text("github-repos-status", "Preferences are shared with your hosted account.");
}
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
function renderExtensions(items: import("../shared").DesktopExtension[]) {
  const list = el("extensions-list"); list.replaceChildren();
  if (!items.length) { const empty = document.createElement("p"); empty.textContent = "No tools or skills installed."; list.append(empty); }
  for (const item of items) {
    const row = document.createElement("div"); row.className = "extension-row";
    const info = document.createElement("div");
    const name = document.createElement("strong"); name.textContent = item.name;
    const detail = document.createElement("small"); detail.textContent = `${item.kind === "skill" ? "Skill" : "MCP server"} · ${item.enabled ? "Enabled" : "Disabled"}`;
    info.append(name, detail);
    const actions = document.createElement("div"); actions.className = "extension-actions";
    const toggle = document.createElement("button"); toggle.textContent = item.enabled ? "Disable" : "Enable";
    toggle.setAttribute("aria-label", `${toggle.textContent} ${item.name}`);
    const remove = document.createElement("button"); remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${item.name}`);
    for (const [control, operation] of [[toggle, () => bridge.setExtensionEnabled({ id: item.id, enabled: !item.enabled })], [remove, () => bridge.removeExtension(item.id)]] as const) {
      control.addEventListener("click", async () => {
        toggle.disabled = remove.disabled = true;
        try { if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing tools or skills."); renderExtensions(await operation()); } catch (error) { showError(error); toggle.disabled = remove.disabled = false; }
      }, { signal });
    }
    if (item.kind === "mcp") {
      const discover = document.createElement("button"); discover.textContent = "Check & list tools";
      discover.disabled = !item.enabled || running;
      discover.addEventListener("click", async () => {
        discover.disabled = true;
        try { const names = await bridge.discoverTools(item.id); detail.textContent = `Available at last check · ${names.join(", ") || "No tools returned"}`; await renderToolChoices(); }
        catch (error) { detail.textContent = `Check failed: ${message(error)}`; }
        finally { discover.disabled = !item.enabled; }
      }, { signal });
      actions.append(discover);
    }
    actions.append(toggle, remove); row.append(info, actions); list.append(row);
  }
}
button("extensions-open").addEventListener("click", async () => {
  if (running || promptQueue.length) { notify("Finish or remove queued messages before changing tools or skills."); return; }
  try { renderExtensions(await bridge.listExtensions()); await renderToolChoices(); el<HTMLDialogElement>("extensions-dialog").showModal(); }
  catch (error) { showError(error); }
}, { signal });
button("extensions-close").addEventListener("click", () => el<HTMLDialogElement>("extensions-dialog").close(), { signal });
el("extensions-form").addEventListener("submit", async event => {
  event.preventDefault(); button("extension-install").disabled = true;
  try {
    if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing tools or skills.");
    const kind = el<HTMLSelectElement>("extension-kind").value;
    if (kind !== "skill" && kind !== "mcp") throw Error("Choose an extension type.");
    renderExtensions(await bridge.installExtension({ kind, name: input("extension-name").value, url: input("extension-url").value }));
    input("extension-name").value = ""; input("extension-url").value = "";
    notify("Extension installed. Review its enabled state before the next coding task.");
  } catch (error) { showError(error); }
  finally { button("extension-install").disabled = false; }
}, { signal });
function renderAccount() {
  if (!state) return;
  if (profileSignedIn !== state.auth.signedIn) {
    profileSignedIn = state.auth.signedIn;
    accountProfile = {};
    if (state.auth.signedIn) void bridge.accountProfile().then(profile => {
      if (!state?.auth.signedIn) return;
      accountProfile = profile;
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
  void bridge.getState().then(renderState).catch(showError);
  void loadSponsor();
}

async function openModels() {
  if (running || actionBusy || promptQueue.length) { notify("Finish or remove queued messages before changing models."); return; }
  const models = await bridge.listModels();
  const list = el("model-options"); list.replaceChildren();
  if (!models.length) list.textContent = "No configured free models are available. Check your account connection.";
  for (const model of models) {
    const option = document.createElement("button"); option.type = "button";
    option.className = "button secondary";
    option.textContent = `${model.name}${state?.auth.model === model.id ? " · Selected" : ""}`;
    option.addEventListener("click", async () => {
      option.disabled = true;
      try { if (running || promptQueue.length) throw Error("Finish or remove queued messages before changing models."); renderState(await bridge.selectModel(model.id)); el<HTMLDialogElement>("model-dialog").close(); }
      catch (error) { showError(error); option.disabled = false; }
    }, { signal });
    list.append(option);
  }
  el<HTMLDialogElement>("model-dialog").showModal();
}
button("model-close").addEventListener("click", () => el<HTMLDialogElement>("model-dialog").close(), { signal });

async function renderToolChoices() {
  let list = document.getElementById("tool-choices");
  if (!list) { list = document.createElement("div"); list.id = "tool-choices"; el("extensions-list").after(list); }
  list.replaceChildren();
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
