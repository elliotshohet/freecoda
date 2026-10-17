import Link from "next/link";
export function SponsorCard() {
  return (
    <aside className="sponsor-card" aria-label="Advertisement preview">
      <div className="sponsor-label">Advertisement · House ad</div>
      <strong>Build something worth sharing.</strong>
      <p>
        This space is reserved for a sponsor. Freecoda is showing its own demo
        ad; no advertiser is paying for this placement yet.
      </p>
      <Link href="/pricing#sponsors">How sponsorship works →</Link>
      <small>
        No ad tracking is active in this preview. Your code and prompts are not
        sent to advertisers.
      </small>
    </aside>
  );
}
