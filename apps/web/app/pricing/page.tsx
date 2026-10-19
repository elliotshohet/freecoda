import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import s from "@/components/product-page.module.css";

export const metadata = { title: "Pricing — Freecoda" };

export default function Pricing() {
  return (
    <main className={s.page} id="main">
      <header className={s.hero}>
        <span className={s.eyebrow}>Pricing</span>
        <h1>More room for your next idea.</h1>
        <p>One free account for desktop, web, and terminal. Supported by clearly labeled sponsors, with no subscription or card required.</p>
      </header>
      <section className={s.plan} aria-labelledby="free-plan-title">
        <div>
          <h2 id="free-plan-title">Freecoda</h2>
          <div className={s.price}>$0<span>/ forever</span></div>
          <p>Hosted access is invite-only during beta. Fair-use and capacity limits apply.</p>
          <div className={s.actions}><Link href="/app">Start with the web app <ArrowUpRight size={16} aria-hidden="true" /></Link><Link href="/download">Get desktop</Link></div>
        </div>
        <ul className={s.features}>
          {[
            "General conversations without repository access",
            "Local project tools and connected cloud workspaces",
            "Plan, build, and review with explicit permissions",
            "A daily hosted AI allowance during beta",
            "Account conversation sync across supported clients",
            "No hosted API key required",
            "No ads inside your code or assistant answers",
          ].map(feature => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}
        </ul>
      </section>
      <section className={s.section} aria-labelledby="pricing-questions">
        <h2 id="pricing-questions">A fair way to keep it free.</h2>
        <div className={s.questions}>
          <article><h3>How does usage work?</h3><p>The invite-only beta has a daily hosted allowance and a shared monthly budget. Your account shows its remaining allowance and reset time. Access can pause when capacity runs out; there is no paid upgrade.</p></article>
          <article><h3>What do sponsors support?</h3><p>Clearly labeled placements help fund the service. Sponsor messages stay separate from assistant answers and generated code. Private code and conversations are not used for ad targeting.</p></article>
          <article><h3>What happens without a sponsor?</h3><p>Freecoda shows its own announcement instead of inventing an advertiser. Hosted access stays within the beta’s funded capacity.</p></article>
          <article><h3>Can I sponsor Freecoda?</h3><p><Link href="/advertise">Tell us about your business</Link>. Inquiries are reviewed before any campaign runs or payment terms are agreed.</p></article>
        </div>
      </section>
    </main>
  );
}
