"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GitHubStars } from "@/components/github-stars";
import { ThemeControl } from "@/components/theme-control";
import { UserAvatar } from "@/components/user-avatar";
import { Code2, MessageSquare, PanelLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    const restoreView = () => setView(new URLSearchParams(window.location.search).get("view") === "workspace" ? "workspace" : "chat");
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
    <div ref={shell} className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Freecoda home">
          <img src="/brand/freecoda-mark.svg" width="25" height="25" alt="" /><span>Freecoda</span>
        </Link>
        <nav className={styles.views} aria-label="Workspace views">
          <ToggleGroup value={[view]} onValueChange={(values) => { if (values[0] === "chat" || values[0] === "workspace") selectView(values[0]); }} aria-label="Conversation mode">
            <ToggleGroupItem value="chat"><MessageSquare data-icon="inline-start" /> Chat</ToggleGroupItem>
            <ToggleGroupItem value="workspace"><Code2 data-icon="inline-start" /> Workspace</ToggleGroupItem>
          </ToggleGroup>
        </nav>
        <div className={styles.accessState}><Badge variant="outline">{view === "chat" ? "No repository access" : "Project workspace"}</Badge></div>
        <div className={styles.headerActions}>
          <div className={styles.githubControl}><GitHubStars /></div>
          {view === "chat" && <Button variant="ghost" size="icon" aria-label="Open chat history" title="Chat history" onClick={() => window.dispatchEvent(new CustomEvent("freecoda:chat-sidebar"))}><PanelLeft aria-hidden="true" /></Button>}
          <ThemeControl />
          <Link className={styles.account} href="/settings" aria-label="Account & settings" title="Account & settings"><UserAvatar image={user.image} name={user.name} /></Link>
        </div>
      </header>
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
