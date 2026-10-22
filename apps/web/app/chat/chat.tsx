"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  Code2,
  Copy,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Square,
  LogIn,
  Trash2,
  X,
} from "lucide-react";
import { VoiceControls } from "@/components/voice-controls";
import { runOwnedVoiceTurn, type OwnedVoiceTurnObserver } from "@/lib/owned-voice-turn";
import { startGitHubSignIn } from "@/lib/start-github-sign-in";
import { Mark } from "@/components/chrome";
import { UserAvatar } from "@/components/user-avatar";
import { WelcomeSurface } from "@/components/welcome-surface";
import { MarkdownMessage } from "@/components/markdown-message";
import { aiServiceText } from "@/components/ai-service-text";
import { useModelSelection } from "@/components/use-model-selection";
import { ThemeControl } from "@/components/theme-control";
import { SponsorPlacement } from "@/components/sponsor-placement";
import { AgentMessage } from "@/components/agent-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton } from "@/components/ui/message-scroller";
import { Trace, TraceLine, TraceIcon, TraceTitle } from "@/components/ui/trace";
import s from "./chat.module.css";
import { codexUnsupportedCommand } from "@freecoda/contracts";
import { interceptWebConversationInput } from "../app/conversation-routing";
import { useConversationCommands } from "../app/conversation-commands";
import {
  boundedChatContext,
  chatContext,
  type Message,
} from "./history";
import { useCloudHistory } from "./use-cloud-history";
type Status = {
  signedIn: boolean;
  userId?: string;
  userName?: string | null;
  userImage?: string | null;
  available: boolean;
  reason?: string;
  models: { id: string; name: string }[];
};
const noModels: Status["models"] = [];
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button variant="ghost" size="sm"
      className={s.copy}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : label}</span>
    </Button>
  );
}
type ChatProps = {
  embedded?: boolean;
  voiceVisible?: boolean;
  initialThreadId?: string;
  onOpenWorkspace?: (command?: string) => void;
};

export default function Chat({ embedded = false, voiceVisible = true, initialThreadId, onOpenWorkspace }: ChatProps) {
  const [status, setStatus] = useState<Status | null>(null),
    [active, setActive] = useState<string | null>(initialThreadId || null),
    [draft, setDraft] = useState(""),
    [queue, setQueue] = useState<{ id: string; text: string; sent?: boolean; status: "queued" | "sending" | "accepted" | "failed"; messageIndex?: number; model?: string }[]>([]),
    [pendingSend, setPendingSend] = useState<{ id: string; text: string; status: "sending" | "accepted" | "failed"; inHistory?: boolean; messageIndex?: number; model?: string } | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [signingIn, setSigningIn] = useState(false),
    [commandNotice, setCommandNotice] = useState("");
  const { model } = useModelSelection(status?.userId, status?.models ?? noModels);
  const { chats, setChats, historyReady, storageError, syncError, removeConversation, openConversation, opening } = useCloudHistory(status?.userId, busy);
  const abort = useRef<AbortController | null>(null),
    sending = useRef(false),
    drainingQueue = useRef(false),
    autoDrainQueue = useRef(false),
    queueRef = useRef(queue),
    sendTextRef = useRef<(retry?: boolean, textOverride?: string, queueId?: string, pendingId?: string, modelOverride?: string, observer?: OwnedVoiceTurnObserver) => Promise<boolean>>(() => Promise.resolve(false)),
    owner = useRef<string | undefined>(undefined),
    initialThreadApplied = useRef(false),
    input = useRef<HTMLTextAreaElement>(null),
    search = useRef<HTMLInputElement>(null);
  const selected = chats.find((c) => c.id === active),
    messages = selected?.messages || [];
  queueRef.current = queue;
  useEffect(() => { if (selected?.cloudLoaded === false) void openConversation(selected.id); }, [selected?.id, selected?.cloudLoaded, openConversation]);
  useEffect(() => {
    let alive = true;
    fetch("/api/chat", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw Error("Chat status could not be loaded. Reload to try again.");
        return r.json();
      })
      .then((d: Status) => {
        if (!alive) return;
        setStatus(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch("/api/chat", { cache: "no-store" });
        if (!response.ok) return;
        const fresh: Status = await response.json();
        if (fresh.userId !== status?.userId) {
          abort.current?.abort();
          setDraft("");
          setActive(null);
          setChats([]);
        }
        setStatus(fresh);
      } catch {
        /* Keep the last known state; pre-send verification still applies. */
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [status?.userId]);
  useEffect(() => {
    const showHistory = () => setSidebar(true);
    window.addEventListener("freecoda:chat-sidebar", showHistory);
    return () => {
      window.removeEventListener("freecoda:chat-sidebar", showHistory);
    };
  }, []);
  useEffect(() => {
    if (owner.current !== undefined && owner.current !== status?.userId) {
      setActive(null);
      setDraft("");
      setQueue([]);
    }
    owner.current = status?.userId;
  }, [status?.userId]);
  useEffect(() => {
    if (!historyReady || !initialThreadId || initialThreadApplied.current) return;
    initialThreadApplied.current = true;
    if (chats.some((chat) => chat.id === initialThreadId)) setActive(initialThreadId);
  }, [historyReady, chats, initialThreadId]);
  const newChat = () => {
    if (busy) return;
    setActive(null);
    setDraft("");
    setError("");
    setCommandNotice("");
    setSidebar(false);
    input.current?.focus();
  };
  const newChatRef = useRef(newChat);
  newChatRef.current = newChat;
  useEffect(() => {
    const start = () => newChatRef.current();
    window.addEventListener("freecoda:new-chat", start);
    return () => window.removeEventListener("freecoda:new-chat", start);
  }, []);
  const commands = useConversationCommands(draft, (command) => { setDraft(""); interceptWebConversationInput(command, { project: value => onOpenWorkspace?.(value), conversation: value => { void runCommand(value); } }); input.current?.focus(); });
  async function runCommand(value: string) {
    const [command, ...args] = value.trim().split(/\s+/);
    const argument = args.join(" ");
    switch (command.toLowerCase()) {
      case "/help":
        setCommandNotice("Type / to discover commands. /project chooses a repository; /build, /plan and /review work in an explicitly selected project. /chat keeps repository access off. /tools, /mcp and /skills manage project capabilities.");
        break;
      case "/chat":
        setCommandNotice("General conversation. No repository or external tool access.");
        break;
      case "/new":
        newChat();
        break;
      case "/clear":
        newChat();
        setCommandNotice("Started a fresh chat. Previous conversations remain saved.");
        break;
      case "/resume":
        setSidebar(true);
        setCommandNotice("Choose a saved conversation from your history.");
        break;
      case "/copy": {
        const answer = messages.filter(message => message.role === "assistant" && message.status === "complete").at(-1)?.content;
        if (!answer) setCommandNotice("No completed assistant response to copy.");
        else try { await navigator.clipboard.writeText(answer); setCommandNotice("Latest response copied."); }
        catch { setCommandNotice("Clipboard access was denied. Select the response and copy it manually."); }
        break;
      }
      case "/pwd":
      case "/cwd":
        setCommandNotice("General chat has no attached working directory. Select a cloud workspace to inspect its app directory.");
        break;
      case "/mode":
        if (!argument || argument === "chat") setCommandNotice("Mode: Chat. Use Workspace for build, plan, and review modes.");
        else if (["build", "plan", "review"].includes(argument)) {
          setCommandNotice(`Switching to Workspace. Choose ${argument} mode from its mode menu.`);
          onOpenWorkspace?.(`/mode ${argument}`);
        } else setCommandNotice("Use /mode chat, build, plan, or review. Coding modes run in Workspace.");
        break;
      case "/status":
        setCommandNotice(`${status?.signedIn ? "Signed in" : "Not signed in"} · ${selected?.title || "New chat"} · ${status?.available ? "Chat available" : status?.reason || "Chat unavailable"}`);
        break;
      case "/usage":
        try {
          const response = await fetch("/api/v1/usage", { cache: "no-store" });
          const usage = await response.json();
          if (!response.ok) throw new Error(usage.error || "Usage is unavailable.");
          setCommandNotice(`Free allowance remaining today: $${(usage.freeRemainingMicros / 1_000_000).toFixed(4)} · resets ${new Date(usage.resetAt).toLocaleString()}.`);
        } catch (error) {
          setCommandNotice(error instanceof Error ? error.message : "Usage is unavailable.");
        }
        break;
      case "/extensions":
      case "/permissions":
        setCommandNotice(`${command} are configured per coding project in Workspace. Chat has no repository, filesystem, or external tool access.`);
        onOpenWorkspace?.(value);
        break;
      case "/mcp":
      case "/tools":
        setCommandNotice(`Opening ${command.slice(1)} tools in Workspace.`);
        onOpenWorkspace?.(value);
        window.dispatchEvent(new CustomEvent("freecoda:extensions", { detail: { view: command.toLowerCase() === "/mcp" ? "mcp" : "tools" } }));
        break;
      default:
        setCommandNotice(codexUnsupportedCommand(command) || `Unknown command “${command}”. Use /help to see commands.`);
    }
  }
  async function signIn() {
    setSigningIn(true);
    try {
      await startGitHubSignIn("/app?view=chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
      setSigningIn(false);
    }
  }
  function updateMessages(id: string, next: Message[]) {
    setChats((current) =>
      current.map((c) =>
        c.id === id ? { ...c, messages: next, updatedAt: Date.now(), cloudDirty: true } : c,
      ),
    );
  }
  async function send(retry = false, textOverride?: string, queueId?: string, pendingId?: string, modelOverride?: string, observer?: OwnedVoiceTurnObserver): Promise<boolean> {
    if (busy || sending.current || !status?.available || !historyReady || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false) return false;
    const text = (textOverride ?? draft).trim();
    if (!retry && !text) return false;
    const current = selected?.messages || [],
      displayedContext = retry
        ? current.at(-1)?.role === "assistant"
          ? current.slice(0, -1)
          : current
        : [...current, { role: "user" as const, content: text }],
      rawContext = chatContext(displayedContext),
      context = boundedChatContext(rawContext);
    if (!context) {
      setError(
        "This current message is too large to send. Shorten it or reduce attached context; your draft and conversation history have been kept.",
      );
      return false;
    }
    if (!context.length || context.at(-1)?.role !== "user") return false;
    const requestBody = JSON.stringify({
      messages: context,
      ...(modelOverride || model ? { model: modelOverride || model } : {}),
      expectedUserId: status.userId,
      consent: true,
    });
    if (new TextEncoder().encode(requestBody).byteLength > 100_000) {
      setError(
        "This conversation is too long to send. Start a new chat; your draft and history have been kept.",
      );
      return false;
    }
    if (
      context.some((m) => m.content.length > (m.role === "user" ? 8000 : 64000))
    ) {
      setError(
        "User messages can contain up to 8,000 characters. Start a new chat if a response exceeds the context limit.",
      );
      return false;
    }
    sending.current = true;
    if (textOverride === undefined) setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    observer?.onController(controller);
    try {
      const check = await fetch("/api/chat", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!check.ok)
        throw Error(
          "Could not verify your account. Your message has not been sent.",
        );
      const fresh: Status = await check.json();
      if (!fresh.signedIn || fresh.userId !== status.userId) {
        setStatus(fresh);
        setDraft("");
        setActive(null);
        setChats([]);
        throw Error(
          "Your signed-in account changed. The previous conversation was not sent.",
        );
      }
      if (!fresh.available) {
        setStatus(fresh);
        throw Error(fresh.reason || "Chat is currently unavailable.");
      }
    } catch (e) {
      if (textOverride === undefined) setDraft((current) => current || text);
      if (pendingId) setPendingSend((current) => current?.id === pendingId ? { ...current, status: "failed" } : current);
      if (queueId) setQueue((current) => current.map((item) => item.id === queueId ? { ...item, status: "failed" } : item));
      setError(
        e instanceof Error ? e.message : "Could not verify your account.",
      );
      setBusy(false);
      sending.current = false;
      abort.current = null;
      return false;
    }
    const id = selected?.id || crypto.randomUUID();
    if (!selected)
      setChats((current) =>
        [
          {
            id,
            title: text.slice(0, 65),
            messages: displayedContext,
            updatedAt: Date.now(),
            cloudDirty: true,
          },
          ...current,
        ],
      );
    else updateMessages(id, displayedContext);
    setActive(id);
    if (pendingId) setPendingSend((current) => current?.id === pendingId ? { ...current, status: "sending", inHistory: true, messageIndex: displayedContext.length - 1 } : current);
    if (queueId) setQueue((current) => current.map((item) => item.id === queueId ? { ...item, sent: true, status: "sending", messageIndex: displayedContext.length - 1 } : item));
    setError("");
    setBusy(true);
    setSidebar(false);
    let answer = "",
      finished = false,
      successful = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw Error(data.error || `Chat request failed (${response.status}).`);
      }
      if (pendingId) setPendingSend((current) => current?.id === pendingId ? { ...current, status: "accepted" } : current);
      if (queueId) setQueue((current) => current.map((item) => item.id === queueId ? { ...item, status: "accepted" } : item));
      if (!response.body) throw Error("No response stream was returned.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let pending = "";
      const consume = (line: string) => {
        if (!line.trim()) return;
        const item = JSON.parse(line);
        if (item.type === "text-delta" && typeof item.text === "string") {
          answer += item.text;
          updateMessages(id, [
            ...displayedContext,
            { role: "assistant", content: answer, status: "partial" },
          ]);
        }
        if (item.type === "finish") finished = true;
        if (item.type === "error")
          throw Error(item.error || "The response was interrupted.");
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          consume(line);
        }
      }
      pending += decoder.decode();
      if (pending.trim()) consume(pending);
      if (!finished)
        throw Error(
          "The response ended early. You can retry when the service is ready.",
        );
      if (!answer)
        throw Error("No response text was returned. You can retry this message.");
      updateMessages(id, [
        ...displayedContext,
        { role: "assistant", content: answer, status: "complete" },
      ]);
      if (pendingId) setPendingSend((current) => current?.id === pendingId ? null : current);
      observer?.onReply(answer);
      successful = true;
    } catch (e) {
      if (pendingId) setPendingSend((current) => current?.id === pendingId ? { ...current, status: "failed" } : current);
      if (queueId) setQueue((current) => current.map((item) => item.id === queueId ? { ...item, status: "failed" } : item));
      if (answer)
        updateMessages(id, [
          ...displayedContext,
          {
            role: "assistant",
            content: answer,
            status: controller.signal.aborted ? "stopped" : "error",
          },
        ]);
      if (controller.signal.aborted)
        setError(
          "Response stopped. Any completed usage will still count toward your allowance.",
        );
      else
        setError(
          e instanceof Error ? e.message : "Could not send this message.",
        );
    } finally {
      abort.current = null;
      sending.current = false;
      setBusy(false);
      input.current?.focus();
    }
    if (successful && queueRef.current.length) autoDrainQueue.current = true;
    return successful;
  }
  sendTextRef.current = send;
  useEffect(() => {
    if (!autoDrainQueue.current || busy || !historyReady || !queue.length || drainingQueue.current) return;
    const next = queue[0];
    const requestModel = next.model || model;
    drainingQueue.current = true;
    autoDrainQueue.current = false;
    let succeeded = false;
    setQueue((current) => current.map((item) => item.id === next.id ? { ...item, status: "sending", model: requestModel } : item));
    void sendTextRef.current(next.sent === true, next.text, next.id, undefined, requestModel).then((success) => {
      if (success) {
        succeeded = true;
        drainingQueue.current = false;
        autoDrainQueue.current = true;
        setQueue((current) => current.filter((item) => item.id !== next.id));
      } else {
        setCommandNotice("A queued message was kept because the last send failed. Retry it when chat is available.");
      }
    }).finally(() => {
      if (!succeeded) drainingQueue.current = false;
    });
  }, [busy, historyReady, queue, model]);
  function submitMessage() {
    const text = draft.trim();
    if (!text) return;
    if (interceptWebConversationInput(text, {
      project: command => { setDraft(""); setCommandNotice(""); onOpenWorkspace?.(command); },
      conversation: command => { setDraft(""); setCommandNotice(""); void runCommand(command); },
    })) return;
    if (busy || sending.current || queue.length > 0) {
      setQueue((current) => [...current, { id: crypto.randomUUID(), text, status: "queued" }]);
      setDraft("");
      setCommandNotice(`${queue.length + 1} message${queue.length ? "s" : ""} queued. Messages run one at a time.`);
      if (!busy) autoDrainQueue.current = true;
      return;
    }
    if (!status?.available || !historyReady) {
      setError(status?.reason || "Chat is not ready yet. Your draft is still here.");
      return;
    }
    setCommandNotice("");
    const id = crypto.randomUUID();
    setPendingSend({ id, text, status: "sending", model });
    void send(false, undefined, undefined, id, model);
  }
  function retryQueue() {
    autoDrainQueue.current = true;
    setQueue((current) => [...current]);
  }
  function retryPendingSend() {
    if (!pendingSend || busy || sending.current) return;
    const retrying = pendingSend;
    setPendingSend({ ...retrying, status: "sending" });
    if (!retrying.inHistory)
      setDraft((current) => current.trim() === retrying.text ? "" : current);
    void send(retrying.inHistory === true, retrying.text, undefined, retrying.id, retrying.model);
  }
  const visibleChats = chats.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main id="main" className={`${s.shell} ${embedded ? s.embedded : ""}`}>
      {sidebar && (
        <Button variant="ghost" size="sm"
          className={s.scrim}
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside id="chat-sidebar" data-open={sidebar} className={`${s.sidebar} ${sidebar ? s.open : ""}`} aria-label="Chats">
        {!embedded && <div className={s.brand}>
          <Link href="/" aria-label="Freecoda home">
            <Mark />
          </Link>
          <Button variant="ghost" size="sm"
            aria-label="Close sidebar"
            className={s.mobileClose}
            onClick={() => setSidebar(false)}
          >
            <X size={19} />
          </Button>
        </div>}
        <Button variant="ghost" size="sm" className={s.newChat} onClick={newChat} disabled={busy}>
          <Plus size={18} />
          New chat
        </Button>
        <label className={s.search}>
          <Search size={16} />
          <Input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your conversations"
            aria-label="Search chats"
          />
        </label>
        <div className={s.history}>
          <span className={s.sectionLabel}>Your chats</span>
          {visibleChats.length ? (
            visibleChats.map((c) => (
              <div
                key={c.id}
                className={`${s.historyRow} ${c.id === active ? s.active : ""}`}
              >
                <Button variant="ghost" size="sm"
                  disabled={busy}
                  aria-current={c.id === active ? "page" : undefined}
                  title={c.title}
                  onClick={() => {
                    setActive(c.id);
                    setSidebar(false);
                    setError("");
                    setDraft("");
                  }}
                >
                  <MessageSquare size={14} />
                  <span>{c.mode === "coding" ? "Coding · " : ""}{c.title}</span>
                </Button>
                <Button variant="ghost" size="sm"
                  disabled={busy}
                  className={s.delete}
                  aria-label={`Delete ${c.title}`}
                  onClick={async () => {
                    if (!confirm("Delete this conversation from your account on all platforms? Offline copies are removed when they reconnect."))
                      return;
                    try { await removeConversation(c.id); if (active === c.id) setActive(null); }
                    catch (error) { setError(error instanceof Error ? error.message : "Deletion could not be queued. Your history is kept."); }
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))
          ) : (
            <p className={s.historyEmpty}>
              {query
                ? "No chats found."
                : "Your conversations will appear here."}
            </p>
          )}
        </div>
        {onOpenWorkspace ? (
          <Button variant="ghost" size="sm" className={s.workspace} type="button" onClick={() => onOpenWorkspace("/project")}>
            <Code2 size={18} />
            <span>Open a workspace</span>
          </Button>
        ) : (
          <Link className={s.workspace} href="/app">
            <Code2 size={18} />
            <span>Open a workspace</span>
          </Link>
        )}
        {!embedded && <div className={s.account}>
          <Link href="/settings">Your account & settings</Link>
          <ThemeControl />
        </div>}
      </aside>
      <section className={s.conversation}>
        <header className={s.topbar}>
          <Button variant="ghost" size="sm"
            className={s.menu}
            aria-label={sidebar ? "Close chat sidebar" : "Open chat sidebar"}
            aria-controls="chat-sidebar"
            aria-expanded={sidebar}
            onClick={() => setSidebar(open => !open)}
          >
            <Menu size={21} />
          </Button>
          <div className={s.threadHeading}>
            <span>{selected?.title || "New chat"}</span>
            <small>{selected?.mode === "coding" ? "Saved coding conversation" : "Chat · no repository access"}</small>
          </div>
          <div className={s.headerRight}>
            <Button variant="ghost" size="sm"
              type="button"
              className={s.headerNewChat}
              onClick={newChat}
              disabled={busy}
              aria-label="Start a new chat"
              title="New chat"
            >
              <Plus size={18} />
            </Button>
            {!status && <span className={s.modelState}>Connecting…</span>}
            {!status?.signedIn && status && (
              <Button variant="ghost" size="sm"
                className={s.signIn}
                aria-label={signingIn ? "Opening GitHub" : "Sign in"}
                title={signingIn ? "Opening GitHub…" : "Sign in"}
                disabled={signingIn}
                onClick={signIn}
              >
                <LogIn size={18} aria-hidden="true" />
              </Button>
            )}
          </div>
        </header>
        <MessageScrollerProvider key={`${status?.userId || "guest"}:${active || "new"}`} autoScroll defaultScrollPosition="end">
        <MessageScroller className={s.scroll}>
        <MessageScrollerViewport aria-label="Conversation">
        <MessageScrollerContent className="mx-auto max-w-4xl p-4 sm:p-8" aria-busy={busy}>
          {messages.length || pendingSend || queue.some((item) => !item.sent) ? (
            <>
              {messages.map((m, i) => (
                <MessageScrollerItem key={i} messageId={`message-${i}`} scrollAnchor={m.role === "user"}>
                  <AgentMessage role={m.role} image={status?.userImage} name={status?.userName}>
                  <MarkdownMessage text={m.content} />
                  {m.role === "user" && queue.find((item) => item.sent && item.messageIndex === i && item.text === m.content) && (() => {
                    const delivery = queue.find((item) => item.sent && item.messageIndex === i && item.text === m.content)!;
                    return <div className={s.deliveryState} role="status">
                      {delivery.status === "failed" ? "Failed" : delivery.status === "accepted" ? "Accepted" : "Sending"}
                      {delivery.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={retryQueue}>Retry</Button>}
                      <Button variant="ghost" size="sm" type="button" onClick={() => setQueue((current) => current.filter((item) => item.id !== delivery.id))}>Remove</Button>
                    </div>;
                  })()}
                  {m.role === "user" && pendingSend?.inHistory && pendingSend.messageIndex === i && pendingSend.text === m.content && <div className={s.deliveryState} role="status">
                    {pendingSend.status === "failed" ? "Failed" : pendingSend.status === "accepted" ? "Accepted" : "Sending"}
                    {pendingSend.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={retryPendingSend}>Retry</Button>}
                  </div>}
                  {m.role === "assistant" &&
                    m.status &&
                    m.status !== "complete" && (
                      <p className={s.partial}>
                        {m.status === "partial" && busy
                          ? "Responding…"
                          : "Incomplete response · excluded from future context"}
                      </p>
                    )}
                  {m.role === "assistant" && !busy && (
                    <CopyButton text={m.content} label="Copy response" />
                  )}
                  </AgentMessage>
                </MessageScrollerItem>
              ))}
              {pendingSend && !pendingSend.inHistory && <MessageScrollerItem messageId="pending"><AgentMessage role="user" image={status?.userImage} name={status?.userName}>
                <MarkdownMessage text={pendingSend.text} />
                <div className={s.deliveryState} role="status">
                  {pendingSend.status === "failed" ? "Failed before send" : "Sending"}
                  {pendingSend.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={retryPendingSend}>Retry</Button>}
                </div>
              </AgentMessage></MessageScrollerItem>}
              {queue.filter((item) => !item.sent).map((item) => <MessageScrollerItem key={item.id} messageId={item.id}><AgentMessage role="user" image={status?.userImage} name={status?.userName}>
                <MarkdownMessage text={item.text} />
                <div className={s.deliveryState} role="status">
                  {item.status === "failed" ? "Failed" : item.status === "sending" ? "Sending" : "Queued"}
                  {item.status === "failed" && <Button variant="ghost" size="sm" type="button" onClick={retryQueue}>Retry</Button>}
                  <Button variant="ghost" size="sm" type="button" onClick={() => setQueue((current) => current.filter((entry) => entry.id !== item.id))}>Remove</Button>
                </div>
              </AgentMessage></MessageScrollerItem>)}
              {busy && messages.at(-1)?.role !== "assistant" && (
                <MessageScrollerItem messageId="thinking"><Trace><TraceLine status="running"><TraceIcon><MessageSquare /></TraceIcon><TraceTitle>Thinking…</TraceTitle></TraceLine></Trace></MessageScrollerItem>
              )}
            </>
          ) : (
            <MessageScrollerItem messageId="welcome" className={s.welcomeContainer}>
              <WelcomeSurface heading="h1" actions={[
                { label: "Understand code", description: "Make sense of a function or a tricky concept", onClick: () => { setDraft("Help me understand a piece of code. Ask me to share the code or concept first."); input.current?.focus(); } },
                { label: "Plan a feature", description: "Turn a rough idea into a clear next step", onClick: () => { setDraft("Help me plan a software feature. Ask what I want to build first."); input.current?.focus(); } },
                { label: "Explore a project", description: "Choose a repository to get to know its code", ...(onOpenWorkspace ? { onClick: () => onOpenWorkspace("/plan") } : { href: "/app?view=workspace" }) },
                { label: "Review a project", description: "Look for a concrete bug before making changes", ...(onOpenWorkspace ? { onClick: () => onOpenWorkspace("/review") } : { href: "/app?view=workspace" }) },
              ]} />
            </MessageScrollerItem>
          )}
        </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
        </MessageScroller>
        </MessageScrollerProvider>
        <div className={s.composerArea}>
          {commandNotice && <div className={s.availability} role="status">{aiServiceText(commandNotice, status?.models)}</div>}
          {error && (
            <div className={s.error} role="alert">
              {aiServiceText(error, status?.models)}
              {!busy && messages.length > 0 && !pendingSend && queue.length === 0 && (
                <Button variant="ghost" size="sm"
                  onClick={() => void send(true)}
                  disabled={!status?.available}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {status && !status.available && (
            <div className={s.availability} role="status">
              {aiServiceText(status.reason || "Chat is currently unavailable.", status.models)}
              {!status.signedIn && (
                <Button variant="ghost" size="sm" onClick={signIn} disabled={signingIn}>
                  Continue with GitHub
                </Button>
              )}
            </div>
          )}
          {storageError && (
            <p className={s.storageError} role="status">
              Browser storage is unavailable. This conversation may not survive
              a reload.
            </p>
          )}
          {syncError && <p className={s.storageError} role="status">{syncError} Your offline copy is kept.</p>}
          {opening && <p className={s.availability} role="status">Opening cloud conversation…</p>}
          {selected?.mode === "coding" && <p className={s.availability}>Coding conversation from your account. Continue it in the desktop app or CLI after trusting a local project.</p>}
          {selected?.cloudDeleted && <p className={s.availability}>Deleted on another device. This unsynced offline copy is read-only.</p>}
          <form
            className={s.composer}
            onSubmit={(e) => {
              e.preventDefault();
              submitMessage();
            }}
          >
            <VoiceControls visible={voiceVisible && !!status?.signedIn && !!status?.available} scopeKey={`${status?.userId || "signed-out"}:${active || "new"}`} disabled={busy || !status?.available || !historyReady || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false}
              onDictation={text => setDraft(current => (current + (current && !/\s$/.test(current) ? " " : "") + text).slice(0, 8000))}
              onTurn={async (text, signal) => {
                if (text.trimStart().startsWith("/")) throw Error("Voice cannot execute slash commands.");
                return runOwnedVoiceTurn(signal, observer => sendTextRef.current(false, text, undefined, undefined, undefined, observer));
              }} />
            {commands.list}
            <InputGroup>
            <InputGroupTextarea
              {...commands.attributes}
              ref={input}
              value={draft}
              maxLength={8000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (commands.keyDown(e)) return;
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  submitMessage();
                }
              }}
              placeholder={busy ? "Write a message to queue…" : "Ask Coda anything, or / for commands"}
              aria-label="Message Freecoda"
              rows={2}
              disabled={selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false}
            />
            <InputGroupAddon align="block-end" className="flex-wrap">
              <span>{busy ? "Enter queues the next message. Messages run one at a time." : "/ for projects, tools and commands"}</span>
              {busy ? (
                <>
                  {draft.trim() && <InputGroupButton type="submit" variant="outline">Queue</InputGroupButton>}
                  <InputGroupButton
                    type="button"
                    size="icon-sm" variant="default"
                    aria-label="Stop response"
                    onClick={() => abort.current?.abort()}
                  >
                    <Square fill="currentColor" />
                  </InputGroupButton>
                </>
              ) : (
                <InputGroupButton
                  type="submit"
                  size="icon-sm" variant="default"
                  aria-label="Send message"
                  disabled={
                    !draft.trim() || !status?.available || !historyReady || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false
                  }
                >
                  <ArrowUp />
                </InputGroupButton>
              )}
            </InputGroupAddon>
            </InputGroup>
          </form>
          {queue.length > 0 && <Button variant="ghost" size="sm" type="button" className={s.retryQueue} disabled={!status?.available || busy || drainingQueue.current} onClick={retryQueue}>Retry queued messages ({queue.length})</Button>}
          <p className={s.disclaimer}>
            Freecoda can make mistakes. Check important information.{" "}
            <Link href="/privacy">
              Conversations sync to your account across platforms. Sending shares context with our AI provider.
            </Link>
          </p>
        </div>
      </section>
      <div className={s.adDock}>
        <SponsorPlacement />
      </div>
    </main>
  );
}
