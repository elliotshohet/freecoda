# Freecoda desktop

A coding workspace for your own projects: edit files, plan and build with an agent, review changes, and approve local commands.

**One plan: free forever, supported by clearly labeled sponsor placements.** Hosted AI is currently invite-only and subject to daily allowance and shared capacity limits. Creating an account does not grant a beta invitation. When no paid sponsor is available, Freecoda displays its own announcement.

[Download the latest release](https://github.com/elliotshohet/freecoda-releases/releases/latest) · [Getting started](https://freecoda.com/docs#desktop) · [Browser workspace](https://freecoda.com/app)

## Downloads

The current public desktop beta is **0.1.3**. Choose the installer for your operating system and processor:

| Platform | Download |
| --- | --- |
| macOS · Apple silicon (M1 and newer) | [DMG · arm64](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/Freecoda-0.1.3-mac-arm64.dmg) |
| macOS · Intel | [DMG · x64](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/Freecoda-0.1.3-mac-x64.dmg) |
| Windows · 64-bit | [Installer · x64](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/Freecoda-0.1.3-win-x64.exe) |
| Linux · x86_64 | [AppImage](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/Freecoda-0.1.3-linux-x86_64.AppImage) |
| Debian / Ubuntu · amd64 | [DEB package](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/Freecoda-0.1.3-linux-amd64.deb) |

These installers are **unsigned beta builds**. macOS builds are not notarized and may be blocked by Gatekeeper. Windows may show a SmartScreen warning. Verify your download before opening it. Make the Linux AppImage executable before launch; it needs the FUSE 2 runtime. Use the DEB on Debian/Ubuntu when the AppImage runtime is unavailable.

### Verify a download

Compare the SHA-256 hash of your installer with the matching filename in [SHA256SUMS.txt for 0.1.3](https://github.com/elliotshohet/freecoda-releases/releases/download/v0.1.3/SHA256SUMS.txt). For later versions, use the checksum file attached to that same release.

On macOS:

```sh
shasum -a 256 /path/to/Freecoda-installer.dmg
```

On Linux:

```sh
sha256sum /path/to/Freecoda-installer.AppImage
```

On Windows PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\Freecoda-installer.exe
```

Replace the example path with the file you downloaded. The entire hash must match the entry for that exact file. Checksums detect a corrupted or mismatched download; they do not replace platform code signing.

## Start a project

1. Install and open Freecoda.
2. Choose a project folder and read the trust prompt before granting access.
3. Sign in through the browser device-approval flow to connect your invited hosted account.
4. Ask the agent to plan, review, or build. Inspect file diffs and shell commands before approving them.

Files and approved commands run on your computer as your user. Local shell commands are not an operating-system sandbox. Relevant project context is sent to the selected AI provider. See the [privacy policy](https://freecoda.com/privacy) for hosted and cloud-workspace details.

The app can also open the [browser workspace](https://freecoda.com/app), where invited users can create or import projects, run private previews, and review draft pull requests within the displayed cloud limits.

## Session permissions

Desktop 0.1.3 starts with **Default** permissions: edits and commands ask for approval. Choose **Read only** to allow reading files without edits or shell commands, or **Full access** to run edits and shell commands without asking. Plan and Review always use read-only tools. The preset lasts for the current app process; changing it clears earlier session grants. Commands run as your user, without an OS sandbox.

The published CLI 0.1.4 has the same presets through `/permissions`, with arrow-key selection or `/permissions read-only|default|full-access`. See the [CLI installation guide](https://freecoda.com/docs#installation).

## Updates

- **Windows and Linux AppImage:** installed builds check for updates and download them in the background. Save your work and close the app normally to install a downloaded update. Active work is not interrupted automatically. Check update status from the app menu.
- **macOS:** download updates manually while releases remain unsigned and unnotarized. Automatic macOS updates require properly signed releases.
- **Debian / Ubuntu:** download the newer DEB and install it with your package manager. This repository does not configure an apt repository on your computer.

Use the [latest release page](https://github.com/elliotshohet/freecoda-releases/releases/latest) for current installers and release notes.

## Bug reports and security

For non-sensitive bugs, [open a public issue](https://github.com/elliotshohet/freecoda-releases/issues/new). Include the app version, operating system, processor type, steps to reproduce, and expected versus actual behavior using a small synthetic example.

**Do not post API keys, tokens, device codes, private code, prompts, conversation history, or unredacted logs/screenshots in public issues.**

For a suspected security vulnerability, use [GitHub private vulnerability reporting](https://github.com/elliotshohet/freecoda-releases/security/advisories/new), not a public issue. See [SECURITY.md](SECURITY.md).

## Distribution and attribution

This public repository contains desktop installers, update metadata, and distribution documentation. Application development source is maintained in a separate private repository; downloading an installer does not grant repository access.

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the Apache-2.0 license and attribution, including the modified Codebuff editing helper. Its upstream [license](vendor/codebuff/LICENSE) and [notice](vendor/codebuff/NOTICE) are included here. No application source code is published in this repository.

### Supplemental notices for earlier downloads

- [Freecoda CLI 0.1.0 and 0.1.1 third-party notices](legal/CLI_0.1.0-0.1.1_THIRD_PARTY_NOTICES.txt)
- [Freecoda desktop 0.1.0 third-party notices](legal/DESKTOP_0.1.0_THIRD_PARTY_NOTICES.txt)

These supplemental documents were prepared by comparing actual published application source maps with the reviewed package notice inventory. Both CLI versions contain the same 25 bundled package name/version pairs; desktop 0.1.0 contains the same 26 pairs across macOS Intel/Apple silicon, Windows x64 and Linux x64. The desktop input installers were checked against their public release checksums before inspection.

**Earlier packages, installers, update feeds and checksums are unchanged.** These files supplement the notices for those versions; they do not imply that old artifacts were rebuilt. New builds include `THIRD_PARTY_NOTICES.txt` within the distribution. The application-bundle notices do not replace the separate notices for the Electron/Chromium runtime.
