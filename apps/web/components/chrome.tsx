import Link from "next/link";
import { ThemeControl } from "./theme-control";
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
        <Link href="/app">Build in your browser</Link>
      </nav>
      <div className="header-actions">
        <ThemeControl />
        <Link className="header-cta" href="/app">
          Your workspace <ArrowUpRight size={15} />
        </Link>
      </div>
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
        <Command size={13} /> Your browser. Your terminal. Your next big thing.
      </span>
    </footer>
  );
}
