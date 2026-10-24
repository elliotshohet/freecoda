import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Header, Footer } from "@/components/chrome";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/seo";
import { GoogleAnalytics } from "@/components/google-analytics";
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Freecoda",
  title: {
    default: "Freecoda — Free, open-source AI coding agent",
    template: "%s · Freecoda",
  },
  description: SITE_DESCRIPTION,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{let p='system';try{const s=localStorage.getItem('freecoda-theme');if(s==='light'||s==='dark')p=s}catch{}const t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t})()`,
          }}
        />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        {children}
        <Footer />
        <Analytics />
        <GoogleAnalytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
