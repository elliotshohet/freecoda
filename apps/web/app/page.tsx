import Link from "next/link";
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
import { Mark } from "@/components/chrome";
import { Install } from "@/components/install";
import { SponsorPlacement } from "@/components/sponsor-placement";

export default function Home() {
  return (
    <main id="main" className="product-home">
      <section className="product-entry" aria-label="Freecoda coding workspace">
        <aside className="entry-sidebar">
          <div className="entry-sidebar-title">
            <Mark />
            <span>Your next project</span>
          </div>
          <Link className="entry-new" href="/app">
            <Plus size={16} /> New workspace
          </Link>
          <div className="entry-sidebar-section">Build with Freecoda</div>
          <Link href="/app">
            <MessageSquare size={16} /> Browser workspace
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
            <div className="entry-mark">
              <Mark />
            </div>
            <h1>What do you want to build?</h1>
            <p>
              Your project, a conversation, and room to work.
              <br />
              Plan, write code, and review the changes together.
            </p>
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
