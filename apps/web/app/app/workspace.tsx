"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import styles from "./workspace.module.css";
import { Mark } from "@/components/chrome";
import { UserAvatar } from "@/components/user-avatar";
import { MarkdownMessage } from "@/components/markdown-message";
import { ModelPicker, modelDisplayName } from "@/components/model-picker";
import { useModelSelection } from "@/components/use-model-selection";
import { ThemeControl } from "@/components/theme-control";
import { SponsorPlacement } from "@/components/sponsor-placement";
import { ProjectExtensions } from "./extensions";

type Status = {
  enabled: boolean;
  userId?: string;
  userName?: string | null;
  userImage?: string | null;
  models?: { id: string; name: string }[];
  authenticated?: boolean;
  invited?: boolean;
  ready?: boolean;
  reason?: string;
  message?: string;
  limits?: {
    projects?: number;
    dailyMinutes?: number;
    idleMinutes?: number;
    retentionDays?: number;
    sessionSeconds?: number;
    dailyComputeSeconds?: number;
    monthlyGlobalComputeSeconds?: number;
    concurrentPerUser?: number;
    concurrentGlobal?: number;
  };
};
const noWorkspaceModels: NonNullable<Status["models"]> = [];
type Project = {
  id: string;
  name: string;
  status: string;
  sandboxId?: string | null;
  updatedAt?: string;
  appDirectory?: string;
  repository?: string;
  repo?: {
    owner: string;
    name: string;
    baseSha: string;
    installationId: number;
    defaultBranch: string;
  };
  expiresAt?: string;
};
type FileEntry = { path: string; type?: string; size?: number };
type Repo = {
  repositoryId?: number;
  installationId: string | number;
  owner: string;
  name: string;
  createdAt?: string;
  defaultBranch?: string;
  private?: boolean;
};
type RunEvent = {
  data?: {
    text?: string;
    messageId?: string;
    delta?: string;
    message?: string;
    command?: string;
    stdout?: string;
    exitCode?: number;
    stderr?: string;
    output?: string;
    diff?: string;
  };
  id?: string | number;
  sequence?: number;
  type: string;
  text?: string;
  content?: string;
  message?: string;
  output?: string;
  path?: string;
  diff?: string;
  status?: string;
};
type Changes = {
  diff: string;
  baseSha?: string;
  expectedBaseSha?: string;
  runId?: string;
  files?: { path: string }[];
  reviewHash?: string;
};
type Message = { id?: string; runId?: string; status?: "accepted"; role: "user" | "assistant" | "system"; text: string };

function allowedPreview(url: string) {
  const candidate = new URL(url);
  return candidate.protocol === "https:" &&
    candidate.origin !== window.location.origin &&
    [".vercel.run", ".sandbox.vercel.dev"].some((suffix) =>
      candidate.hostname.endsWith(suffix),
    );
}

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/web/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
            "This action is unavailable. Please try again.",
    );
  return data as T;
}

export function CloudWorkspace({ conversationMode = "project" }: { conversationMode?: "ask" | "project" }) {
  const [status, setStatus] = useState<Status | null>(null);
  const { model, setModel } = useModelSelection(status?.userId, status?.models ?? noWorkspaceModels);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "inspect">("chat");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [extensionsView, setExtensionsView] = useState<"all" | "mcp" | "tools">("all");
  const [extensionsOpenSignal, setExtensionsOpenSignal] = useState(0);
  const [file, setFile] = useState<{
    path: string;
    content: string;
    hash: string;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const promptInputRef = useRef("");
  type QueuedPrompt = { id: string; text: string; mode: string; model?: string; extensionConsent?: boolean; failed?: boolean };
  const [queuedPrompts, setQueuedPrompts] = useState<QueuedPrompt[]>([]);
  const queuedRef = useRef<QueuedPrompt[]>([]);
  const submittingRef = useRef(false);
  const activeRunRef = useRef<string | null>(null);
  const [queuePaused, setQueuePaused] = useState(false);
  const queuePausedRef = useRef(false);
  function updateQueue(next: QueuedPrompt[]) {
    queuedRef.current = next;
    setQueuedPrompts(next);
  }
  function pauseQueue(paused: boolean) {
    queuePausedRef.current = paused;
    setQueuePaused(paused);
  }
  const [mode, setMode] = useState("build");
  const [consent, setConsent] = useState(false);
  const [consentVersion, setConsentVersion] = useState("");
  const [consentLoaded, setConsentLoaded] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const [hasExternalTools, setHasExternalTools] = useState(false);
  const [extensionConsent, setExtensionConsent] = useState(false);
  const extensionsChanged = useCallback((enabled: boolean) => { setHasExternalTools(enabled); setExtensionConsent(false); }, []);
  useEffect(() => { setExtensionConsent(false); setHasExternalTools(false); }, [project?.id]);
  const [tab, setTab] = useState<"files" | "changes" | "preview" | "output">(
    "files",
  );
  const [changes, setChanges] = useState<Changes | null>(null);
  const [output, setOutput] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    expiresAt?: string;
  } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<
    "create" | "import" | "publish" | "delete" | null
  >(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [repoPreferences, setRepoPreferences] = useState<{ repositoryId: number; owner: string; name: string; enabled: boolean }[]>([]);
  const [repoLoadError, setRepoLoadError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const projectRef = useRef<string | null>(null);
  const eventCursor = useRef<string | number>(0);
  const endOfChat = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const publishKey = useRef<string | null>(null);
  const dirty = !!file && draft !== file.content;
  const available =
    !!status?.enabled &&
    status.ready === true &&
    status.authenticated !== false &&
    status.invited !== false;
  const running = runId !== null;
  useEffect(() => {
    const open = (event: Event) => {
      if (!project) { setNotice("Select or import a project to manage its MCP connections and tools."); return; }
      const view = (event as CustomEvent).detail?.view;
      setControlsOpen(true);
      setExtensionsView(view === "mcp" || view === "tools" ? view : "all");
      setExtensionsOpenSignal(value => value + 1);
    };
    window.addEventListener("freecoda:extensions", open);
    return () => window.removeEventListener("freecoda:extensions", open);
  }, [project?.id]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await api<Status>("status", "GET", undefined, signal);
      if (signal?.aborted) return;
      setStatus(next);
      if (
        next.enabled &&
        next.authenticated !== false &&
        next.invited !== false
      ) {
        const cloudConsent = await api<{
          version: string;
          accepted: boolean;
        }>("consent", "GET", undefined, signal);
        if (signal?.aborted) return;
        setConsentVersion(cloudConsent.version);
        setConsent(cloudConsent.accepted);
        setConsentLoaded(true);
        const data = await api<{ projects: Project[] }>(
          "projects",
          "GET",
          undefined,
          signal,
        );
        if (signal?.aborted) return;
        setProjects(data.projects);
        const id = new URLSearchParams(window.location.search).get("project");
        const selected = data.projects.find((p) => p.id === id);
        if (selected) await selectProject(selected, signal);
      }
    } catch (e) {
      if (!signal?.aborted) setError(errorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void load(abort.signal);
    return () => abort.abort();
  }, [load]);
  useEffect(() => {
    const showModel = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      if (detail?.view === "workspace") setModelPickerOpen(true);
    };
    window.addEventListener("freecoda:show-model", showModel);
    return () => window.removeEventListener("freecoda:show-model", showModel);
  }, []);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      dialogRef.current?.querySelector<HTMLElement>(
        "input:not([type=checkbox]),textarea,select",
      ) || dialogRef.current?.querySelector<HTMLElement>("button,a[href]")
    )?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [dialog]);
  useEffect(() => {
    if (!project || project.status !== "creating") return;
    const id = project.id;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const detail = await api<{ project: Project; files: FileEntry[] }>(
          `projects/${id}`,
          "GET",
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setProject(detail.project);
        setFiles(detail.files);
        setProjects((current) =>
          current.map((p) => (p.id === id ? detail.project : p)),
        );
        if (detail.project.status === "creating")
          timer = setTimeout(poll, 1500);
        else
          setNotice(
            detail.project.status === "failed"
              ? "Repository import stopped. Delete this project and try again."
              : "Repository imported. Resume the workspace to start building.",
          );
      } catch (e) {
        if (!abort.signal.aborted) setError(errorMessage(e));
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [project?.id, project?.status]);
  useEffect(() => {
    endOfChat.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [messages, queuedPrompts]);
  useEffect(() => {
    const next = queuedRef.current[0];
    if (!next || runId || activeRunRef.current || busy || submittingRef.current || queuePausedRef.current) return;
    if (!project || !consent || dirty || (hasExternalTools && next.mode === "build" && next.extensionConsent === undefined && !extensionConsent)) return;
    void startPrompt(next);
  }, [busy, queuedPrompts, runId, queuePaused, consent, dirty, hasExternalTools, extensionConsent, project?.id]);

  async function refreshFiles(id: string) {
    const data = await api<{ files: FileEntry[] }>(`projects/${id}/files`);
    if (projectRef.current === id) setFiles(data.files);
  }
  async function refreshChanges(id: string) {
    const data = await api<Changes>(`projects/${id}/diff`);
    if (projectRef.current === id) {
      setChanges(data);
      setReviewed(false);
      publishKey.current = null;
    }
  }
  async function selectProject(next: Project, signal?: AbortSignal) {
    if (dirty && !window.confirm("Discard your unsaved file changes?")) return;
    if (running || activeRunRef.current || submittingRef.current) {
      setError("Stop the current run before switching projects.");
      return;
    }
    if (queuedRef.current.length && !window.confirm("Discard queued messages before switching projects?")) return;
    projectRef.current = next.id;
    setProject(next);
    setFile(null);
    setFiles([]);
    setFileFilter("");
    setChanges(null);
    setMessages([]);
    updateQueue([]);
    pauseQueue(false);
    activeRunRef.current = null;
    setOutput("");
    setPreview(null);
    setPrUrl(null);
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const detail = await api<{
        project: Project;
        files: FileEntry[];
        runs: { id: string; status: string }[];
      }>(`projects/${next.id}`, "GET", undefined, signal);
      if (projectRef.current !== next.id || signal?.aborted) return;
      setProject(detail.project);
      setFiles(detail.files);
      if (detail.project.status === "ready" && detail.project.sandboxId) {
        const savedPreview = await api<{
          url: string | null;
          expiresAt: string | null;
        }>(`projects/${next.id}/preview-session`, "GET", undefined, signal);
        if (projectRef.current !== next.id || signal?.aborted) return;
        if (savedPreview.url && savedPreview.expiresAt) {
          if (!allowedPreview(savedPreview.url))
            throw new Error("This preview URL is not a supported private sandbox.");
          setPreview({ url: savedPreview.url, expiresAt: savedPreview.expiresAt });
        }
      }
      const url = new URL(window.location.href);
      url.searchParams.set("project", next.id);
      window.history.replaceState(null, "", url);
      const latest = detail.runs[0];
      if (latest) {
        eventCursor.current = 0;
        if (["queued", "running"].includes(latest.status)) { activeRunRef.current = latest.id; setRunId(latest.id); }
        else {
          let after: string | number = 0;
          for (let batch = 0; batch < 50; batch++) {
            const data = await api<{ events: RunEvent[] }>(
              `runs/${latest.id}/events?after=${after}`,
              "GET",
              undefined,
              signal,
            );
            if (projectRef.current !== next.id || signal?.aborted) return;
            applyEvents(data.events);
            if (data.events.length < 100) break;
            after = eventCursor.current;
          }
        }
      }
    } catch (e) {
      if (!signal?.aborted && projectRef.current === next.id)
        setError(errorMessage(e));
    } finally {
      if (!signal?.aborted && projectRef.current === next.id) setBusy(false);
    }
  }
  async function openFile(path: string) {
    if (
      !project ||
      (dirty && !window.confirm("Discard your unsaved file changes?"))
    )
      return;
    setBusy(true);
    setError("");
    const id = project.id;
    try {
      const data = await api<{
        path: string;
        content: string;
        hash: string;
        encoding?: string;
      }>(`projects/${id}/files?path=${encodeURIComponent(path)}`);
      if (data.encoding === "base64")
        throw new Error("Binary files cannot be edited in this text editor.");
      if (projectRef.current === id) {
        setFile(data);
        setDraft(data.content);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveFile() {
    if (!project || !file || !dirty) return;
    setBusy(true);
    setError("");
    const id = project.id;
    const path = file.path;
    const content = draft;
    try {
      const data = await api<{ hash: string }>(`projects/${id}/files`, "PUT", {
        path,
        content,
        expectedHash: file.hash,
      });
      setFile({ path, content, hash: data.hash });
      setNotice("File saved in your cloud workspace.");
      await refreshChanges(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function applyEvents(events: RunEvent[]) {
    for (const event of events) {
      eventCursor.current = event.sequence ?? event.id ?? eventCursor.current;
      const text =
        event.type === "command_output"
          ? [
              event.data?.stdout,
              event.data?.stderr,
              event.data?.exitCode !== undefined
                ? `Exit code: ${event.data.exitCode}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")
          : (event.data?.text ??
            event.data?.delta ??
            event.data?.message ??
            event.data?.output ??
            event.data?.command ??
            event.text ??
            event.content ??
            event.message ??
            event.output ??
            "");
      if (event.type === "user" && text) {
        const messageId = event.data?.messageId;
        setMessages((current) => {
          const index = messageId ? current.findIndex((message) => message.id === messageId || message.runId === messageId) : -1;
          if (index < 0) return [...current, { id: messageId, role: "user", text }];
          return current.map((message, position) => position === index ? { ...message, text, status: undefined } : message);
        });
      } else if (
        [
          "message",
          "delta",
          "text",
          "text-delta",
          "assistant",
          "assistant_delta",
        ].includes(event.type) &&
        text
      ) {
        setMessages((current) => {
          const previous = current.at(-1);
          if (
            event.type === "message" &&
            previous?.role === "assistant" &&
            previous.text.endsWith(text)
          )
            return current;
          return previous?.role === "assistant"
            ? [
                ...current.slice(0, -1),
                { role: "assistant", text: previous.text + text },
              ]
            : [...current, { role: "assistant", text }];
        });
      } else if (
        ["command", "command_output", "tool", "tool-result", "output"].includes(
          event.type,
        ) &&
        text
      )
        setOutput((current) => `${current}${text}\n`.slice(-150000));
      else if (event.type === "error")
        setError(
          text || "The agent stopped. Your saved files are still available.",
        );
      if (event.diff) {
        setChanges((current) => ({ ...current, diff: event.diff! }));
        setReviewed(false);
      }
    }
  }
  useEffect(() => {
    if (!runId || !project) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const id = project.id;
    async function poll() {
      try {
        const data = await api<{
          events: RunEvent[];
          status?: string;
          done?: boolean;
          cursor?: string | number;
          run?: { id: string; status: string };
        }>(
          `runs/${runId}/events?after=${encodeURIComponent(eventCursor.current)}`,
          "GET",
          undefined,
          abort.signal,
        );
        if (abort.signal.aborted) return;
        applyEvents(data.events || []);
        if (data.cursor !== undefined) eventCursor.current = data.cursor;
        if (
          (data.done ||
            ["completed", "failed", "cancelled", "succeeded"].includes(
              data.run?.status || data.status || "",
            )) &&
          (data.events?.length || 0) < 100
        ) {
          setBusy(true);
          const terminalStatus = data.run?.status || data.status || "";
          if (["failed", "cancelled"].includes(terminalStatus)) pauseQueue(true);
          // Keep the active run until the terminal state is confirmed, then
          // prevent queue draining while refreshing its final files.
          activeRunRef.current = null;
          setRunId(null);
          try {
            const detail = await api<{ project: Project; files: FileEntry[] }>(
              `projects/${id}`,
            );
            if (projectRef.current === id) {
              setProject(detail.project);
              setFiles(detail.files);
              setProjects((current) =>
                current.map((p) => (p.id === id ? detail.project : p)),
              );
            }
            await refreshChanges(id);
            if (file && projectRef.current === id) {
              const fresh = await api<{
                path: string;
                content: string;
                hash: string;
              }>(`projects/${id}/files?path=${encodeURIComponent(file.path)}`);
              setFile(fresh);
              setDraft(fresh.content);
            }
          } finally {
            if (projectRef.current === id) setBusy(false);
          }
          return;
        }
        timer = setTimeout(poll, 1000);
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(
            `${errorMessage(e)} Reconnecting to the current run; queued messages are retained.`,
          );
          timer = setTimeout(poll, 2500);
        }
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [runId, project?.id]);

  async function sendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!promptInputRef.current.trim()) return;
    const text = promptInputRef.current.trim();
    if (text.startsWith("/")) {
      promptInputRef.current = "";
      setPrompt("");
      await slashCommand(text);
      return;
    }
    enqueuePrompt();
  }

  async function slashCommand(input: string) {
    const [command, ...args] = input.trim().split(/\s+/);
    const rawArgument = args.join(" ").trim();
    const argument = args.join(" ").toLowerCase();
    setError("");
    switch (command.toLowerCase()) {
      case "/help":
        setNotice("Commands: /new, /clear, /mode build|plan|review, /model, /permissions, /status, /usage, /extensions, /mcp, /tools, /sync status|pull, /resume, /suspend.");
        break;
      case "/new":
        setDialog("create");
        break;
      case "/clear":
        setMessages([]);
        setOutput("");
        setNotice("Cleared the visible chat and terminal output. Saved cloud history remains available.");
        break;
      case "/mode":
        if (["build", "plan", "review"].includes(argument)) {
          setMode(argument);
          setNotice(`Mode set to ${argument}.`);
        } else setNotice("Usage: /mode build|plan|review");
        break;
      case "/model":
        if (!rawArgument) {
          const currentModel = status?.models?.find((entry) => entry.id === model);
          setNotice(`Current model: ${currentModel ? modelDisplayName(currentModel) : model || "Loading"}.`);
          setModelPickerOpen(true);
        } else if (!status?.models?.some((entry) => entry.id === rawArgument)) {
          setError(`Unknown model “${rawArgument}”. Available: ${status?.models?.map((entry) => entry.id).join(", ") || "none"}.`);
        } else if (setModel(rawArgument)) {
          const chosenModel = status?.models?.find((entry) => entry.id === rawArgument);
          setNotice(`Model set to ${chosenModel ? modelDisplayName(chosenModel) : rawArgument}.`);
        }
        break;
      case "/permissions":
        setNotice(`Cloud storage consent: ${consent ? "saved for this account" : "not yet accepted"}. External MCP tools: ${hasExternalTools ? extensionConsent ? "allowed for the next run" : "require per-run approval" : "not enabled"}.`);
        break;
      case "/status":
        setNotice(`Project: ${project?.name || "none"} (${project?.status || "not selected"}). Run: ${running ? "active" : "idle"}. Queued: ${queuedPrompts.length}.`);
        break;
      case "/usage": {
        try {
          const response = await fetch("/api/v1/usage", { cache: "no-store" });
          const usage = await response.json();
          if (!response.ok) throw new Error(usage.error || "Usage is unavailable.");
          setNotice(`AI free allowance remaining today: $${(usage.freeRemainingMicros / 1_000_000).toFixed(4)}. Beam Free inference has $0 model cost.`);
        } catch (error) { setError(errorMessage(error)); }
        break;
      }
      case "/extensions":
      case "/mcp":
      case "/tools":
        window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: command === "/mcp" ? "mcp" : command === "/tools" ? "tools" : "all" } }));
        setNotice(project ? "Manage the selection for the next run in Cloud settings. Active runs keep their existing tools." : "Select or import a project to manage its MCP connections and tools.");
        break;
      case "/sync":
        if (!argument || argument === "status") await syncRepository("status");
        else if (argument === "pull") await syncRepository("pull");
        else setNotice("Usage: /sync status|pull. Publish and merge cloud edits before pulling.");
        break;
      case "/resume":
        if (project?.status === "suspended") await lifecycle("resume");
        else setNotice("The selected project is already active.");
        break;
      case "/suspend":
        if (project?.status === "ready" && !running) await lifecycle("suspend");
        else setNotice("Stop the active run before suspending this project.");
        break;
      default:
        setError(`Unknown command: ${command}. Try /help.`);
    }
  }
  function enqueuePrompt() {
    const text = promptInputRef.current.trim();
    if (!text || !project || !consent || dirty || inactive) return;
    if (text.startsWith("/")) {
      promptInputRef.current = "";
      setPrompt("");
      void slashCommand(text);
      return;
    }
    updateQueue([...queuedRef.current, { id: crypto.randomUUID(), text, mode }]);
    // Clear only the submitted draft now; a later response must never erase
    // a new message typed while this request is in flight.
    promptInputRef.current = "";
    setPrompt("");
  }
  async function startPrompt(item: QueuedPrompt) {
    if (!project || !consent || dirty || submittingRef.current || activeRunRef.current || queuePausedRef.current) return;
    if (hasExternalTools && item.mode === "build" && item.extensionConsent === undefined && !extensionConsent) return;
    const id = project.id;
    if (projectRef.current !== id || queuedRef.current[0]?.id !== item.id) return;
    // Bind approval to this request identity, including an uncertain POST retry.
    const approvedItem = { ...item, model: item.model || model, extensionConsent: item.extensionConsent ?? extensionConsent, failed: false };
    if (!approvedItem.model) {
      pauseQueue(true);
      setError("No approved free model is available for this account. Your message is retained in the queue.");
      return;
    }
    updateQueue(queuedRef.current.map((entry) => entry.id === item.id ? approvedItem : entry));
    submittingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setReviewed(false);
    try {
      const data = await api<{ run: { id: string; status: string } }>(
        `projects/${id}/runs`,
        "POST",
        { requestId: item.id, prompt: item.text, mode: item.mode, model: approvedItem.model, consent: true, extensionConsent: approvedItem.extensionConsent },
      );
      if (projectRef.current !== id) return;
      activeRunRef.current = data.run.id;
      setMessages((current) => current.some((message) => message.id === item.id || message.runId === data.run.id)
        ? current
        : [...current, { id: item.id, runId: data.run.id, role: "user", text: item.text, status: "accepted" }]);
      updateQueue(queuedRef.current.filter((entry) => entry.id !== item.id));
      setExtensionConsent(false);
      eventCursor.current = 0;
      setRunId(data.run.id);
    } catch (e) {
      updateQueue(queuedRef.current.map((entry) => entry.id === item.id ? { ...entry, failed: true } : entry));
      pauseQueue(true);
      setError(`${errorMessage(e)} Your message is retained. Retry the queue to reconnect or submit it safely.`);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }
  async function acceptCloudConsent(checked: boolean) {
    if (!checked || consent || !consentVersion || consentSaving) return;
    setConsentSaving(true);
    setError("");
    try {
      const result = await api<{ accepted: boolean }>("consent", "POST", {
        version: consentVersion,
      });
      setConsent(result.accepted);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConsentSaving(false);
    }
  }
  async function stopRun() {
    pauseQueue(true);
    if (!runId) return;
    setBusy(true);
    try {
      await api(`runs/${runId}/cancel`, "POST", {});
      setNotice("Stop requested. Waiting for the current tool to finish.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function lifecycle(action: "suspend" | "resume" | "delete") {
    if (!project) return;
    if (action === "resume" && !consent) {
      setError("Agree to cloud storage before resuming this workspace.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: Project }>(
        `projects/${project.id}${action === "delete" ? "" : `/${action}`}`,
        action === "delete" ? "DELETE" : "POST",
        action === "delete" ? undefined : {},
      );
      if (action === "delete") {
        setProjects((current) => current.filter((p) => p.id !== project.id));
        setProject(null);
        projectRef.current = null;
        setFile(null);
        setFiles([]);
        setPreview(null);
        setMessages([]);
        setChanges(null);
        setOutput("");
      } else {
        if (!result.project)
          throw new Error(
            "Workspace status could not be verified. Refresh this project.",
          );
        const next = result.project;
        setProject(next);
        if (action === "suspend") setPreview(null);
        setProjects((current) =>
          current.map((p) => (p.id === next.id ? next : p)),
        );
      }
      setDialog(null);
      setNotice(
        action === "delete"
          ? "Cloud project deleted."
          : action === "suspend"
            ? "Workspace suspended."
            : "Workspace resumed.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function syncRepository(action: "status" | "pull") {
    if (!project?.repo) { setError("Import a GitHub repository first."); return; }
    if (busy || running || dirty) { setError("Finish the active task and save your file before syncing."); return; }
    if (action === "pull" && !consent) { setError("Accept cloud storage terms before pulling source."); return; }
    const id = project.id;
    setBusy(true);
    setError("");
    try {
      if (action === "status") {
        const state = await api<{ identity: string; branch: string; baseSha: string; headSha: string; status: string; aheadBy: number; behindBy: number; dirty: boolean }>(`projects/${id}/sync`);
        setNotice(`${state.identity} · ${state.branch} · ${state.baseSha.slice(0, 7)} → ${state.headSha.slice(0, 7)} · ${state.dirty ? "unpublished cloud edits" : "clean"} · upstream ${state.status} (${state.aheadBy} commits ahead, ${state.behindBy} behind). Pull requires a clean suspended workspace.`);
      } else {
        if (!window.confirm(`Pull committed source from ${project.repo.owner}/${project.repo.name} (${project.repo.defaultBranch})? Unpublished cloud edits and divergent branches will be refused.`)) return;
        const result = await api<{ project: Project }>(`projects/${id}/sync`, "POST", { expectedBaseSha: project.repo.baseSha });
        if (projectRef.current !== id) return;
        setProject(result.project);
        setProjects(current => current.map(item => item.id === id ? result.project : item));
        setFile(null);
        setPreview(null);
        await refreshFiles(id);
        await refreshChanges(id);
        setNotice("Pulled committed source from GitHub. Resume when you want to run this workspace.");
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function changeAppDirectory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project || running || dirty || !consent) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: Project }>(
        `projects/${project.id}`,
        "PATCH",
        { appDirectory: String(data.get("appDirectory") || ".").trim() },
      );
      setProject(result.project);
      setProjects((current) =>
        current.map((p) => (p.id === result.project.id ? result.project : p)),
      );
      setPreview(null);
      setNotice("App folder updated. Open a new preview to start this app.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function showImport() {
    setDialog("import");
    setBusy(true);
    setError("");
    setRepoLoadError("");
    setRepos([]);
    setSelectedRepo(null);
    setRepoPreferences([]);
    setInstallUrl(null);
    try {
      const data = await api<{ repos: Repo[]; installUrl?: string }>(
        "github/repos",
      );
      setRepos(data.repos);
      const link = data.installUrl ? new URL(data.installUrl) : null;
      setInstallUrl(link && link.origin === "https://github.com" && /^\/apps\/[a-z0-9-]+\/installations\/new$/.test(link.pathname) && !link.username && !link.password && !link.search && !link.hash ? link.toString() : null);
      const response = await fetch("/api/v1/github/repositories", { cache: "no-store" });
      const configured = await response.json();
      if (!response.ok) throw Error(configured.error || "Could not load saved repository selections.");
      setRepoPreferences(configured.repositories || []);
    } catch (e) {
      setRepoLoadError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function createProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = await api<{ project: Project }>("projects", "POST", {
        name: form.get("name"),
        template: form.get("template") || "nextjs",
        consent: true,
      });
      setProjects((current) => [...current, data.project]);
      setDialog(null);
      await selectProject(data.project);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function importRepo(repo: Repo) {
    if (!consent) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ project: Project }>("projects/import", "POST", {
        installationId: repo.installationId,
        owner: repo.owner,
        repo: repo.name,
        consent: true,
      });
      setProjects((current) => [...current, data.project]);
      setDialog(null);
      await selectProject(data.project);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function openPreview() {
    if (!project) return;
    setTab("preview");
    if (!consent) {
      setError("Agree to cloud storage before starting a private preview.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ url: string; expiresAt?: string }>(
        `projects/${project.id}/preview-session`,
        "POST",
        {},
      );
      if (!allowedPreview(data.url))
        throw new Error("This preview URL is not a supported private sandbox.");
      setPreview(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function copyPreviewUrl() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.url);
      setNotice("Private preview URL copied. It expires automatically.");
    } catch {
      setError("Could not copy the preview URL. Open it in a new tab instead.");
    }
  }
  async function reviewChanges() {
    if (!project) return;
    setTab("changes");
    setBusy(true);
    setError("");
    try {
      await refreshChanges(project.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function publish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!project || !changes?.reviewHash || !reviewed || dirty || running)
      return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const data = await api<{ url?: string; pullRequestUrl?: string }>(
        `projects/${project.id}/publish`,
        "POST",
        {
          ...(changes.runId ? { runId: changes.runId } : {}),
          expectedBaseSha: changes.baseSha || changes.expectedBaseSha,
          reviewHash: changes.reviewHash,
          idempotencyKey: (publishKey.current ||= crypto.randomUUID()),
          title: form.get("title"),
          body: form.get("body"),
        },
      );
      setPrUrl(data.url || data.pullRequestUrl || null);
      setDialog(null);
      setNotice("Draft pull request created.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const matchingFiles = files.filter(
    (f) =>
      f.type !== "directory" &&
      f.path.toLowerCase().includes(fileFilter.toLowerCase()),
  );
  const visibleFiles = matchingFiles.slice(0, 250);
  const paused = ["suspended", "stopped"].includes(project?.status || "");
  const activeWorkspace = projects.find(
    (candidate) => candidate.id !== project?.id && candidate.status === "ready" && candidate.sandboxId,
  );
  const inactive = ["creating", "failed", "expired", "deleted"].includes(
    project?.status || "",
  );
  const limitText = status?.limits
    ? [
        status.limits.projects && `${status.limits.projects} projects`,
        status.limits.dailyComputeSeconds &&
          `${Math.floor(status.limits.dailyComputeSeconds / 60)} compute minutes/day`,
        status.limits.sessionSeconds &&
          `${Math.floor(status.limits.sessionSeconds / 60)} minutes/session`,
        status.limits.concurrentPerUser &&
          `${status.limits.concurrentPerUser} active project at a time`,
        status.limits.monthlyGlobalComputeSeconds &&
          `${Math.floor(status.limits.monthlyGlobalComputeSeconds / 60)} compute minutes/month shared by everyone`,
        status.limits.idleMinutes &&
          `suspends after ${status.limits.idleMinutes} idle minutes`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Free capacity is limited. Projects may pause when the daily capacity is used.";
  return (
    <div className={styles.shell} data-conversation-mode={conversationMode}>
      <h1 className="sr-only">Freecoda coding workspace</h1>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {error.includes("Cloud compute is busy") && activeWorkspace && (
            <button className={styles.errorAction} type="button" onClick={() => void selectProject(activeWorkspace)}>
              Open active workspace: {activeWorkspace.name}
            </button>
          )}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          <Check size={15} />
          {notice}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer">
              View draft pull request <ArrowUpRight size={13} />
            </a>
          )}
        </p>
      )}
      {loading ? (
        <div className={styles.empty} role="status">
          <Loader2 size={24} className={styles.spin} />
          <h2>Opening your workspace…</h2>
        </div>
      ) : !available ? (
        <div className={styles.workbench}>
          <aside className={styles.projects}>
            <div className={styles.sectionHead}>
              <strong>Your projects</strong>
              <FolderGit2 size={16} />
            </div>
            <p className={styles.smallEmpty}>
              Sign in to create a project or bring a repository from GitHub.
            </p>
            <nav className={styles.railLinks} aria-label="Workspace resources">
              <Link href="/docs">
                Documentation <ArrowUpRight size={13} />
              </Link>
              <Link href="/docs#desktop">
                Desktop & CLI <ArrowUpRight size={13} />
              </Link>
            </nav>
            <div className={styles.railSponsor}>
              <SponsorPlacement placement="web" />
            </div>
          </aside>
          <section className={styles.setup} data-conversation-slot>
            <div className={styles.setupIcon}>
              <Code2 size={34} />
            </div>
            <h2>
              {!status
                ? "Could not load your workspace."
                : status.authenticated === false
                  ? "Let’s build something."
                  : status?.invited === false
                    ? "Cloud access is opening gradually."
                    : "Your cloud workspace is getting ready."}
            </h2>
            <p>
              {status?.reason ||
                status?.message ||
                (!status
                  ? "Refresh to check cloud availability. You can also open your account or use the local CLI."
                  : "Cloud execution is not enabled on this instance yet. You can keep building with the local CLI while the cloud service is configured.")}
            </p>
            <div className={styles.actions}>
              <Link className="button purple" href="/dashboard">
                {status?.authenticated === false
                  ? "Continue with GitHub"
                  : "View account & allowance"}
              </Link>
              <Link className="button secondary" href="/docs">
                Use the local CLI
              </Link>
              <button
                className={styles.iconButton}
                onClick={() => void load()}
                aria-label="Refresh service availability"
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <p className={styles.footnote}>
              One free plan, shared capacity, no paid upgrades. No cloud project
              has been created.
            </p>
          </section>
        </div>
      ) : (
        <>
          <div className={styles.workspaceSettings} data-open={controlsOpen || !consent}>
            <button type="button" className={styles.settingsToggle} aria-expanded={controlsOpen || !consent} onClick={() => setControlsOpen(open => !open)}>
              <ShieldCheck size={14} /> Cloud settings · {consent ? "consent saved" : "consent required"}
            </button>
            <div className={styles.settingsBody}>
          <div className={styles.capacity}>
            <ShieldCheck size={16} />
            <span>{limitText}</span>
            <Link href="/privacy#cloud-workspaces">Cloud privacy</Link>
          </div>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              disabled={!consentLoaded || consentSaving || consent}
              onChange={(e) => void acceptCloudConsent(e.target.checked)}
            />
            <span>
              {consent
                ? "Cloud storage consent is saved for this account. Files, chat, diffs, and command output are retained for up to seven days after activity; material changes to these terms will ask again."
                : "I agree to store this project’s files, chat, diffs, and command output in Freecoda’s cloud for up to seven days after last activity. Delete the project at any time. Avoid secrets and private customer data."}
            </span>
          </label>
          {project && <div id="cloud-project-extensions"><ProjectExtensions key={project.id} projectId={project.id} disabled={busy || running || !consent} onToolsChanged={extensionsChanged} requestedView={extensionsView} openSignal={extensionsOpenSignal} mode={mode} /></div>}
          {project && hasExternalTools && mode === "build" && <label className={styles.consent}>
            <input type="checkbox" checked={extensionConsent} disabled={running} onChange={event => setExtensionConsent(event.target.checked)} />
            <span>Allow enabled MCP tools for this run. They may send project context to external servers and perform actions outside this workspace.</span>
          </label>}
            </div>
          </div>
          <div className={styles.workbench}>
            <aside className={styles.projects} data-mobile-open={projectsOpen}>
              <button
                className={styles.mobileProjectsToggle}
                aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((open) => !open)}
              >
                <FolderGit2 size={15} />
                <span>{project?.name || "Projects"}</span>
                <ChevronRight size={14} />
              </button>
              <div className={styles.sectionHead}>
                <strong>Projects</strong>
                <button
                  aria-label="Create project"
                  disabled={!consent || busy || running}
                  onClick={() => setDialog("create")}
                >
                  <Plus size={17} />
                </button>
              </div>
              <div className={styles.projectList}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className={project?.id === p.id ? styles.selected : ""}
                    onClick={() => selectProject(p)}
                    disabled={running || busy}
                  >
                    <FolderGit2 size={16} />
                    <span>
                      {p.name}
                      <small>
                        {p.status === "ready" && p.sandboxId
                          ? "Active · uses your compute slot"
                          : p.status}
                      </small>
                    </span>
                    <ChevronRight size={13} />
                  </button>
                ))}
                {!projects.length && (
                  <p className={styles.smallEmpty}>
                    Your next idea starts here. Create a project or import a
                    GitHub repository.
                  </p>
                )}
              </div>
              <button
                className={styles.importButton}
                disabled={!consent || busy || running}
                onClick={showImport}
              >
                <GitBranch size={15} /> Import from GitHub
              </button>
              {project && (
                <div className={styles.currentThread}>
                  <span>Current thread</span>
                  <button
                    onClick={() =>
                      document.getElementById("cloud-prompt")?.focus()
                    }
                  >
                    <MessageSquare size={14} />
                    <span>
                      {messages.find((message) => message.role === "user")
                        ?.text || "Project conversation"}
                    </span>
                    {running && <span className={styles.runningDot} />}
                  </button>
                </div>
              )}
              <nav
                className={styles.railLinks}
                aria-label="Workspace resources"
              >
                <Link href="/docs">
                  Documentation <ArrowUpRight size={13} />
                </Link>
                <Link href="/docs#desktop">
                  Desktop & CLI <ArrowUpRight size={13} />
                </Link>
              </nav>
              <div className={styles.railSponsor}>
                <SponsorPlacement placement="web" />
              </div>
              <p className={styles.railNote}>
                Only repositories you select.
                <br />
                Nothing is pushed automatically.
              </p>
            </aside>
            {!project ? (
              <section className={styles.start} data-conversation-slot>
                <div className={styles.startGlyph}>
                  <Code2 size={46} strokeWidth={1.3} />
                </div>
                <h2>What do you want to build?</h2>
                <p>
                  Start with a blank project or bring a repository. Ask the
                  agent to build, fix, or help you understand it.
                </p>
                <div className={styles.actions}>
                  <button
                    className="button purple"
                    disabled={!consent || busy}
                    onClick={() => setDialog("create")}
                  >
                    <Plus size={15} /> New project
                  </button>
                  <button
                    className="button secondary"
                    disabled={!consent || busy}
                    onClick={showImport}
                  >
                    <GitBranch size={15} /> Import repository
                  </button>
                </div>
                <span>Review every change before sharing it.</span>
              </section>
            ) : (
              <section className={styles.projectArea}>
                <div className={styles.projectTop}>
                  <div>
                    <strong>{project.name}</strong>
                    {project.repo && <span className={styles.projectStatus}>{project.repo.owner}/{project.repo.name} · {project.repo.defaultBranch} · {project.repo.baseSha.slice(0, 7)}</span>}
                    <span className={styles.projectStatus}>
                      {project.status}
                    </span>
                  </div>
                  <div className={styles.projectTools}>
                    {project.repo && <>
                      <button disabled={busy || running || dirty} onClick={() => syncRepository("status")}><GitBranch size={14} /> Check GitHub</button>
                      <button disabled={busy || running || dirty || !consent} onClick={() => syncRepository("pull")}><RefreshCw size={14} /> Pull from GitHub</button>
                    </>}
                    {paused ? (
                      <button
                        disabled={busy || running || !consent || inactive}
                        onClick={() => lifecycle("resume")}
                      >
                        <Play size={14} /> Resume
                      </button>
                    ) : (
                      <button
                        disabled={busy || running || dirty || inactive}
                        onClick={() => lifecycle("suspend")}
                      >
                        <Pause size={14} /> Suspend
                      </button>
                    )}
                    <button
                      disabled={busy || running}
                      onClick={() => setDialog("delete")}
                      aria-label="Delete cloud project"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className={styles.mobilePaneToggle} role="group" aria-label="Workspace view">
                  <button type="button" aria-pressed={mobilePane === "chat"} onClick={() => setMobilePane("chat")}>Conversation</button>
                  <button type="button" aria-pressed={mobilePane === "inspect"} onClick={() => setMobilePane("inspect")}>Files & output</button>
                </div>
                <div className={styles.taskLayout} data-mobile-pane={mobilePane}>
                  <section
                    className={styles.chatColumn}
                    data-conversation-slot
                    aria-label="Agent conversation"
                  >
                    <div
                      className={styles.conversation}
                      aria-live="polite"
                      aria-relevant="additions text"
                    >
                      {!messages.length && (
                        <div className={styles.chatEmpty}>
                          <span className={styles.agentGlyph}>✳</span>
                          <h3>What do you want to build?</h3>
                          <p>
                            Build something new, trace a bug, or make a plan.
                            The agent works in this cloud project. Changes are
                            yours to review.
                          </p>
                          <div className={styles.suggestions}>
                            {[
                              "Explain this project",
                              "Plan a new feature",
                              "Find a bug",
                            ].map((suggestion) => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => {
                                  promptInputRef.current = suggestion;
                                  setPrompt(suggestion);
                                  document
                                    .getElementById("cloud-prompt")
                                    ?.focus();
                                }}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {messages.map((m, i) => (
                        <div key={m.id || i} className={`${styles.messageRow} ${m.role === "user" ? styles.userRow : styles.agentRow}`}>
                          {m.role === "user" ? <UserAvatar image={status?.userImage} name={status?.userName} className={`${styles.messageAvatar} ${styles.userAvatar}`} /> : <span className={`${styles.messageAvatar} ${styles.agentAvatar}`} role="img" aria-label="Coda"><Mark /></span>}
                          <div className={m.role === "user" ? styles.userMessage : styles.agentMessage} aria-label={m.role === "user" ? "Your message" : "Coda response"}>
                          <span>{m.role === "user" ? "You" : m.role === "assistant" ? "Coda" : "Workspace"}</span>
                          {m.role === "assistant" ? <MarkdownMessage text={m.text} /> : <p>{m.text}</p>}
                          {m.status === "accepted" && <small>Sent · waiting for the agent</small>}
                          </div>
                        </div>
                      ))}
                      {running && (
                        <p className={styles.working}>
                          <Loader2 size={14} className={styles.spin} /> Working
                          in your project…
                        </p>
                      )}
                      {queuedPrompts.length > 0 && (
                        <div className={styles.queuedPrompts} aria-label="Queued messages">
                          <strong>{queuedPrompts.length} queued{queuePaused ? " · paused" : ""}</strong>
                          {queuePaused && <button type="button" disabled={busy || running} onClick={() => { setError(""); pauseQueue(false); }}>Retry queue</button>}
                          {hasExternalTools && queuedPrompts[0]?.mode === "build" && queuedPrompts[0]?.extensionConsent === undefined && !extensionConsent && <p>Approve external tools for the next run before this queue continues.</p>}
                          {queuedPrompts.map((queued, index) => (
                            <div key={queued.id} className={styles.userMessage}>
                              <UserAvatar image={status?.userImage} name={status?.userName} />
                              <span>You · {submittingRef.current && index === 0 ? "Sending…" : queued.failed ? "Failed · retry available" : queuePaused ? "Paused" : "Queued"}</span>
                              <p>{queued.text}</p>
                              <small>{queued.mode}</small>
                              <button
                                type="button"
                                aria-label={`Remove queued message ${index + 1}`}
                                disabled={submittingRef.current && index === 0}
                                onClick={() => updateQueue(queuedRef.current.filter((entry) => entry.id !== queued.id))}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div ref={endOfChat} />
                    </div>
                    <form className={styles.composer} onSubmit={sendPrompt}>
                      <label className="sr-only" htmlFor="cloud-prompt">
                        Message the coding agent
                      </label>
                      <textarea
                        id="cloud-prompt"
                        value={prompt}
                        onChange={(e) => { promptInputRef.current = e.target.value; setPrompt(e.target.value); }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          if (event.ctrlKey) enqueuePrompt();
                          else event.currentTarget.form?.requestSubmit();
                        }}
                        rows={2}
                        maxLength={12000}
                        placeholder="What would you like to build?"
                        disabled={!consent || inactive}
                      />
                      <div>
                        <label>
                          Mode{" "}
                          <select
                            value={mode}
                            onChange={(e) => setMode(e.target.value)}
                            disabled={running}
                          >
                            <option value="build">Build</option>
                            <option value="plan">Plan · read only</option>
                            <option value="review">Review · read only</option>
                          </select>
                        </label>
                        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: "tools" } }))}>Tools</button>
                        <span>
                          {dirty
                            ? "Save your file before starting a run."
                            : "Enter sends · Ctrl+Enter queues · Shift+Enter adds a line."}
                        </span>
                        {running ? (
                          <button
                            type="button"
                            className={styles.send}
                            disabled={busy}
                            onClick={stopRun}
                          >
                            <Square size={13} /> Stop
                          </button>
                        ) : (
                          <button
                            type="submit"
                            className={styles.send}
                            disabled={
                              busy ||
                              !consent ||
                              (hasExternalTools && mode === "build" && !extensionConsent) ||
                              !prompt.trim() ||
                              dirty ||
                              inactive
                            }
                          >
                            <Send size={14} /> Send
                          </button>
                        )}
                      </div>
                    </form>
                  </section>
                  <div className={styles.bottom}>
                    <div
                      className={styles.tabs}
                      role="tablist"
                      aria-label="Workspace panels"
                    >
                      {(
                        [
                          ["files", FileCode2, "Files"],
                          ["changes", GitBranch, "Changes"],
                          ["preview", Play, "Preview"],
                          ["output", Terminal, "Output"],
                        ] as const
                      ).map(([key, Icon, label]) => (
                        <button
                          key={key}
                          id={`tab-${key}`}
                          role="tab"
                          aria-selected={tab === key}
                          aria-controls={`panel-${key}`}
                          tabIndex={tab === key ? 0 : -1}
                          onKeyDown={(e) => {
                            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft")
                              return;
                            const tabs = [
                              "files",
                              "changes",
                              "preview",
                              "output",
                            ] as const;
                            const next =
                              tabs[
                                (tabs.indexOf(tab) +
                                  (e.key === "ArrowRight" ? 1 : 3)) %
                                  4
                              ];
                            e.preventDefault();
                            if (next === "changes") void reviewChanges();
                            else setTab(next);
                            document.getElementById(`tab-${next}`)?.focus();
                          }}
                          onClick={() => {
                            if (key === "changes") void reviewChanges();
                            else if (key === "preview") setTab("preview");
                            else setTab(key);
                          }}
                        >
                          <Icon size={15} />
                          {label}
                          {key === "output" && running && (
                            <span className={styles.runningDot} />
                          )}
                        </button>
                      ))}
                    </div>
                    <section
                      className={styles.panel}
                      role="tabpanel"
                      tabIndex={0}
                      id={`panel-${tab}`}
                      aria-labelledby={`tab-${tab}`}
                    >
                      {tab === "files" && (
                        <>
                          <form
                            className={styles.appFolder}
                            onSubmit={changeAppDirectory}
                            key={`${project.id}:${project.appDirectory}`}
                          >
                            <label>
                              App folder{" "}
                              <input
                                name="appDirectory"
                                aria-label="App folder relative to repository root"
                                defaultValue={
                                  project.appDirectory?.replace(
                                    /^\/(?:home\/project\/app|vercel\/sandbox\/project)\/?/,
                                    "",
                                  ) || "."
                                }
                                maxLength={300}
                                required
                                disabled={
                                  busy || running || inactive || !consent
                                }
                                placeholder=". or apps/web"
                              />
                            </label>
                            <button
                              disabled={
                                busy || running || inactive || dirty || !consent
                              }
                            >
                              Set app folder
                            </button>
                            <span>
                              The folder containing your app’s package.json.
                            </span>
                          </form>
                          <div className={styles.editorRow}>
                            <div className={styles.files} role="region" aria-label="Project files" tabIndex={0}>
                              <div className={styles.sectionHead}>
                                <strong>Files</strong>
                                <button
                                  aria-label="Refresh files"
                                  disabled={busy || running || inactive}
                                  onClick={async () => {
                                    try {
                                      await refreshFiles(project.id);
                                    } catch (e) {
                                      setError(errorMessage(e));
                                    }
                                  }}
                                >
                                  <RefreshCw size={13} />
                                </button>
                              </div>
                              <input
                                className={styles.fileFilter}
                                aria-label="Filter project files"
                                placeholder="Find a file…"
                                value={fileFilter}
                                onChange={(e) => setFileFilter(e.target.value)}
                              />
                              {visibleFiles.map((f) => (
                                <button
                                  key={f.path}
                                  disabled={busy || running || inactive}
                                  className={
                                    file?.path === f.path
                                      ? styles.activeFile
                                      : ""
                                  }
                                  title={f.path}
                                  onClick={() => openFile(f.path)}
                                >
                                  <FileCode2 size={13} />
                                  <span>{f.path}</span>
                                </button>
                              ))}
                              {matchingFiles.length > 250 && (
                                <p className={styles.smallEmpty}>
                                  Showing 250 files. Filter by path to find
                                  more.
                                </p>
                              )}
                              {!!files.length && !matchingFiles.length && (
                                <p className={styles.smallEmpty}>
                                  No files match this path.
                                </p>
                              )}
                              {!files.length && (
                                <p className={styles.smallEmpty}>
                                  No files loaded. Ask the agent to create the
                                  first file.
                                </p>
                              )}
                            </div>
                            <div className={styles.editor}>
                              <div className={styles.editorBar}>
                                <span>
                                  {file?.path || "Your project files"}
                                  {dirty && <b> · unsaved</b>}
                                </span>
                                {file && (
                                  <button
                                    disabled={
                                      busy ||
                                      running ||
                                      inactive ||
                                      !dirty ||
                                      !consent
                                    }
                                    onClick={saveFile}
                                  >
                                    Save file
                                  </button>
                                )}
                              </div>
                              {file ? (
                                <textarea
                                  aria-label={`Edit ${file.path}`}
                                  className={styles.codeEditor}
                                  spellCheck={false}
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  value={draft}
                                  onChange={(e) => setDraft(e.target.value)}
                                  disabled={
                                    busy || running || inactive || !consent
                                  }
                                />
                              ) : (
                                <div className={styles.editorEmpty}>
                                  <FileCode2 size={27} />
                                  <p>Select a file to read and edit it.</p>
                                  <span>
                                    Changes stay in this workspace until you
                                    create a draft pull request.
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                      {tab === "changes" && (
                        <div className={styles.changePanel}>
                          <div className={styles.changeHeader}>
                            <div>
                              <h3>Review your changes.</h3>
                              <p>Nothing has been pushed to GitHub.</p>
                            </div>
                            <button
                              disabled={
                                busy ||
                                running ||
                                dirty ||
                                !changes?.diff ||
                                !changes.reviewHash ||
                                !project.repo
                              }
                              onClick={() => {
                                setDialog("publish");
                              }}
                            >
                              <GitPullRequest size={15} /> Create draft PR
                            </button>
                          </div>
                          {changes?.diff ? (
                            <pre className={styles.diff}>
                              {changes.diff.split("\n").map((line, i) => (
                                <span
                                  key={i}
                                  className={
                                    line.startsWith("+") &&
                                    !line.startsWith("+++")
                                      ? styles.added
                                      : line.startsWith("-") &&
                                          !line.startsWith("---")
                                        ? styles.removed
                                        : undefined
                                  }
                                >
                                  {line}
                                </span>
                              ))}
                            </pre>
                          ) : (
                            <div className={styles.smallEmpty}>
                              {busy
                                ? "Loading changes…"
                                : "No changes to review yet."}
                            </div>
                          )}
                          {changes?.diff && (
                            <label className={styles.reviewCheck}>
                              <input
                                type="checkbox"
                                checked={reviewed}
                                onChange={(e) => setReviewed(e.target.checked)}
                              />
                              I reviewed this diff and confirm it contains no
                              secrets or workflow changes.
                            </label>
                          )}
                          <p className={styles.footnote}>
                            Publishing creates a branch and a draft pull request
                            in your selected repository. It does not merge or
                            deploy your changes.
                          </p>
                        </div>
                      )}
                      {tab === "output" && (
                        <div className={styles.output}>
                          <p>Command output from this run</p>
                          {output ? (
                            <pre>{output}</pre>
                          ) : (
                            <span>No command output yet.</span>
                          )}
                        </div>
                      )}
                      {tab === "preview" && (
                        <div className={styles.preview}>
                          {preview ? (
                            <>
                              <div className={styles.previewBar}>
                                <ShieldCheck size={14} />
                                <span>
                                  Private preview
                                  {preview.expiresAt
                                    ? ` · expires ${new Date(preview.expiresAt).toLocaleTimeString()}`
                                    : ""}
                                </span>
                                <a href={preview.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink size={13} /> Open link
                                </a>
                                <button onClick={() => void copyPreviewUrl()}>
                                  <Copy size={13} /> Copy link
                                </button>
                                <button disabled={busy} onClick={openPreview}>
                                  <RefreshCw size={14} /> Refresh access
                                </button>
                              </div>
                              <iframe
                                title={`${project.name} private preview`}
                                src={preview.url}
                                sandbox="allow-scripts allow-forms allow-same-origin"
                                referrerPolicy="no-referrer"
                              />
                            </>
                          ) : (
                            <div className={styles.editorEmpty}>
                              <Play size={28} />
                              <p>
                                {busy
                                  ? "Starting your private preview…"
                                  : "Your preview is not running yet."}
                              </p>
                              <span>
                                Dependencies are installed in the isolated
                                workspace when needed. Preview access is private
                                and expires automatically.
                              </span>
                              <button
                                disabled={
                                  busy || inactive || running || !consent
                                }
                                onClick={openPreview}
                              >
                                Install dependencies & open preview
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {dialog && (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setDialog(null);
          }}
        >
          <section
            className={styles.dialog}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="cloud-dialog-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setDialog(null);
              if (e.key === "Tab") {
                const nodes = Array.from(
                  dialogRef.current?.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],select:not(:disabled)",
                  ) || [],
                );
                if (!nodes.length) {
                  e.preventDefault();
                  dialogRef.current?.focus();
                  return;
                }
                const first = nodes[0],
                  last = nodes.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              className={styles.close}
              disabled={busy}
              onClick={() => setDialog(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            {dialog === "create" && (
              <form onSubmit={createProject}>
                <h2 id="cloud-dialog-title">A fresh place to start.</h2>
                <p>
                  Give your project a name. You can ask the agent to create its
                  first files.
                </p>
                <label className="field">
                  Project name
                  <input
                    name="name"
                    required
                    minLength={1}
                    maxLength={80}
                    autoFocus
                    placeholder="my-next-idea"
                  />
                </label>
                <label className="field">
                  Starting point
                  <select name="template" defaultValue="nextjs">
                    <option value="nextjs">Next.js app</option>
                    <option value="vite">Vite app</option>
                  </select>
                </label>
                <p className={styles.footnote}>
                  Cloud files, chat, diffs, and output are kept for up to seven
                  days after last activity. Your daily free capacity applies.
                </p>
                <button className="button purple" disabled={busy || !consent}>
                  {busy ? "Creating…" : "Create cloud project"}
                </button>
              </form>
            )}
            {dialog === "import" && (
              <>
                <h2 id="cloud-dialog-title">Bring your own starting point.</h2>
                <p>
                  GitHub controls which repositories the Freecoda GitHub App
                  can access. Your Freecoda selections and working preferences
                  are managed separately in account settings. Importing creates
                  a cloud copy and leaves your original repository unchanged.
                </p>
                <div className={styles.repoAccessActions}>
                  <Link className="button secondary" href="/settings#connections" target="_blank" rel="noopener noreferrer">
                    Manage Freecoda selections <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                  {installUrl && <a className="button secondary" href={installUrl} target="_blank" rel="noopener noreferrer">
                    Manage GitHub App access <ArrowUpRight size={14} aria-hidden="true" />
                  </a>}
                  <button className={styles.linkButton} disabled={busy} onClick={showImport}>Refresh repository access</button>
                </div>
                <p className={styles.footnote}>Management opens in a new tab. After changing repository access or selections, return here and refresh. GitHub organization approval may be required for additional repositories.</p>
                {repoLoadError && <p className={styles.repoAccessError} role="alert">{repoLoadError} Refresh access to retry, or manage your connections in settings.</p>}
                <h3 className={styles.repoSectionTitle}>Repositories granted by GitHub</h3>
                {repos.length ? (
                  <div className={styles.repoList}>
                    {repos.map((repo) => (
                      <button
                        key={`${repo.installationId}/${repo.owner}/${repo.name}`}
                        type="button"
                        disabled={busy}
                        aria-pressed={selectedRepo?.repositoryId === repo.repositoryId}
                        data-selected={selectedRepo?.repositoryId === repo.repositoryId}
                        onClick={() => setSelectedRepo(repo)}
                      >
                        <FolderGit2 size={18} />
                        <span>
                          {repo.owner}/{repo.name}
                          <small>
                            {repo.private
                              ? "Private repository"
                              : "Public repository"}
                            {repoPreferences.some(preference => preference.repositoryId === repo.repositoryId && preference.enabled)
                              ? " · Selected in Freecoda"
                              : " · Not selected in Freecoda settings"}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.smallEmpty}>
                    {busy
                      ? "Loading your selected repositories…"
                      : "No repositories are available. Select repositories in the GitHub App installation, then refresh."}
                  </p>
                )}
                {repos.length > 0 && (
                  <p className={styles.footnote}>Sorted by repository creation date, newest first.</p>
                )}
                {selectedRepo && (
                  <p className={styles.selectedRepo}>
                    Selected: <strong>{selectedRepo.owner}/{selectedRepo.name}</strong>
                  </p>
                )}
                <button
                  type="button"
                  className="button purple"
                  disabled={!selectedRepo || busy || !consent}
                  onClick={() => selectedRepo && void importRepo(selectedRepo)}
                >
                  {busy ? "Importing…" : "Import selected repository"}
                </button>
                {repoPreferences.some(preference => !repos.some(repo => repo.repositoryId === preference.repositoryId)) && !busy && <div className={styles.unavailableRepos}>
                  <h3 className={styles.repoSectionTitle}>Saved selections without current access</h3>
                  <p>These repositories cannot be imported until GitHub access is restored. Manage GitHub App access or remove their saved configuration in Freecoda settings.</p>
                  <ul>{repoPreferences.filter(preference => !repos.some(repo => repo.repositoryId === preference.repositoryId)).map(preference => <li key={preference.repositoryId}>{preference.owner}/{preference.name}</li>)}</ul>
                </div>}

              </>
            )}
            {dialog === "publish" && (
              <form onSubmit={publish}>
                <h2 id="cloud-dialog-title">Share a draft for review.</h2>
                <p>
                  Create a branch and a draft pull request in{" "}
                  {project?.repo
                    ? `${project.repo.owner}/${project.repo.name}`
                    : project?.repository || "your selected repository"}
                  . Review the Changes panel first.
                </p>
                <label className="field">
                  Pull request title
                  <input
                    name="title"
                    required
                    maxLength={150}
                    defaultValue="Changes from Freecoda"
                    autoFocus
                  />
                </label>
                <label className="field">
                  Description
                  <textarea
                    name="body"
                    rows={4}
                    maxLength={10000}
                    defaultValue="Created in Freecoda. Please review these changes before merging."
                  />
                </label>
                <label className={styles.reviewCheck}>
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the full diff and authorize publishing these
                  changes as a draft pull request. No secrets or workflow files
                  are included.
                </label>
                <button
                  className="button purple"
                  disabled={busy || !reviewed || !changes?.diff}
                >
                  {busy ? "Creating draft…" : "Publish branch & draft PR"}
                </button>
              </form>
            )}
            {dialog === "delete" && (
              <>
                <h2 id="cloud-dialog-title">Delete {project?.name}?</h2>
                <p>
                  This removes the cloud project, its files, chat, and output,
                  and stops its preview. Your GitHub repository and existing
                  pull requests stay as they are.
                </p>
                <div className={styles.actions}>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    Keep project
                  </button>
                  <button
                    className={styles.deleteButton}
                    disabled={busy || running}
                    onClick={() => lifecycle("delete")}
                  >
                    {busy ? "Deleting…" : "Delete cloud project"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <ModelPicker open={modelPickerOpen} models={status?.models ?? noWorkspaceModels} selected={model} onSelect={setModel} onClose={() => setModelPickerOpen(false)} />
    </div>
  );
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not complete that action. Please try again.";
}
