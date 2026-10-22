import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { GitHubSignIn } from "@/components/github-sign-in";
import { canonicalLocalAuthOrigin } from "@/lib/browser-session";
import { appUrl } from "@/lib/config";
import { getAuth } from "@/lib/auth";
import { safeSignInReturn, signInPath } from "@/lib/sign-in-return";
import styles from "./sign-in.module.css";

export const metadata: Metadata = {
  title: "Sign in to Freecoda",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeSignInReturn(typeof params.returnTo === "string" ? params.returnTo : undefined);
  const requestHeaders = await headers();
  const auth = getAuth();
  let user;
  let unavailable = false;
  try {
    user = (await auth?.api.getSession({ headers: requestHeaders }))?.user;
  } catch {
    unavailable = true;
  }
  if (user) redirect(returnTo);
  const canonicalOrigin = canonicalLocalAuthOrigin(requestHeaders.get("host"), appUrl());
  if (canonicalOrigin) redirect(`${canonicalOrigin}${signInPath(returnTo, unavailable)}`);
  return (
    <main id="main" className={styles.page}>
      <Link className={styles.back} href="/"><ArrowLeft size={15} aria-hidden="true" />Back to Freecoda</Link>
      <section className={styles.card} aria-labelledby="sign-in-title">
        <div className={styles.brand}><img src="/brand/freecoda-mark.svg" alt="" width="52" height="52" /><span>Freecoda</span></div>
        <h1 id="sign-in-title">Your next idea starts here.</h1>
        <p>Your free, open-source coding agent. Sign in with GitHub to start building.</p>
        {auth ? <GitHubSignIn callbackURL={returnTo} label="Sign in with GitHub" /> : <p className={styles.problem} role="status">Sign-in is not configured on this instance yet.</p>}
        {(unavailable || params.reason === "unavailable") && <div className={styles.problem} role="status">We could not verify your session. Try signing in, or <Link href={signInPath(returnTo)}>check again</Link>.</div>}
        <p className={styles.access}>Free to use, supported by ads. Signing in does not grant repository access. Hosted AI still requires a beta invitation and uses your account’s free allowance.</p>
        <nav className={styles.links} aria-label="Sign-in information">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/download">Get the desktop app <ArrowUpRight size={12} aria-hidden="true" /></Link>
        </nav>
      </section>
    </main>
  );
}
