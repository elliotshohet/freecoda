import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowUpRight, CircleDollarSign, Info, ShieldCheck } from "lucide-react";
import { adminMetrics, adminPeriod, requireAdmin } from "@/lib/admin";
import { appUrl } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeControl } from "@/components/theme-control";
import { AdminControls } from "./admin-controls";
import { AdminSidebar } from "./admin-sidebar";
import "./admin.css";

export const metadata = { title: "Business & operations", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const count = (value: unknown) => Number(value || 0).toLocaleString("en-US");
const usd = (micros: unknown) => `$${(Number(micros || 0) / 1_000_000).toFixed(6)}`;
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function MetricsTable({ caption, columns, rows, empty }: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: ReactNode[] }[];
  empty: string;
}) {
  return <Table>
    <TableCaption>{caption}</TableCaption>
    <TableHeader><TableRow>{columns.map(column => <TableHead key={column} scope="col">{column}</TableHead>)}</TableRow></TableHeader>
    <TableBody>
      {rows.map(row => <TableRow key={row.key}>{row.cells.map((cell, index) => <TableCell key={columns[index]}>{cell}</TableCell>)}</TableRow>)}
      {!rows.length ? <TableRow><TableCell colSpan={columns.length}>
        <Empty><EmptyHeader><EmptyTitle>{empty}</EmptyTitle><EmptyDescription>Only recorded data is shown here.</EmptyDescription></EmptyHeader></Empty>
      </TableCell></TableRow> : null}
    </TableBody>
  </Table>;
}

function MetricCard({ title, value, description, note }: { title: string; value: string; description: string; note: ReactNode }) {
  return <Card className="h-full">
    <CardHeader><CardTitle><h2>{title}</h2></CardTitle></CardHeader>
    <CardContent><p className="text-3xl font-semibold tracking-tight tabular-nums break-words">{value}</p></CardContent>
    <CardFooter className="mt-auto flex-col items-start gap-2"><p className="text-xs text-muted-foreground">{description}</p>{note}</CardFooter>
  </Card>;
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  let user;
  try { user = await requireAdmin(new Request(`${appUrl()}/admin`, { headers: await headers() })); }
  catch (error) { if (error instanceof ApiError && error.status === 401) redirect("/?signin=required"); if (error instanceof ApiError && error.status === 403) notFound(); throw error; }
  let days: number;
  try { days = adminPeriod((await searchParams).days); } catch { notFound(); }
  const data = await adminMetrics(days);
  const impressions = data.advertising.campaigns.reduce((sum, campaign) => sum + Number(campaign.impressions), 0);
  const clicks = data.advertising.campaigns.reduce((sum, campaign) => sum + Number(campaign.clicks), 0);
  return <TooltipProvider>
    <div className="admin-ui"><SidebarProvider className="bg-background">
      <AdminSidebar user={{ name: user.name, image: user.image }} />
      <SidebarInset id="main">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground">Administration</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline"><ShieldCheck data-icon="inline-start" aria-hidden="true" />Private</Badge>
            <ThemeControl />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 p-4 md:gap-8 md:p-8 xl:p-10">
          <section id="overview" aria-labelledby="overview-title" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Business & operations</p>
                <h1 id="overview-title" className="text-3xl font-semibold tracking-tight">Overview</h1>
                <p className="text-sm text-muted-foreground">Your business and operations, at a glance.</p>
              </div>
              <AdminControls days={days} />
            </div>
            <p className="text-xs text-muted-foreground" title={`${data.period.from} → ${data.period.to}`}>
              Observation window: <time dateTime={data.period.from}>{date(data.period.from)}</time> – <time dateTime={data.period.to}>{date(data.period.to)}</time> · UTC · Last refreshed <time dateTime={data.period.to}>{new Date(data.period.to).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })}</time>
            </p>
          </section>
          <section aria-label="Measured activity" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Accounts with an AI request" value={count(data.inference.active_accounts)} description="Distinct accounts in the request ledger during this period." note={<Badge variant="secondary">Request ledger</Badge>} />
            <MetricCard title="Recorded provider cost" value={usd(data.inference.cost_micros)} description="Settled request ledger only. Excludes infrastructure and credits." note={<Badge variant="secondary">Settled requests</Badge>} />
            <MetricCard title="Provider cost / AI-active account" value={data.inference.costMicrosPerActiveAccount === null ? "Unavailable" : usd(data.inference.costMicrosPerActiveAccount)} description="Recorded provider cost ÷ accounts above; unavailable with unattributed requests. Not total cost per user." note={<Badge variant="outline">{data.inference.costMicrosPerActiveAccount === null ? "Incomplete attribution" : "Provider cost only"}</Badge>} />
            <MetricCard title="New accounts" value={count(data.accounts.signups)} description={`${count(data.accounts.total)} accounts in total. No visitor conversion denominator.`} note={<Badge variant="secondary">Observation window</Badge>} />
          </section>
          <section id="inference" aria-labelledby="inference-title">
            <Card>
              <CardHeader>
                <CardTitle><h2 id="inference-title">AI requests</h2></CardTitle>
                <CardDescription>Recorded model usage in this observation window. Operator and test activity is included.</CardDescription>
                <CardAction><Badge variant="secondary">{count(data.inference.requests)} requests</Badge></CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-2" aria-label="Request outcomes">
                  <Badge variant="secondary">{count(data.inference.settled)} settled</Badge>
                  <Badge variant="outline">{count(data.inference.released)} released</Badge>
                  <Badge variant="outline">{count(data.inference.unresolved)} unresolved</Badge>
                  <Badge variant="outline">{count(data.inference.unattributed_requests)} unattributed requests</Badge>
                </div>
                <MetricsTable caption="Models used in the observation window" columns={["Model", "Requests", "Recorded cost", "Unresolved"]} rows={data.models.map(row => ({ key: row.model, cells: [row.model, count(row.requests), usd(row.cost_micros), count(row.unresolved)] }))} empty="No recorded requests in this period." />
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">{count(data.inference.input_tokens)} input tokens · {count(data.inference.output_tokens)} output tokens. Unresolved requests have no final cost yet.</p></CardFooter>
            </Card>
          </section>
          <section id="activity" aria-labelledby="activity-title">
            <Card>
              <CardHeader><CardTitle><h2 id="activity-title">Daily activity</h2></CardTitle><CardDescription>Request volume, active accounts, and recorded provider cost by day.</CardDescription></CardHeader>
              <CardContent><MetricsTable caption="UTC request creation dates; days without requests are omitted." columns={["Date", "Requests", "Accounts", "Recorded provider cost"]} rows={data.daily.map(row => ({ key: row.day, cells: [row.day, count(row.requests), count(row.accounts), usd(row.cost_micros)] }))} empty="No recorded daily activity." /></CardContent>
            </Card>
          </section>
          <section id="cloud" aria-labelledby="cloud-title">
            <Card>
              <CardHeader><CardTitle><h2 id="cloud-title">Cloud work & conversation sync</h2></CardTitle><CardDescription>Aggregate execution and retained conversation activity.</CardDescription><CardAction><Badge variant="outline">Usage only</Badge></CardAction></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Coding runs</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count(data.runs.runs)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Settled sandbox seconds</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count(data.compute.settled_seconds)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Retained conversations updated</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count(data.conversations.updated)}</dd></div>
                </dl>
                <Separator />
                <div className="flex flex-wrap gap-2" aria-label="Coding run outcomes"><Badge variant="secondary">{count(data.runs.completed)} completed</Badge><Badge variant={Number(data.runs.failed) ? "destructive" : "outline"}>{count(data.runs.failed)} failed</Badge><Badge variant="outline">{count(data.runs.cancelled)} canceled</Badge></div>
                <p className="text-sm text-muted-foreground">Sandbox seconds come from reservations created in this period; {count(data.compute.unresolved)} unresolved reservations. This is usage, not a Vercel invoice.</p>
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">{count(data.conversations.retained)} retained conversations in total. Conversation contents and personal identifiers are not shown.</p></CardFooter>
            </Card>
          </section>
          <section id="advertising" aria-labelledby="advertising-title">
            <Card>
              <CardHeader><CardTitle><h2 id="advertising-title">Advertising</h2></CardTitle><CardDescription>Lifetime counters for up to 50 most recent campaigns.</CardDescription><CardAction><Badge variant="outline">Lifetime delivery</Badge></CardAction></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Recorded impressions</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count(impressions)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Recorded clicks</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count(clicks)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Recorded click-to-impression ratio</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{impressions ? `${(clicks / impressions * 100).toFixed(2)}%` : "Unavailable"}</dd></div>
                </dl>
                <MetricsTable caption="Recent campaigns · lifetime delivery counters" columns={["Sponsor", "Status", "Impressions", "Clicks"]} rows={data.advertising.campaigns.map(row => ({ key: row.id, cells: [row.sponsor, <Badge key="status" variant={row.active ? "secondary" : "outline"}>{row.active ? "Enabled" : "Disabled"}</Badge>, count(row.impressions), count(row.clicks)] }))} empty="No campaigns configured." />
              </CardContent>
              <CardFooter><p className="text-xs text-muted-foreground">{data.advertising.scope} {count(data.advertising.inquiries)} sponsor inquiries received in this observation window. House announcements do not count as paid impressions.</p></CardFooter>
            </Card>
          </section>
          <section id="costs" aria-labelledby="costs-title">
            <Card>
              <CardHeader><CardTitle><h2 id="costs-title">Costs & acquisition still unavailable</h2></CardTitle><CardDescription>These figures require additional source data.</CardDescription><CardAction><Badge variant="outline">Unavailable</Badge></CardAction></CardHeader>
              <CardContent className="flex flex-col gap-5">
                <ul className="flex flex-col gap-3">{data.unavailable.map(note => <li key={note} className="flex items-start gap-2 text-sm text-muted-foreground"><CircleDollarSign className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{note}</li>)}</ul>
                <Alert><Info aria-hidden="true" /><AlertTitle>Recorded cost is only part of the picture</AlertTitle><AlertDescription>Provider ledger figures cannot establish profitability, total cost per active user, or advertiser break-even pricing. Use an actual infrastructure billing export and a matched observation period before calculating those figures.</AlertDescription></Alert>
              </CardContent>
              <CardFooter><Button variant="outline" nativeButton={false} render={<a href="https://vercel.com/eshohets-projects/freecoda" />} size="lg">Open project usage in Vercel<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Button></CardFooter>
            </Card>
          </section>
          <p className="text-xs text-muted-foreground">Freecoda administration · Aggregate metrics · <Link href="/app" className="underline underline-offset-4">Return to app</Link></p>
        </div>
      </SidebarInset>
    </SidebarProvider></div>
  </TooltipProvider>;
}
