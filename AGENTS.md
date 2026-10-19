# Repository Guidelines

## Project Structure & Module Organization

Freecoda is a Bun/TypeScript monorepo with three clients. `apps/web` contains the Next.js website, API routes, shared web components, and database code; static assets live in `apps/web/public`. `apps/desktop/src` contains Electron main/preload code and the renderer; installer assets are in `apps/desktop/resources`. `packages/cli` provides the terminal client, `packages/core` the agent loop and repository tools, and `packages/contracts` shared validation. Root `tests/` holds unit and integration suites. Operational scripts live in `scripts/`, SQL migrations in `apps/web/lib/db/migrations`, and release documentation in `distribution/`.

## Build, Test, and Development Commands

Use Bun 1.3.5+ and Node.js 24. Run commands from the repository root:

- `bun install --frozen-lockfile`: install workspace dependencies.
- `bun run dev`: start the web app at `http://127.0.0.1:3010`.
- `bun run desktop:dev`: build and launch Electron.
- `bun packages/cli/src/index.ts --help`: run the CLI from source.
- `bun run build`: build CLI, desktop, and web; use `build:cli` or `desktop:build` for focused builds.
- `bun run typecheck`: check all TypeScript workspaces.
- `bun run test`: run the curated Bun test suite.
- `bun run test:integration`: run database and GitHub/cloud integration suites.

## Coding Style & Naming Conventions

Follow surrounding TypeScript: two-space indentation, double quotes, semicolons, and strict typing. Use camelCase for functions/variables, PascalCase for components/types, and descriptive kebab-case filenames. Keep shared schemas in `packages/contracts`. No dedicated formatter or linter is configured; match existing code and run typechecking. Before editing the web app, read `apps/web/AGENTS.md` and its referenced local Next.js documentation.

## Testing Guidelines

Use `bun:test` and name root suites `tests/<feature>.test.ts`; integration suites use `.integration.test.ts`. Add regression coverage for changed behavior, especially approval, security, accounting, and persistence boundaries. Run a focused suite with `bun test tests/core.test.ts`, then relevant repository checks. Integration tests require a separate `freecoda_test` database configured through `.env.test.local` and migrated first. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects such as “Restore public splash”; follow that style. Keep changes focused. PRs should explain the problem, resulting behavior, and validation performed; link relevant issues and include screenshots for visual changes. Ensure CI checks pass.

## Security & Configuration

Use `.env.example` to prepare local configuration without replacing existing secrets. Never commit credentials or print secret values. Preserve repository trust checks, write/command approvals, and server-only provider credentials. Follow the README for database setup and migrations.

## Product Boundaries

- Keep browser, desktop, and CLI behavior consistent. Shared contracts belong in `packages/contracts`; agent and repository behavior belongs in `packages/core` where practical.
- General chat must not acquire repository access implicitly. Preserve explicit folder trust, permission modes, and approval boundaries for file writes and shell commands.
- Hosted inference uses the approved free-model catalog through Vercel AI Gateway. Preserve zero-price validation and fail visibly when an approved model is unavailable; never silently substitute a paid model.
- Keep MCP tools and `SKILL.md` skills subject to their installation, trust, and execution permissions on every client.
- Preserve account isolation, encryption, deletion semantics, offline conflict handling, and consent when changing cloud conversation sync or connected repositories. Device credentials must not grant access to private administrator metrics.
- Use the signed-in user's real avatar when available, with a graceful fallback. Preserve Freecoda branding and the single-logo splash screen.

## Verification & Releases

- Build and test changes locally before publication. For UI changes, verify the actual relevant client, including mobile layout for web changes. Report what was tested and any remaining limitations.
- When asked to run the CLI or desktop app, launch it from source and verify the actual process or interface; a successful build alone is insufficient. On the current workstation, run Freecoda and browser QA on the Mini rather than the Air.
- Always commit and push to GitHub before deploying to Vercel. Keep unrelated changes out of commits, including generated `apps/web/next-env.d.ts` changes unless intentionally required.
- Use `elliotshohet/freecoda` for source, releases, and updater feeds. The retired release repository must not be reintroduced. Older clients with an embedded retired feed need a one-time manual reinstall.
- When asked to release desktop or CLI changes, carry the release through the requested clients: bump their package versions and relevant lockfile metadata, prepare dated versioned changelog entries with canonical release links, commit and push the reviewed source, create and push the corresponding version tags, and publish canonical GitHub releases after the gates below pass. Desktop tags use `v<VERSION>`; CLI tags use `cli-v<VERSION>`. Keep pending entries explicitly under Unreleased and label publication pending until verified. A local version bump, pushed tag, or running workflow alone does not complete a release.
- Publish release artifacts only from successful CI runs at the exact reviewed source commit. Verify downloaded asset bytes, checksums, sizes, and updater metadata before exposing download links. Published versions are immutable; use a new version for changed artifacts.
- Maintain root `CHANGELOG.md` for every desktop and CLI release. Record the version, release date, evidenced user-visible changes, migration steps, and material limitations, with a link to the canonical release. Keep local or pending changes in an explicitly labeled Unreleased section until published; never invent historical changes or mark an unverified release complete.
- Validate automatic updates through actual installation and relaunch, not feed checks alone. macOS automatic installation requires Developer ID signing and notarization; keep unsigned builds on manual downloads and never bypass OS security checks to claim success.
- Keep private billing exports, business measurements, and operational evidence outside public source. Distinguish recorded usage, rounded dashboard figures, credits, and verified cash charges.
- Preserve user browser tabs, unsaved drafts, and active sessions. Close only agent-owned QA resources when finished, and do not interrupt unrelated running work.

## Parallel Execution & Coordination

- For substantial tasks, identify independent workstreams and proactively use available subagents in parallel when useful. Keep trivial work local and avoid duplicate effort.
- Give each worker a clear objective, file/module ownership, dependencies, and validation expectations. Tell workers they share the codebase and must preserve others’ edits; never revert unrelated or uncommitted work.
- Parallelize independent searches, read-only commands, and tests when resources permit. Run dependent steps sequentially. Coordinate shared files, ports, databases, browser pages, and lockfiles before using them; serialize conflicting operations.
- Check for active work before editing. Use isolated worktrees for conflicting edits, preserve existing changes, and coordinate integration with other active agents or chats.
- Prefer subagents for subtasks. Separate agents or user-visible chats are authorized for independent Freecoda work where supported and appropriate; avoid fragmenting a single task unnecessarily.
- Review and integrate worker results, resolve conflicts deliberately, and run required checks on the combined result before declaring completion. Optimize elapsed time while preserving correctness.
- Work within runtime tools, concurrency limits, and permissions. These instructions do not enable unavailable tools, unlimited agents, or automatic scheduling.
