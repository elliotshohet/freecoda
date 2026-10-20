# Impeccable initialization, critique, and polish

Date: 2026-10-20. Scope: web, Electron desktop, and terminal clients. Existing identity and functionality preserved.

## Product context

User confirmed the shared audience and product brief. Each client now has PRODUCT.md and `.impeccable/config.json` with the explicitly selected code-first workflow. CLI is a terminal surface; no native-mobile platform is claimed. No DESIGN.md was invented during initialization.

## Independent baseline critique

Method: dual-agent (A: /root/design_review; B: /root/evidence_review). Assessment A completed before Assessment B findings entered synthesis. Scores are provisional source-review judgments, not measured user outcomes.

| Heuristic (each /4) | Web | Desktop | CLI |
|---|---:|---:|---:|
| System status | 3 | 3 | 3 |
| Familiar language | 3 | 3 | 3 |
| User control | 3 | 3 | 3 |
| Consistency | 3 | 3 | 3 |
| Error prevention | 3 | 3 | 3 |
| Recognition | 3 | 2 | 3 |
| Efficiency | 3 | 3 | 3 |
| Minimalism | 2 | 2 | 2 |
| Recovery | 3 | 2 | 2 |
| Help | 3 | 3 | 2 |
| Total /40 | 29 | 27 | 27 |

Freecoda-specific trust, mode, account, queue, and approval workflows give the product its identity. Existing draft preservation, explicit permission scope, and recovery affordances are strengths. Competing navigation and persistent terminal chrome create avoidable load. Sam (keyboard use) encounters weak dark focus; Jordan (first use) can miss desktop New chat; Alex (power use) loses action evidence in short terminal approvals.

## Implemented polish

- P1: Added a shared high-contrast focus token and visible disclosure focus in web and desktop; improved light secondary text contrast.
- P1: CLI approvals prioritize transcript evidence on short terminals. Category warning and choices wrap. Undersized approval screens request resizing and reject invisible acceptance; Escape still declines.
- P2: Chat header, send, and related controls have 44px interaction bounds.
- P2: Desktop New chat sits outside the closed workspace disclosure; functional secondary labels and announcement text have an 11px floor in the affected patterns.
- P2: CLI compact header/sponsor presentation recovers transcript space and respects actual terminal dimensions.

## Verification

- `bun run typecheck`: passed all workspaces.
- `bun run build`: passed CLI, desktop, and Next.js production build.
- Eight focused suites: 25 passed, 0 failed, 174 assertions. Includes real CLI PTY approval, resizing, permission, queue, desktop trust/security/workspace, and browser-chat coverage.
- Neo web QA on the Mini: live public page and signed-in app; dark/light themes; widths 390, 768, 1440 (baseline also 2748). No document horizontal overflow. Changed send and new-chat controls measured 44x44px. Keyboard focus resolved to solid RGB177/154/239 in dark mode.
- Actual source-run Electron client on the Mini, isolated QA profile: rendered screenshots in dark/light; New chat visible outside details; affected secondary label measured 11px; solid dark focus RGB177/154/239. Desktop resize API unavailable in this CDP target, so smaller native window behavior was not verified.
- Baseline detector: web one conventional blockquote false positive; desktop 24 warnings and nine advisories; CLI zero markup findings, which does not validate ANSI rendering. Final changed-target scan: 27 findings (12 tiny text, four padding, two undersized functional text, nine shadow advisories), all desktop. Fixed-height controls and later CSS overrides limit static inference; no clean-scan claim.
- Mutable browser overlay loaded successfully in temporary reviewer tab. Buffered console findings unavailable through SDK. Overlay service and reviewer tab cleaned up.

## Follow-up and limitations

Broader public navigation grouping, composer notice hierarchy, desktop session/conversation navigation, operation-specific recovery, CLI help grouping, and long-path display remain critique follow-ups. Snapshots remain open for those issues; no post-polish score was invented. Hosted inference and update installation were outside this pass. No deployment or release was performed.

## Run notes

Baseline snapshots and first-run trends stored in each client `.impeccable/critique/`; targets are app-globals-css, src-renderer-index-html, and src-ui-ts. No ignore lists existed. Temporary snapshot body files removed. Private screenshots and runtime evidence are under ignored `.data/impeccable-qa/`. Questions about scope were already answered by the user; the confirmed scope was carried into polish.

## Project agent policy

Only project AGENTS.md records the subsequent lower-usage instruction: default one main agent; Luna medium for focused fixes and Sol medium for broad coordination/integration, where selectable. Existing two workers had finished before that instruction; no additional workers were spawned. Current-thread model switching was not available through the task tools. Global instructions and memory were not edited.

## Completion

Temporary web, Electron debugging, and overlay services stopped; agent QA tabs closed. User requested `npx impeccable update`: command succeeded and reported the user-level installation already at v4.7.0, refreshing hooks in ~/.agents and ~/.github. This session used the plugin-bundled v4.3.1 instructions; its cached plugin version was not rewritten.
