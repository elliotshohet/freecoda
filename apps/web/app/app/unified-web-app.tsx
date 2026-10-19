"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mark } from "@/components/chrome";
import { GitHubStars } from "@/components/github-stars";
import { ThemeControl } from "@/components/theme-control";
import { UserAvatar } from "@/components/user-avatar";
import { PanelLeft, SlidersHorizontal } from "lucide-react";
import Chat from "../chat/chat";
import { CloudWorkspace } from "./workspace";
import styles from "./unified-web-app.module.css";

type View = "chat" | "workspace";

export function UnifiedWebApp({ initialView, initialThreadId, user }: { initialView: View; initialThreadId?: string; user: { name?: string | null; image?: string | null } }) {
  const [view, setView] = useState<View>(initialView);
  const shell = useRef<HTMLDivElement>(null);
  const [conversationBounds, setConversationBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const root = shell.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const slot = root.querySelector<HTMLElement>("[data-conversation-slot]");
        if (!slot) { setConversationBounds(null); return; }
        const box = (getComputedStyle(slot).display === "contents" ? slot.parentElement! : slot).getBoundingClientRect();
        const outer = root.getBoundingClientRect();
        const next = { left: box.left - outer.left, top: box.top - outer.top, width: box.width, height: box.height };
        setConversationBounds(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
      });
    };
    const resize = new ResizeObserver(update);
    const observeSlots = () => {
      root.querySelectorAll<HTMLElement>("[data-conversation-slot]").forEach(slot => {
        resize.observe(slot);
        if (slot.parentElement) resize.observe(slot.parentElement);
      });
      update();
    };
    resize.observe(root);
    const changes = new MutationObserver(observeSlots);
    changes.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-conversation-mode", "data-mobile-pane", "data-open", "hidden"],
    });
    window.addEventListener("resize", update);
    observeSlots();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => shell.current?.style.setProperty("--app-height", `${viewport?.height || window.innerHeight}px`);
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    const restoreView = () => setView(new URLSearchParams(window.location.search).get("view") === "chat" ? "chat" : "workspace");
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, []);
  function selectView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "chat") url.searchParams.set("view", "chat");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }

  return (
    <div ref={shell} className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Freecoda home">
          <Mark />
          <span>freecoda</span>
        </Link>
        <span className={styles.roomTitle}>Conversation & project</span>
        <div className={styles.headerActions}>
          <GitHubStars />
          {view === "chat" && <button type="button" className={styles.headerButton} aria-label="Open chat history" title="Chat history" onClick={() => window.dispatchEvent(new CustomEvent("freecoda:chat-sidebar"))}><PanelLeft size={16} /></button>}
          <button type="button" className={styles.headerButton} aria-label="Choose model" title="Choose model · /model" onClick={() => window.dispatchEvent(new CustomEvent("freecoda:show-model", { detail: { view } }))}><SlidersHorizontal size={16} /><span>Model</span></button>
          <ThemeControl />
          <Link className={styles.account} href="/settings" aria-label="Account & settings" title="Account & settings"><UserAvatar image={user.image} name={user.name} /><span className={styles.accountLabel}>Account</span></Link>
        </div>
      </header>
      <div id="workspace-panel" className={styles.panels}>
        <CloudWorkspace conversationMode={view === "chat" ? "ask" : "project"} />
      </div>
      <section className={styles.conversationSurface} hidden={!conversationBounds || conversationBounds.width <= 0 || conversationBounds.height <= 0} style={conversationBounds || undefined} aria-label="Conversation">
        <div className={styles.conversationModes} role="group" aria-label="Conversation mode">
          <button type="button" aria-pressed={view === "chat"} onClick={() => selectView("chat")}>Ask Coda</button>
          <button type="button" aria-pressed={view === "workspace"} onClick={() => selectView("workspace")}>Work on project</button>
        </div>
        <div className={styles.chatSurface} hidden={view !== "chat"}>
          <Chat embedded initialThreadId={initialThreadId} onOpenWorkspace={() => selectView("workspace")} />
        </div>
      </section>
    </div>
  );
}
