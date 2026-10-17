import Link from "next/link";
import { ArrowUpRight, Command } from "lucide-react";
export function Mark() {
  return (
    <span className="brand-symbol" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
export function Header() {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <Mark />
        freecoda<span className="beta">beta</span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/pricing">Free access</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/privacy">Our promise</Link>
      </nav>
      <Link className="header-cta" href="/dashboard">
        Your workspace <ArrowUpRight size={15} />
      </Link>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Link href="/" className="brand">
          <Mark />
          freecoda
        </Link>
        <p>More room for what you want to build.</p>
      </div>
      <div className="footer-links">
        <Link href="/docs">Documentation</Link>
        <Link href="/advertise">Sponsor Freecoda</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/pricing">Free access</Link>
      </div>
      <span className="footer-note">
        <Command size={13} /> Built for the terminal. Made for you.
      </span>
    </footer>
  );
}
