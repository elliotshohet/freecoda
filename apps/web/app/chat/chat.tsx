"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { createAuthClient } from "better-auth/react";
import { Mark } from "@/components/chrome";
import { ThemeControl } from "@/components/theme-control";
import { SponsorPlacement } from "@/components/sponsor-placement";
import s from "./chat.module.css";
import {
  chatContext,
  type Message,
} from "./history";
import { useCloudHistory } from "./use-cloud-history";
type Status = {
  signedIn: boolean;
  userId?: string;
  available: boolean;
  reason?: string;
  models: { id: string; name: string }[];
};
const suggestions = [
  "Explain a tricky idea",
  "Help me write something",
  "Make a plan for my week",
  "Work through a coding problem",
];
function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
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
    </button>
  );
}
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code className={s.inlineCode} key={i}>
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
function MessageContent({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const body = part.slice(3, -3),
            newline = body.indexOf("\n"),
            language = newline >= 0 ? body.slice(0, newline).trim() : "",
            code = newline >= 0 ? body.slice(newline + 1) : body;
          return (
            <div className={s.code} key={i}>
              <div>
                <span>{language || "Code"}</span>
                <CopyButton text={code} label="Copy code" />
              </div>
              <pre>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        return (
          <div className={s.prose} key={i}>
            {part.split("\n").map((line, j) =>
              /^#{1,3} /.test(line) ? (
                <h3 key={j}>
                  <Inline text={line.replace(/^#{1,3} /, "")} />
                </h3>
              ) : /^\s*(?:[-*]|\d+\.) /.test(line) ? (
                <div className={s.listLine} key={j}>
                  <span>{line.match(/^\s*(\d+\.) /)?.[1] || "•"}</span>
                  <span>
                    <Inline text={line.replace(/^\s*(?:[-*]|\d+\.) /, "")} />
                  </span>
                </div>
              ) : (
                <p key={j}>
                  <Inline text={line || "\u00a0"} />
                </p>
              ),
            )}
          </div>
        );
      })}
    </>
  );
}
export default function Chat() {
  const [status, setStatus] = useState<Status | null>(null),
    [active, setActive] = useState<string | null>(null),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [model, setModel] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [signingIn, setSigningIn] = useState(false);
  const { chats, setChats, historyReady, storageError, syncError, removeConversation, openConversation, opening } = useCloudHistory(status?.userId, busy);
  const abort = useRef<AbortController | null>(null),
    sending = useRef(false),
    end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    search = useRef<HTMLInputElement>(null);
  const selected = chats.find((c) => c.id === active),
    messages = selected?.messages || [];
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
        setModel(d.models?.[0]?.id || "");
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
        setModel((current) =>
          fresh.models.some((m) => m.id === current)
            ? current
            : fresh.models[0]?.id || "",
        );
      } catch {
        /* Keep the last known state; pre-send verification still applies. */
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [status?.userId]);
  useEffect(() => { setActive(null); }, [status?.userId]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages, busy]);
  const newChat = () => {
    if (busy) return;
    setActive(null);
    setDraft("");
    setError("");
    setSidebar(false);
    input.current?.focus();
  };
  async function signIn() {
    setSigningIn(true);
    try {
      const result = await createAuthClient().signIn.social({
        provider: "github",
        callbackURL: "/chat",
      });
      if (result.error) throw Error(result.error.message || "Sign-in failed.");
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
  async function send(retry = false) {
    if (busy || sending.current || !status?.available || !historyReady || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false) return;
    const text = draft.trim();
    if (!retry && !text) return;
    const current = selected?.messages || [],
      displayedContext = retry
        ? current.at(-1)?.role === "assistant"
          ? current.slice(0, -1)
          : current
        : [...current, { role: "user" as const, content: text }],
      context = chatContext(displayedContext);
    if (!context.length || context.at(-1)?.role !== "user") return;
    if (context.length > 40) {
      setError(
        "This conversation has reached its context limit. Start a new chat to continue.",
      );
      return;
    }
    const requestBody = JSON.stringify({
      messages: context,
      ...(model ? { model } : {}),
      expectedUserId: status.userId,
      consent: true,
    });
    if (new TextEncoder().encode(requestBody).byteLength > 100_000) {
      setError(
        "This conversation is too long to send. Start a new chat; your draft and history have been kept.",
      );
      return;
    }
    if (
      context.some((m) => m.content.length > (m.role === "user" ? 8000 : 64000))
    ) {
      setError(
        "User messages can contain up to 8,000 characters. Start a new chat if a response exceeds the context limit.",
      );
      return;
    }
    sending.current = true;
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
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
      setError(
        e instanceof Error ? e.message : "Could not verify your account.",
      );
      setBusy(false);
      sending.current = false;
      abort.current = null;
      return;
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
    setDraft("");
    setError("");
    setBusy(true);
    setSidebar(false);
    let answer = "",
      finished = false;
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
        throw Error("The model returned no text. You can retry this message.");
      updateMessages(id, [
        ...displayedContext,
        { role: "assistant", content: answer, status: "complete" },
      ]);
    } catch (e) {
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
  }
  const visibleChats = chats.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main id="main" className={s.shell}>
      {sidebar && (
        <button
          className={s.scrim}
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside id="chat-sidebar" className={`${s.sidebar} ${sidebar ? s.open : ""}`}>
        <div className={s.brand}>
          <Link href="/" aria-label="Freecoda home">
            <Mark />
            <span>freecoda</span>
          </Link>
          <button
            aria-label="Close sidebar"
            className={s.mobileClose}
            onClick={() => setSidebar(false)}
          >
            <X size={19} />
          </button>
        </div>
        <button className={s.newChat} onClick={newChat} disabled={busy}>
          <Plus size={18} />
          New chat
        </button>
        <label className={s.search}>
          <Search size={16} />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
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
                <button
                  disabled={busy}
                  onClick={() => {
                    setActive(c.id);
                    setSidebar(false);
                    setError("");
                    setDraft("");
                  }}
                >
                  <MessageSquare size={14} />
                  <span>{c.mode === "coding" ? "Coding · " : ""}{c.title}</span>
                </button>
                <button
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
                </button>
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
        <Link className={s.workspace} href="/app">
          <Code2 size={18} />
          <span>Coding workspace</span>
        </Link>
        <div className={s.account}>
          <Link href="/settings">Your account & settings</Link>
          <ThemeControl />
        </div>
      </aside>
      <section className={s.conversation}>
        <header className={s.topbar}>
          <button
            className={s.menu}
            aria-label="Open sidebar"
            aria-controls="chat-sidebar"
            aria-expanded={sidebar}
            onClick={() => setSidebar(true)}
          >
            <Menu size={21} />
          </button>
          <div className={s.topBrand}>
            Freecoda <span>Free</span>
          </div>
          <div className={s.headerRight}>
            {status?.models?.length ? (
              <label className={s.model}>
                <select
                  aria-label="Chat model"
                  value={model}
                  disabled={busy}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {status.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            ) : (
              <span className={s.modelState}>
                {status ? "Chat" : "Connecting…"}
              </span>
            )}
            {!status?.signedIn && status && (
              <button
                className={s.signIn}
                disabled={signingIn}
                onClick={signIn}
              >
                {signingIn ? "Opening GitHub…" : "Sign in"}
              </button>
            )}
          </div>
        </header>
        <div className={s.scroll}>
          {messages.length ? (
            <div className={s.messages} aria-label="Conversation">
              {messages.map((m, i) => (
                <article
                  key={i}
                  className={
                    m.role === "user" ? s.userMessage : s.assistantMessage
                  }
                  aria-label={
                    m.role === "user" ? "Your message" : "Freecoda response"
                  }
                >
                  {m.role === "assistant" && (
                    <div className={s.assistantLabel}>
                      <Mark />
                      <span>Freecoda</span>
                    </div>
                  )}
                  <MessageContent text={m.content} />
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
                </article>
              ))}
              {busy && messages.at(-1)?.role !== "assistant" && (
                <div role="status" className={s.thinking}>
                  <Mark />
                  Thinking…
                </div>
              )}
              <div ref={end} />
            </div>
          ) : (
            <div className={s.welcome}>
              <div className={s.welcomeMark}>
                <Mark />
              </div>
              <h1>What can I help with?</h1>
              <p>A little room to think, write, and build.</p>
              <div className={s.suggestions}>
                {suggestions.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => {
                      setDraft(q);
                      input.current?.focus();
                    }}
                  >
                    <span>{["✦", "✎", "◇", "⌘"][i]}</span>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className={s.composerArea}>
          {error && (
            <div className={s.error} role="alert">
              {error}
              {!busy && messages.length > 0 && (
                <button
                  onClick={() => void send(true)}
                  disabled={!status?.available}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {status && !status.available && (
            <div className={s.availability} role="status">
              {status.reason || "Chat is currently unavailable."}
              {!status.signedIn && (
                <button onClick={signIn} disabled={signingIn}>
                  Continue with GitHub
                </button>
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
              void send();
            }}
          >
            <textarea
              ref={input}
              value={draft}
              maxLength={8000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Message Freecoda"
              aria-label="Message Freecoda"
              rows={2}
              disabled={busy || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false}
            />
            <div className={s.composerActions}>
              <span>Ask anything. Make something.</span>
              {busy ? (
                <button
                  type="button"
                  className={s.send}
                  aria-label="Stop response"
                  onClick={() => abort.current?.abort()}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className={s.send}
                  aria-label="Send message"
                  disabled={
                    !draft.trim() || !status?.available || !historyReady || selected?.mode === "coding" || selected?.cloudDeleted || selected?.cloudLoaded === false
                  }
                >
                  <ArrowUp size={21} />
                </button>
              )}
            </div>
          </form>
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
