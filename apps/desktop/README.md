# Freecoda desktop

Electron desktop application for Freecoda. Application ID: `com.freecoda.desktop`; product name: **Freecoda**. Packaging is built from this monorepo. Hosted account access and fair-use allowances remain the same as the website.

## Chat and coding

Freecoda starts in Chat: a general conversation with no repository access or tools. You can start and reopen saved conversations without selecting a folder. Chat history stays in private application storage and is separate from each coding workspace's history. Sending a message shares that conversation with the selected provider.

Choose Build, Plan, or Review to work with a repository. Coding still requires selecting and trusting the folder. Returning to Chat restores the separate general conversations, hides repository tools, and resets session permission grants. Search, deletion, response copying, and clearly labeled sponsor placements remain part of the conversation interface.

## Session permissions

Type `/permissions` in the conversation composer to select **Read only**, **Default**, or **Full access**. Read only blocks file changes and shell commands. Default asks for approval before changes and commands. Full access allows both without individual prompts; shell commands run on your computer without an OS sandbox. Changing this setting clears earlier category grants. The selection is session-only and resets when switching workspaces or restarting. Plan and Review remain read-only at every permission level.

## Build and package

Fork [elliotshohet/freecoda](https://github.com/elliotshohet/freecoda) on GitHub and clone your fork, or clone the repository directly. From the repository root, with Bun 1.3.5 or newer and Node.js 24:

```sh
bun install --frozen-lockfile
bun run desktop:build
# Launch the local Electron app (connects to the production hosted service).
bun --cwd apps/desktop start
# Run the matching command on the target operating system.
bun run desktop:package -- --mac dmg zip --x64 --publish never
bun run desktop:package -- --mac dmg zip --arm64 --publish never
bun run desktop:package -- --win nsis --x64 --publish never
bun run desktop:package -- --linux AppImage deb --x64 --publish never
```

Packages are written to `apps/desktop/release/`. macOS x64 targets Intel Macs; arm64 targets Apple Silicon. These are separate builds, rather than a universal binary. Windows ARM64 and Linux ARM64 packages are not part of the initial matrix.

## CI downloads

The **Desktop packages** GitHub Actions workflow builds natively on Linux, Windows, Intel macOS, and Apple Silicon macOS. It runs for changes to desktop/shared code and can also be started with **Run workflow**. Each job validates its expected package formats and uploads a matching `SHA256SUMS.txt`.

Open the workflow run in this repository, select its operating-system/architecture artifact, and extract the downloaded artifact ZIP. GitHub may require sign-in to download Actions artifacts. Artifacts expire after fourteen days; rerun the workflow to regenerate them. The workflow has read-only repository permissions and always passes `--publish never`. It creates no GitHub Release and uploads nothing to a public download service.

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

Source, installers, updater metadata, and monitoring now share the public
[`elliotshohet/freecoda`](https://github.com/elliotshohet/freecoda) repository.
The **Prepare public desktop release** workflow accepts a successful Desktop
packages run ID, its full source SHA, and the matching stable desktop version.
It validates all four native artifacts and checksums, combines both macOS
architectures in `latest-mac.yml`, and creates a draft release in this repository.

The workflow retains the `desktop-release` environment and uses the repository's
`GITHUB_TOKEN` with `contents: write`; a cross-repository `FREECODA_RELEASE_TOKEN`
is no longer needed. Fork owners must check workflow permissions, environment
rules, repository owner/feed settings, and artifact provenance before publishing.
Review the draft assets and checksums, then publish the release. Never replace an
already published version. No release credential is bundled in the application.

Older installed builds point to the former `freecoda-releases` updater feed.
Install a new build manually from [the current releases](https://github.com/elliotshohet/freecoda/releases)
to switch feeds. Historical release assets must be copied and hash-verified before
the old repository is removed; changing source references alone does not migrate
those assets or redirect existing installed clients.

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
