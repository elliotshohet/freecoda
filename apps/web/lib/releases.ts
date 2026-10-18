// Public npm release verified before enabling installation instructions.
export const CLI_PUBLISHED = true;
export const CLI_RELEASE_VERSION = "0.1.4";
export const CLI_INSTALL_COMMAND = `npm install --global freecoda@${CLI_RELEASE_VERSION}`;

// Public release assets and checksums verified before exposing downloads.
export const DESKTOP_PUBLISHED = true;
export const DESKTOP_RELEASE_VERSION = "0.1.3";
export const DESKTOP_RELEASE_URL = `https://github.com/elliotshohet/freecoda-releases/releases/tag/v${DESKTOP_RELEASE_VERSION}`;
const desktopAssetBase = `https://github.com/elliotshohet/freecoda-releases/releases/download/v${DESKTOP_RELEASE_VERSION}`;
export const DESKTOP_CHECKSUMS_URL = `${desktopAssetBase}/SHA256SUMS.txt`;
export const DESKTOP_DOWNLOADS = [
  {
    label: "macOS · Apple silicon",
    detail: "M1 and newer · DMG",
    filename: `Freecoda-${DESKTOP_RELEASE_VERSION}-mac-arm64.dmg`,
  },
  {
    label: "macOS · Intel",
    detail: "Intel Macs · DMG",
    filename: `Freecoda-${DESKTOP_RELEASE_VERSION}-mac-x64.dmg`,
  },
  {
    label: "Windows · x64",
    detail: "64-bit installer · EXE",
    filename: `Freecoda-${DESKTOP_RELEASE_VERSION}-win-x64.exe`,
  },
  {
    label: "Linux · AppImage",
    detail: "x86_64 · Portable app",
    filename: `Freecoda-${DESKTOP_RELEASE_VERSION}-linux-x86_64.AppImage`,
  },
  {
    label: "Linux · Debian / Ubuntu",
    detail: "amd64 · DEB package",
    filename: `Freecoda-${DESKTOP_RELEASE_VERSION}-linux-amd64.deb`,
  },
].map((asset) => ({ ...asset, href: `${desktopAssetBase}/${asset.filename}` }));
