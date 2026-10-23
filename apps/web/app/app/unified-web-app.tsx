"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mark } from "@/components/chrome";
import { GitHubStars } from "@/components/github-stars";
import { ThemeControl } from "@/components/theme-control";
import { UserAvatar } from "@/components/user-avatar";
import { BookOpen, Code2, FolderKanban, MessageSquare, Plus, Settings2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
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
    const restoreView = () => {
      const params = new URLSearchParams(window.location.search);
      setView(params.get("view") === "chat" || (params.has("thread") && params.get("view") !== "workspace") ? "chat" : "workspace");
    };
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, []);
  function selectView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "chat") url.searchParams.set("view", "chat");
    else url.searchParams.set("view", "workspace");
    window.history.replaceState(null, "", url);
  }

  return (
    <div ref={shell} className={styles.shell} data-view={view}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Freecoda home">
          <Mark /><span className={styles.wordmark}>Freecoda</span>
        </Link>
        <div className={styles.context}>
          <span className={styles.contextEyebrow}>YOUR WORKSPACE</span>
          <span className={styles.contextTitle}>{view === "chat" ? "Ask anything" : "Build something"}</span>
        </div>
        <Badge className={styles.accessState} variant="outline"><ShieldCheck data-icon="inline-start" />{view === "chat" ? "Private chat · no repo access" : "Project access by choice"}</Badge>
        <div className={styles.headerActions}>
          <div className={styles.githubControl}><GitHubStars /></div>
          <ThemeControl />
          <Link className={styles.account} href="/settings" aria-label="Account & settings" title="Account & settings"><UserAvatar image={user.image} name={user.name} /></Link>
        </div>
      </header>
      <aside className={styles.activityRail} aria-label="Application navigation">
        <Button className={styles.newChat} onClick={() => { selectView("chat"); window.dispatchEvent(new CustomEvent("freecoda:new-chat")); }}>
          <Plus data-icon="inline-start" /> New chat
        </Button>
        <div className={styles.navLabel}>WORKSPACE</div>
        <Button variant="ghost" className={view === "chat" ? styles.navActive : styles.navItem} aria-current={view === "chat" ? "page" : undefined} onClick={() => selectView("chat")}>
          <MessageSquare data-icon="inline-start" /> Chat <span className={styles.navHint}>Private</span>
        </Button>
        <Button variant="ghost" className={view === "workspace" ? styles.navActive : styles.navItem} aria-current={view === "workspace" ? "page" : undefined} onClick={() => selectView("workspace")}>
          <FolderKanban data-icon="inline-start" /> Projects <span className={styles.navHint}>Cloud</span>
        </Button>
        <div className={styles.railSpacer} />
        <div className={styles.sidebarNote}><Sparkles data-icon="inline-start" /><span>Free, open source,<br />and yours to shape.</span></div>
        <div className={styles.navLabel}>RESOURCES</div>
        <Link className={styles.navLink} href="/docs"><BookOpen data-icon="inline-start" /> Documentation</Link>
        <Link className={styles.navLink} href="/settings"><Settings2 data-icon="inline-start" /> Settings</Link>
      </aside>
      <footer className={styles.statusbar}>
        <span><Code2 size={12} aria-hidden="true" />{view === "workspace" ? "Cloud workspace" : "General chat"}</span>
        <span><ShieldCheck size={12} aria-hidden="true" />{view === "workspace" ? "Review before sharing" : "No repository access"}</span>
        <Link href="/docs">Free & open source</Link>
      </footer>
      <div id="workspace-panel" className={styles.panels}>
        <CloudWorkspace conversationMode={view === "chat" ? "ask" : "project"} onOpenProject={() => selectView("workspace")} onOpenChat={() => selectView("chat")} />
      </div>
      <section className={styles.conversationSurface} hidden={!conversationBounds || conversationBounds.width <= 0 || conversationBounds.height <= 0} style={conversationBounds || undefined} aria-label="Conversation">
        <div className={styles.chatSurface} hidden={view !== "chat"}>
          <Chat embedded voiceVisible={view === "chat"} initialThreadId={initialThreadId} onOpenWorkspace={(command = "/project") => {
            if (!["/project", "/repos"].includes(command.trim().split(/\s+/)[0].toLowerCase())) selectView("workspace");
            window.dispatchEvent(new CustomEvent("freecoda:project-command", { detail: { command } }));
          }} />
        </div>
      </section>
    </div>
  );
}
