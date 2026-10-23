"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./chrome.module.css";
import { createAuthClient } from "better-auth/react";
import { GitHubSignIn } from "./github-sign-in";
import { UserAvatar } from "./user-avatar";
import { usePathname } from "next/navigation";
import { ThemeControl } from "./theme-control";
import { ArrowDownToLine, ArrowUpRight, Command, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList } from "@/components/ui/navigation-menu";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

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
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1101px)");
    const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  if (
    pathname === "/chat" ||
    pathname === "/settings" ||
    pathname === "/admin" ||
    pathname === "/app" ||
    pathname.startsWith("/app/")
  ) return null;
  const links = [
    { href: "/download", label: "Desktop", isActive: pathname === "/download" },
    { href: "/docs#installation", label: "CLI", isActive: false },
    { href: "/app?view=workspace", label: "Web", isActive: false },
    { href: "/pricing", label: "Pricing", isActive: pathname === "/pricing" },
    { href: "/docs", label: "Docs", isActive: pathname === "/docs" },
    { href: "https://github.com/elliotshohet/freecoda", label: "GitHub", isActive: false },
    { href: "/advertise", label: "Advertise", isActive: pathname === "/advertise" },
  ];
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} onClick={() => setOpen(false)} aria-label="Freecoda home">
        <img src="/brand/freecoda-mark.svg" alt="" width="30" height="30" />
        <span>Freecoda</span>
      </Link>
      <div className={styles.desktopNavigation}>
        <NavigationMenu aria-label="Main navigation" viewport={false}>
          <NavigationMenuList className="m-0 p-0">
            {links.map(link => (
              <NavigationMenuItem key={link.href}>
                <NavigationMenuLink asChild active={link.isActive} className="min-h-11 justify-center">
                  <Link href={link.href} aria-current={link.isActive ? "page" : undefined}>{link.label}</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      </div>
      <div className={styles.actions}>
        <ThemeControl />
        {pathname !== "/sign-in" && <PublicAccountAction />}
        <Button asChild className={styles.downloadAction}>
          <Link href="/download">Download</Link>
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="icon" className={styles.toggle} aria-label="Open navigation">
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent className="shadcn-surface overflow-y-auto" side="right">
            <SheetHeader className="pr-14">
              <SheetTitle>Explore Freecoda</SheetTitle>
              <SheetDescription>Your assistant, wherever you work.</SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile navigation" className="flex flex-col gap-1 px-4">
              {links.map(link => (
                <SheetClose asChild key={link.href}>
                  <Button asChild variant="ghost" className="min-h-11 justify-start">
                  <Link href={link.href} aria-current={link.isActive ? "page" : undefined}>{link.label}</Link>
                  </Button>
                </SheetClose>
              ))}
            </nav>
            <SheetFooter>
              <Card>
                <CardHeader>
                  <CardTitle role="heading" aria-level={3}>Make room for your next idea.</CardTitle>
                  <CardDescription>Local folders, files, and conversations together on desktop.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <SheetClose asChild>
                    <Button asChild className="min-h-11 w-full">
                      <Link href="/download"><ArrowDownToLine data-icon="inline-start" aria-hidden="true" />Download desktop</Link>
                    </Button>
                  </SheetClose>
                </CardFooter>
              </Card>
            </SheetFooter>
          </SheetContent>
        </Sheet>
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
        <p>Free, open-source coding agent. Supported by ads.</p>
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
