import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import {
  ArrowUpRight,
  ArrowUp,
  Code2,
  FolderGit2,
  GitBranch,
  Laptop,
  MessageSquare,
  Plus,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Install } from "@/components/install";
import { SponsorPlacement } from "@/components/sponsor-placement";
import { GitHubSignIn } from "@/components/github-sign-in";

export default async function Home() {
  let signedIn = false;
  try {
    signedIn = !!(await getAuth()?.api.getSession({ headers: await headers() }))?.user?.id;
  } catch {
    // A failed session check must keep the public landing accessible.
  }
  if (signedIn) redirect("/app");
  return (
    <main id="main" className="product-home">
      <section className="product-entry" aria-label="Freecoda coding workspace">
        <aside className="entry-sidebar">
          <div className="entry-sidebar-title">
            <span>Your next project</span>
          </div>
          <Link className="entry-new" href="/app">
            <Plus size={16} /> New workspace
          </Link>
          <div className="entry-sidebar-section">Build with Freecoda</div>
          <Link href="/app">
            <MessageSquare size={16} /> Chat & workspace
          </Link>
          <Link href="/docs#desktop">
            <Laptop size={16} /> Desktop app
          </Link>
          <Link href="/docs#installation">
            <Terminal size={16} /> Terminal
          </Link>
          <div className="entry-sidebar-bottom">
            <span className="entry-free">One plan. Free forever.</span>
            <p>Sponsor supported, with clear daily limits. Invite-only beta.</p>
            <Link href="/pricing">
              How free access works <ArrowUpRight size={12} />
            </Link>
          </div>
        </aside>
        <div className="entry-center">
          <div className="entry-context">
            <span>Freecoda workspace</span>
            <span>Browser · Desktop · CLI</span>
          </div>
          <div className="entry-welcome">
            <h1>What do you want to build?</h1>
            <p>
              Your project, a conversation, and room to work.
              <br />
              Plan, write code, and review the changes together.
            </p>
            <GitHubSignIn />
            <Link
              href="/app"
              className="entry-composer"
              aria-label="Open Freecoda and start building"
            >
              <span>Describe a feature, fix a bug, or explore your code…</span>
              <div>
                <span>
                  <FolderGit2 size={14} /> Choose a project
                </span>
                <span className="entry-send">
                  <ArrowUp size={18} />
                </span>
              </div>
            </Link>
            <div className="entry-prompts">
              <Link href="/app">
                <Code2 size={15} /> Build something new
              </Link>
              <Link href="/app">
                <GitBranch size={15} /> Bring a repository
              </Link>
              <Link href="/docs">
                <Terminal size={15} /> Work locally
              </Link>
            </div>
            <p className="entry-caption">
              Cloud workspaces need sign-in and consent. Nothing starts until
              you choose.
            </p>
          </div>
          <div className="entry-sponsor">
            <SponsorPlacement placement="web" />
          </div>
        </div>
        <aside className="entry-review">
          <div className="entry-review-tabs">
            <span>How it works</span>
            <ShieldCheck size={14} />
          </div>
          <div className="entry-review-content">
            <GitBranch size={28} strokeWidth={1.3} />
            <h2>A clear view of every change.</h2>
            <p>
              Keep the conversation open while you inspect files, review diffs,
              and check command output.
            </p>
            <ul>
              <li>Start with a plan or ask for a change.</li>
              <li>Review what the agent produces.</li>
              <li>Publish a draft PR when you’re ready.</li>
            </ul>
            <Link href="/app">
              Open your workspace <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="entry-privacy">
            <ShieldCheck size={15} />
            <p>
              Ads stay separate from answers. Your code and conversations are
              never sold to sponsors.
            </p>
          </div>
        </aside>
      </section>
      <section className="product-open-source" id="open-source">
        <div>
          <h2>Built in the open.</h2>
          <p>Freecoda is open source under Apache 2.0. Explore the code, report a bug, or contribute.</p>
        </div>
        <div className="repository-links">
          <a href="https://github.com/elliotshohet/freecoda">
            <strong>Freecoda on GitHub <ArrowUpRight size={16} /></strong>
            <span>Source, development, documentation & contributions</span>
          </a>
          <a href="https://github.com/elliotshohet/freecoda/releases">
            <strong>Downloads & updates <ArrowUpRight size={16} /></strong>
            <span>Desktop installers, checksums & release history</span>
          </a>
        </div>
      </section>
      <section className="product-local" id="how-it-works">
        <div>
          <h2>The same room to build. Wherever you work.</h2>
          <p>
            Use the cloud workspace, open your own folder in the desktop app, or
            stay in your terminal. One free, sponsor-supported plan. No paid
            upgrades.
          </p>
          <Link href="/docs#desktop">
            Download the desktop beta <ArrowUpRight size={14} />
          </Link>
        </div>
        <Install />
      </section>
    </main>
  );
}
