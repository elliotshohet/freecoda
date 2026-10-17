# Freecoda desktop

Electron desktop application for Freecoda. Application ID: `com.freecoda.desktop`; product name: **Freecoda**; initial version: **0.1.0**. Packaging is built from this private monorepo. Hosted account access and fair-use allowances remain the same as the website.

## Build and package

From the repository root, with Bun 1.3.5 or newer and Node.js 24:

```sh
bun install --frozen-lockfile
bun run desktop:build
# Run the matching command on the target operating system.
bun run desktop:package -- --mac dmg zip --x64 --publish never
bun run desktop:package -- --mac dmg zip --arm64 --publish never
bun run desktop:package -- --win nsis --x64 --publish never
bun run desktop:package -- --linux AppImage deb --x64 --publish never
```

Packages are written to `apps/desktop/release/`. macOS x64 targets Intel Macs; arm64 targets Apple Silicon. These are separate builds, rather than a universal binary. Windows ARM64 and Linux ARM64 packages are not part of the initial matrix.

## Private CI downloads

The **Desktop packages** GitHub Actions workflow builds natively on Linux, Windows, Intel macOS, and Apple Silicon macOS. It runs for changes to desktop/shared code and can also be started with **Run workflow**. Each job validates its expected package formats and uploads a matching `SHA256SUMS.txt`.

Open the workflow run in the private repository, select its operating-system/architecture artifact, and extract the downloaded artifact ZIP. Repository access is required. Artifacts expire after fourteen days; rerun the workflow to regenerate them. The workflow has read-only repository permissions and always passes `--publish never`. It creates no GitHub Release and uploads nothing to a public download service.

| System              | Included packages   | Install                                                                                                            |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| macOS Intel         | `.dmg`, `.zip`      | Open the DMG and drag Freecoda into Applications, or extract the application ZIP.                                  |
| macOS Apple Silicon | `.dmg`, `.zip`      | Choose the arm64 artifact, then install as above.                                                                  |
| Windows x64         | NSIS `.exe`         | Run the installer and follow its prompts.                                                                          |
| Linux x64           | `.AppImage`, `.deb` | Make the AppImage executable and launch it, or install the Debian package with the distribution's package manager. |

For an AppImage, `chmod +x /path/to/Freecoda.AppImage` grants execution permission. On Debian/Ubuntu, `sudo apt install /path/to/freecoda.deb` installs the package and its declared dependencies. Linux runtime support depends on the distribution; use the DEB package when the AppImage runtime is unavailable. Do not disable Electron's sandbox to work around installation problems.

Compare the package's SHA-256 digest against `SHA256SUMS.txt` before installation. On macOS/Linux, use `shasum -a 256 /path/to/package`; on Windows, use PowerShell's `Get-FileHash -Algorithm SHA256 C:\path\to\package.exe`. A checksum verifies the downloaded bytes against the build artifact, rather than authenticating a publisher independently.

## Signing and release limits

The initial CI packages have no configured publisher certificate or Apple notarization credentials. macOS packages can be unsigned or locally/ad-hoc signed by packaging tools, and Windows installers are unsigned. Gatekeeper or SmartScreen may warn or block installation. Verify the workflow/source and checksum; follow the operating system's explicit approval flow only if you trust that build. Managed devices can require administrator approval.

Signed distribution requires Apple Developer ID signing and notarization for macOS, and an appropriate Windows code-signing certificate or signing service. Store signing credentials in the build service's secrets, never in source or the packaged application. When configured, the native workflow passes those credentials to electron-builder and requires signing to succeed. Packaging itself uses `--publish never`; the separate release workflow prepares the public draft and updater metadata. Installed Windows/AppImage update behavior is described below, while unsigned macOS builds use manual downloads. No hosted account or provider credentials are bundled in the app.

A successful packaging job establishes that installers were produced. Interactive launch, GitHub login, project access, terminal approvals, and installer/uninstaller behavior still require testing on each supported operating system before calling a release validated.

References: [electron-builder CLI](https://www.electron.build/docs/cli/), [macOS packaging](https://www.electron.build/docs/mac/), [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), and [Actions artifacts](https://github.com/actions/upload-artifact).
## Public release updates

The source repository stays private. Installers and updater metadata belong in
the separate public `elliotshohet/freecoda-releases` repository. The **Prepare
public desktop release** workflow accepts a successful Desktop packages run ID,
its full source SHA, and the matching stable desktop version. It validates all
four native artifacts and their checksums, combines both macOS architectures in
`latest-mac.yml`, and uploads only installers, blockmaps, updater metadata, and
checksums into a draft release. It never copies source files.

Configure the `desktop-release` environment and its `FREECODA_RELEASE_TOKEN`
secret: a fine-grained GitHub token restricted to **Contents: read and write**
on `elliotshohet/freecoda-releases` only. The private repository's default
`GITHUB_TOKEN` cannot publish across repositories. No credential is bundled in
the app. Review the draft assets and checksums, then publish the release to make
it visible to the public updater. Never replace an already published version.

NSIS Windows and Linux AppImage installations can use the public update feed.
Debian installations use their package manager/manual `.deb` installer. macOS
automatic installation requires a Developer ID signed app; unsigned builds
offer manual downloads. Keep `latest.yml`, `latest-linux.yml`, and the combined
`latest-mac.yml` alongside their exact referenced binaries and blockmaps.

### Activating installer signing

The native workflow supports optional signing without changing the current
unsigned release. Add repository secrets only after obtaining existing signing
credentials; no accounts or certificates are purchased by this workflow.

For both macOS architectures, configure `DESKTOP_MAC_CERTIFICATE_P12` (base64
Developer ID Application P12), `DESKTOP_MAC_CERTIFICATE_PASSWORD`,
`DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_PASSWORD` (Apple app-specific password),
and `DESKTOP_APPLE_TEAM_ID`. Electron-builder imports the certificate, signs the
app with hardened runtime, and notarizes using Apple's service. Windows uses
`DESKTOP_WINDOWS_CERTIFICATE_PFX` (base64 Authenticode PFX) and
`DESKTOP_WINDOWS_CERTIFICATE_PASSWORD`. Hardware/cloud-only Windows identities
need a separate signing integration instead of a PFX.

Partial configuration fails the build. A configured certificate enables
`forceCodeSigning`, so signing failure cannot silently produce an unsigned
release. The app's macOS Developer ID check and Windows signature verification
remain enabled. A new signed release needs a new version and fresh native
artifacts; never overwrite the current stable binaries. These credentials have
not been configured or validated yet.
