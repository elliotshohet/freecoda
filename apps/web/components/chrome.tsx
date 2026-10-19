"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./chrome.module.css";
import { createAuthClient } from "better-auth/react";
import { GitHubSignIn } from "./github-sign-in";
import { UserAvatar } from "./user-avatar";
import { usePathname } from "next/navigation";
import { ThemeControl } from "./theme-control";
import { ArrowUpRight, Command, Menu, X } from "lucide-react";
export function Mark() {
  return (
    <span className="brand-symbol" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
const publicAuth = createAuthClient();

function PublicAccountAction() {
  const { data: session, isPending, error } = publicAuth.useSession();
  if (error) return (
    <Link className={styles.accountLink} href="/app" title="Account status unavailable. Open the app to check your session." aria-label="Check your account">
      <span>Check account</span><ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
  if (isPending) return (
    <Link className={styles.accountLink} href="/app" aria-label="Open Freecoda">
      <span>Open app</span><ArrowUpRight size={15} aria-hidden="true" />
    </Link>
  );
  if (!session?.user) return (
    <div className={styles.signIn} title="Sign in with GitHub">
      <GitHubSignIn callbackURL="/app" label="Sign in with GitHub" />
    </div>
  );
  return (
    <Link className={styles.accountLink} href="/app" aria-label={`Continue as ${session.user.name || "your account"}`}>
      <UserAvatar image={session.user.image} name={session.user.name} className={styles.avatar} />
      <span>Continue</span><ArrowUpRight size={14} aria-hidden="true" />
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navigationId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [pathname]);
  if (
    pathname === "/chat" ||
    pathname === "/settings" ||
    pathname === "/admin" ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  ) return null;
  const links = [
    { href: "https://github.com/elliotshohet/freecoda", label: "Source" },
    { href: "/download", label: "Download" },
    { href: "/#install", label: "CLI" },
    { href: "/app", label: "Web" },
    { href: "/pricing", label: "Pricing" },
    { href: "/docs", label: "Docs" },
    { href: "/advertise", label: "Advertise" },
  ];
  return (
    <header className={styles.header} onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <Link href="/" className={styles.brand} onClick={() => setOpen(false)} aria-label="Freecoda home">
        <img src="/brand/freecoda-mark.svg" alt="" width="30" height="30" />
        <span>Freecoda</span>
      </Link>
      <nav id={navigationId} className={styles.navigation} data-open={open} aria-label="Main navigation">
        {links.map(link => <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
          onClick={() => setOpen(false)}
        >{link.label}</Link>)}
      </nav>
      <div className={styles.actions}>
        <ThemeControl />
        {pathname !== "/sign-in" && <PublicAccountAction />}
        <button
          ref={toggle}
          type="button"
          className={styles.toggle}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-controls={navigationId}
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
export function Footer() {
  const pathname = usePathname();
  if (
    pathname === "/chat" ||
    pathname === "/settings" ||
    pathname === "/admin" ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  )
    return null;
  return (
    <footer className="site-footer">
      <div>
        <Link href="/" className="brand">
          <img src="/brand/freecoda-mark.svg" width="28" height="28" alt="" />
          Freecoda
        </Link>
        <p>More room for what you want to build.</p>
      </div>
      <div className="footer-links">
        <Link href="/docs">Documentation</Link>
        <a href="https://github.com/elliotshohet/freecoda">Source on GitHub</a>
        <a href="https://github.com/elliotshohet/freecoda/releases">Downloads & updates</a>
        <Link href="/advertise">Sponsor Freecoda</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/pricing">Pricing</Link>
      </div>
      <span className="footer-note">
        <Command size={13} /> Your browser. Your terminal. Your next big thing.
      </span>
    </footer>
  );
}
