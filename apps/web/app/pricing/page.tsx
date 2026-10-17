import Link from "next/link";
import { Check, ArrowUpRight } from "lucide-react";
export const metadata = { title: "Free forever" };
export default function Pricing() {
  return (
    <main className="page-shell" id="main">
      <div className="page-intro">
        <span className="section-kicker">One plan. More possibility.</span>
        <h1>
          Free to start.
          <br />
          Free to keep going.
        </h1>
        <p>
          Freecoda is supported by direct sponsors. No subscriptions, credit
          packs, or card required. Just a little space for the people who help
          keep it free.
        </p>
      </div>
      <article className="free-plan">
        <div>
          <span className="status-badge">The only plan</span>
          <h2>Freecoda. Free forever.</h2>
          <div className="free-price">
            $0<span>/ forever</span>
          </div>
          <p>Your next idea shouldn’t need a subscription.</p>
          <Link className="button purple" href="/docs">
            Get started <ArrowUpRight size={16} />
          </Link>
        </div>
        <ul>
          {[
            "Local coding agent and repository tools",
            "Plan, build, fix, and review",
            "Clear approval before changes and commands",
            "A daily hosted AI allowance during beta",
            "No ads inside your code or model answers",
            "No prompt or source-code ad targeting",
          ].map((f) => (
            <li key={f}>
              <Check size={15} />
              {f}
            </li>
          ))}
        </ul>
      </article>
      <div className="faq">
        <h2>A fair way to keep it free.</h2>
        <details open>
          <summary>How do sponsors support Freecoda?</summary>
          <p>
            Direct sponsors buy clearly labeled placements on the website and
            between agent turns in the terminal. Ads are separate from model
            answers and generated code. We don’t sell your code or
            conversations, or use them to target ads.
          </p>
        </details>
        <details>
          <summary>Does free mean unlimited?</summary>
          <p>
            No. Hosted AI has fair-use and capacity limits. The invite-only beta
            has a daily allowance and a shared monthly budget. Your workspace
            shows the remaining allowance and reset time. If capacity runs out,
            you can return after the reset; there is no paid upgrade.
          </p>
        </details>
        <details>
          <summary>What happens when there isn’t a sponsor?</summary>
          <p>
            We show a Freecoda announcement, not an invented advertiser. Hosted
            access stays within the beta’s funded budget, and we expand capacity
            as sponsorship grows.
          </p>
        </details>
        <details>
          <summary>Can I sponsor Freecoda?</summary>
          <p>
            Yes. <Link href="/advertise">Tell us about your business</Link> to
            ask about direct placements. Every campaign is reviewed before it
            goes live.
          </p>
        </details>
      </div>
    </main>
  );
}
