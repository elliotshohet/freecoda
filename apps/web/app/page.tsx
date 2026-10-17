import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Code2,
  GitBranch,
  LockKeyhole,
  Terminal,
  Wallet,
  Zap,
} from "lucide-react";
import { Install } from "@/components/install";
import { TerminalDemo } from "@/components/terminal-demo";
import { SponsorPlacement } from "@/components/sponsor-placement";
export default function Home() {
  return (
    <main id="main">
      <section className="hero">
        <div className="hero-copy">
          <div className="availability">
            <span /> A little more freedom to build
          </div>
          <h1>
            Your code.
            <br />
            Your next
            <br />
            <span>big thing.</span>
          </h1>
          <p className="hero-description">
            Meet the coding agent that works where you do. Plan, build, and fix
            things in your terminal—with your code and your choices in your
            hands.
          </p>
          <Install />
          <div className="platforms">
            <span>macOS</span>
            <span>Linux</span>
            <span>Windows via WSL2</span>
            <Link href="/docs">
              Get started <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-label">
            <span className="asterisk">✳</span> From “what if” to working code.
          </div>
          <TerminalDemo />
          <div className="visual-footnote">
            <span className="small-check">
              <Check size={12} />
            </span>{" "}
            Runs on your machine. Always asks before making changes.
          </div>
        </div>
      </section>
      <div className="trust-strip">
        <span>
          <LockKeyhole size={16} /> Clearly labeled ads. No sale of your code.
        </span>
        <span>
          <Wallet size={16} /> Sponsor supported. Free forever.
        </span>
        <span>
          <Code2 size={16} /> Local execution. Your repository.
        </span>
      </div>
      <SponsorPlacement placement="web" />
      <section className="workflow section-pad" id="how-it-works">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Less setup. More making.</span>
            <h2>
              One terminal.
              <br />A lot of possibility.
            </h2>
          </div>
          <p>
            Keep your editor, your tools, and your way of working. Freecoda fits
            into the project you already have.
          </p>
        </div>
        <div className="workflow-grid">
          <article>
            <div className="step-icon">
              <Terminal size={24} />
              <span>1</span>
            </div>
            <h3>Make yourself at home.</h3>
            <p>
              Install Freecoda, open a project, and sign in. Or bring your own
              API key and skip the account.
            </p>
            <code>cd your-project && freecoda</code>
          </article>
          <article>
            <div className="step-icon">
              <Zap size={24} />
              <span>2</span>
            </div>
            <h3>Tell it what’s on your mind.</h3>
            <p>
              A stubborn bug. A new feature. A question about your code. Start a
              conversation or make a plan first.
            </p>
            <code>/plan add a settings page</code>
          </article>
          <article>
            <div className="step-icon">
              <GitBranch size={24} />
              <span>3</span>
            </div>
            <h3>Review it. Make it yours.</h3>
            <p>
              See the diff, approve the change, and run your checks. Your work
              stays in your own repository.
            </p>
            <code>/review</code>
          </article>
        </div>
      </section>
      <section className="promise-section section-pad">
        <div className="promise-art" aria-hidden="true">
          <div className="bracket">{"{"}</div>
          <div className="promise-lock">
            <LockKeyhole size={48} strokeWidth={1.2} />
            <span>your code</span>
          </div>
          <div className="bracket">{"}"}</div>
        </div>
        <div className="promise-copy">
          <span className="section-kicker">A straightforward promise</span>
          <h2>
            Sponsors support you.
            <br />
            Your code stays yours.
          </h2>
          <p>
            Clearly labeled sponsor cards help fund free AI usage. Ads stay
            separate from agent answers. We do not sell your code or
            conversations to advertisers. The preview uses a house ad until real
            sponsors are available.
          </p>
          <Link href="/privacy" className="text-link">
            Read our privacy promise <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>
      <section className="pricing-preview section-pad">
        <div>
          <span className="section-kicker">
            Start small. Build something good.
          </span>
          <h2>
            Free to use.
            <br />
            Supported by sponsors.
          </h2>
          <p>
            Our invite-only beta includes $0.10 of AI inference a day.
            <br />
            No credit packs, subscriptions, or payment card required.
          </p>
          <Link className="button dark" href="/pricing">
            How free access works <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="allowance-visual">
          <span>Your only plan</span>
          <div className="allowance-amount">
            $0<span>/ forever</span>
          </div>
          <div className="allowance-track">
            <i />
          </div>
          <p>
            Fair-use limits keep the service sustainable.
            <br />
            No card. No paid upgrade.
          </p>
          <Link href="/dashboard">
            Join the beta <ArrowUpRight size={14} />
          </Link>
        </div>
      </section>
      <section className="closing">
        <span className="closing-star">✳</span>
        <h2>
          What will you
          <br />
          make room for?
        </h2>
        <Link href="/docs" className="button light">
          Let’s build something <ArrowUpRight size={17} />
        </Link>
        <div className="giant-wordmark" aria-hidden="true">
          freecoda
        </div>
      </section>
    </main>
  );
}
