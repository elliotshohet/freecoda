# Local execution result — October 20, 2026

Integrated session coordination, ownership-safe streaming/approvals/drafts, repository leases, explicit macOS PTY/external CLI connections, preview/voice modal ordering, and a zero-cost-only admission migration. These are local/unreleased changes; the historical comparison below is a baseline, not a current release claim. See [implementation evidence and remaining gaps](docs/parity-implementation.md) and [source reuse/license inventory](docs/freebuff-reuse.md). Root/web/desktop typechecking and the focused 51-test integration/boundary run passed; five isolated PostgreSQL integration tests also passed. Only the isolated loopback test database received the migration; no production migration, publication, production packaging or paid/external API call occurred. Full terminal emulation, managed external-agent protocols, autonomous delegation, split panes and multimodal attachment parity remain incomplete.

# Execution prompt: make FreeCoda competitive with Freebuff

**Prepared October 20, 2026 (America/Los_Angeles).** Use this entire document as a self-contained task prompt for a future coding agent. The evidence appendix is a dated starting point, not a guarantee of current behavior.

## Activation and objective

When the user explicitly asks you to execute this prompt, improve FreeCoda's desktop product against the evidenced Freebuff capabilities below. Implement coherent local changes, preserve existing work and product boundaries, and report the resulting behavior accurately. Reading, maintaining or summarizing this file does **not** authorize implementation. Creating this prompt does not resume any previously stopped implementation, Figma, app or watcher task.

Deliver a competitive **FreeCoda** experience, with its existing name, logo and identity. Focus on useful capabilities rather than copying Freebuff's appearance or claiming complete parity. Inspect and reuse suitable official Freebuff open-source code when it reduces unnecessary implementation, subject to the license and integration requirements below. Do not stop at a plan once this prompt is explicitly executed; carry authorized local work through integration, documenting genuine blockers and continuing independent work.

## Scope and operating constraints

- Primary scope: `apps/desktop`, shared agent/repository behavior in `packages/core`, and shared validation in `packages/contracts`. Change CLI/web only where a shared contract requires compatibility, or where separately authorized. Embedded desktop browser preview is in scope; a standalone browser product is not.
- Read current repository/global instructions and applicable skills before editing. Before changing `apps/web`, read its `AGENTS.md` and referenced local Next.js guidance.
- Check the working tree and active work first. Preserve all existing edits, drafts, data and user sessions. Never reset or discard unrelated changes. Prior stopped tasks remain stopped unless the new execution request specifically requires their work.
- Use coordinated **parallel subagents in the current checkout**, with explicit non-overlapping ownership. Do **not** create or use Git worktrees unless the user later requests them. Serialize shared-file, contract, database, port and integration changes. Review the combined result yourself. Product-level isolation must also fit this no-worktree constraint; prefer an appropriate separate directory/snapshot/overlay design when isolation is needed.
- No production push, deployment, release, version tag, artifact publication or production data change. Do not treat this prompt as authorization to commit or push. Keep changes local and reviewable.
- Do not run separate production build/compile/package commands, test suites or broad browser/Electron QA under the current constraints. Do not write a large new test suite as a substitute for implementation. Code inspection, static reasoning, documentation and diff review are allowed. If the execution request separately authorizes a source/dev launch, normal development-source transformation is allowed; otherwise do not launch or reload apps. Do not start Figma work.
- Acceptance criteria below describe intended outcomes. They are **not** permission to run otherwise-prohibited checks. Report each as source-reviewed, runtime-verified with exact authorized evidence, unverified, or blocked. Never call skipped checks passing. If a necessary check is prohibited, leave its result unverified and record the command/flow for a later authorized session.
- Do not expose credentials, scrape private accounts for comparison content, or send messages to third parties. Inspect credential presence without values; obtain any genuinely required account/credential choice before provider integration. Do not assume an installed agent's sign-in authorizes an unrelated API key or account.

## Inspect first and produce a concrete local plan

1. Record current HEAD, dirty paths, client versions, active task ownership and the difference between local source and recorded releases. Do not assume the appendix's versions, line numbers or observations remain current.
2. Trace existing desktop initialization, IPC/preload boundaries, workspace switching, trust, permission presets, turn queue, drafts, account history, extensions, inference routing, voice and preview. Identify working implementations and partial scaffolding before adding replacements.
3. Recheck relevant official Freebuff documentation and public source, starting with `https://freebuff.com`, its desktop view and `https://github.com/CodebuffAI/freebuff`. Prefer concrete public code over marketing claims. Separate desktop evidence from web/CLI evidence; report missing public source rather than inventing an implementation.
4. Map each prioritized gap to existing FreeCoda modules, an upstream candidate if available, expected behavior, dependency/permission risks, migration needs and permitted verification. Assign parallel workers from that map. Keep shared-file integration under a single owner.

## Reuse Freebuff's open-source code where it fits

Use the official public repository as an implementation resource, not only a visual reference. Inspect its agent runtime, orchestration, workspace management, tools, session integration and applicable UI utilities for reusable solutions. Prefer adapting compatible, maintained code or a suitable published dependency over rebuilding equivalent machinery without a reason.

For **each reused component**, do the following before copying or depending on it:

1. Pin the upstream repository, commit and exact files/package version. Confirm those files are actually published as open source. Do not assume freebuff.com, its entire desktop client, hosted website or backend is public merely because the agent framework is public. Do not extract private source, service credentials or paid functionality from a deployed app.
2. Read the applicable root and nested `LICENSE`, `NOTICE`, file headers and package/dependency terms. Resolve conflicting or outdated license labels from the actual files being reused. A README or GitHub license badge alone is insufficient. Assess compatibility with FreeCoda's existing Apache-2.0 project and distribution; leave any component with unresolved obligations out of the implementation and identify the blocker. Do not make unsupported legal assurances.
3. Preserve required copyright and license notices, retain existing third-party notices, mark modifications where required, and include necessary attribution/license text in source and distributed notices. Do not relabel upstream code as original FreeCoda code or remove its provenance. Keep runtime, packaging and updater dependencies accounted for.
4. Add a concise reuse inventory, for example `docs/freebuff-reuse.md`, with upstream commit/files, applicable license evidence, local destination, adaptations, required notices, dependencies and limitations. Record why a promising candidate was rejected when that affects the design.
5. Adapt the integration to FreeCoda's contracts and permission model. Upstream behavior must not bypass folder trust, approvals, read-only modes, account isolation, consent, cancellation, encryption, deletion semantics or the approved free-model policy. Code reuse does not authorize upstream telemetry, advertising profiles, account requirements or paid inference.

**Branding stays FreeCoda.** Preserve the existing name, logo, app identity, domains and canonical `elliotshohet/freecoda` release/updater ownership. Do not import Freebuff logos, brand graphics, wordmarks, screenshots or product copy. Preserve legally required upstream copyright/attribution even when it mentions Freebuff or Codebuff; legal notices are distinct from product branding. Do not import an upstream visual asset unless separately authorized and appropriately licensed. Rewrite user-facing feature descriptions truthfully for FreeCoda.

If the relevant upstream desktop implementation is not public or is unsuitable, document that fact and implement the smallest maintainable FreeCoda-native solution using its existing modules. Do not copy an entire upstream stack merely to reuse one component.

## Implementation phases and priorities

### Phase 0 — preserve boundaries and finish the current local foundation

Build on the existing local changes rather than discarding them. Keep the actual desktop main-screen layout, FreeCoda branding, workspace actions, recent conversations, account avatar and compact one-line sponsor placement. Preserve reversible archive/Undo; a removed sidebar navigation entry must not delete archived data or make restoration impossible.

Complete workspace switching so opening multiple folders, selecting another folder and returning restores the correct conversation and editable draft. Close the actions dropdown after selection. Keep General Chat free of implicit repository access. Do not interrupt an active task or lose dirty editor content when navigating.

Harden the current suggestion, voice and preview implementations before describing them as complete. Suggestions should be prepared from the allowed current workspace/conversation context before acceptance; Tab inserts editable text only, never sends or executes. Cancel stale results across context/account changes. Respect account access, inference limits and privacy disclosures; do not add unnecessary file reads to prefetch.

Keep a single composer voice entry to the right of Send with dictation/live choices inside desktop. Dictation changes the draft; live voice follows normal turn and tool approvals. Electron speech recognition may be unsupported. Detect and explain that state; do not call a panel a working microphone feature or silently open an external browser. Do not add a paid speech dependency without authorization.

Keep Code/Preview navigation coherent. Preview pages are untrusted HTTP(S) content in an isolated renderer, with no privileged app preload or credentials. They must not obscure approvals or settings dialogs. Preserve browser navigation controls and make load/permission failures explicit. A preview is not an AI browser automation engine.

### Phase 1 — real multi-session and parallel agent execution

This is the main functional competitiveness gap. Reuse suitable public upstream orchestration where practical. Replace the single-global-run limitation with explicit session/run identities, per-session cancellation, progress and scoped tool/approval ownership.

Allow independent work to run concurrently without racing shared files or leaking context. Distinguish separate project roots, simultaneous chats, and concurrent edits to the same repository. Same-repository writes need real isolation or explicit serialization/conflict handling. Multiple folder entries, a split layout, or launching two uncoordinated loops is not sufficient. Use no Git worktrees under the current preference. Neither a separate directory nor a worktree would constitute an OS sandbox; describe the actual protection accurately.

Provide desktop visibility into running/queued/completed/failed/cancelled sessions. Scope notifications, stream events and approvals to their originating session. Keep drafts editable while work runs. If crash/restart recovery cannot safely resume execution, recover records as interrupted and require an explicit resume instead of replaying writes or commands.

### Phase 2 — integrated external agents and a useful workbench

Inspect official public integration code for locally installed Claude Code/Codex. Add an adapter boundary only where actual process/protocol support and permission semantics are understood. Detect availability, obtain explicit account/connection selection, preserve the external agent's own terms and credentials, and distinguish its sessions/costs from FreeCoda-hosted inference. Do not silently install an agent, export credentials or substitute accounts/models. If this requires an unavailable user decision, mark that track blocked and continue others.

Improve the workbench around actual workflows: navigable session tabs/splits, files/diffs/output and preview. Prioritize a real interactive PTY terminal over merely relabeling the current command-output panel if a suitable compatible implementation fits. Keep terminal sessions scoped to folders and lifecycles. An interactive shell runs with the user's privileges; show that boundary clearly.

Add attachment/multimodal handling only when the selected approved route actually supports it. Validate file types, sizes, consent, retention and supported client behavior; disable unsupported inputs with an explanation. An attachment icon or generic message schema is not a completed upload/inference path.

### Phase 3 — models, extensions and product quality within FreeCoda's policy

Freebuff's wider catalog is evidence of a product difference, not permission to copy its paid offerings. Preserve approved zero-price validation and visible failure when no approved free model is available. Never fall back to a paid model. If more verified free routes are supported, introduce shared validated catalog/capability contracts and truthful availability feedback. Do not expose dormant paid/BYOK configuration as consumer access without an explicit product and credential decision. Keep connected external-agent billing visibly separate.

Preserve installed MCP/skill/plugin trust and execution permissions on every affected client. Do not equate instruction skills with executable agent templates. Reuse upstream registry/orchestration patterns only with explicit trust/provenance and compatible installation semantics.

Keep sponsor placement separate from assistant output. Preserve the single-line footer ad between account identity and app version, with ellipsis plus accessible full text. Do not import upstream ad targeting, prompt/typing telemetry or privacy terms. Use actual configured campaigns and the existing house fallback.

### Phase 4 — integrate, document and hand off locally

Integrate worker changes deliberately, review the final combined diff and account for every shared contract/API change. Preserve compatibility for existing accounts, trusted folders, threads, encrypted sync records, drafts and plugin settings. Make any migration explicit, bounded and recoverable; never delete old records merely to simplify a new schema.

Update this document's status matrix and implementation notes to reflect actual code and evidence. Keep local/unreleased features visibly separate from release claims. Update user-facing documentation and an explicitly labeled Unreleased changelog section where appropriate; do not invent a release, bump versions to imply publication, or alter historical release evidence.

Do not deploy or start prohibited validation. Return a concise explanation of what changed, where upstream code was reused, what remains incomplete, and exactly which verification was skipped or authorized and performed.

## Acceptance criteria and evidence requirements

Use this checklist as a completion contract, recording an honest evidence status for every item:

- FreeCoda name, logo and canonical repository/updater identity remain intact; no Freebuff brand assets or private implementation code are imported.
- Each reused component has a pinned public origin, verified applicable license, preserved required notices, adaptation record and accounted-for dependencies.
- Switching folders restores the correct history/draft and closes its menu, without implicit trust or lost unsaved work; General Chat cannot gain repository tools through switching or concurrency.
- Multiple independent sessions have distinct state, progress, cancellation and approval ownership; same-repository concurrent edits are isolated or serialized with explicit conflicts. No Git worktrees are introduced.
- A denied approval is not retried through another session, tool or subagent. Plan/Review stay read-only across orchestration and extensions.
- Stale inference, voice transcripts, suggestion results and tool events cannot land in a different account, workspace or conversation. Cancelling one session does not cancel an unrelated one.
- Tab inserts only a prepared editable suggestion. No acceptance path submits, runs a slash command or executes a tool automatically.
- Voice availability is real and explicit; dictation/live behavior, microphone/recording state and Stop ownership are correctly scoped. Unsupported or unverified speech is labeled accordingly.
- Preview content receives no privileged bridge, cannot cover approval dialogs, and has working-by-design navigation/error/close lifecycle; actual runtime behavior remains unverified unless authorized evidence establishes it.
- External-agent connections disclose the provider/account/cost boundary and do not bypass FreeCoda consent or expose credentials. Missing binaries/authentication produce actionable status.
- PTY, attachments, splits and wider catalogs are marked complete only when their full data/lifecycle path is implemented; unsupported capabilities are disabled or clearly labeled.
- No paid hosted fallback, upstream ad profiling, unintended cloud upload, account data leak or changed deletion semantics is introduced.
- Existing CLI/web contracts remain compatible or changes are explicitly documented. No production publication or unauthorized validation occurs.

Required handoff artifacts: local implementation; an updated parity matrix; upstream reuse/attribution inventory and required notices; migration and limitation notes; a list of source-reviewed acceptance items; exact authorized runtime/check evidence if any; and a concise deferred verification plan. Describe blocked/skipped work plainly. **Do not claim full Freebuff parity or production readiness from code presence, a successful dev transform, a design mockup or documentation alone.**

---

## Evidence appendix: FreeCoda vs Freebuff desktop parity

**As of October 20, 2026 (America/Los_Angeles).** This compares the local FreeCoda checkout with official Freebuff sources inspected on this date. It is a source and documentation review, not a runtime qualification or a claim of complete feature parity.

## Main finding

FreeCoda has the main pieces of a desktop chat and coding client: trusted local folders, editing, approved commands, saved conversations, account sync, extensions, and hosted inference. The largest documented gaps against Freebuff are parallel local agents with workspace isolation, connected Claude Code/Codex agents, and a broad user-selectable model catalog. Similar sidebar and composer layouts do not close those gaps.

Some differences are deliberate product choices. FreeCoda enforces an approved zero-price hosted route, has no paid user upgrade, and separates sponsor selection from private conversation content. Freebuff documents a broader model and access system. Its current site also advertises a paid upgrade, despite older or broader free-access wording in its README. See the source qualifications below.

## What the status labels mean

- **Implemented in source:** a concrete implementation exists. This does not mean it was exercised successfully during this review or shipped in a download.
- **Partial / unverified:** implementation exists, but an important capability, integration, release, or end-to-end result is not established.
- **Missing in inspected source:** no matching first-party implementation was found in the reviewed client/core paths. An extension or shell command could add something, but that is not built-in parity.
- **Not established for Freebuff:** inspected official evidence does not support a conclusion. This does not mean Freebuff lacks the feature.

FreeCoda baseline: Git HEAD `3438f28362bb2945f9cce93a65d9348016c1861b`, **plus existing uncommitted changes** in this checkout. Desktop package version is `0.1.10`; CLI package version is `0.1.9`. A package version does not identify all working-tree changes.

[CHANGELOG.md](CHANGELOG.md) records Desktop 0.1.10 at source `01951fe92530b55c6db4a59c4ed8a63218782bbd` and links its [canonical release](https://github.com/elliotshohet/freecoda/releases/tag/v0.1.10). Its publication and validation statements are repository records, not fresh checks performed for this report. Current uncommitted desktop changes must not be assumed present in that release. The changelog's “No pending client feature releases” entry does not describe these later local edits.

## Desktop feature matrix

Freebuff entries describe official documentation unless marked “web UI observed.” They are not independent tests of its desktop binary. Evidence keys link to the source register below.

| Capability | FreeCoda local source | Freebuff official evidence | Practical parity assessment |
| --- | --- | --- | --- |
| Desktop on macOS, Windows, Linux | **Implemented in source:** Electron client and native release workflows. Recorded targets are macOS Intel/ARM64, Windows x64 and Linux x64. [C1, C9] | Desktop download UI lists Mac Intel/ARM64, Windows x64/ARM64/older PCs, Linux DEB and AppImage x64/ARM64. [F2] | Both offer desktop clients; Freebuff advertises more architecture/package variants. No installer was run here. |
| Open local folders and keep project context | **Implemented in source:** explicit folder selection/trust, separate coding history, current-folder files and tools. [C2] | Desktop onboarding says sign in, open a folder, start a chat; local files and commands are advertised. [F2] | Broad workflow overlap; behavior was not compared end to end. |
| Multiple open workspaces | **Partial / unverified:** current local edits persist up to 50 open roots separately from 12 recent roots, and restore scoped conversations. One workspace is active at a time. [C2, C3] | Parallel local work in isolated workspaces is documented. [F1] | Switching saved folders is not equivalent to concurrent isolated work. New persistence/UI changes are local, not established as released. |
| Parallel agents and isolated concurrent edits | **Missing in inspected source:** desktop rejects a new task while `activeController` is present; core constructs one `ToolLoopAgent` per run. No first-party subagent/worktree orchestration was found. [C2, C4] | Specialized agents and parallel local work are documented. [F1, F3] | Major functional gap. Repository instructions asking development assistants to delegate do not add orchestration to the FreeCoda product. |
| Connected Claude Code / Codex agents | **Missing in inspected source:** no desktop adapter or account bridge for running those installed agents. [C2, C4] | Desktop can use locally installed Claude Code and Codex with existing provider accounts. [F1] | Major integration gap; a user invoking a CLI through the shell is not an integrated agent session. |
| General chat without project access | **Implemented in source:** chat mode omits repository tools and keeps history separate from coding mode. [C2, C4] | A separate Chat product is documented. [F1] | Both cover general chat. Identical permission boundaries in Freebuff desktop were not established. |
| Build, Plan, Review and approvals | **Implemented in source:** read-only Plan/Review omit file writes and shell tools; coding actions respect permission presets and approvals. [C2, C4] | Agent/tool trust controls are documented; inspected material is principally runtime/CLI documentation. [F3] | Do not claim matching desktop approval semantics or menu choices. |
| Local code editing | **Implemented in source:** text-file explorer/editor, highlighting, saving with external-change checks, and diff/status workflows. [C2, C3] | Desktop advertises local-file work and app building. [F2] | Basic overlap; a full IDE, debugger or language-server parity claim is unsupported. |
| Local terminal | **Partial:** shell-command entry and streamed output exist. Commands use pipes, not an interactive PTY terminal. [C3, C4] | Bottom-terminal control observed on the official web app; exact desktop terminal behavior was not established. [F4] | FreeCoda's command panel should not be labeled a complete interactive terminal. |
| Browser preview inside desktop | **Partial / unverified:** new local Code/Preview controls embed an HTTP(S) page with back/forward/reload in an isolated `WebContentsView`. [C3, C5] | Browser-use and hosted preview capabilities are documented across products. [F1] | FreeCoda preview is local implementation, not a released or qualified flow. Viewing a page does not make it an AI browser automation tool. |
| AI-driven browser research/testing | **Missing as a built-in local core tool:** reviewed tools cover files, search, writes and shell; installed external tools can extend them. [C4] | Browser research/testing is documented as a capability, without proving its availability in every client. [F1] | Do not infer equivalent automation from the embedded preview. |
| Saved conversations, drafts, search | **Implemented in source:** account/workspace/thread-scoped drafts, history search, offline copies and conflict-aware account synchronization. [C2, C3, C6] | Project/chat lists and chat search observed in the web UI. [F4] | FreeCoda coverage is substantial; matching Freebuff desktop offline/conflict semantics is not established. |
| Archive and Undo | **Implemented in source:** local reversible archive, restore and Undo; archive access is in settings in current local UI. [C2, C3] | Exact archive/Undo behavior not established from inspected official evidence. | Preserve FreeCoda's behavior; there is no supported claim that Freebuff is missing it. |
| Split chat and multiple active chat panes | **Missing in inspected desktop UI:** one agent pane; saved-thread navigation is sequential. [C3] | Split-chat and tab controls observed in the official web UI. [F4] | Web observation does not prove desktop behavior, but FreeCoda has no matching desktop pane system in reviewed source. |
| Precomputed Tab suggestions | **Partial / unverified:** local changes prepare context-based suggestions before textarea focus, reuse pending/ready results, and allow Tab insertion only into the editable draft. Availability requires sign-in/service capacity. [C2, C3] | Equivalent desktop Tab-completion behavior not established. | Do not present requested interaction or code presence as proven successful generation. Tab acceptance is explicitly not send/execute. |
| Dictation and live voice in desktop | **Partial / unverified:** local changes embed the speech companion inside Electron; dictation edits a draft and live voice uses normal turns/approvals. Electron speech recognition and actual microphone transcription/playback remain unqualified. [C2, C5] | Equivalent voice behavior not established. | An embedded panel is not proof of working speech. Recorded 0.1.10 release notes describe an external browser companion, not the current in-app change. |
| Skills, MCP, plugins | **Implemented in source:** reviewed installation, skill reading, MCP discovery, enablement and tool choices; tool use remains permission-bound. [C2, C4] | Agent templates, MCP configuration and executable-agent publisher/repository trust are documented. [F3] | Overlapping extension concepts; Freebuff executable agent templates/SDK are broader than FreeCoda instruction skills. Do not assume manifest compatibility. |
| User-selectable model catalog | **Intentionally limited:** desktop's verified model filter requires the approved `reflection/beam-free` route with zero input/output price. Normal model picker/branding is hidden. [C2, C7] | A multi-provider catalog and model picker are documented; availability varies by access tier. [F1, F4] | Major difference. FreeCoda's dormant/configuration-level provider options are not a comparable end-user catalog. |
| Images and other attachments | **Missing from inspected desktop composer:** its run input is a text prompt; no equivalent attachment picker was found. [C3] | Attach-files UI observed on the web; README documents image-capable models and a paid model accepting audio/video/PDF. [F1, F4] | No established desktop multimodal parity; model capability alone is not proof that every client accepts each format. |
| Ads and funding | **Implemented in source:** separately labeled placements, house fallback, aggregate impression/click handling. New one-line footer placement is local. [C2, C3, C8] | Text ads support included access; current web UI also advertises a paid upgrade. [F1, F4] | Funding and placement resemble each other, but pricing and targeting policies differ. |
| Updates and install trust | **Partial:** updater exists; records describe Windows/Linux AppImage installed updates. macOS automatic installation is limited by unsigned/not-notarized builds and remains manual. [C9] | Official downloads are offered. [F2] | Freebuff signing/notarization and updater reliability were not independently inspected; no superiority claim is made. |

## Pricing, privacy and execution boundaries

**Free access is not the same offer.** FreeCoda's pricing source describes one sponsor-funded plan, invited hosted access, daily allowance and shared capacity limits, with no paid upgrade. Its hosted availability is still dependent on server configuration and account eligibility. [C7] Freebuff's README describes free access, earned usage and regional/tier limits. Its current official web UI also presents a Starter upgrade. The visible upgrade offered an introductory first-month price followed by a monthly price; eligibility and checkout were not investigated. Treat the README's no-subscription wording as incomplete for the current product, not evidence that upgrades do not exist. [F1, F4]

**Neither should be called offline or guaranteed no-training.** FreeCoda sends relevant context through its hosted gateway. The provider-training flag is honored by gateway options, and the local privacy source explicitly warns that the configured hosted route can retain/train on submitted content. FreeCoda's own policy says it does not sell conversations/code or use them for ad targeting. Those are stated policies and inspected implementation choices, not an independent privacy audit. [C7, C8]

**Freebuff's displayed policy needs a date qualification.** The policy inspected was updated October 18 and says it becomes effective **November 12, 2026**, after this report's date. It describes personalized advertising signals, model/feature-specific training notices and connected-repository evaluation. These are disclosures in a forthcoming displayed policy, not proof that every practice is active on October 20. The README also discusses data-use notices. No earlier effective policy was reconstructed. [F1, F5]

**Folder trust is not an OS sandbox.** FreeCoda limits repository file operations and gates writes/commands, but approved shell commands still run as the user's account. Its shell implementation explicitly says it is not an OS sandbox. Freebuff's runtime documentation similarly distinguishes trust from isolation for executable agent code. Do not describe either entire local agent system as sandboxed merely because its UI or a preview renderer uses an Electron sandbox. [C4, F3]

## Other product surfaces

| Surface | FreeCoda evidence | Freebuff evidence | Scope of the difference |
| --- | --- | --- | --- |
| CLI | [packages/cli](packages/cli), including local permissions, threads, queue, configuration and updates; source version 0.1.9. CLI configuration also contains optional direct-provider settings. | Published CLI installation and terminal workflow are documented. [F1] | Both have a CLI; this report does not establish command-by-command parity or current npm publication for FreeCoda. |
| Browser chat | [README.md](README.md), [apps/web/app/app](apps/web/app/app), [apps/web/app/chat](apps/web/app/chat). Authenticated chat/project UI, account history and hosted inference exist in source. | Chat/web app visible; tabs, project navigation and model/attachment controls observed. [F4] | A desktop preview is not a separate browser product. No FreeCoda live website behavior was tested here. |
| Hosted coding and repositories | [apps/web/lib/cloud/service.ts](apps/web/lib/cloud/service.ts), [sandbox.ts](apps/web/lib/cloud/sandbox.ts), [github.ts](apps/web/lib/cloud/github.ts): consent, sandbox lifecycle, preview, source edits and reviewed branch/draft-PR publication. | Web/Cloud hosted environments, GitHub repository work and deployment workflows are documented. [F1] | FreeCoda has concrete backend implementation; configured/live operation was not rechecked. Desktop cloud entries open the browser rather than host a native cloud runner. |
| Custom-agent SDK | No comparable public custom-agent SDK/registry found in the reviewed FreeCoda package structure. | Codebuff framework and SDK are documented. [F1, F3] | A reusable core package is not the same as an extensible, published agent platform. |

## What would close the largest gaps

These findings inform the prioritized execution phases above; they do not establish working or released behavior:

1. Add real parallel desktop run orchestration and isolation if that is a desired product direction; multiple folder bookmarks alone do not meet it.
2. Decide whether connected external agents belong in FreeCoda's product and permission model.
3. Decide whether broad model selection is compatible with the strict zero-price requirement. Paid fallback must not be introduced under the label of parity.
4. Qualify the local voice, preview, suggestion and workspace changes before describing them as working or released; use a new release process if publication is later requested.
5. Define any desired PTY, attachment and split-pane experience explicitly rather than claiming those capabilities from adjacent controls.

## Source register and review limits

### FreeCoda code pointers

- **C1:** [apps/desktop/package.json](apps/desktop/package.json), [.github/workflows/desktop-release.yml](.github/workflows/desktop-release.yml), [CHANGELOG.md](CHANGELOG.md).
- **C2:** [apps/desktop/src/local-agent.ts](apps/desktop/src/local-agent.ts): `getState`, `selectWorkspace`, `trustWorkspace`, `runAgent`, `startVoice`, `suggestPrompt`, `syncConversations`, `setThreadArchived`, sponsor methods. Particularly lines 548, 615, 952, 1048, 1100, 1263 and 1483 in the reviewed working tree.
- **C3:** [renderer/index.html](apps/desktop/src/renderer/index.html), [renderer/index.ts](apps/desktop/src/renderer/index.ts), [composer-suggestions.ts](apps/desktop/src/renderer/composer-suggestions.ts), [composer-drafts.ts](apps/desktop/src/composer-drafts.ts), [shared.ts](apps/desktop/src/shared.ts).
- **C4:** [packages/core/src/agent.ts](packages/core/src/agent.ts) (`runAgent`, repository tools, single `ToolLoopAgent`), [shell.ts](packages/core/src/shell.ts), [workspace.ts](packages/core/src/workspace.ts), [extensions.ts](packages/core/src/extensions.ts), [extensions-local.ts](packages/core/src/extensions-local.ts).
- **C5:** [voice-panel.ts](apps/desktop/src/voice-panel.ts), [voice-bridge.ts](packages/core/src/voice-bridge.ts), [preview-panel.ts](apps/desktop/src/preview-panel.ts), [preview-security.ts](apps/desktop/src/preview-security.ts), [main.ts](apps/desktop/src/main.ts).
- **C6:** [apps/web/lib/conversations.ts](apps/web/lib/conversations.ts), [apps/web/lib/cloud/crypto.ts](apps/web/lib/cloud/crypto.ts), desktop history methods in C2.
- **C7:** [apps/web/lib/usage.ts](apps/web/lib/usage.ts), [free-model-selector.ts](apps/web/lib/free-model-selector.ts), [hosted-provider.ts](apps/web/lib/hosted-provider.ts), [pricing/page.tsx](apps/web/app/pricing/page.tsx). Server-side provider support is configuration capability, not proof of a current paid consumer route.
- **C8:** [privacy/page.tsx](apps/web/app/privacy/page.tsx), C2 sponsor methods, and current footer CSS in [styles.css](apps/desktop/src/renderer/styles.css).
- **C9:** [updater.ts](apps/desktop/src/updater.ts), unsigned-macOS handling in [main.ts](apps/desktop/src/main.ts), release limitations in [CHANGELOG.md](CHANGELOG.md).

### Freebuff official sources

- **F1:** [Official repository README](https://github.com/CodebuffAI/freebuff/blob/553796b69f2c1567cfce5f06ccd63051f8feb432/README.md), captured repository HEAD `553796b69f2c1567cfce5f06ccd63051f8feb432`. Covers products, models, access, agents, connected desktop agents and framework/SDK.
- **F2:** [Desktop entry](https://freebuff.com/desktop). In the signed-in browser this initially redirected to the home app; clicking its Desktop app link opened [the desktop download view](https://freebuff.com/?product=desktop), which was read. No download or installation was performed.
- **F3:** [Official Agents and Tools documentation](https://github.com/CodebuffAI/freebuff/blob/553796b69f2c1567cfce5f06ccd63051f8feb432/docs/agents-and-tools.md). Runtime/CLI details are not automatically desktop guarantees.
- **F4:** [Official live app](https://freebuff.com/), read-only navigation inspection on the report date. UI controls and upgrade messaging were observed; no prompt was submitted, project created or purchase initiated. Personal conversation names are excluded from this report.
- **F5:** [Displayed privacy policy](https://freebuff.com/privacy-policy), updated October 18, 2026, explicitly effective November 12, 2026.

The requested standalone [FAQ route](https://freebuff.com/faq) returned “Page not found.” The product subdirectory's [README](https://github.com/CodebuffAI/freebuff/blob/main/freebuff/README.md) directs FAQ/product information to the root README as its maintained source. Its older wording was not used to override the newer root catalog or observed upgrade UI.

No FreeCoda app changes, launches, builds, test suites, UI QA, Figma work, deployment, publishing or subagent work were performed for this report. Existing implementation changes were only read. No Freebuff desktop binary was installed or exercised. Consequently, performance, reliability, exact desktop visual parity, live microphone behavior and shipping status of local edits remain outside the evidence established here.
