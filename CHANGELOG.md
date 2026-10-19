# Changelog

Desktop and CLI releases are versioned separately. Dates below are the canonical
GitHub releases' publication dates in UTC, including releases migrated into this
repository. Each heading links to its release notes and downloadable artifacts.

## Unreleased

- Add direct recent-folder reopening, save outgoing conversation history before switching workspaces, and retain drafts separately by conversation.
- Load owner-scoped cloud workspace metadata for desktop accounts, with explicit browser handoff to the selected cloud project.
- Add persistent one-click light/dark theme buttons, visible Freecoda branding, a bottom-right account avatar, and active-folder file shortcuts.

- Refine desktop navigation, conversation layout, composer, account settings, and plugin/MCP management with a consistent neutral interface and accessible icon actions.
- Group local-folder conversations under their desktop workspace; show repository details and the current project conversation in web workspaces.
- Hide model names from normal desktop, web, and CLI headers without changing model selection.
- Align supported slash commands across clients: saved-chat `/resume`, fresh-chat `/clear`, `/copy`, `/diff`, and directory inspection. Cloud compute uses `/start`; unsupported Codex capabilities report their limitations.
- Improve CLI plugin, MCP, and skill inventories with accurate installed/enabled states and management commands.

- Remove the desktop sidebar's manual “Sync conversations” button while keeping account conversation sync working.

## Desktop 0.1.6 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.6) · Source: `aa56d79a3b461d3e899a808015b0d8fc7fd9b8fc`

- Published the desktop release using the canonical `elliotshohet/freecoda` update feed.
- Verified actual automatic installation and relaunch from 0.1.5 on Windows and Linux AppImage, including renderer security checks.
- Desktop 0.1.4 and older require one manual reinstall because they use the retired repository's feed.

## CLI 0.1.6 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.6) · Source: `ab69e1b1fbf82e4d9eca1a78ba9ff7c7ba06d6a0`

- Added checksum-verified GitHub release updates for writable global npm installations after an interactive session closes normally. Source and project-local installations remain unchanged; `FREECODA_AUTO_UPDATE=0` disables automatic installation.
- Retained general chat without repository access by default, with explicitly trusted coding modes and separate conversation histories.
- Distributed the CLI as a GitHub release archive; npm registry publication remains separate.

## Desktop 0.1.5 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.5) · Source: `f0df40e19650c52bb4533ba7278d112349658085`

- Added the free-model picker, MCP discovery, individual tool controls, and `SKILL.md` skills.
- Added recoverable queued messages, streaming Markdown, user avatars, and a normalized macOS Dock icon.
- Added shared account conversations and explicit GitHub repository sync with folder trust and permission approvals.
- Passed native runtime smoke tests and packaging on Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon.

## CLI 0.1.5 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.5) · Source: `f0df40e19650c52bb4533ba7278d112349658085`

- Added approved zero-cost Beam selection through Vercel AI Gateway.
- Added MCP discovery, tool controls, and `SKILL.md` installation.
- Added FIFO message queues with pause, retry, cancellation, and retained drafts.
- Added account conversation history and explicit GitHub repository sync with trust and approval checks.
- Passed checks on Linux, macOS, and Windows and built the archive in the matching successful native packaging workflow.

## Desktop 0.1.4 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.4) · Source: `787c432f0eef1f6c78050e64324287f3ac1f87c0`

- Added general conversation without a folder or file/shell tools, alongside explicitly trusted Build, Plan, and Review workspaces with separate histories.
- Included searchable local threads, deletion, formatted responses, response/code copying, light and dark themes, and labeled sponsor placements.
- Stored history locally; generation requests used the Freecoda service.

## Desktop 0.1.3 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.3) · Source: `063cffb8d7c144ba941529fff550820e70317151`

- Added `/permissions` with Read only, Default, and Full access presets and a visible active preset beside the composer.
- Reset session permissions when changing projects; Plan and Review stayed read only. Full access allowed local writes and shell commands without individual prompts, without an operating system sandbox.
- Included the conversation-first workspace, saved project threads, optional file/editor/terminal tools, and labeled sponsors.

## Desktop 0.1.2 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.2) · Source: `93d99d6f7a6e61a6eaaf6de9eab02277411b1686`

- Added a conversation-first workspace, saved project threads, file and diff review, and labeled sponsor placements.
- Passed packaging on all four native targets, with installer and update-feed hashes validated.

## Desktop 0.1.1 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.1) · Source: `b3f99160fe14c56c2e2b6f0e093136b6a848df89`

- Added bundled third-party license notices and aligned Windows notification identity.
- Verified installed upgrades from 0.1.0 to 0.1.1 on Windows NSIS and Linux AppImage: automatic download, normal-close installation, and relaunch.

## Desktop 0.1.0 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.0) · Source: `9fb42e72ef2e6ac75e4286eeb9da71f0b3d119f9`

- Published installers for Linux x64, Windows x64, and macOS Intel and Apple Silicon, with checksums, updater metadata, and blockmaps.
- Passed all four native packaging jobs and validation checks.

## Installation and signing notes for these releases

- Verify the release's `SHA256SUMS.txt` before installation. Checksums detect changed downloads; they do not independently authenticate the publisher.
- These macOS and Windows installers are unsigned, and macOS builds are not notarized. macOS uses manual downloads until Developer ID signing and notarization are configured; Windows may show SmartScreen warnings.
- Windows NSIS and Linux AppImage support downloaded updates installed on normal quit. Linux DEB updates use the package manager. Linux AppImage requires FUSE 2 or a distribution-supported extraction method.
