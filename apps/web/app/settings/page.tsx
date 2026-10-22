import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/admin";
import { appUrl } from "@/lib/config";
import { ArrowLeft } from "lucide-react";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
import { Workspace } from "@/components/workspace";
import { ConnectedRepositories } from "@/components/connected-repositories";
import { ThemeControl } from "@/components/theme-control";
import { Mark } from "@/components/chrome";
import styles from "./settings.module.css";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Account & settings", robots: { index: false, follow: false } };
export default async function Settings() {
  const user = await requireBrowserSession("/settings");
  let admin = false;
  try { await requireAdmin(new Request(`${appUrl()}/admin`, { headers: await headers() })); admin = true; } catch { /* Private metrics remain absent for other accounts. */ }
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
          {admin && <Link href="/admin">Business & operations</Link>}
        </nav>
        <div className={styles.content} tabIndex={0} aria-label="Account settings">
          <div className={styles.intro}>
            <h1>Account & settings</h1>
            <p>Your preferences and connections, shared across Freecoda.</p>
          </div>
          <Card className="mb-5" id="profile" aria-labelledby="profile-title">
            <CardHeader><CardTitle role="heading" aria-level={2} id="profile-title">Profile</CardTitle><CardDescription>Your connected identity and account details.</CardDescription></CardHeader>
            <CardContent><Badge variant="secondary">GitHub account</Badge><dl className={styles.profile}><div><dt>Name</dt><dd>{user.name}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div></dl><p className={styles.note}>Your name and email come from GitHub. Manage your profile on GitHub.</p></CardContent>
          </Card>
          <Card className="mb-5" id="preferences" aria-labelledby="preferences-title">
            <CardHeader><CardTitle role="heading" aria-level={2} id="preferences-title">Appearance & conversations</CardTitle><CardDescription>Make your workspace feel like yours.</CardDescription></CardHeader><CardContent>
            <div className={styles.preference}><div><h3>Appearance</h3><p>Choose the theme that works for you.</p></div><ThemeControl /></div>
            <details className={styles.disclosure}><summary>How conversation sync works</summary><p>Signed-in conversations sync across the web, CLI, and desktop, with an offline copy on each device. Search and delete them in the chat sidebar. Deletions reach other clients on their next sync.</p><p>Repository settings do not upload a local folder. Cloud workspaces require their own storage consent.</p></details>
          </CardContent></Card>
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
