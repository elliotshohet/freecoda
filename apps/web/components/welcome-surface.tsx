import Link from "next/link";
import { ArrowUpRight, Code2, Lightbulb, Wrench } from "lucide-react";
import { Button } from "./ui/button";
import { BrandSplash } from "./brand-splash";
import { Spotlight } from "./spotlight";
import styles from "./welcome-surface.module.css";

type WelcomeAction = { label: string; description: string; href?: string; onClick?: () => void; disabled?: boolean };

export function WelcomeIdentity() {
  return <div className={styles.identity}><BrandSplash /></div>;
}

export function WelcomeSurface({ title = "What will you build today?", description = "A fresh thought. A tricky problem. A project you can’t stop thinking about.", actions, heading = "h2", hint = "Start a conversation below, or use" }: { title?: string; description?: string; actions: WelcomeAction[]; heading?: "h1" | "h2" | "h3"; hint?: string | null }) {
  const Heading = heading;
  const icons = [Lightbulb, Code2, Wrench];
  return <div className={styles.surface}>
    <WelcomeIdentity />
    <Heading className={styles.heading}>{title}</Heading>
    <p className={styles.description}>{description}</p>
    <div className={styles.actions} aria-label="Conversation starting points">{actions.map((action, index) => {
      const Icon = icons[index % icons.length];
      return <Spotlight key={action.label} className={styles.actionCard}>
        <Icon size={18} className={styles.actionIcon} aria-hidden="true" />
        {action.href ? <Link href={action.href} className={styles.actionLink}>{action.label}<ArrowUpRight size={15} aria-hidden="true" /></Link> : <Button variant="ghost" className={styles.actionButton} disabled={action.disabled} onClick={action.onClick}>{action.label}<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Button>}
        <p className={styles.actionDescription}>{action.description}</p>
      </Spotlight>;
    })}</div>
    {hint && <p className={styles.hint}>{hint} <kbd>/</kbd> for commands.</p>}
    <div className={styles.promise}><span />Free to use. Open source. Yours to shape.</div>
  </div>;
}
