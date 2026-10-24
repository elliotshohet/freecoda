import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, Code2, FileCode2, FolderGit2, Globe2, Laptop2, MessageSquare, ShieldCheck, Terminal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { Install } from "@/components/install";
import { GitHubIcon } from "@/components/github-icon";
import { BrandSplash } from "@/components/brand-splash";
import { LandingHeadline } from "@/components/landing-motion";
import { Spotlight } from "@/components/spotlight";
import { homeStructuredData, publicPageMetadata, SITE_DESCRIPTION } from "@/lib/seo";
import styles from "./landing-v2.module.css";

export const metadata = {
  ...publicPageMetadata({ title: "Free, open-source AI coding agent", description: SITE_DESCRIPTION, path: "/" }),
  title: { absolute: "Freecoda — Free, open-source coding agent. Supported by ads." },
};

const clients = [
  { icon: Globe2, title: "A tab. A fresh start.", description: "Ask a question or open a cloud project. Your workspace is right here in your browser.", href: "/app", action: "Open the web app", detail: "Web", className: styles.webCard },
  { icon: Laptop2, title: "Right at home.", description: "Your local folders, tools, and conversations, together in a dedicated desktop app.", href: "/download", action: "Download Freecoda", detail: "Desktop", className: styles.desktopCard },
  { icon: Terminal, title: "Stay in your flow.", description: "Bring the agent to your command line. Keep your favorite editor and make it yours.", href: "/docs#installation", action: "Install the CLI", detail: "Terminal", className: styles.terminalCard },
];

export default function Home() {
  return (
    <main id="main" className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData).replace(/</g, "\\u003c") }} />
      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.heroAtmosphere} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.intro}>
          <div className={styles.announcement}><span /> Free & open source <span className={styles.announcementDivider}>/</span> Made for your next idea</div>
          <h1 id="welcome-title"><LandingHeadline /></h1>
          <p className={styles.lead}>A coding agent that makes room for you.</p>
          <p className={styles.description}>Go from “what if” to working software. Ask, build, and refine with Freecoda, in your browser, on your desktop, or in your terminal.</p>
          <div className={styles.actions}>
            <Link className={buttonVariants({ size: "lg" })} href="/app">Start building <ArrowRight data-icon="inline-end" /></Link>
            <Link className={buttonVariants({ size: "lg", variant: "outline" })} href="/download"><ArrowDownToLine data-icon="inline-start" /> Get the desktop app</Link>
          </div>
          <p className={styles.heroNote}>Supported by ads. No subscription required.<br /><span>Hosted beta is invite-only.</span></p>
        </div>
        <div className={styles.previewWrap}>
          <div className={styles.previewCaption}><span><span className={styles.statusDot} /> Your next idea starts here</span><span>Meet your workspace</span></div>
          <div className={styles.visual} aria-label="Illustrative Freecoda workspace preview">
            <div className={styles.visualTop}><Link href="/app"><img src="/brand/freecoda-mark.svg" alt="" width="22" height="22" />Freecoda</Link><span>my-next-idea <span className={styles.previewBranch}>/ main</span></span><span className={styles.windowDots}>● ● ●</span></div>
            <div className={styles.visualBody}>
              <div className={styles.visualRail}><div><MessageSquare size={17} /> Chat</div><div><FolderGit2 size={17} /> Projects</div><span>my-next-idea</span><div className={styles.activeFile}><FileCode2 size={15} /> page.tsx</div><div><FileCode2 size={15} /> styles.css</div><div><FileCode2 size={15} /> package.json</div><p><ShieldCheck size={14} /> You’re in control</p></div>
              <div className={styles.visualContent}>
                <BrandSplash />
                <h2>A little curiosity.<br />A lot of possibility.</h2>
                <p>What would you like to make?</p>
                <Link href="/app" className={styles.visualComposer}><span>Let’s build something together</span><ArrowRight size={18} /></Link>
                <div className={styles.visualSuggestions}><span><Code2 size={13} /> Explore an idea</span><span><FileCode2 size={13} /> Improve my code</span></div>
              </div>
            </div>
            <div className={styles.visualBottom}><span><span className={styles.statusDot} /> Ready when you are</span><span>Illustrative preview</span></div>
          </div>
          <div className={styles.floatingNote}><Check size={15} /><span>Your ideas.<br /><strong>Your call.</strong></span></div>
        </div>
      </section>
      <div className={styles.valuesBar}><span><GitHubIcon size={17} /> Open source, always</span><span><ShieldCheck size={17} /> Access on your terms</span><span><Globe2 size={17} /> Three ways to make it yours</span></div>
      <section className={styles.clients} aria-labelledby="clients-title">
        <div className={styles.sectionHead}><div><p className={styles.eyebrow}>Find your flow</p><h2 id="clients-title">Same curiosity.<br />Your kind of workspace.</h2></div><p>Good tools meet you where you are.<br />Pick a place to start.</p></div>
        <div className={styles.clientGrid}>{clients.map(({ icon: Icon, ...client }) => <Spotlight className={`${styles.clientCard} ${client.className}`} key={client.detail}><span className={styles.clientDetail}>{client.detail}<Icon size={21} /></span><div className={styles.clientIllustration} aria-hidden="true">{client.detail === "Terminal" ? <code><span>$</span> freecoda<br /><span>›</span> What are we building?</code> : client.detail === "Web" ? <div className={styles.miniBrowser}><span>freecoda.com</span><img src="/brand/freecoda-mark.svg" width="32" height="32" alt="" /><i /><i /></div> : <div className={styles.miniDesktop}><img src="/brand/freecoda-mark.svg" width="52" height="52" alt="" /><span>Freecoda</span></div>}</div><h3>{client.title}</h3><p>{client.description}</p><Link href={client.href}>{client.action}<ArrowUpRight size={16} /></Link></Spotlight>)}</div>
      </section>
      <section className={styles.principles} aria-labelledby="principles-title"><div><p className={styles.eyebrow}>More freedom to create</p><h2 id="principles-title">An assistant.<br />You’re still the author.</h2><p>Explore a new direction, untangle a bug, or finally start that side project. Freecoda helps with the work. You decide where it goes.</p><Link href="/docs">Get to know Freecoda <ArrowRight size={16} /></Link></div><div className={styles.principleList}><article><MessageSquare size={22} /><div><h3>Start with a conversation</h3><p>Ask anything. General chat stays separate from repository access.</p></div></article><article><ShieldCheck size={22} /><div><h3>Build with a say in every step</h3><p>Choose the project, grant access, and review the changes before sharing.</p></div></article><article><GitHubIcon size={22} /><div><h3>Open from the start</h3><p>Read the source, shape the tools, and help make Freecoda better.</p></div></article></div></section>
      <section id="install" className={styles.install}><div><p className={styles.eyebrow}>For the command line people</p><h2>One command.<br />A new beginning.</h2><p>Your terminal, with a little more possibility.</p><Link href="/docs#installation">Read the installation guide <ArrowRight size={16} /></Link></div><div className={styles.installCommand}><div className={styles.terminalHeader}><Terminal size={15} /><span>Terminal</span><span>bash</span></div><Install compact /><p>Requires Node.js 22+ and npm. Follow the installer’s PATH instructions, then run <code>freecoda</code>.</p></div></section>
      <section className={styles.source}><BrandSplash /><p className={styles.eyebrow}>Good tools belong within reach.</p><h2>Your next idea<br />deserves a place to start.</h2><p>Free to use. Open source. Supported by ads.</p><div className={styles.actions}><Link className={buttonVariants({ size: "lg" })} href="/app">Let’s make something <ArrowRight data-icon="inline-end" /></Link><a className={buttonVariants({ variant: "outline", size: "lg" })} href="https://github.com/elliotshohet/freecoda"><GitHubIcon size={17} />Explore the source</a></div></section>
    </main>
  );
}
