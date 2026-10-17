import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Header, Footer } from "@/components/chrome";
export const metadata: Metadata = {
  metadataBase: new URL("https://freecoda.com"),
  title: {
    default: "Freecoda — Your code. Your next big thing.",
    template: "%s · Freecoda",
  },
  description:
    "A local coding agent for your next big thing. Plan, build, and review in your terminal with free daily usage, clear limits, and clearly labeled sponsor cards.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        {children}
        <Footer />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
