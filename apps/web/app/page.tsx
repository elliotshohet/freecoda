import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, ArrowUpRight, Globe2, Laptop2, Terminal } from "lucide-react";
import { FeatureOverview } from "@/components/feature-overview";
import { Install } from "@/components/install";
import { GitHubIcon } from "@/components/github-icon";
import { homeStructuredData, publicPageMetadata, SITE_DESCRIPTION } from "@/lib/seo";

export const metadata = {
  ...publicPageMetadata({
    title: "Free, open-source AI coding agent",
    description: SITE_DESCRIPTION,
    path: "/",
  }),
  title: { absolute: "Freecoda — Free, open-source AI coding agent" },
};

export default function Home() {
  return (
    <main id="main" className="product-home marketing-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData).replace(/</g, "\\u003c") }}
      />
      <section className="marketing-welcome" aria-labelledby="welcome-title">
        <div className="marketing-hero">
          <div className="marketing-intro">
            <h1 id="welcome-title">Make room for<br /><span>your next idea.</span></h1>
            <p className="marketing-subtitle">Think it through, build it, and keep moving. Freecoda gives every idea a place to start.</p>
            <div className="marketing-primary-actions">
              <Link className="marketing-download-button" href="/download"><ArrowDownToLine size={17} aria-hidden="true" />Download desktop</Link>
              <Link className="marketing-web-button" href="/app">Use web version <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
            <p className="marketing-availability">Free, supported by ethical ads. Hosted access is invite-only during beta.</p>
          </div>
          <section className="marketing-cli" id="install" aria-labelledby="install-title">
            <div className="marketing-cli-heading"><Terminal size={16} aria-hidden="true" /><h2 id="install-title">More at home in a terminal?</h2><Link href="/docs#installation">CLI guide <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
            <Install compact />
            <p className="marketing-cli-requirements">Requires Node.js 22+ and npm. Follow the installer’s PATH instructions, then run <code>freecoda</code>.</p>
          </section>
        </div>
        <section className="marketing-clients" aria-label="Choose how to use Freecoda">
          <h2>One assistant. Your choice of workspace.</h2>
          <div className="marketing-client-list">
            <Link href="/app"><Globe2 size={21} aria-hidden="true" /><strong>Browser</strong><span>Conversations and cloud projects, wherever you sign in.</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
            <Link href="/download"><Laptop2 size={21} aria-hidden="true" /><strong>Desktop</strong><span>Local folders, files, and conversations together.</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
            <Link href="/docs#installation"><Terminal size={21} aria-hidden="true" /><strong>Terminal</strong><span>A focused coding companion for the command line.</span><ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>
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
