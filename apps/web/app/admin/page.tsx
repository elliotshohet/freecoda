import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { adminMetrics, adminPeriod, requireAdmin } from "@/lib/admin";
import { appUrl } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { Mark } from "@/components/chrome";
import { ArrowLeft, ChartNoAxesCombined, CircleDollarSign, Cloud, LayoutDashboard, Megaphone, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./admin.module.css";
export const metadata = { title: "Business & operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const count = (value: unknown) => Number(value || 0).toLocaleString("en-US");
const usd = (micros: unknown) => `$${(Number(micros || 0) / 1_000_000).toFixed(6)}`;
export default async function Admin({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  try { await requireAdmin(new Request(`${appUrl()}/admin`, { headers: await headers() })); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect("/?signin=required"); if (error instanceof ApiError && error.status === 403) notFound(); throw error; }
  let days: number;
  try { days = adminPeriod((await searchParams).days); } catch { notFound(); }
  const data = await adminMetrics(days);
  const impressions = data.advertising.campaigns.reduce((sum, campaign) => sum + Number(campaign.impressions), 0);
  const clicks = data.advertising.campaigns.reduce((sum, campaign) => sum + Number(campaign.clicks), 0);
  return <main id="main" className={styles.shell}>
    <aside className={styles.sidebar}>
      <Link href="/app" className={styles.brand}><Mark /><span>freecoda</span></Link>
      <div className={styles.workspace}><span className={styles.workspaceIcon}><ShieldCheck size={18} /></span><div><strong>Administration</strong><small>Private workspace</small></div></div>
      <p className={styles.navLabel}>WORKSPACE</p>
      <nav aria-label="Dashboard sections" className={styles.navigation}>
        <a href="#overview"><LayoutDashboard size={17} />Overview</a>
        <a href="#inference"><Sparkles size={17} />AI requests</a>
        <a href="#activity"><ChartNoAxesCombined size={17} />Daily activity</a>
        <a href="#cloud"><Cloud size={17} />Cloud & sync</a>
        <a href="#advertising"><Megaphone size={17} />Advertising</a>
        <a href="#costs"><CircleDollarSign size={17} />Costs & acquisition</a>
      </nav>
      <div className={styles.sidebarFooter}><ShieldCheck size={16} /><span>Aggregate metrics only<br /><small>Administrator access</small></span></div>
      <Link href="/app" className={styles.back}><ArrowLeft size={16} />Back to app</Link>
    </aside>
    <div className={styles.main}>
    <header className={styles.header}><span>Workspace <span className={styles.separator}>/</span> <strong>Overview</strong></span><div className={styles.headerActions}><Link href="/app" aria-label="Back to Freecoda app"><ArrowLeft size={14} />Back to app</Link><span className={styles.privateBadge}><ShieldCheck size={13} />Private</span></div></header>
    <div className={styles.content}>
      <div id="overview" className={styles.title}><div><p className={styles.eyebrow}>Private · administrator</p><h1>Overview</h1><p>Your business and operations, at a glance.</p></div><nav aria-label="Observation period">{[7,30,90].map(period => <Link key={period} href={`/admin?days=${period}`} aria-current={days === period ? "page" : undefined}>{period} days</Link>)}</nav></div>
      <p className={styles.period}>Observation window: {data.period.from} → {data.period.to} · UTC · <Link href={`/admin?days=${days}`}><RefreshCw size={12} />Refresh</Link></p>
      <section className={styles.metrics} aria-label="Measured activity">
        <article><span>Accounts with an AI request</span><strong>{count(data.inference.active_accounts)}</strong><small>Distinct accounts in the request ledger during this period.</small></article>
        <article><span>Recorded provider cost</span><strong>{usd(data.inference.cost_micros)}</strong><small>Settled request ledger only. Excludes infrastructure and credits.</small></article>
        <article><span>Provider cost / AI-active account</span><strong>{data.inference.costMicrosPerActiveAccount === null ? "Unavailable" : usd(data.inference.costMicrosPerActiveAccount)}</strong><small>Recorded provider cost ÷ accounts above; unavailable with unattributed requests. Not total cost per user.</small></article>
        <article><span>New accounts</span><strong>{count(data.accounts.signups)}</strong><small>{count(data.accounts.total)} accounts in total. No visitor conversion denominator.</small></article>
      </section>
      <section id="inference" className={styles.card}><h2>AI requests</h2><p>{count(data.inference.requests)} requests · {count(data.inference.settled)} settled · {count(data.inference.released)} released · {count(data.inference.unresolved)} unresolved · {count(data.inference.unattributed_requests)} unattributed requests. Operator and test activity is included.</p><p>{count(data.inference.input_tokens)} input tokens · {count(data.inference.output_tokens)} output tokens. Unresolved requests have no final cost yet.</p>
        <div className={styles.table}><table><caption>Models used in the observation window</caption><thead><tr><th>Model</th><th>Requests</th><th>Recorded cost</th><th>Unresolved</th></tr></thead><tbody>{data.models.map(row => <tr key={row.model}><td>{row.model}</td><td>{count(row.requests)}</td><td>{usd(row.cost_micros)}</td><td>{count(row.unresolved)}</td></tr>)}{!data.models.length && <tr><td colSpan={4}>No recorded requests in this period.</td></tr>}</tbody></table></div>
      </section>
      <section id="activity" className={styles.card}><h2>Daily activity</h2><div className={styles.table}><table><caption>UTC request creation dates; days without requests are omitted.</caption><thead><tr><th>Date</th><th>Requests</th><th>Accounts</th><th>Recorded provider cost</th></tr></thead><tbody>{data.daily.map(row => <tr key={row.day}><td>{row.day}</td><td>{count(row.requests)}</td><td>{count(row.accounts)}</td><td>{usd(row.cost_micros)}</td></tr>)}{!data.daily.length && <tr><td colSpan={4}>No recorded daily activity.</td></tr>}</tbody></table></div></section>
      <section id="cloud" className={styles.card}><h2>Cloud work & conversation sync</h2><p>{count(data.runs.runs)} coding runs · {count(data.runs.completed)} completed · {count(data.runs.failed)} failed · {count(data.runs.cancelled)} canceled.</p><p>{count(data.compute.settled_seconds)} settled sandbox seconds from reservations created in this period; {count(data.compute.unresolved)} unresolved reservations. This is usage, not a Vercel invoice.</p><p>{count(data.conversations.updated)} retained conversations updated in this period · {count(data.conversations.retained)} retained in total. Conversation contents and personal identifiers are not shown.</p></section>
      <section id="advertising" className={styles.card}><h2>Advertising</h2><p>Lifetime counters for up to 50 most recent campaigns: {count(impressions)} recorded impressions · {count(clicks)} recorded clicks · {impressions ? `${(clicks / impressions * 100).toFixed(2)}% recorded click-to-impression ratio` : "click-to-impression ratio unavailable"}.</p><p>{data.advertising.scope} {count(data.advertising.inquiries)} sponsor inquiries received in this observation window. House announcements do not count as paid impressions.</p><div className={styles.table}><table><caption>Recent campaigns · lifetime delivery counters</caption><thead><tr><th>Sponsor</th><th>Status</th><th>Impressions</th><th>Clicks</th></tr></thead><tbody>{data.advertising.campaigns.map(row => <tr key={row.id}><td>{row.sponsor}</td><td>{row.active ? "Enabled" : "Disabled"}</td><td>{count(row.impressions)}</td><td>{count(row.clicks)}</td></tr>)}{!data.advertising.campaigns.length && <tr><td colSpan={4}>No campaigns configured.</td></tr>}</tbody></table></div></section>
      <section id="costs" className={styles.card}><h2>Costs & acquisition still unavailable</h2><ul>{data.unavailable.map(note => <li key={note}>{note}</li>)}</ul><p>Provider ledger figures cannot establish profitability, total cost per active user, or advertiser break-even pricing. Use an actual infrastructure billing export and a matched observation period before calculating those figures.</p><a href="https://vercel.com/eshohets-projects/freecoda">Open project usage in Vercel</a></section>
    </div>
    </div>
  </main>;
}
