import Link from "next/link";
import styles from "./welcome-surface.module.css";

type WelcomeAction = {
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export function WelcomeIdentity() {
  return (
    <div className={styles.identity}>
      <img src="/brand/freecoda-mark.svg" width="56" height="56" alt="" />
      <span>Freecoda</span>
    </div>
  );
}

export function WelcomeSurface({
  title = "What’s on your mind?",
  description = "A question, a first draft, or something you want to build.",
  actions,
  heading = "h2",
  hint = "Start typing below, or use",
}: {
  title?: string;
  description?: string;
  actions: WelcomeAction[];
  heading?: "h1" | "h2" | "h3";
  hint?: string | null;
}) {
  const Heading = heading;
  return (
    <div className={styles.surface}>
      <WelcomeIdentity />
      <Heading className={styles.heading}>{title}</Heading>
      <p className={styles.description}>{description}</p>
      <div className={styles.actions} aria-label="Conversation starting points">
        {actions.map((action) =>
          action.href ? (
            <Link key={action.label} className={styles.action} href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.description}</span>
              <span className={styles.arrow} aria-hidden="true">→</span>
            </Link>
          ) : (
            <button
              key={action.label}
              className={styles.action}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              <strong>{action.label}</strong>
              <span>{action.description}</span>
              <span className={styles.arrow} aria-hidden="true">→</span>
            </button>
          ),
        )}
      </div>
      {hint && (
        <p className={styles.hint}>
          {hint} <kbd>/</kbd> for commands.
        </p>
      )}
    </div>
  );
}
