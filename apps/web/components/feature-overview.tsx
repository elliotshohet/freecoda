import Link from "next/link";
import { CLI_RELEASE_VERSION, DESKTOP_RELEASE_VERSION } from "@/lib/releases";
import styles from "./feature-overview.module.css";

// Native releases are verified separately from the web deployment. Keep this truthful until publication.
export const NATIVE_FEATURE_RELEASE_PENDING = false;
const groups = [
  {
    title: "Chat, history and drafts",
    clients: "Web · Desktop · CLI",
    items: [
      ["Keep a conversation going", "Ask questions, write, plan and review with follow-up context. General chat does not gain repository tools."],
      ["Keep your place", "Signed-in conversations sync to your account, with local copies and retry handling when a connection is unavailable."],
      ["Control the next turn", "Queue messages, stop a response, and revisit saved conversations. Desktop also supports local archived chats with Undo, saved composer drafts and AI draft suggestions."],
    ],
  },
  {
    title: "Work with a local project",
    clients: "Desktop · CLI",
    items: [
      ["Choose and trust a folder", "Read and search project files, inspect changes, and work in Build, Plan or Review mode. General chat stays separate from project conversations."],
      ["Edit with permission", "The desktop file editor preserves editable text with syntax colors. Agent file changes and shell commands follow your permission preset and approval boundaries."],
      ["Stay in control", "Review changes, inspect Git status or pull updates, cancel work, and use the terminal client in the project you selected."],
    ],
  },
  {
    title: "Use a cloud workspace",
    clients: "Web",
    items: [
      ["Connect your repository", "Choose an accessible GitHub repository and create a cloud project after reviewing cloud storage consent."],
      ["Inspect the work", "Browse and edit files, inspect diffs, preview the app, and read run output. Start or stop project work through the existing workspace controls."],
      ["Review before sharing", "Build, Plan and Review modes keep their existing boundaries. Review changes before creating a draft pull request; voice dictation never approves a project action."],
    ],
  },
  {
    title: "Add instructions and tools",
    clients: "Client capabilities differ",
    items: [
      ["Skills are instructions", "Read installed SKILL.md content and review trusted sources before adding them to coding tasks."],
      ["MCP servers expose tools", "Configure supported connections, explicitly check available tools, and choose which actions are enabled. Saved configuration does not mean a server is connected."],
      ["Plugins bundle capabilities", "Desktop, CLI and cloud project workspaces can review plugin manifests that bundle skills and MCP servers. Installation does not bypass tool permissions or make general chat a coding session."],
    ],
  },
  {
    title: "Speak or dictate",
    clients: "Browser-dependent",
    items: [
      ["Dictate an editable draft", "Start dictation yourself, then review or edit the words before sending. Web chat and cloud project composers support this where browser recognition is available."],
      ["Talk in general chat", "Live voice sends one spoken chat turn at a time, pauses the microphone during the reply, and reads the answer aloud. Stop, mute or interrupt the session at any time."],
      ["Know the browser boundary", "Recognition and playback depend on browser speech services and microphone permission. Audio or speech text may be processed online by the browser’s provider; support varies and is not an offline guarantee."],
    ],
  },
  {
    title: "Access, settings and privacy",
    clients: "Free beta",
    items: [
      ["Use the free hosted service", "GitHub sign-in and an invitation are required for hosted beta access. Approved free models and account allowances apply; no paid model is silently substituted."],
      ["Manage your account", "Review repository access, connected devices and account settings. Cloud project retention follows its consent terms; conversation history has separate deletion and sync rules."],
      ["Choose your client", "Use the web for chat and cloud projects, desktop for local files, or the CLI in your terminal. Light and dark themes are available; desktop close-to-tray preserves the session."],
    ],
  },
] as const;

export function FeatureOverview({ compact = false }: { compact?: boolean }) {
  return <details className={`${styles.overview}${compact ? ` ${styles.compact}` : ""}`}>
    <summary className={styles.summary}><span>What can Freecoda do?</span>{" "}<small>Explore features and client differences</small></summary>
    <div className={styles.content}>
      <p className={styles.intro}>Start with a conversation. Open a group for the tools, boundaries and client that fit your task.</p>
      <div className={styles.groups}>
        {groups.map(group => <details key={group.title} className={styles.group}>
          <summary><span>{group.title}</span>{" "}<small>{group.clients}</small></summary>
          <dl>{group.items.map(([title, description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl>
        </details>)}
      </div>
      <p className={styles.note}>{NATIVE_FEATURE_RELEASE_PENDING ? "New native voice, draft recovery and workspace improvements are available in current source builds. Updated desktop and CLI installers are pending verification and publication; existing downloads may differ." : `Native voice is available in desktop ${DESKTOP_RELEASE_VERSION} and CLI ${CLI_RELEASE_VERSION} through a separate browser companion. Both require a browser with the relevant speech support.`}</p>
      <nav className={styles.links} aria-label="Feature documentation"><Link href="/docs">Read the guide</Link><Link href="/download">Choose a client</Link><Link href="/pricing">Free access and limits</Link><Link href="/privacy">Privacy and retention</Link></nav>
    </div>
  </details>;
}
