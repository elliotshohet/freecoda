import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Code2, FolderGit2, Globe2, Laptop2, ShieldCheck, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Install } from "@/components/install";
import { GitHubIcon } from "@/components/github-icon";
import { homeStructuredData, publicPageMetadata, SITE_DESCRIPTION } from "@/lib/seo";
import styles from "./landing-v2.module.css";

export const metadata = {
  ...publicPageMetadata({ title: "Free, open-source AI coding agent", description: SITE_DESCRIPTION, path: "/" }),
  title: { absolute: "Freecoda — Free, open-source coding agent. Supported by ads." },
};

const clients = [
  { icon: Globe2, title: "In your browser", description: "Go from a question to a cloud project. Your conversations come with you.", href: "/app", action: "Open web app", detail: "Nothing to install" },
  { icon: Laptop2, title: "On your desktop", description: "Work alongside your local folders, files, and tools in a dedicated workspace.", href: "/download", action: "Get the desktop app", detail: "Your local workspace" },
  { icon: Terminal, title: "In your terminal", description: "Bring a coding agent into the command line. Stay close to your code.", href: "/docs#installation", action: "Install the CLI", detail: "Built for your workflow" },
];

export default function Home() {
  return (
    <main id="main" className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData).replace(/</g, "\\u003c") }} />
      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.intro}>
          <Badge variant="outline"><Code2 data-icon="inline-start" /> Your open-source coding agent</Badge>
          <h1 id="welcome-title">Free to build.<br /><span>Backed by ads.</span></h1>
          <p className={styles.lead}>Turn your next idea into working software.</p>
          <p className={styles.description}>Explore your code, fix bugs, and build something new with an AI coding agent in your browser, desktop, or terminal. Ads help keep it free.</p>
          <div className={styles.actions}>
            <Link className={buttonVariants({ size: "lg" })} href="/app">Start building <ArrowRight data-icon="inline-end" /></Link>
            <Link className={buttonVariants({ size: "lg", variant: "outline" })} href="/download"><ArrowDownToLine data-icon="inline-start" /> Download desktop</Link>
          </div>
          <div className={styles.heroNote}><span className={styles.statusDot} /> Free to use <span>·</span> Apache 2.0 <span>·</span> Hosted beta is invite-only</div>
        </div>
        <div className={styles.visual} aria-label="Freecoda workspace illustration">
          <div className={styles.visualTop}><span className={styles.windowDots}>● ● ●</span><span>your-next-idea</span><Code2 size={15} /></div>
          <div className={styles.visualBody}>
            <div className={styles.visualRail}><img src="/brand/freecoda-mark.svg" alt="" width="25" height="25" /><FolderGit2 size={19} /><Code2 size={19} /><Terminal size={19} /></div>
            <div className={styles.visualContent}>
              <div className={styles.visualHeading}><img src="/brand/freecoda-mark.svg" alt="" width="22" height="22" /><span>Freecoda</span><Badge variant="secondary">Workspace</Badge></div>
              <p className={styles.visualPrompt}>Let’s turn this idea into something real.</p>
              <div className={styles.code}><span>01</span><code><em>const</em> idea = <b>"something great"</b>;</code><span>02</span><code><em>await</em> freecoda.build(idea);</code><span>03</span><code className={styles.comment}>// Make it yours.</code></div>
              <div className={styles.visualSteps}><span><ShieldCheck size={15} /> You review the changes</span><span><FolderGit2 size={15} /> You choose the repository</span></div>
              <div className={styles.visualComposer}><span>What do you want to build?</span><ArrowUpRight size={18} /></div>
              <div className={styles.visualSponsor}><span>AD SUPPORTED</span> More room to build. No subscription required.</div>
            </div>
          </div>
          <div className={styles.visualBottom}><span className={styles.statusDot} /> Your code. Your direction.<span>Freecoda / preview</span></div>
        </div>
      </section>
      <section className={styles.manifesto} aria-label="Why Freecoda"><span>Good tools should be<br /><strong>within everyone’s reach.</strong></span><p>Ads help keep Freecoda free. Open source keeps the code open to inspect, improve, and make your own.</p><Link href="/pricing">How it stays free <ArrowUpRight size={16} /></Link></section>
      <section className={styles.clients} aria-labelledby="clients-title"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>MEET YOUR WORKSPACE</span><h2 id="clients-title">Same agent. Your kind of setup.</h2></div><p>Start where you’re comfortable.<br />Keep moving wherever you work.</p></div><div className={styles.clientGrid}>{clients.map(({ icon: Icon, ...client })=><Card key={client.title}><CardHeader><div className={styles.clientIcon}><Icon size={22} /></div><CardTitle>{client.title}</CardTitle><CardDescription>{client.description}</CardDescription></CardHeader><CardContent><span className={styles.clientDetail}>{client.detail}</span></CardContent><CardFooter><Link className={buttonVariants({variant:"ghost"})} href={client.href}>{client.action}<ArrowUpRight data-icon="inline-end" /></Link></CardFooter></Card>)}</div></section>
      <section id="install" className={styles.install}><div><Badge variant="outline"><Terminal data-icon="inline-start" /> THE COMMAND LINE, TOO</Badge><h2>Less setup.<br />More shipping.</h2><p>Install the CLI, open your project, and start a conversation with your code.</p><Link className={buttonVariants({variant:"link"})} href="/docs#installation">Read the installation guide <ArrowRight data-icon="inline-end" /></Link></div><div className={styles.installCommand}><Install compact /><p>Requires Node.js 22+ and npm. Follow the installer’s PATH instructions, then run <code>freecoda</code>.</p></div></section>
      <Separator />
      <section className={styles.source}><div><GitHubIcon size={27} /><h2>Open by design.</h2><p>Read the code. Share an idea. Make it better.</p></div><a className={buttonVariants({variant:"outline",size:"lg"})} href="https://github.com/elliotshohet/freecoda">Explore the source <ArrowUpRight data-icon="inline-end" /></a></section>
    </main>
  );
}
