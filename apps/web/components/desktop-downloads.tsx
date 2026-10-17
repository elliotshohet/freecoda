import { ArrowDownToLine, ArrowUpRight } from "lucide-react";
import {
  DESKTOP_CHECKSUMS_URL,
  DESKTOP_DOWNLOADS,
  DESKTOP_PUBLISHED,
  DESKTOP_RELEASE_URL,
  DESKTOP_RELEASE_VERSION,
} from "@/lib/releases";

export function DesktopDownloads() {
  if (!DESKTOP_PUBLISHED)
    return (
      <p>
        Native desktop installers are being prepared. Use the browser workspace
        with your beta invitation.
      </p>
    );
  return (
    <>
      <p>
        Freecoda desktop {DESKTOP_RELEASE_VERSION} is a public beta for local
        projects. Choose your operating system and processor below. Hosted AI
        still requires a beta invitation and has the same free allowance.
      </p>
      <div
        className="desktop-downloads"
        role="group"
        aria-label="Desktop installers"
      >
        {DESKTOP_DOWNLOADS.map((asset) => (
          <a
            key={asset.filename}
            href={asset.href}
            className="desktop-download"
          >
            <span>
              <strong>{asset.label}</strong>
              <small>{asset.detail}</small>
            </span>
            <ArrowDownToLine size={18} aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="download-verification">
        <a href={DESKTOP_CHECKSUMS_URL}>SHA-256 checksums</a>
        <span aria-hidden="true"> · </span>
        <a href={DESKTOP_RELEASE_URL}>
          Release notes <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </p>
      <p>
        These initial beta installers are unsigned. macOS builds are not
        notarized and may be blocked by Gatekeeper; Windows may show a
        SmartScreen warning. Verify the installer against the linked checksums
        before opening it.
      </p>
      <p>
        On Linux, make the AppImage executable before launching it, for example{" "}
        <code>chmod +x /path/to/Freecoda.AppImage</code>. The AppImage needs a
        FUSE 2 runtime; see the{" "}
        <a href="https://docs.appimage.org/user-guide/troubleshooting/fuse.html">
          AppImage FUSE guidance
        </a>
        . If the AppImage runtime is unavailable on Debian or Ubuntu, use the
        DEB download instead.
      </p>
      <p>
        Open a project folder and review its trust prompt before continuing.
        Freecoda asks for approval before local file changes and shell commands.
        Sign in to connect your hosted allowance, or open the browser workspace
        from the desktop app.
      </p>
      <p>
        Windows and Linux AppImage builds check for updates and download them in
        the background, then install when you close the app normally. Active
        work is not interrupted. Use the app menu to check update status. macOS
        requires manual downloads until signed, notarized releases are
        available. For Debian packages, download the newer DEB and install it
        with your package manager.
      </p>
    </>
  );
}
