# Freebuff product parity research

Read-only source review of the public `CodebuffAI/freebuff` repository through BrowserOS Neo. The GitHub `main` page showed commit `9690a9f71fdcc3b2a672c79ddfff3964c820a472` (short SHA `9690a9f`) while inspected. Since `main` advances, use the pinned commit links below to reproduce this snapshot. Product capabilities in README are vendor descriptions, not independent runtime verification.

## Public source and reuse boundary

The public root contains `agents/`, `cli/`, `common/`, `docs/`, `evals/`, `freebuff/`, `packages/`, `sdk/`, `scripts/tmux/`, `LICENSE`, and `NOTICE`. `packages/` contains `agent-runtime/`, `code-map/`, and `llm-providers/`. This is a useful public codebase for examining agent orchestration, code maps, providers, CLI behavior, and SDK contracts.

The README describes five products: Desktop (locally run parallel agents), CLI, Web (full-stack app building), Cloud (agents on GitHub repositories), and Chat (research/conversation). The inspected public tree has no `apps/desktop` or `apps/web` source directories. Treat Desktop/Web UI, deployment operations, hosted account entitlements, and service internals as unavailable for source reuse; the public marketing/README descriptions are not implementation evidence. Several repository commits are explicitly titled “Sync public snapshot from freebuff-private,” further indicating that the public mirror is a selected source snapshot rather than the entire product.

`LICENSE` identifies Apache License 2.0 and Freebuff, Inc. copyright (2025). Root `NOTICE` says the product includes software developed for Codebuff and identifies Codebuff copyright (2025). Apache-2.0 permits reuse subject to its conditions: retain the license and relevant attribution notices, mark modified files, and include applicable NOTICE text in distributions. It does not grant Freebuff/Codebuff trademarks or imply permission for unpublished code, bundled third-party dependencies, paid model access, account systems, or credentials. Review the exact selected files and their dependency licenses before copying anything. The project already documents its retained Codebuff indentation helper separately in [`freebuff-reuse.md`](freebuff-reuse.md); this parity inventory does not add upstream code.

## Product capability comparison

| Area | Public Freebuff reference | Freecoda today | Portable parity opportunity / boundary |
| --- | --- | --- | --- |
| Desktop parallel work | README positions Desktop around running parallel local agents. | Multiple independent desktop sessions can run, with session histories, drafts, background status and approval recovery. Same/overlapping physical roots and shared Git identities serialize work; terminal leases are exclusive. See `apps/desktop/src/desktop-session-manager.ts` and [`parity-implementation.md`](parity-implementation.md). | Improve session coordination/presentation and explicit task handoff; do not imply concurrent edits to one checkout are safe. The shared local agent now supports one bounded batch of read-only specialists. Autonomous parallel editing is not implemented; any future write-capable orchestrator must preserve per-session permissions, approval ownership, cancellation, repository leases, and account boundaries. |
| CLI | Public `cli/` implementation and README describe terminal coding. | Interactive coding client, permissions, project trust, extensions, voice companion, queues, account-synced threads and local offline history (`packages/cli/src/index.ts`). | Feature parity is already broad. Full-screen interactive terminal emulation for external agent CLIs remains limited in desktop PTY relay; CLI user interface is terminal-native. |
| Hosted web/cloud coding | README describes Web app building and shipping, plus Cloud agents against GitHub repos. | Signed-in web app supports general Ask and project work; connected GitHub repo/branch import, cloud workspace, diff review and draft PR publishing. Repository sync is explicit; merged/pulled commits carry changes across clients (`apps/web/app/app/`, `docs/repository-sync.md`). | Could improve app lifecycle preview/deployment affordances and cloud workspace continuity. Do not import unpublished service implementation or silently turn repository connection into automatic file upload. Keep consent and explicit review/publish boundaries. |
| Chat and models | README lists conversation/chat and a multi-model catalog, including paid/limited access and multimodal model claims. | Hosted inference uses the approved free-model catalog through Gateway; zero-price validation, usage allowance and reservation controls apply. General chat has no tools or repo access (`packages/core/src/agent.ts`). | Better model capability disclosure or free-model image input only when the currently approved zero-price route demonstrably supports it. Do not import paid catalog, paid fallback, billing or credentials; the Freecoda product boundary explicitly prohibits silent paid substitutions. |
| Parallel agent implementation | README advertises Fast mode that delegates work to parallel subagents and verifies results. Public `packages/agent-runtime/` is a candidate for architecture study. | The local core agent can delegate one batch of up to two read-only specialist tasks using the same approved model. Each child has five steps, twelve read-tool calls and a shared 90-second deadline. Children cannot write, run shell commands, use extensions, or delegate recursively. Native read tools are intersected with the parent's final enabled tool set. | The parent receives bounded findings and must integrate and validate them. Hosted cloud-turn delegation and parallel mutation are not implemented. Avoid transplanting a second agent engine whose templates, service calls, billing and entitlements do not match Freecoda. |
| Codebase understanding | Pinned `packages/code-map/src/parse.ts` uses `web-tree-sitter` with per-language tag queries to extract identifiers and call identifiers, calculate token scores, and build token-to-caller maps. | Core now provides a simple, bounded `repository_map` read-only tool with paths and top-level declaration names, using the existing workspace ignore, credential and symlink rules (`packages/core/src/repository-map.ts`). | The first-party map gives quick orientation without a parser runtime. A richer symbol/reference index could add parser-backed calls and relationships, but should retain explicit resource caps and existing trusted-root boundaries. |
| Terminal and external agents | Desktop marketing says local parallel agents; public README offers CLI products. | Freecoda Desktop can explicitly launch installed Codex/Claude CLI with their own sign-in, permissions and billing; terminal output is fixed-size plain text, without full-screen TUI/resize parity (`apps/desktop/src/external-agents.ts`, `interactive-terminal.ts`). | Improve PTY resize/full-screen support and lifecycle recovery in Freecoda's native adapter. Keep external identity/approval/billing distinct; never claim Freecoda approvals govern a separately launched CLI. |
| Media input | README describes image-enabled models and a paid-tier model accepting audio, video and PDF. | The documented parity review lists complete multimodal attachment submission as unimplemented. Voice support is separate and depends on platform recognition. | Start with image attachment UX only if Freecoda's approved zero-price model route supports it end-to-end. Audio/video/PDF claims depend on provider/model availability and cannot be copied as product behavior independently of paid access. |

### Pinned code-map implementation findings

The code-map package is substantially more than a file tree. `parse.ts` parses language-aware query results for identifiers and call identifiers, derives per-file token scores, constructs a token caller map, and boosts scores using external calls. `languages.ts` configures Tree-sitter WASM grammars and tag queries for TypeScript/TSX, JavaScript/JSX, Python, Java, C#, C++, Rust, Ruby and Go. The package manifest pins `web-tree-sitter` and `@vscode/tree-sitter-wasm`; this is a meaningful runtime and packaging dependency, including WASM resolution behavior.

The inspected parser sets defaults of 10,000 files, 1,000,000 bytes per source file and 500,000,000 total parsed bytes, with environment overrides for these caps. Its source reader skips files over per-file or remaining total byte limits. This is a deliberate scale-control design; it is not equivalent to Freecoda's current 120-file/512-KiB overview limits. The public map implementation reads through a supplied callback when available, while its fallback reads filesystem paths directly. A Freecoda parser integration should use the callback route backed by `Workspace.read`, never adopt a second path traversal that could bypass workspace exclusions or trusted roots.

The first-party `repository_map` deliberately does not copy or depend on this code. It uses a small declaration recognizer and returns no call graph or token ranking. That keeps the initial capability lightweight, but means nested declarations, multiline forms and parser-level references are outside its accuracy guarantees. Expand only with a bounded, locally bundled parser path and tests for ignores, symlinks, credentials, aborts and large repositories.

## Authenticated product observations

The following are live, signed-in Freebuff interface observations relayed from the parent agent, recorded as UI affordances rather than claims about backend behavior. Navigating and expanding sections exposed controls and labels; integration data loads were not exercised, and no authentication change, OAuth connection, payment, publication, or external action was submitted.

### App shell and workspace affordances

- Main navigation presents **Home**, **Sites**, **Settings**, **Earn**, and **Account**. The app shell has a 52 px rail and a 256 px project/chat sidebar, a tab strip, and controls to collapse the sidebar and toggle terminal and right-side panels.
- Chat includes split-chat controls, an attach control, and model/reasoning pickers in the composer. These observations establish visible UI, not that every attachment type or model path was exercised.
- Templates are grouped as **SaaS**, **CRM**, **Store**, **Portfolio**, **Study**, and **AI chat**.

### Settings affordances

- General settings expose an advanced mode, an option to include `AGENTS.md`, and cloud auto-archive.
- Account areas include standing, usage, billing, referrals, and offers. Provider choices show Claude Code, Codex, and API; a Developer API area is also present.
- Integration connect cards are shown for Gmail, Calendar, Drive, Slack, Notion, Linear, PostHog, Sentry, Stripe, Supabase, HubSpot, and Outlook. Their visible presence does not prove OAuth setup, working scopes, connected accounts, or actions.
- Project settings and account skills are available. Appearance controls show theme presets, custom colors, wallpaper, and import/export. Shortcuts are customizable. Archived items expose restore and delete controls; no destructive action was submitted.

## Freecoda parity work and remaining gaps

Implemented locally in this checkout:

- App navigation rail and project-sidebar collapse, retaining Freecoda branding and real account avatars.
- Conversation tabs with independent drafts, close-without-delete semantics, keyboard navigation and account-scoped session storage. Drafts and split selection survive reload in the same browser session; this is not cloud draft sync. Storage is bounded to 32 tabs and 8,000 characters per draft.
- Split conversation comparison with a secondary transcript/draft preview. Continuing in the other pane swaps focus; there is one active composer/send owner, not simultaneous web generation.
- Six starter prompt presets. A choice prepares an editable draft and opens explicit project creation when needed. It never creates a project, sends a message or runs inference automatically.
- Searchable settings, explicit system/light/dark appearance, bounded text sizing and configurable predefined keyboard shortcuts, with device persistence and cross-tab preference updates.
- Read-only repository mapping in the shared local core and hosted cloud workspace. Local mapping is bounded to 120 files/512 KiB; hosted mapping uses a 30-file limit. This is a declaration overview, not a full symbol/reference graph.
- Bounded read-only specialist delegation in the local shared core, available to CLI and desktop with tool toggles. No external agent credentials or new provider route is introduced.

Full Freebuff parity remains incomplete. Missing areas include the complete Sites publishing service, service OAuth connections and operations, multimodal submissions, account-wide skill management, archived conversation restoration, full terminal emulation, managed external-agent protocols, theme preset/customization/import/export, and hosted specialist orchestration. Paid model access, BYOK billing, subscriptions and referral rewards conflict with current Freecoda product rules and have not been introduced. No private upstream implementation or branded assets were copied.

## Verification

- Combined curated suite: **265 passed, 0 failed, 1,700 assertions across 68 files** using local fixtures. Loopback fixtures required the normal permission flow because sandboxed binds fail with `EADDRINUSE`; this was not a product failure.
- Full monorepo typecheck passed. CLI and desktop source builds passed. The web production build passed with webpack, including all 24 prerendered pages.
- Actual BrowserOS Neo QA on confirmed `Macmini8,1`: signed-in app/settings, real avatar and existing workspace list, sidebar toggle, draft tabs, split comparison/focus swaps, account-scoped reload persistence, template selection without project creation, settings filtering, theme and text-size persistence, and shortcuts for new chat/sidebar/settings.
- Responsive checks at 390px confirmed no document horizontal overflow and an accessible composer; split panes stack on mobile. Reference and local desktop screenshots were inspected.
- Next.js runtime diagnostics returned no compilation issues, configuration errors or browser session errors before the final build. A fresh page load after that build restored four draft tabs and split selection; runtime diagnostics again returned empty configuration/session error arrays, and the 1440px layout had no document overflow.
- No real specialist inference, production migration, push, deployment, purchase, OAuth connection or release was performed. Hosted cloud mapping is typechecked and covered through its bounded source-adapter tests; an actual cloud sandbox mapping turn is not qualified by these checks. CLI/desktop compilation and local-agent fixture coverage do not constitute a fresh Electron UI qualification.

## Source references

- [Pinned public repository tree](https://github.com/CodebuffAI/freebuff/tree/9690a9f71fdcc3b2a672c79ddfff3964c820a472)
- [Pinned README](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/README.md)
- [Pinned agent runtime package](https://github.com/CodebuffAI/freebuff/tree/9690a9f71fdcc3b2a672c79ddfff3964c820a472/packages/agent-runtime)
- [Pinned code map package](https://github.com/CodebuffAI/freebuff/tree/9690a9f71fdcc3b2a672c79ddfff3964c820a472/packages/code-map)
- [Pinned code map parser](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/packages/code-map/src/parse.ts)
- [Pinned code map language configuration](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/packages/code-map/src/languages.ts)
- [Pinned code map dependencies](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/packages/code-map/package.json)
- [Pinned CLI source](https://github.com/CodebuffAI/freebuff/tree/9690a9f71fdcc3b2a672c79ddfff3964c820a472/cli)
- [Pinned LICENSE](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/LICENSE)
- [Pinned NOTICE](https://github.com/CodebuffAI/freebuff/blob/9690a9f71fdcc3b2a672c79ddfff3964c820a472/NOTICE)
- [Freecoda repository sync guide](repository-sync.md)
- [Freecoda prior local parity review](parity-implementation.md)
