"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceControls } from "@/components/voice-controls";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
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
import { AgentMessage } from "@/components/agent-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { MessageScroller, MessageScrollerProvider, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "@/components/ui/message-scroller";
import { Trace, TraceLine, TraceIcon, TraceTitle, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent } from "@/components/ui/trace";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle, CodeBlockActions, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import styles from "./workspace.module.css";
import { Mark } from "@/components/chrome";
import { UserAvatar } from "@/components/user-avatar";
import { WelcomeIdentity, WelcomeSurface } from "@/components/welcome-surface";
import { MarkdownMessage } from "@/components/markdown-message";
import { aiServiceText } from "@/components/ai-service-text";
import { useModelSelection } from "@/components/use-model-selection";
import { ThemeControl } from "@/components/theme-control";
import { SponsorPlacement } from "@/components/sponsor-placement";
import { parseSkillInstallIntent, codexUnsupportedCommand } from "@freecoda/contracts";
import { useConversationCommands } from "./conversation-commands";
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
type WorkspaceMessage = { id?: string; runId?: string; status?: "accepted"; role: "user" | "assistant" | "system"; text: string };

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

export function CloudWorkspace({ conversationMode = "project", onOpenProject, onOpenChat }: { conversationMode?: "ask" | "project"; onOpenProject?: () => void; onOpenChat?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const { model } = useModelSelection(status?.userId, status?.models ?? noWorkspaceModels);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "inspect">("chat");
  const [controlsOpen, setControlsOpen] = useState(false);
  const [extensionsView, setExtensionsView] = useState<"all" | "mcp" | "tools" | "skills">("all");
  const [skillSource, setSkillSource] = useState<string | null>(null);
  const [extensionsOpenSignal, setExtensionsOpenSignal] = useState(0);
  const [file, setFile] = useState<{
    path: string;
    content: string;
    hash: string;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
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
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalResult, setTerminalResult] = useState<{ command: string; exitCode: number; stdout: string; stderr: string; cwd: string } | null>(null);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileOpen, setNewFileOpen] = useState(false);
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
  const [projectSearch, setProjectSearch] = useState("");
  const [repoSearch, setRepoSearch] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [repoPreferences, setRepoPreferences] = useState<{ repositoryId: number; owner: string; name: string; enabled: boolean }[]>([]);
  const [repoLoadError, setRepoLoadError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const projectRef = useRef<string | null>(null);
  const eventCursor = useRef<string | number>(0);
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
      setExtensionsView(view === "mcp" || view === "tools" || view === "skills" ? view : "all");
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
    if (!signal) onOpenProject?.();
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
  async function createFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !consent) return;
    const path = newFilePath.trim().replace(/^\/+/, "");
    setBusy(true);
    setError("");
    try {
      const data = await api<{ hash: string }>(`projects/${project.id}/files`, "PUT", {
        path,
        content: "",
        expectedHash: null,
      });
      setFile({ path, content: "", hash: data.hash });
      setDraft("");
      setNewFilePath("");
      setNewFileOpen(false);
      await refreshFiles(project.id);
      setNotice("File created in your cloud workspace.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function runTerminal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !consent || !terminalCommand.trim()) return;
    const command = terminalCommand.trim();
    setTerminalBusy(true);
    setError("");
    setTerminalResult(null);
    try {
      const result = await api<{ exitCode: number; stdout: string; stderr: string; cwd: string }>(
        `projects/${project.id}/terminal`, "POST", { command },
      );
      setTerminalResult({ command, ...result });
      setTerminalCommand("");
      setTab("output");
      setNotice(result.exitCode === 0 ? "Command finished." : `Command exited with code ${result.exitCode}.`);
      await refreshFiles(project.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTerminalBusy(false);
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

  const slashRef = useRef<(value: string) => Promise<void>>(async () => {});
  slashRef.current = slashCommand;
  useEffect(() => {
    const run = (event: Event) => { void slashRef.current((event as CustomEvent<{ command: string }>).detail.command); };
    window.addEventListener("freecoda:project-command", run);
    return () => window.removeEventListener("freecoda:project-command", run);
  }, []);
  const commands = useConversationCommands(prompt, command => {
    promptInputRef.current = "";
    setPrompt("");
    void slashCommand(command);
    document.getElementById("cloud-prompt")?.focus();
  });

  async function sendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!promptInputRef.current.trim()) return;
    const text = promptInputRef.current.trim();
    const skill = parseSkillInstallIntent(text);
    if (text.startsWith("/") || skill) {
      promptInputRef.current = "";
      setPrompt("");
      await slashCommand(skill ? `/skills${skill.source ? ` install ${skill.source}` : ""}` : text);
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
      case "/chat":
        onOpenChat?.();
        break;
      case "/project":
        setProjectSearch(rawArgument);
        setProjectsOpen(true);
        setNotice("Choose a project to give this conversation project access, or import a repository from GitHub.");
        break;
      case "/repos":
        await showImport();
        break;
      case "/build":
      case "/plan":
      case "/review":
        setMode(command.slice(1).toLowerCase());
        if (!project) { setProjectsOpen(true); setNotice("Choose or import a project before continuing. No repository access has been granted."); }
        else setNotice(`${command.slice(1)} selected for ${project.name}. ${command === "/build" ? "Changes require the project's permissions." : "Read-only project access."}`);
        break;
      case "/files":
      case "/diff":
      case "/changes":
      case "/preview":
      case "/output":
        setTab((command === "/diff" ? "changes" : command.slice(1)) as "files" | "changes" | "preview" | "output");
        setMobilePane("inspect");
        if (!project) setNotice("Select a project to inspect its files and output.");
        break;
      case "/help":
        setNotice("Type / for commands. /project selects project access; /chat returns to general conversation; /build, /plan and /review choose how to work. /files, /changes, /preview and /output inspect the project.");
        break;
      case "/new":
        onOpenChat?.();
        window.dispatchEvent(new CustomEvent("freecoda:new-chat"));
        break;
      case "/clear":
        onOpenChat?.();
        window.dispatchEvent(new CustomEvent("freecoda:new-chat"));
        setNotice("Started a fresh general chat. This workspace’s existing run history remains saved.");
        break;
      case "/resume":
        onOpenChat?.();
        window.dispatchEvent(new CustomEvent("freecoda:chat-sidebar"));
        break;
      case "/copy": {
        const answer = messages.filter(message => message.role === "assistant").at(-1)?.text;
        if (running || !answer) setNotice("No completed assistant response to copy.");
        else try { await navigator.clipboard.writeText(answer); setNotice("Latest response copied."); }
        catch { setError("Clipboard access was denied. Use the response’s Copy button instead."); }
        break;
      }
      case "/pwd":
      case "/cwd":
        setNotice(project ? `Cloud app directory: ${project.appDirectory || "."}. This is in the hosted workspace, not on your computer.` : "No cloud workspace selected.");
        break;
      case "/mode":
        if (["build", "plan", "review"].includes(argument)) {
          setMode(argument);
          setNotice(`Mode set to ${argument}.`);
        } else setNotice("Usage: /mode build|plan|review");
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
          setNotice(`AI free allowance remaining today: $${(usage.freeRemainingMicros / 1_000_000).toFixed(4)}. Hosted inference is free.`);
        } catch (error) { setError(errorMessage(error)); }
        break;
      }
      case "/skills":
        setSkillSource(argument.startsWith("install ") ? rawArgument.slice(8).trim() : null);
        window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: "skills" } }));
        setNotice(project ? "Review the skill source and choose Install extension. Installation does not grant new execution permissions." : "Choose a project before installing skills.");
        break;
      case "/plugins":
      case "/extensions":
      case "/mcp":
      case "/tools":
        window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: command === "/mcp" ? "mcp" : command === "/tools" ? "tools" : "all" } }));
        setNotice(project ? "Manage plugins for the next run in Cloud settings. Active runs keep their existing tools." : "Select or import a project to manage its MCP connections and tools.");
        break;
      case "/sync":
        if (!argument || argument === "status") await syncRepository("status");
        else if (argument === "pull") await syncRepository("pull");
        else setNotice("Usage: /sync status|pull. Publish and merge cloud edits before pulling.");
        break;
      case "/start":
        if (project?.status === "suspended") await lifecycle("resume");
        else setNotice("The selected project is already active.");
        break;
      case "/suspend":
        if (project?.status === "ready" && !running) await lifecycle("suspend");
        else setNotice("Stop the active run before suspending this project.");
        break;
      default:
        setError(codexUnsupportedCommand(command) || `Unknown command: ${command}. Try /help.`);
    }
  }
  function enqueuePrompt() {
    const text = promptInputRef.current.trim();
    if (!text || !project || !consent || dirty || inactive) return;
    const skill = parseSkillInstallIntent(text);
    if (text.startsWith("/") || skill) {
      promptInputRef.current = "";
      setPrompt("");
      void slashCommand(skill ? `/skills${skill.source ? ` install ${skill.source}` : ""}` : text);
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
      setError("The AI service is unavailable for this account. Your message is retained in the queue.");
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
  const visibleProjects = projects.filter((item) =>
    [item.name, item.repository, item.repo && `${item.repo.owner}/${item.repo.name}`]
      .filter(Boolean).join(" ").toLowerCase().includes(projectSearch.trim().toLowerCase()),
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
        <Alert className={styles.error} variant="destructive">
          <AlertTitle>Workspace error</AlertTitle>
          <AlertDescription>{aiServiceText(error, status?.models)}</AlertDescription>
          {error.includes("Cloud compute is busy") && activeWorkspace && (
            <Button className={styles.errorAction} type="button" onClick={() => void selectProject(activeWorkspace)}>
              Open active workspace: {activeWorkspace.name}
            </Button>
          )}
          <AlertAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss error" onClick={() => setError("")}><X /></Button></AlertAction>
        </Alert>
      )}
      {notice && (
        <Alert className={styles.notice} role="status">
          <Check size={15} />
          <AlertDescription>{aiServiceText(notice, status?.models)}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer">
              View draft pull request <ArrowUpRight size={13} />
            </a>
          )}
          </AlertDescription>
        </Alert>
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
            <WelcomeIdentity />
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
              {aiServiceText(status?.reason ||
                status?.message ||
                (!status
                  ? "Refresh to check cloud availability. You can also open your account or use the local CLI."
                  : "Cloud execution is not enabled on this instance yet. You can keep building with the local CLI while the cloud service is configured."), status?.models)}
            </p>
            <div className={styles.actions}>
              <Link className={buttonVariants()} href="/dashboard">
                {status?.authenticated === false
                  ? "Continue with GitHub"
                  : "View account & allowance"}
              </Link>
              <Link className={buttonVariants({ variant: "outline" })} href="/docs">
                Use the local CLI
              </Link>
              <Button
                variant="ghost"
                onClick={() => void load()}
                aria-label="Refresh service availability"
              >
                <RefreshCw size={17} />
              </Button>
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
            <Button type="button" className={styles.settingsToggle} aria-expanded={controlsOpen || !consent} onClick={() => setControlsOpen(open => !open)}>
              <ShieldCheck size={14} /> Cloud settings · {consent ? "consent saved" : "consent required"}
            </Button>
            <div className={styles.settingsBody}>
          <div className={styles.capacity}>
            <ShieldCheck size={16} />
            <span>{limitText}</span>
            <Link href="/privacy#cloud-workspaces">Cloud privacy</Link>
          </div>
          <Field orientation="horizontal" className={styles.consent}>
            <Checkbox id="cloud-consent" checked={consent} disabled={!consentLoaded || consentSaving || consent} onCheckedChange={checked => void acceptCloudConsent(checked === true)} />
            <FieldLabel htmlFor="cloud-consent">
              {consent
                ? "Cloud storage consent is saved for this account. Files, chat, diffs, and command output are retained for up to seven days after activity; material changes to these terms will ask again."
                : "I agree to store this project’s files, chat, diffs, and command output in Freecoda’s cloud for up to seven days after last activity. Delete the project at any time. Avoid secrets and private customer data."}
            </FieldLabel>
          </Field>
          {project && <div id="cloud-project-extensions"><ProjectExtensions key={project.id} projectId={project.id} disabled={busy || running || !consent} onToolsChanged={extensionsChanged} requestedView={extensionsView} openSignal={extensionsOpenSignal} skillSource={skillSource} mode={mode} /></div>}
          {project && hasExternalTools && mode === "build" && <Field orientation="horizontal" className={styles.consent}>
            <Checkbox id="external-tools-consent" checked={extensionConsent} disabled={running} onCheckedChange={checked => setExtensionConsent(checked === true)} />
            <FieldLabel htmlFor="external-tools-consent">Allow enabled MCP tools for this run. They may send project context to external servers and perform actions outside this workspace.</FieldLabel>
          </Field>}
            </div>
          </div>
          <div className={styles.workbench}>
            <aside className={styles.projects} data-mobile-open={projectsOpen} aria-label="Cloud workspaces">
              <Button
                className={styles.mobileProjectsToggle}
                aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((open) => !open)}
              >
                <FolderGit2 size={15} />
                <span>{project?.name || "Workspaces"}</span>
                <ChevronRight size={14} />
              </Button>
              <div className={styles.sectionHead}>
                <strong>Your workspaces</strong>
                <Button
                  aria-label="Create project"
                  disabled={!consent || busy || running}
                  onClick={() => setDialog("create")}
                >
                  <Plus size={17} />
                </Button>
              </div>
              <label className={styles.projectSearch}>Find a workspace<Input type="search" value={projectSearch} onChange={event => setProjectSearch(event.target.value)} placeholder="Name or repository…" /></label>
              <div className={styles.projectList}>
                {visibleProjects.map((p) => {
                  const selected = project?.id === p.id;
                  const details = selected ? project : p;
                  const repository = details.repo ? `${details.repo.owner}/${details.repo.name}` : details.repository;
                  return (
                    <div key={p.id} className={styles.workspaceGroup}>
                      <Button
                        className={`${styles.workspaceButton} ${selected ? styles.selected : ""}`}
                        onClick={() => selectProject(p)}
                        disabled={running || busy}
                        aria-current={selected ? "true" : undefined}
                        aria-label={`Open workspace ${p.name}${repository ? `, ${repository}` : ""}`}
                      >
                        <FolderGit2 size={16} aria-hidden="true" />
                        <span>
                          {p.name}
                          <small>{repository || "Cloud project"}</small>
                          {details.repo?.defaultBranch && <small className={styles.workspaceBranch}><GitBranch size={11} aria-hidden="true" />{details.repo.defaultBranch}</small>}
                          {details.appDirectory && details.appDirectory !== "." && <small>App: {details.appDirectory}</small>}
                          <small>{details.status === "ready" && details.sandboxId ? "Active · uses your compute slot" : details.status}</small>
                        </span>
                        <ChevronRight size={13} aria-hidden="true" />
                      </Button>
                      {selected && (
                        <div className={styles.workspaceConversation}>
                          <Button
                            aria-label={`Continue conversation in ${p.name}`}
                            onClick={() => {
                              onOpenProject?.();
                              setMobilePane("chat");
                              document.getElementById("cloud-prompt")?.focus();
                            }}
                          >
                            <MessageSquare size={14} aria-hidden="true" />
                            <span>{messages.find((message) => message.role === "user")?.text || "Workspace conversation"}</span>
                            {running && <span className={styles.runningDot} aria-label="Running" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {projectSearch && !visibleProjects.length && <p className={styles.smallEmpty}>No matching workspaces.</p>}
                {!projects.length && (
                  <Empty className={styles.projectListEmpty}>
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><FolderGit2 /></EmptyMedia>
                      <EmptyTitle>No workspaces yet</EmptyTitle>
                      <EmptyDescription>Create a project or import a GitHub repository.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
              <Button
                variant="outline"
                disabled={!consent || busy || running}
                onClick={showImport}
              >
                <GitBranch size={15} /> Import from GitHub
              </Button>
              <nav
                className={styles.railLinks}
                aria-label="Workspace resources"
              >
                <Link href="/docs">
                  Documentation <ArrowUpRight size={13} />
                </Link>
                <Link href="/download">
                  Download desktop <ArrowUpRight size={13} />
                </Link>
                <Link href="/#install">
                  Install the CLI <ArrowUpRight size={13} />
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
              <section className={styles.welcomeStart} data-conversation-slot aria-label="Start a workspace">
                <div className={styles.codingWelcome}>
                  <Badge variant="outline"><FolderGit2 data-icon="inline-start" /> YOUR PROJECT, YOUR CALL</Badge>
                  <h2>What are we<br /><span>building today?</span></h2>
                  <p>Start with a clean project or bring a repository you choose. Freecoda works alongside you, and every change stays yours to review.</p>
                  <div className="my-8 grid gap-4 sm:grid-cols-2">
                    <Card size="sm">
                      <CardHeader><CardTitle>Start from an idea</CardTitle><CardDescription>A clean, ready-to-build workspace.</CardDescription></CardHeader>
                      <CardContent>Choose a starter and let your project take shape in the cloud.</CardContent>
                      <CardFooter><Button disabled={!consent || busy || running} onClick={() => setDialog("create")}><Plus data-icon="inline-start" />Create a project</Button></CardFooter>
                    </Card>
                    <Card size="sm">
                      <CardHeader><CardTitle>Continue with a repo</CardTitle><CardDescription>Bring in a project you already own.</CardDescription></CardHeader>
                      <CardContent>Select a GitHub repository you have granted Freecoda access to.</CardContent>
                      <CardFooter><Button variant="outline" disabled={!consent || busy || running} onClick={() => void showImport()}><FolderGit2 data-icon="inline-start" />Choose a repository</Button></CardFooter>
                    </Card>
                  </div>
                  <div className={styles.workflowSteps} aria-label="How it works"><span><b>01</b> Open a project</span><span><b>02</b> Build with your agent</span><span><b>03</b> Review every change</span></div>
                  <div className={styles.welcomeLinks}>{onOpenChat ? <Button type="button" onClick={onOpenChat}>Just want to chat? <ArrowUpRight size={13} aria-hidden="true" /></Button> : <Link href="/app?view=chat">Just want to chat? <ArrowUpRight size={13} aria-hidden="true" /></Link>}<Link href="/docs#desktop">Work in a local folder <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
                </div>
                <p className={styles.welcomeNote}>{!consent ? "Accept cloud storage consent above to create or import a workspace." : "Review every change before sharing it."}</p>
              </section>
            ) : (
              <section className={styles.projectArea}>
                <div className={styles.projectTop}>
                  <div>
                    <strong>{project.name}</strong><span className={styles.projectStatus}>Cloud project · {mode === "build" ? "Build with approvals" : `${mode} · read only`}</span>
                    {project.repo && <span className={styles.projectStatus}>{project.repo.owner}/{project.repo.name} · {project.repo.defaultBranch} · {project.repo.baseSha.slice(0, 7)}</span>}
                    <span className={styles.projectStatus}>
                      {project.status}
                    </span>
                  </div>
                  <div className={styles.projectTools}>
                    {project.repo && <>
                      <Button disabled={busy || running || dirty} onClick={() => syncRepository("status")}><GitBranch size={14} /> Check GitHub</Button>
                      <Button disabled={busy || running || dirty || !consent} onClick={() => syncRepository("pull")}><RefreshCw size={14} /> Pull from GitHub</Button>
                    </>}
                    {paused ? (
                      <Button
                        disabled={busy || running || !consent || inactive}
                        onClick={() => lifecycle("resume")}
                      >
                        <Play size={14} /> Resume
                      </Button>
                    ) : (
                      <Button
                        disabled={busy || running || dirty || inactive}
                        onClick={() => lifecycle("suspend")}
                      >
                        <Pause size={14} /> Suspend
                      </Button>
                    )}
                    <Button
                      disabled={busy || running}
                      onClick={() => setDialog("delete")}
                      aria-label="Delete cloud project"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                <div className={styles.mobilePaneToggle}>
                  <ToggleGroup size="sm" value={[mobilePane]} onValueChange={values => { if (values[0] === "chat" || values[0] === "inspect") setMobilePane(values[0]); }} aria-label="Workspace view">
                    <ToggleGroupItem value="chat">Conversation</ToggleGroupItem>
                    <ToggleGroupItem value="inspect">Files & output</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className={styles.taskLayout} data-mobile-pane={mobilePane}>
                  <section
                    className={styles.chatColumn}
                    data-conversation-slot
                    aria-label="Agent conversation"
                  >
                    <MessageScrollerProvider key={project.id} autoScroll defaultScrollPosition="end">
                    <MessageScroller className={styles.conversation}>
                      <MessageScrollerViewport aria-label="Agent conversation">
                      <MessageScrollerContent aria-busy={running} className="p-4">
                      {!messages.length && (
                        <MessageScrollerItem messageId="welcome" className={styles.workspaceWelcome}>
                          <WelcomeSurface heading="h3" description={`A plan, a question, or a change for ${project.name}. You review the work before sharing it.`} actions={[
                            { label: "Explore this project", description: "Understand the code and where to start", prompt: "Explain how this project is organized and where I should start.", mode: "plan" },
                            { label: "Plan a feature", description: "Work out the next steps before editing", prompt: "Help me plan a new feature. Ask what I want to build first.", mode: "plan" },
                            { label: "Review this project", description: "Look for a concrete bug before making changes", prompt: "Review this project for a concrete bug. Explain your findings before making changes.", mode: "review" },
                            { label: "Build something", description: "Make a change with the usual approvals", prompt: "Help me make a change to this project. Ask what I need first.", mode: "build" },
                          ].map(action => ({ label: action.label, description: action.description, disabled: busy || running || inactive || !consent, onClick: () => {
                            setMode(action.mode);
                            promptInputRef.current = action.prompt;
                            setPrompt(action.prompt);
                            document.getElementById("cloud-prompt")?.focus();
                          } }))} />
                        </MessageScrollerItem>
                      )}
                      {messages.map((m, i) => (
                        <MessageScrollerItem key={m.id || i} messageId={m.id || `message-${i}`} scrollAnchor={m.role === "user"}>
                          <AgentMessage role={m.role} image={status?.userImage} name={status?.userName} footer={m.status === "accepted" ? "Sent · waiting for the agent" : undefined}>
                            {m.role === "assistant" ? <MarkdownMessage text={m.text} /> : <p>{m.text}</p>}
                          </AgentMessage>
                        </MessageScrollerItem>
                      ))}
                      {(running || output) && <MessageScrollerItem messageId="run-activity">
                        <Trace>
                          {output && <TraceCollapsible>
                            <TraceCollapsibleTrigger><TraceLine><TraceIcon><Terminal /></TraceIcon><TraceTitle>Command output from this run</TraceTitle></TraceLine></TraceCollapsibleTrigger>
                            <TraceCollapsibleContent><CodeBlock size="sm"><CodeBlockContent wrap className="max-h-64">{output}</CodeBlockContent></CodeBlock></TraceCollapsibleContent>
                          </TraceCollapsible>}
                          {running && <TraceLine status="running"><TraceIcon><Loader2 /></TraceIcon><TraceTitle>Working in your project…</TraceTitle></TraceLine>}
                        </Trace>
                      </MessageScrollerItem>}
                      {queuedPrompts.length > 0 && (
                        <MessageScrollerItem messageId="queue" className={styles.queuedPrompts} aria-label="Queued messages">
                          <strong>{queuedPrompts.length} queued{queuePaused ? " · paused" : ""}</strong>
                          {queuePaused && <Button type="button" disabled={busy || running} onClick={() => { setError(""); pauseQueue(false); }}>Retry queue</Button>}
                          {hasExternalTools && queuedPrompts[0]?.mode === "build" && queuedPrompts[0]?.extensionConsent === undefined && !extensionConsent && <p>Approve external tools for the next run before this queue continues.</p>}
                          {queuedPrompts.map((queued, index) => (
                            <AgentMessage key={queued.id} role="user" image={status?.userImage} name={status?.userName}>
                              <span>You · {submittingRef.current && index === 0 ? "Sending…" : queued.failed ? "Failed · retry available" : queuePaused ? "Paused" : "Queued"}</span>
                              <p>{queued.text}</p>
                              <small>{queued.mode}</small>
                              <Button
                                type="button"
                                aria-label={`Remove queued message ${index + 1}`}
                                disabled={submittingRef.current && index === 0}
                                onClick={() => updateQueue(queuedRef.current.filter((entry) => entry.id !== queued.id))}
                              >
                                <X size={13} />
                              </Button>
                            </AgentMessage>
                          ))}
                        </MessageScrollerItem>
                      )}
                      </MessageScrollerContent>
                      </MessageScrollerViewport>
                      <MessageScrollerButton />
                    </MessageScroller>
                    </MessageScrollerProvider>
                    <form className={styles.composer} onSubmit={sendPrompt}>
                      <VoiceControls visible={conversationMode === "project" && consent && !inactive} scopeKey={project?.id || "no-project"} disabled={busy || !project || !consent || inactive} onDictation={text => { const next = (promptInputRef.current + (promptInputRef.current && !/\s$/.test(promptInputRef.current) ? " " : "") + text).slice(0, 12000); promptInputRef.current = next; setPrompt(next); }} />
                      {commands.list}
                      <label className="sr-only" htmlFor="cloud-prompt">
                        Message the coding agent
                      </label>
                      <InputGroup>
                      <InputGroupTextarea
                        {...commands.attributes}
                        id="cloud-prompt"
                        value={prompt}
                        onChange={(e) => { promptInputRef.current = e.target.value; setPrompt(e.target.value); }}
                        onKeyDown={(event) => {
                          if (commands.keyDown(event)) return;
                          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                          event.preventDefault();
                          if (event.ctrlKey) enqueuePrompt();
                          else event.currentTarget.form?.requestSubmit();
                        }}
                        rows={2}
                        maxLength={12000}
                        placeholder="Ask Coda about this project, or / for commands"
                        disabled={!consent || inactive}
                      />
                      <InputGroupAddon align="block-end" className="flex-wrap">
                        <InputGroupButton type="button" onClick={() => { promptInputRef.current = "/"; setPrompt("/"); document.getElementById("cloud-prompt")?.focus(); }}>Commands</InputGroupButton>
                        <InputGroupButton type="button" title="Use /build, /plan or /review" onClick={() => { promptInputRef.current = "/"; setPrompt("/"); document.getElementById("cloud-prompt")?.focus(); }}>{mode === "build" ? "Build" : mode === "plan" ? "Plan · read only" : "Review · read only"}</InputGroupButton>
                        <InputGroupButton type="button" onClick={() => onOpenChat?.()} title="Continue without repository context · /chat">Leave project</InputGroupButton>
                        <InputGroupButton type="button" onClick={() => window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: "tools" } }))}>Tools</InputGroupButton>
                        <span>
                          {dirty
                            ? "Save your file before starting a run."
                            : "Enter sends · Ctrl+Enter queues · Shift+Enter adds a line."}
                        </span>
                        {running ? (
                          <InputGroupButton
                            type="button"
                            variant="default"
                            disabled={busy}
                            onClick={stopRun}
                          >
                            <Square /> Stop
                          </InputGroupButton>
                        ) : (
                          <InputGroupButton
                            type="submit"
                            variant="default"
                            disabled={
                              busy ||
                              !consent ||
                              (hasExternalTools && mode === "build" && !extensionConsent) ||
                              !prompt.trim() ||
                              dirty ||
                              inactive
                            }
                          >
                            <Send /> Send
                          </InputGroupButton>
                        )}
                      </InputGroupAddon>
                      </InputGroup>
                    </form>
                  </section>
                  <Tabs value={tab} onValueChange={value => { const next = value as typeof tab; if (next === "changes") void reviewChanges(); else setTab(next); }} className={styles.bottom}>
                    <TabsList variant="line" aria-label="Workspace panels" className="w-full shrink-0 justify-start">
                      {([["files", FileCode2, "Files"], ["changes", GitBranch, "Changes"], ["preview", Play, "Preview"], ["output", Terminal, "Output"]] as const).map(([key, Icon, label]) => (
                        <TabsTrigger key={key} value={key}><Icon data-icon="inline-start" />{label}{key === "output" && running && <Badge variant="secondary">Running</Badge>}</TabsTrigger>
                      ))}
                    </TabsList>
                    <TabsContent value={tab} className={styles.panel}>
                      {tab === "files" && (
                        <>
                          <form
                            className={styles.appFolder}
                            onSubmit={changeAppDirectory}
                            key={`${project.id}:${project.appDirectory}`}
                          >
                            <label>
                              App folder{" "}
                              <Input
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
                            <Button
                              disabled={
                                busy || running || inactive || dirty || !consent
                              }
                            >
                              Set app folder
                            </Button>
                            <span>
                              The folder containing your app’s package.json.
                            </span>
                          </form>
                          <div className={styles.editorRow}>
                            <div className={styles.files} role="region" aria-label="Project files" tabIndex={0}>
                              <div className={styles.sectionHead}>
                                <strong>Files</strong>
                                <div className={styles.fileActions}>
                                  <Button size="sm" variant="outline" disabled={busy || running || inactive || !consent} onClick={() => setNewFileOpen(true)}><Plus size={13} /> New file</Button>
                                  <Button aria-label="Refresh files" disabled={busy || running || inactive} onClick={async () => { try { await refreshFiles(project.id); } catch (e) { setError(errorMessage(e)); } }}><RefreshCw size={13} /></Button>
                                </div>
                              </div>
                              <Input
                                className={styles.fileFilter}
                                aria-label="Filter project files"
                                placeholder="Find a file…"
                                value={fileFilter}
                                onChange={(e) => setFileFilter(e.target.value)}
                              />
                              {visibleFiles.map((f) => (
                                <Button
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
                                </Button>
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
                                  <Button
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
                                  </Button>
                                )}
                              </div>
                              {file ? (
                                <Textarea
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
                            <Button
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
                            </Button>
                          </div>
                          {changes?.diff ? (
                            <CodeBlock><CodeBlockContent>{changes.diff.split("\n").map((line, i) => <CodeBlockLine key={i} variant={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : undefined}>{line}</CodeBlockLine>)}</CodeBlockContent></CodeBlock>
                          ) : (
                            <div className={styles.smallEmpty}>
                              {busy
                                ? "Loading changes…"
                                : "No changes to review yet."}
                            </div>
                          )}
                          {changes?.diff && (
                            <Field orientation="horizontal" className={styles.reviewCheck}>
                              <Checkbox id="reviewed-diff" checked={reviewed} onCheckedChange={checked => setReviewed(checked === true)} />
                              <FieldLabel htmlFor="reviewed-diff">I reviewed this diff and confirm it contains no secrets or workflow changes.</FieldLabel>
                            </Field>
                          )}
                          <p className={styles.footnote}>
                            Publishing creates a branch and a draft pull request
                            in your selected repository. It does not merge or
                            deploy your changes.
                          </p>
                        </div>
                      )}
                      {tab === "output" && (
                        <div className={styles.terminalPanel}>
                          <div className={styles.terminalHeader}>
                            <div><strong>Project terminal</strong><span>Commands run in the isolated workspace sandbox.</span></div>
                            <Badge variant="outline">{terminalResult?.cwd || project.appDirectory || "/home/project/app"}</Badge>
                          </div>
                          <form className={styles.terminalForm} onSubmit={runTerminal}>
                            <span aria-hidden="true">$</span>
                            <Input aria-label="Terminal command" value={terminalCommand} onChange={event => setTerminalCommand(event.target.value)} placeholder="bun run build" maxLength={4000} disabled={!consent || inactive || terminalBusy || running} />
                            <Button type="submit" disabled={!consent || inactive || terminalBusy || running || !terminalCommand.trim()}>{terminalBusy ? <Loader2 className="animate-spin" /> : <Play />} Run</Button>
                          </form>
                          <p className={styles.terminalHint}>Each command runs for up to 30 seconds. Files and package changes stay in this project.</p>
                          {terminalResult ? <div className={styles.terminalResult}>
                            <div className={styles.terminalCommand}><span>$ {terminalResult.command}</span><Badge variant={terminalResult.exitCode === 0 ? "secondary" : "destructive"}>Exit {terminalResult.exitCode}</Badge></div>
                            {terminalResult.stdout && <pre>{terminalResult.stdout}</pre>}
                            {terminalResult.stderr && <pre className={styles.terminalError}>{terminalResult.stderr}</pre>}
                            {!terminalResult.stdout && !terminalResult.stderr && <span className={styles.terminalMuted}>Command completed with no output.</span>}
                          </div> : <Empty className={styles.terminalEmpty}><EmptyHeader><EmptyTitle>Run a project command</EmptyTitle><EmptyDescription>Try a build, inspect files, or install a package in the sandbox.</EmptyDescription></EmptyHeader></Empty>}
                          {output && <details className={styles.agentOutput}><summary>Latest agent command output</summary><CodeBlock><CodeBlockHeader><CodeBlockTitle>Agent output</CodeBlockTitle><CodeBlockActions><CodeBlockCopyButton value={output} /></CodeBlockActions></CodeBlockHeader><CodeBlockContent wrap>{output}</CodeBlockContent></CodeBlock></details>}
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
                                <Button onClick={() => void copyPreviewUrl()}>
                                  <Copy size={13} /> Copy link
                                </Button>
                                <Button disabled={busy} onClick={openPreview}>
                                  <RefreshCw size={14} /> Refresh access
                                </Button>
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
                              <Button
                                disabled={
                                  busy || inactive || running || !consent
                                }
                                onClick={openPreview}
                              >
                                Install dependencies & open preview
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      <Dialog open={newFileOpen} onOpenChange={open => { if (!busy) setNewFileOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Create a project file</DialogTitle>
          <form onSubmit={createFile}>
            <FieldGroup>
              <p className={styles.footnote}>Choose a path inside this project, such as <code>src/components/Hello.tsx</code>.</p>
              <Field><FieldLabel htmlFor="new-project-file">File path</FieldLabel><Input id="new-project-file" autoFocus value={newFilePath} onChange={event => setNewFilePath(event.target.value)} placeholder="src/new-file.ts" maxLength={500} required disabled={busy} /></Field>
              <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setNewFileOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !newFilePath.trim() || !consent}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Create file</Button></div>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy) setDialog(null); }}>
        {dialog && <DialogContent showCloseButton={!busy} className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>{dialog === "create" ? "A fresh place to start." : dialog === "import" ? "Open a GitHub repository" : dialog === "publish" ? "Create a draft pull request" : "Delete cloud project"}</DialogTitle>
            {dialog === "create" && (
              <form onSubmit={createProject}><FieldGroup>
                <p>
                  Give your project a name. You can ask the agent to create its
                  first files.
                </p>
                <Field><FieldLabel htmlFor="cloud-name">Project name</FieldLabel><Input
                    id="cloud-name" name="name"
                    required
                    minLength={1}
                    maxLength={80}
                    autoFocus
                    placeholder="my-next-idea"
                  />
                </Field>
                <Field><FieldLabel htmlFor="cloud-template">Starting point</FieldLabel><NativeSelect id="cloud-template" name="template" defaultValue="nextjs">
                    <NativeSelectOption value="nextjs">Next.js app</NativeSelectOption>
                    <NativeSelectOption value="vite">Vite app</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <p className={styles.footnote}>
                  Cloud files, chat, diffs, and output are kept for up to seven
                  days after last activity. Your daily free capacity applies.
                </p>
                <Button  disabled={busy || !consent}>
                  {busy ? "Creating…" : "Create cloud project"}
                </Button>
              </FieldGroup></form>
            )}
            {dialog === "import" && (
              <>
                <p>
                  GitHub controls which repositories the Freecoda GitHub App
                  can access. Your Freecoda selections and working preferences
                  are managed separately in account settings. Importing creates
                  a cloud copy and leaves your original repository unchanged.
                </p>
                <div className={styles.repoAccessActions}>
                  <Link className={buttonVariants({ variant: "outline" })} href="/settings#connections" target="_blank" rel="noopener noreferrer">
                    Manage Freecoda selections <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                  {installUrl && <a className={buttonVariants({ variant: "outline" })} href={installUrl} target="_blank" rel="noopener noreferrer">
                    Manage GitHub App access <ArrowUpRight size={14} aria-hidden="true" />
                  </a>}
                  <Button variant="link" disabled={busy} onClick={showImport}>Refresh repository access</Button>
                </div>
                <p className={styles.footnote}>Management opens in a new tab. After changing repository access or selections, return here and refresh. GitHub organization approval may be required for additional repositories.</p>
                {repoLoadError && <p className={styles.repoAccessError} role="alert">{repoLoadError} Refresh access to retry, or manage your connections in settings.</p>}
                <h3 className={styles.repoSectionTitle}>Repositories granted by GitHub</h3>
                {repos.length ? (
                  <div className={styles.repoList}>
                    <label className={styles.projectSearch}>Find a repository<Input type="search" value={repoSearch} onChange={event => setRepoSearch(event.target.value)} placeholder="owner/repository" /></label>
                    {repoSearch && !repos.some(repo => `${repo.owner}/${repo.name}`.toLowerCase().includes(repoSearch.toLowerCase())) && <p className={styles.smallEmpty}>No matching repositories.</p>}
                    {repos.length > 8 && <p className={styles.smallEmpty}>{repos.length} repositories · search to narrow the list.</p>}
                    {repos.filter(repo => `${repo.owner}/${repo.name}`.toLowerCase().includes(repoSearch.toLowerCase())).slice(0, 8).map((repo) => (
                      <Button
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
                      </Button>
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
                <Button
                  type="button"
                  disabled={!selectedRepo || busy || !consent}
                  onClick={() => selectedRepo && void importRepo(selectedRepo)}
                >
                  {busy ? "Importing…" : "Import selected repository"}
                </Button>
                {repoPreferences.some(preference => !repos.some(repo => repo.repositoryId === preference.repositoryId)) && !busy && <div className={styles.unavailableRepos}>
                  <h3 className={styles.repoSectionTitle}>Saved selections without current access</h3>
                  <p>These repositories cannot be imported until GitHub access is restored. Manage GitHub App access or remove their saved configuration in Freecoda settings.</p>
                  <ul>{repoPreferences.filter(preference => !repos.some(repo => repo.repositoryId === preference.repositoryId)).map(preference => <li key={preference.repositoryId}>{preference.owner}/{preference.name}</li>)}</ul>
                </div>}

              </>
            )}
            {dialog === "publish" && (
              <form onSubmit={publish}><FieldGroup>
                <p>
                  Create a branch and a draft pull request in{" "}
                  {project?.repo
                    ? `${project.repo.owner}/${project.repo.name}`
                    : project?.repository || "your selected repository"}
                  . Review the Changes panel first.
                </p>
                <Field><FieldLabel htmlFor="cloud-title">Pull request title</FieldLabel><Input
                    id="cloud-title" name="title"
                    required
                    maxLength={150}
                    defaultValue="Changes from Freecoda"
                    autoFocus
                  />
                </Field>
                <Field><FieldLabel htmlFor="cloud-body">Description</FieldLabel><Textarea
                    id="cloud-body" name="body"
                    rows={4}
                    maxLength={10000}
                    defaultValue="Created in Freecoda. Please review these changes before merging."
                  />
                </Field>
                <Field orientation="horizontal" className={styles.reviewCheck}>
                  <Checkbox id="authorize-pr" checked={reviewed} onCheckedChange={checked => setReviewed(checked === true)} />
                  <FieldLabel htmlFor="authorize-pr">I reviewed the full diff and authorize publishing these changes as a draft pull request. No secrets or workflow files are included.</FieldLabel>
                </Field>
                <Button
                  disabled={busy || !reviewed || !changes?.diff}
                >
                  {busy ? "Creating draft…" : "Publish branch & draft PR"}
                </Button>
              </FieldGroup></form>
            )}
            {dialog === "delete" && (
              <>
                <p>
                  This removes the cloud project, its files, chat, and output,
                  and stops its preview. Your GitHub repository and existing
                  pull requests stay as they are.
                </p>
                <div className={styles.actions}>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    Keep project
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || running}
                    onClick={() => lifecycle("delete")}
                  >
                    {busy ? "Deleting…" : "Delete cloud project"}
                  </Button>
                </div>
              </>
            )}
        </DialogContent>}
      </Dialog>
    </div>
  );
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Could not complete that action. Please try again.";
}
