import { publicPageMetadata } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { AdvertiserForm } from "@/components/advertiser-form";
import s from "@/components/product-page.module.css";

export const metadata = publicPageMetadata({
  title: "Developer Sponsorship & Advertising",
  description: "Reach developers through reviewed Freecoda sponsor placements on desktop, terminal, and web. Learn how placements work and submit a sponsorship inquiry.",
  path: "/advertise",
});

export default function Advertise() {
  return (
    <main className={s.page} id="main">
      <header className={s.hero}>
        <span className={s.eyebrow}>Advertise with Freecoda</span>
        <h1>Reach developers where ideas become projects.</h1>
        <p>Support a free coding agent with a quiet, clearly labeled placement. Your message appears alongside the work, separate from the answer.</p>
        <div className={s.actions}><a href="#inquiry">Discuss a placement <ArrowDown size={15} aria-hidden="true" /></a><Link href="/pricing">How Freecoda stays free <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
      </header>
      <figure className={s.preview}>
        <Image src="/images/freecoda-desktop-0.1.8-preview.webp" width={1480} height={950} alt="Freecoda desktop interface with a separate announcement area above the conversation composer." sizes="(max-width: 1120px) 100vw, 1040px" />
        <figcaption>Desktop interface preview. When no reviewed sponsor is available, Freecoda shows its own announcement.</figcaption>
      </figure>
      <section className={s.section} aria-labelledby="placements-title">
        <h2 id="placements-title">A place alongside the work.</h2>
        <div className={s.placements}>
          <article><h3>Desktop</h3><p>A labeled placement outside the assistant’s answer and project files.</p></article>
          <article><h3>Terminal</h3><p>A compact sponsor message between agent turns, separate from command output.</p></article>
          <article><h3>Web</h3><p>A dedicated sponsor area around supported chat and workspace interfaces.</p></article>
          <article><h3>Mobile web</h3><p>The same clear labeling in the responsive browser experience.</p></article>
        </div>
      </section>
      <section className={s.section} aria-labelledby="advertiser-questions">
        <h2 id="advertiser-questions">Clear expectations.</h2>
        <div className={s.questions}>
          <article><h3>What can a placement include?</h3><p>Your business name, headline, short description, and link. Every campaign is reviewed before it appears.</p></article>
          <article><h3>How are placements priced?</h3><p>Availability and commercial terms are agreed during review. Sending an inquiry does not purchase a campaign or start billing.</p></article>
          <article><h3>What is reported?</h3><p>Aggregate deliveries and clicks. Private conversations and source code are not used for targeting, and Freecoda does not install advertising cookies.</p></article>
          <article><h3>Does sponsorship change the answers?</h3><p>No. Sponsor copy stays outside assistant responses and generated code. There are no paid recommendations inserted into answers.</p></article>
        </div>
      </section>
      <section className={s.inquiry} id="inquiry" aria-labelledby="inquiry-title">
        <div><h2 id="inquiry-title">Let’s find a good fit.</h2><p>Tell us what you’re building, who it helps, and where you’d like to appear.</p><p>This is a reviewed sponsorship inquiry. No campaign runs and no payment is taken when you submit it.</p></div>
        <AdvertiserForm />
      </section>
    </main>
  );
}
