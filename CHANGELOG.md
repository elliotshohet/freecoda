# Changelog

Desktop and CLI releases are versioned separately. Dates below are the canonical
GitHub releases' publication dates in UTC, including releases migrated into this
repository. Published headings link to release notes and downloadable artifacts. Pending entries
remain under Unreleased until publication and artifact verification are complete.

## Unreleased

### Desktop 0.1.11 — publication pending

- Add independently owned sessions, background status and approval recovery, interrupted-session restoration without replay, and repository-wide execution serialization.
- Add explicit macOS interactive shell, Codex, and Claude connections with separate-account consent and session-bound controls.
- Improve stream hydration, draft and suggestion ownership, and native preview and voice dialog ordering.
- Migration and limits: no local history migration is required. macOS interactive terminals are fixed-size plain-text sessions; Windows and Linux do not yet offer that transport. External Codex and Claude use their own sign-in and billing. Full terminal emulation and managed external-agent protocols remain incomplete. Unsigned macOS packages require manual installation; live microphone and external-agent TUI behavior remain unqualified.

### CLI 0.1.10 — publication pending

- Improve compact terminal rendering and keep approval evidence visible before accepting a choice.
- Correct first-party LICENSE ownership while retaining required upstream component notices.
- Migration and limits: no local data migration is required.

### Web — deployed

- Deploy zero-cost-only concurrency admission and apply migration 0013 to production after isolated CI integration checks. At most three verified free requests can run for one account. Nonzero and uncertain reservations retain conservative admission.

## Desktop 0.1.10 — 2026-10-20

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.10)

Source: `01951fe92530b55c6db4a59c4ed8a63218782bbd`.

All 212 curated tests, full typechecking, production builds and native smoke passed locally; matching Checks and all native package jobs passed in CI. All 16 downloaded asset bytes, SHA-256 checksums, sizes and three SHA-512 updater feeds were independently verified before publication.

- Recover composer drafts after restart, privately scoped to the account, workspace and conversation. Switching contexts and normal Quit flush pending draft writes; failed sends preserve the draft. First-turn and cloud conflict identities preserve next-message typing.
- Show pending, generating and unavailable AI suggestion feedback inline, and cancel stale suggestions when focus or context changes. Tab inserts for review without sending.
- Restore local workspace and chat history without waiting for cloud requests, reuse short-lived explorer snapshots, and offer explicit Refresh chats. Normal turns retain conflict-safe cloud reconciliation.
- Add browser-companion dictation and live voice using the selected mode, explicit folder trust and normal approvals. Stop cancels only its own turn, including requests still loading cloud history. Dictation remains editable and cannot approve actions.
- Add a grouped, expandable welcome feature guide with actual capabilities and client differences. The web splash and welcome screens also include this overview and browser voice controls; cloud coding supports editable dictation, while live web voice is in general chat.
- Limits and migration: no manual data migration is required. Voice depends on browser speech recognition/synthesis and microphone permission; browser services may process audio online. No audio starts until Start is chosen. Live microphone transcription/playback has not been qualified end to end on every platform. Builds remain unsigned and macOS installation remains manual. Installed Windows/Linux AppImage 0.1.9→0.1.10 updates passed verified replacement, renderer relaunch, close-to-tray, second-launch restoration and normal Quit. Tray-menu clicking, macOS automatic installation and DEB package-manager updates remain unqualified.

## CLI 0.1.9 — 2026-10-20

[Release](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.9)

Source: `01951fe92530b55c6db4a59c4ed8a63218782bbd`. The public archive, SHA-256 manifest, sizes and eight allowlisted package files were independently verified after successful exact-source CI.

- Discover `/voice` for browser-companion dictation and live conversation in the interactive full-screen client; `/voice stop` closes the session. Plain and noninteractive sessions explain the unsupported mode.
- Preserve typed drafts, normal action approvals, explicit project trust and mode isolation. Voice cannot answer approval prompts or dispatch slash commands. Stop/Interrupt cancels a turn even before agent startup; changing conversations ends the companion session.
- Limits and migration: no manual history migration is required. Browser speech support varies and may require online processing; recording begins only after Start is chosen in the companion. Live microphone transcription/playback has not been qualified on every platform. No separate paid audio API is introduced. The npm registry remains a separate publication channel.

## Desktop 0.1.9 — 2026-10-20

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.9)

Source: `c18c1d559bce69c14312c98376f94d1c57f44194`.

All 187 curated tests, typechecking, native smoke and packaging passed. All 16 downloaded asset bytes, SHA-256 checksums, sizes and three SHA-512 updater feeds were independently verified before publication. Fresh hosted AI generation and native Tab insertion were verified without changing saved conversation history.

- Preserve archived conversations on this device, with a brief Undo action and an Archived chats view; keep cloud deletion separate.
- Add theme-aware syntax colors to the existing file editor while preserving whitespace, native editing, approval checks, and scrolling.
- Separate local workspace folders, cloud projects, and general chat; consolidate navigation and repair plugin-manager loading and Tools visibility.
- Use a neutral composer focus treatment and contextual hosted AI draft suggestions that Tab inserts for review, without sending or executing them.
- Limits: archive status remains device-local. AI suggestions require an eligible signed-in account and use its hosted allowance. Builds remain unsigned; macOS downloads require manual installation. Installed Windows/Linux updates from 0.1.8 to 0.1.9 passed CI, including verified replacement, renderer relaunch, close-to-tray, second-launch restoration and normal Quit. Tray-menu clicking and macOS automatic installation remain unqualified.

## Desktop 0.1.8 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.8)
Source: `e0b0f3dc3052f800552038ea41123b3c8aab59a0`.

Checks and native packaging passed for Linux x64, Windows x64, Intel macOS, and Apple Silicon macOS. All 16 downloaded assets, SHA-256 checksums, sizes, and three SHA-512 updater feeds were verified before publication.

- Align the desktop with a compact navigation rail, real project and conversation controls, neutral transcript, focused composer, and separate sponsor placement. Preserve account, permission, and repository boundaries.
- Show the actual runtime version at bottom left, labeling source runs as local development; offer GitHub sign-in there when signed out and retain the account avatar at bottom right.
- Expand authenticated account settings with profile, repository access, cloud workspaces, local integrations, allowance, and connected devices, with loading and failure states.
- Closing the window now keeps the workspace in the tray or macOS menu bar. Show Freecoda restores it; Quit Freecoda (Ctrl+Q / Cmd+Q) confirms unsaved work and exits. No launch-at-login behavior is added.
- Remove the normal model picker, `/model` command, and underlying model branding while retaining background inference configuration and privacy disclosures.
- Migration and limits: choose Quit to permit a downloaded update to install. Builds are unsigned; macOS requires manual downloads while Developer ID signing/notarization are unavailable. Windows can show SmartScreen warnings. Clients 0.1.4 and older with the retired updater feed require a manual reinstall. Installed Windows/Linux updates from 0.1.7 to 0.1.8 passed CI, including replacement, relaunch, close-to-tray, second-launch restoration, and normal Quit. Tray-menu clicking itself remains unqualified.

## CLI 0.1.8 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.8)
Source: `e0b0f3dc3052f800552038ea41123b3c8aab59a0`.

The exact-source CI archive, package identity/version, public bytes, SHA-256 checksum, and size were verified. CI installed and smoke-checked the archive.

- Refine the branded session header and bordered composer, with command-discovery hints and sponsor messages separated above input.
- Remove `/model` and underlying model branding from normal help and status while preserving provider configuration, repository trust, approvals, conversation scopes, and account sync.
- Migration and limits: Node.js 22+ and npm are required. The canonical GitHub archive is published; npm registry publication remains separate. Hosted access retains beta invitation and allowance requirements.

## Web and local development — 2026-10-19

- Rebuild the public welcome page around the inspected reference frame, product headline, authentic desktop-source preview, working download/web/install entries, and source banner. Keep Freecoda branding and truthful capabilities.
- Add responsive Source, Download, CLI, Web, Pricing, Docs, and Advertise navigation, persistent theme switching, and real account state.
- Add a dedicated GitHub sign-in screen with safe app/chat return paths. Canonicalize loopback hosts before creating OAuth state to fix localhost/127.0.0.1 cookie mismatches. Fresh local and production OAuth roundtrips passed.
- Align web chat/workspace, pricing, and advertiser interfaces. Keep the free invite-only beta and reviewed sponsorship inquiries; no subscription or self-service advertising billing is introduced.
- Publish a checksum-pinned shell installer and point downloads to verified desktop/CLI 0.1.8 assets. The production endpoint and checksum-only installer check passed after deployment.
- Support optional Docker source Fast Refresh with narrow read-only mounts, separate generated-route caches, two CPU cores, and three-second polling. The Mini's active web service runs natively, preserving the existing PostgreSQL container and data.

## Desktop 0.1.7 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.7)
Source: `c8ee625bc0fbe072c6d3973faf47a4946c4e2988`.

Checks and Linux x64, Windows x64, macOS Intel, and macOS Apple Silicon native packaging passed. The 16 downloaded assets, SHA-256 checksums, sizes, and all three updater feeds were verified before publication.

- Refine the desktop sidebar, conversation transcript, composer, account settings, and plugin/MCP management with neutral surfaces and accessible icon actions.
- Group conversations under their local workspace, show repository details, and reopen previously selected folders without bypassing trust. Save outgoing conversation history before switching workspaces and retain drafts separately by conversation.
- Load account-scoped cloud workspace metadata and open the selected project in the browser. Cloud workspaces remain browser workspaces; this does not add an embedded desktop cloud runner or a separate environment manager.
- Add persistent one-click light/dark theme switching, visible Freecoda branding, a bottom-right account avatar, and active-folder file shortcuts.
- Hide model names from normal headers while preserving model selection.
- Align supported commands: saved-conversation `/resume`, fresh-conversation `/clear`, `/copy`, `/diff`, and working-directory inspection. Use `/start` for cloud compute where available. Unsupported Codex commands explain their limitations; this is not full Codex feature parity.
- Remove the manual “Sync conversations” sidebar button while retaining account conversation sync.
- Migration and limits: macOS installation remains a manual download while builds are unsigned and not notarized. Clients with the retired update feed require a manual reinstall. Cloud listing requires compatible server support and account access. Windows installers are also unsigned. Actual installed automatic updates to 0.1.7 have not been qualified.

- Shared web interfaces include matching header controls, theme switching, repository details, and consistent saved-conversation versus cloud-compute commands.

## CLI 0.1.7 — 2026-10-19

[Release](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.7)
Source: `c8ee625bc0fbe072c6d3973faf47a4946c4e2988`.

The CI-built archive, public download checksum, byte size, and packaged version were verified.

- Hide model names from normal CLI headers while retaining explicit model selection.
- Align supported conversation commands, including saved-conversation `/resume`, fresh-conversation `/clear`, `/copy`, `/diff`, and working-directory inspection. Unsupported Codex capabilities report explicit limitations instead of claiming feature parity.
- Improve plugin, MCP server, and skill inventories with accurate installed/enabled states and management commands.
- Migration and limits: existing folder trust and command approvals still apply. GitHub release archives and npm registry publication are separate; npm registry publication and actual installed automatic updates to 0.1.7 remain unqualified.

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
