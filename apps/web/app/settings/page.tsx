import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
import { Workspace } from "@/components/workspace";
import { ConnectedRepositories } from "@/components/connected-repositories";
import { ThemeControl } from "@/components/theme-control";
import { Mark } from "@/components/chrome";
import styles from "./settings.module.css";

export const metadata = { title: "Account & settings", robots: { index: false, follow: false } };
export default async function Settings() {
  const user = await requireBrowserSession();
  return <SessionBoundary userId={user.id}>
    <main className={styles.shell} id="main">
      <header className={styles.topbar}>
        <Link href="/app" className={styles.brand} aria-label="Freecoda app"><Mark /> freecoda</Link>
        <Link href="/app" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Back to app</Link>
      </header>
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="Settings sections">
          <span className={styles.navLabel}>Your account</span>
          <a href="#profile">Profile</a>
          <a href="#preferences">Appearance & conversations</a>
          <a href="#connections">Connected repositories</a>
          <a href="#usage">Usage & devices</a>
        </nav>
        <div className={styles.content} tabIndex={0} aria-label="Account settings">
          <div className={styles.intro}>
            <h1>Account & settings</h1>
            <p>Your preferences and connections, shared across Freecoda.</p>
          </div>
          <section className={styles.card} id="profile" aria-labelledby="profile-title">
            <div className={styles.sectionHeading}><h2 id="profile-title">Profile</h2><span className={styles.badge}>GitHub account</span></div>
            <dl className={styles.profile}><div><dt>Name</dt><dd>{user.name}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div></dl>
            <p className={styles.note}>Your name and email come from GitHub. Manage your profile on GitHub.</p>
          </section>
          <section className={styles.card} id="preferences" aria-labelledby="preferences-title">
            <h2 id="preferences-title">Appearance & conversations</h2>
            <div className={styles.preference}><div><h3>Appearance</h3><p>Choose the theme that works for you.</p></div><ThemeControl /></div>
            <details className={styles.disclosure}><summary>How conversation sync works</summary><p>Signed-in conversations sync across the web, CLI, and desktop, with an offline copy on each device. Search and delete them in the chat sidebar. Deletions reach other clients on their next sync.</p><p>Repository settings do not upload a local folder. Cloud workspaces require their own storage consent.</p></details>
          </section>
          <div className={styles.repositories}><ConnectedRepositories /></div>
          <section className={styles.usage} id="usage" aria-labelledby="usage-title">
            <div className={styles.usageHeading}><h2 id="usage-title">Usage & devices</h2><p>One free plan, supported by labeled sponsors. No paid credits or subscription.</p></div>
            <Workspace settings />
          </section>
          <p className={styles.help}>Need a hand? <Link href="/docs">Read the documentation</Link></p>
        </div>
      </div>
    </main>
  </SessionBoundary>;
}
