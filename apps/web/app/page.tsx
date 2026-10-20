import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, ArrowUpRight, Terminal } from "lucide-react";
import { FeatureOverview } from "@/components/feature-overview";
import { Install } from "@/components/install";
import { GitHubIcon } from "@/components/github-icon";

export default function Home() {
  return (
    <main id="main" className="product-home marketing-home">
      <section className="marketing-welcome" aria-labelledby="welcome-title">
        <div className="marketing-hero">
          <div className="marketing-intro">
            <h1 id="welcome-title">Your next idea,<br /><span>free.</span></h1>
            <p className="marketing-subtitle">An open-source AI agent supported by ethical ads.</p>
            <div className="marketing-primary-actions">
              <Link className="marketing-download-button" href="/download"><ArrowDownToLine size={17} aria-hidden="true" />Download desktop</Link>
              <Link className="marketing-web-button" href="/app">Use web version <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
            <p className="marketing-availability">Free forever. Desktop, web, and terminal. Hosted access is invite-only during beta.</p>
          </div>
          <section className="marketing-cli" id="install" aria-labelledby="install-title">
            <div className="marketing-cli-heading"><Terminal size={16} aria-hidden="true" /><h2 id="install-title">More at home in a terminal?</h2><Link href="/docs#installation">CLI guide <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
            <Install compact />
            <p className="marketing-cli-requirements">Requires Node.js 22+ and npm. Follow the installer’s PATH instructions, then run <code>freecoda</code>.</p>
          </section>
        </div>
        <FeatureOverview />
        <figure className="marketing-product">
          <div className="marketing-product-frame">
            <Image src="/images/freecoda-desktop-0.1.8-preview.webp" alt="Freecoda desktop interface with workspace navigation and a conversation composer." width={1480} height={950} priority sizes="(max-width: 1120px) 100vw, 1040px" />
          </div>
          <figcaption><span>Desktop interface preview</span><span>Built for your next idea.</span></figcaption>
        </figure>
        <a className="open-source-banner" href="https://github.com/elliotshohet/freecoda">
          <span className="open-source-icon"><GitHubIcon size={22} /></span>
          <span><strong>Open source on GitHub</strong><small>Read the code. Report a bug. Help shape Freecoda.</small></span>
          <span className="open-source-license">Apache 2.0</span>
          <ArrowUpRight size={19} aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}
