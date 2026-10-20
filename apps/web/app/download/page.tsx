import { publicPageMetadata } from "@/lib/seo";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { DesktopDownloads } from "@/components/desktop-downloads";

export const metadata = publicPageMetadata({
  title: "Download for macOS, Windows & Linux",
  description: "Download the Freecoda desktop beta for macOS, Windows, or Linux, with installation instructions and release checksums.",
  path: "/download",
});

export default function DownloadPage() {
  return (
    <main id="main" className="prose download-page">
      <Link className="download-back" href="/"><ArrowLeft size={15} aria-hidden="true" />Back to Freecoda</Link>
      <span className="download-eyebrow">Desktop app</span>
      <h1>Make room for your next project.</h1>
      <p className="download-intro">Freecoda for your own folders. Choose your platform, install the app, and decide what it can access.</p>
      <DesktopDownloads />
      <div className="download-other-clients">
        <Link href="/app">Use the web version <ArrowUpRight size={14} aria-hidden="true" /></Link>
        <Link href="/#install">Install the CLI <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
    </main>
  );
}
