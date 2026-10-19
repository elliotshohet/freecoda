import Link from "next/link";
import { requireBrowserSession } from "@/lib/browser-session";
import { SessionBoundary } from "@/components/session-boundary";
import { Workspace } from "@/components/workspace";
import { ConnectedRepositories } from "@/components/connected-repositories";
import { ThemeControl } from "@/components/theme-control";

export const metadata = { title: "Account & settings", robots: { index: false, follow: false } };
export default async function Settings() {
  const user = await requireBrowserSession();
  return <SessionBoundary userId={user.id}>
    <main className="page-shell account-settings" id="main">
      <nav className="account-navigation" aria-label="Account navigation">
        <Link href="/chat">← Back to chat</Link>
        <Link href="#profile">Profile</Link>
        <Link href="#usage">Plan & usage</Link>
        <Link href="#connections">Connected repositories</Link>
        <Link href="#preferences">Preferences</Link>
      </nav>
      <h1>Your account & settings</h1>
      <section className="panel" id="profile">
        <h2>Profile</h2>
        <dl><dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd></dl>
        <p>Signed in with GitHub. Your GitHub profile is managed on GitHub.</p>
      </section>
      <section className="panel" id="preferences">
        <h2>Preferences</h2>
        <p>Appearance</p><ThemeControl />
        <p>Signed-in conversations sync across the web, CLI, and desktop with an offline copy on each device. Search and delete them in the chat sidebar; deletions reach other clients on their next sync.</p>
      </section>
      <section className="panel" id="usage">
        <h2>Free plan & usage</h2>
        <p>Free forever, supported by labeled sponsors. No subscription, paid credits, or billing checkout.</p>
        <p>Your actual daily allowance and connected devices appear below. Hosted access may require an invitation.</p>
      </section>
      <Workspace />
      <ConnectedRepositories />
    </main>
  </SessionBoundary>;
}
