import Link from "next/link";
import { ArrowUpRight, Code2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import styles from "./welcome-surface.module.css";

type WelcomeAction = { label: string; description: string; href?: string; onClick?: () => void; disabled?: boolean };

export function WelcomeIdentity() {
  return <div className={styles.identity}><img src="/brand/freecoda-mark.svg" width="40" height="40" alt="" /><span>Freecoda</span><Badge variant="secondary">Free & open source</Badge></div>;
}

export function WelcomeSurface({ title = "What will you build today?", description = "Your coding agent, from the first question to the next commit.", actions, heading = "h2", hint = "Start a conversation below, or use" }: { title?: string; description?: string; actions: WelcomeAction[]; heading?: "h1" | "h2" | "h3"; hint?: string | null }) {
  const Heading = heading;
  return <div className={styles.surface}>
    <WelcomeIdentity />
    <Heading className={styles.heading}>{title}</Heading>
    <p className={styles.description}>{description}</p>
    <div className={styles.actions} aria-label="Conversation starting points">{actions.map(action => <Card key={action.label} size="sm">
      <CardHeader><CardTitle>{action.href ? <Link href={action.href} className={styles.actionLink}>{action.label}<ArrowUpRight size={15} aria-hidden="true" /></Link> : <Button variant="ghost" className="w-full justify-between" disabled={action.disabled} onClick={action.onClick}>{action.label}<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Button>}</CardTitle></CardHeader>
      <CardContent><p className={styles.actionDescription}>{action.description}</p></CardContent>
    </Card>)}</div>
    {hint && <p className={styles.hint}>{hint} <kbd>/</kbd> for commands.</p>}
    <div className={styles.promise}><Code2 size={14} aria-hidden="true" /><span>Free to use. Open source. Supported by ads.</span></div>
  </div>;
}
