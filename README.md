# Freecoda

A conversational assistant and coding agent for the browser, desktop, and terminal. One plan: **free forever, supported by direct sponsors**. There are no paid credits, subscriptions, or user checkout. Hosted usage has fair-use limits and an operator spending cap. Source, CLI, desktop installers, updater metadata, and release automation live together in this repository.

## Browser chat

The public home page introduces Freecoda and provides GitHub sign-in independently of chat availability. Verified signed-in visitors go straight to `/app`. `/app` combines conversations and project work in one screen: choose **Ask Coda** for a general conversation or **Work on project** to run the project agent, while keeping the project rail and file/output inspector available. Each mode retains its own conversation and draft when switching. `/chat` redirects to `/app?view=chat`. Both require a verified browser session, as does `/settings`. Background session checks preserve drafts and workspace state; an account change hides private content until you explicitly reload. `/dashboard` redirects to `/settings` for profile, appearance, usage/devices, and GitHub repository access. Repository connections require the configured GitHub App and cloud access; unavailable integrations report their actual state. Use `/model` to choose an approved, configured free model for future messages; the selection is shared across both conversation modes. Use `/mcp` to inspect configured MCP connections and explicitly discover their tools, or `/tools` to select which available tools the next project run may use. Installing or selecting tools does not execute them, and external tools still require run approval.

Chat includes encrypted account conversations with offline local copies, a message composer, streamed answers, and a separately labeled sponsor placement. An approved hosted invitation is required for inference. It shares the existing Gateway routing, usage reservations, rate limits, and free allowance; it does not bypass service capacity limits.

Enter sends; Shift+Enter adds a line. Messages sent during an active response enter a visible queue. Sending, accepted, failed, and paused states distinguish local messages from server acceptance; failed items can be retried or removed. Workspace retries use stable message IDs so a lost response does not create duplicate runs. Stop pauses the queue. Type `/help` for commands. Cloud storage consent is saved per account and terms version; external MCP tools still require approval for each build run. Preview tickets remain private and expire after five minutes; refresh restores an unexpired ticket without allocating new compute.

Responses use safe Markdown presentation with bounded code blocks and tables; web and desktop code blocks offer exact copying. CLI `--plain` preserves plain streamed output. See [working on the same repository across web, desktop, and CLI](docs/repository-sync.md) for repository identity, explicit fetch/pull, and the publish-and-merge workflow. Git sync does not upload uncommitted local files.

Conversation history syncs to the signed-in account across web, CLI and Desktop. Existing local histories migrate once to the current account; signing into a different account uses separate history. Sending a message submits its conversation context to the hosted model provider. The interface reports unavailable service configuration explicitly and never substitutes generated-looking fixture answers for a real provider response.

## Open source and downloads

Development, contributions, documentation, and release preparation live in [elliotshohet/freecoda](https://github.com/elliotshohet/freecoda). The former release repository’s Git history and distribution documents have been merged here, its five releases and 80 assets were verified in this repository, and the former repository has been removed. Desktop release workflows and new builds now target this repository. Older installed apps require manual reinstallation to switch updater feeds. See [the consolidation and migration notes](distribution/README.md).

## Workspace packages

- `apps/desktop`: native Linux, macOS, and Windows client with local editor, hosted AI chat, approved commands, and account history with private offline copies.
- `apps/web`: website, GitHub sign-in, device authorization, inference proxy, transactional usage accounting, and sponsor placements.
- `packages/cli`: interactive terminal client with account conversation sync and local offline history.
- `packages/core`: repository tools, approval handling, model transports, and agent loop.
- `packages/contracts`: shared validation and allowance rules.
- `scripts`: migrations, invitations, sponsor operations, reconciliation, and model evaluation.

## Build from source

Fork or clone the repository, install dependencies, then build any of the three apps below. Run commands from the repository root.

### Fork, clone, and install

Development requires Git, Bun 1.3.5 or newer, and Node.js 24. Docker is needed for the local PostgreSQL 17 service. Building desktop installers also requires a supported native operating system and electron-builder's platform dependencies.

To contribute independently, use **Fork** on [GitHub](https://github.com/elliotshohet/freecoda), then clone your fork:

```sh
git clone https://github.com/YOUR_GITHUB_USERNAME/freecoda.git
cd freecoda
git remote add upstream https://github.com/elliotshohet/freecoda.git
bun install --frozen-lockfile
```

For a direct checkout, clone `https://github.com/elliotshohet/freecoda.git` instead. Forks need their own database, OAuth app, Gateway credentials, deployment project, and release configuration; credentials and account access do not transfer with source.

### Build the CLI, desktop app, and web app

```sh
# CLI: produces packages/cli/dist/index.js and the npm launcher.
bun run build:cli
node packages/cli/dist/index.js --help

# Desktop: builds Electron main, preload, and renderer bundles.
bun run desktop:build
bun --cwd apps/desktop start

# Web: configure apps/web/.env.local as described below first.
bun --cwd apps/web build
bun --cwd apps/web start
```

The web app opens at http://127.0.0.1:3010. `bun run build` builds all three apps. To create a distributable desktop installer after building, run `bun run desktop:package` on the target platform; see [platform packaging commands](apps/desktop/README.md). Build output does not include hosted credentials or grant inference access; configure and sign in to a server separately.

## Run the web locally

```sh
# Create these only when they do not already exist; preserve existing secrets.
cp .env.example apps/web/.env.local
# Create a private root .env with FREECODA_DB_PASSWORD=<your-local-password>.
docker compose up -d --wait
```

Edit `apps/web/.env.local`: set `DATABASE_URL` to `postgresql://freecoda:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5439/freecoda`, generate separate `BETTER_AUTH_SECRET`, `AD_SIGNING_SECRET`, and `CRON_SECRET` values, and configure `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Keep `BETTER_AUTH_URL=http://127.0.0.1:3010`. Register `http://127.0.0.1:3010/api/auth/callback/github` as the local GitHub OAuth callback; use a separate OAuth app for production. If a private SSH tunnel forwards Air browser traffic to the Mini at `127.0.0.1:13010`, add the exact callback `http://127.0.0.1:13010/api/auth/callback/github` to the local GitHub OAuth app too. Keep the tunnel bound to loopback; production auth stays on its canonical URL.

```sh
bun run db:migrate
bun run dev
```

Open http://127.0.0.1:3010. The landing page can run before model access is configured; inference requires the Gateway setup below, an approved model, the enabled hosted flag, and an invited signed-in account. PostgreSQL binds only to loopback on port 5439. Never commit `.env` files or credentials. Stop the web server with Ctrl+C and stop PostgreSQL with `docker compose stop`; the database volume persists.

For a production-mode local web check, stop the dev server, run `bun --cwd apps/web build`, then `bun --cwd apps/web start`.

## Use the web

Visit [freecoda.com](https://freecoda.com), sign in with GitHub, and open `/chat` for general conversation. Create or reopen a conversation, enter a message, and read the streamed reply. Chat history syncs to your encrypted account history. Clearing browser storage removes the offline cache; use the history delete action to remove an account conversation. Your submitted conversation is sent to the configured model provider. An invitation and available hosted capacity are required for inference.

Open `/app` for the cloud coding workspace. When enabled for your account, consent to cloud storage, create or import a project, and review proposed changes before publishing a branch and draft pull request. Cloud workspaces require additional Sandbox, Workflow, GitHub App, and encryption configuration described below; local chat setup alone does not enable them. Use `/docs` for installation and usage instructions, `/device` to approve a CLI/desktop sign-in, and `/settings` for account settings.

## Desktop app

```sh
bun run desktop:dev
# Build installers on the target platform; no publishing.
bun run desktop:build
bun run desktop:package -- --mac dmg zip --x64
```

See [desktop setup and installers](apps/desktop/README.md) for Linux AppImage/DEB, Windows NSIS, Intel/Apple Silicon macOS, CI artifacts, and signing status. Opening a folder requires explicit trust before reading project files. Writes and commands require approval. Hosted sign-in opens the system browser; credentials stay in the main process.

## Run the CLI

```sh
bun run build:cli
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js login
node packages/cli/dist/index.js --cwd /path/to/project
```

Install the current CLI from the [GitHub release archive](https://github.com/elliotshohet/freecoda/releases/tag/cli-v0.1.5), after checking its `SHA256SUMS.txt`:

```sh
npm install --global https://github.com/elliotshohet/freecoda/releases/download/cli-v0.1.5/freecoda-0.1.5.tgz --ignore-scripts
```

The npm registry package may be an older version. Sign in to use the free sponsored hosted allowance without an API key. Hosted access requires server configuration and a beta invitation; daily and shared capacity limits apply. `login`, `usage`, and `hosted` connect to the hosted service when available.

<details>
<summary>Advanced settings: optional API key</summary>

Run `node packages/cli/dist/index.js provider configure` only if you want to connect your own provider and model. Your provider bills you directly under its pricing and data policies. This does not add sponsored credits or increase your Freecoda allowance. `FREECODA_PROVIDER_KEY` supplies a key without saving it in configuration. Run `node packages/cli/dist/index.js hosted` to return to hosted mode.

</details>

Repository trust precedes reading context. Writes show a diff and require approval; shell commands require separate approval and **are not an OS sandbox**. Symlinks, common credential paths, and `.gitignore` / `.freecodaignore` exclusions are respected by repository tools. Shell commands can access files beyond those tools, so review them carefully. Conversations keep owner-only local copies and synchronize to your signed-in account. Optional direct-provider keys remain local. `history clear` removes this directory’s local copies and queues deletion of its synchronized conversations.

## Conversation history across devices

Signed-in web, CLI and Desktop clients share encrypted account conversation history. General Chat and coding conversations remain separate. Use the history picker in web/Desktop or `/resume` in the CLI to continue a conversation created on another device. Resuming coding history uses your currently selected and trusted local folder; it does not grant file access to a remote machine or bypass tool approvals.

Local copies allow offline access and queue unsynced turns until the connection returns. Updates use version checks: a concurrent local edit is preserved as a separate copy instead of overwriting a newer cloud conversation. Deletion syncs to the account, and stale offline copies cannot recreate a deleted conversation. Account conversations remain until you delete them or your account; the cloud coding workspace's separate source/run retention policy still applies. Existing local conversations migrate once to the first verified signed-in account. Signing out or switching accounts keeps each account’s cache separate. Provider credentials and application settings are not conversation history and are not uploaded.

## Install tools and skills

Freecoda supports **HTTP MCP servers** for external tools and **SKILL.md files** for reusable instructions. Installs are explicit and enabled immediately; they never run package install scripts. General Chat stays tool-free and does not load installed skills. Skills guide Agent, Plan and Review; remote MCP tools are available only in Agent mode.

For the CLI:

```sh
freecoda extensions add-skill /absolute/path/to/my-skill/SKILL.md
freecoda extensions add-skill https://raw.githubusercontent.com/OWNER/REPO/main/path/SKILL.md
freecoda extensions add-mcp DeepWiki https://mcp.deepwiki.com/mcp
freecoda extensions list
freecoda extensions disable EXTENSION_ID
freecoda extensions enable EXTENSION_ID
freecoda extensions remove EXTENSION_ID
freecoda --mode build --cwd /path/to/project
```

Use `/extensions` during a CLI session to see installed items. In Desktop, open **Tools & skills** to install, enable, disable or remove a skill or MCP server. CLI and Desktop installations are stored privately on that machine in their respective app data directories; they do not sync to the hosted account. Local skill installs include supported text files from the skill directory. HTTPS/GitHub file installs download the single SKILL.md; referenced support files are not downloaded. Skill installation does not execute bundled scripts.

In the web cloud workspace at `/app`, select a project and open **Tools & skills**. Add a public HTTPS SKILL.md URL, paste skill instructions, or add a public HTTPS MCP endpoint. Web extensions are encrypted project settings, separate from repository files. Check **Allow enabled MCP tools for this run** before starting an Agent task; Plan and Review never connect to MCP servers. This is separate from ordinary `/chat`, which remains conversational and tool-free. Web extension settings are project-specific and do not sync to local clients.

Local Agent mode asks for approval before each external tool call under the commands category. A session grant for **commands and external tools** or Full access also permits MCP calls; it covers the entire category, rather than one command. Web consent covers the selected run. External tools receive their arguments and may act outside the workspace: install only servers you trust and review what you share. No stdio process transport or interactive MCP OAuth setup is provided in this version. Hosted MCP endpoints must resolve to public Internet addresses; redirects and private/local targets are blocked.

## Connected GitHub repositories

Connect the Freecoda GitHub App to selected repositories, then use **Connected repositories** in the web or desktop interface to save the branch, app directory and enabled state. These settings belong to your signed-in account and are shared across the web, Desktop and CLI. They configure access and import defaults; saving a repository does not clone it, trust a local directory, or authorize a push.

```sh
freecoda repos list
freecoda repos configured
freecoda repos configure OWNER/REPO --branch main --directory apps/web
# Use --installation ID if more than one installation matches.
freecoda repos remove OWNER/REPO
```

Repository access is rechecked against your GitHub identity and current App installation before saving. A local Desktop or CLI project still requires folder selection and repository trust. Cloud imports and publishing retain their existing review and consent steps.

## Checks

```sh
bun run typecheck
bun run test
bun --env-file=apps/web/.env.local scripts/test-db.ts
bun --env-file=.env.test.local scripts/migrate.ts
bun run test:integration
bun run build
```

Integration tests require a separate local database named `freecoda_test` and refuse other database targets. GitHub Actions runs compilation, unit/integration checks, a production build, and CLI build/help smoke checks on Linux, macOS, and Windows. Desktop packaging runs separately on Linux, Windows, Intel macOS, and Apple Silicon macOS. Packaging checks do not establish full interactive compatibility on every platform.

## Hosted launch gates

Hosted inference uses Vercel AI Gateway with `reflection/beam-free` (provider `reflection`). Configure server-side `AI_GATEWAY_API_KEY` for local development; Vercel deployments can use their `VERCEL_OIDC_TOKEN`. No OpenAI BYOK key is needed. Zero token prices do not cover database, hosting, or Sandbox costs.

The suitability algorithm refreshes the live catalog and provider endpoint and checks zero pricing across all billing fields, active/nondeprecated status, context length, output limits, required tools, and provider policy. Runtime routing is pinned to the explicitly approved Beam Free configuration. Catalog inspection can score privacy guarantees, coding capabilities, context headroom, latency, throughput, and uptime, but telemetry does not switch production to another model. If Beam is unavailable, incompatible, unapproved, or no longer free, requests fail with an unavailable-service response. There is no alternative-model or paid fallback.

**Privacy:** Beam Free may retain submitted prompts, conversations, and repository excerpts and use them for training. This hosted route has no no-training or zero-data-retention guarantee. Evaluation requires explicit `--allow-prompt-training`. Do not submit secrets or content that requires stronger provider guarantees.

```sh
# Inspect the free candidate selection and live capabilities.
bun --env-file=apps/web/.env.local scripts/configure-free-model.ts --discover
# Stage the requested Beam Free model.
bun --env-file=apps/web/.env.local scripts/configure-free-model.ts --model reflection/beam-free
# Makes real calls across all twelve repository fixtures.
# Beam Free permits provider training; review the privacy disclosure before this call.
bun --env-file=apps/web/.env.local run eval --model reflection/beam-free --provider reflection --max-cost-usd 0 --allow-prompt-training
# Approve after reviewing a passing matching report less than 24 hours old.
bun --env-file=apps/web/.env.local scripts/configure-free-model.ts --model reflection/beam-free --approve
bun run invite person@example.com
```

The configuration command replaces previous approved defaults; recheck the catalog after selecting a new model. Set `HOSTED_INFERENCE_ENABLED=true` in the web environment and restart after approval. Repeat configuration, evaluation, and approval using the intended production database and credentials before enabling production. `bun run models:free` is the configuration shortcut and accepts the same flags. The legacy `scripts/configure-openai.ts` remains available for operators choosing OpenAI BYOK; its billing requirements differ, and it does not change the Beam-only hosted routing policy.

The evaluation runs twelve disposable fixtures covering edits, planning, review, approval refusal, ignored credentials, traversal, and untrusted instructions. It saves a credential-free report to ignored `.data/evaluation.json`; it does not approve a model or enable inference. Review actual provider behavior and the report before approval. Authentication, unavailable capacity, and routing failures are blockers. A passing evaluation establishes this narrow baseline, not universal model correctness. Hosted requests still enforce daily allowance, an application-wide monthly cap, and unresolved reservation limits. Interrupted requests retain reservations until provider evidence reconciles them.

```sh
bun --env-file=apps/web/.env.local scripts/reconcile.ts
bun --env-file=apps/web/.env.local scripts/cleanup.ts
bun run invite person@example.com
```

Invitations are limited to twenty beta accounts. The invitation script stores permission and sends no email. Reconciliation never guesses a refund; requests without a provider generation ID require investigation. For BYOK requests, Gateway charges can be zero while the upstream provider bills separately: obtain provider billing/usage evidence before an operator settles an interrupted reservation. These reservations remain held until that evidence is available.

### Daily maintenance and monitoring

Apply migrations through `0009_maintenance.sql`, set production `CRON_SECRET` to at least 32 random characters, and deploy `apps/web/vercel.json` with the web project root. The configured daily Vercel Cron calls `/api/maintenance` with `Authorization: Bearer <CRON_SECRET>`; it fits the Hobby daily schedule. Verify the cron registration and first successful invocation in the Vercel dashboard after deployment. Preview deployments do not establish production maintenance coverage.

Maintenance removes expired device/ad/rate-limit records, reconciles up to five older non-BYOK requests with explicit provider evidence, and schedules durable cleanup for expired/orphaned projects and account resources. Limits keep each sweep bounded; durable workflows retry external resource failures. No refund is inferred from a missing generation, missing configuration, or BYOK Gateway charge. Repeated sweeps are serialized. The manual scripts above remain available for recovery and backlog processing.

Authenticated `GET /api/maintenance?status=1` returns the last start/finish timestamps, status, and aggregate counters. Use the same Bearer authorization through your secret manager; never put the secret in a URL. Treat a failed run, a running record older than five minutes, or no completed run in 48 hours as an operations incident. Inspect Vercel cron/workflow failures and database connectivity, run the endpoint again after resolving the cause, and confirm its finished status. The application stores this health record; it does not claim an independently configured pager or alert-delivery service.

Public `GET /api/readiness` returns only `{ "ready": true }` with 200 or `{ "ready": false }` with 503. It performs a real database query and requires the most recent maintenance record to have completed successfully within 48 hours. Missing, failed, future-dated or currently running maintenance is not ready, even during a brief healthy sweep; a monitor should retry before alerting. Database acquisition and query waits are bounded, simultaneous requests share one probe, and a ten-second instance/CDN cache bounds ordinary probe load. This proves database connectivity and recent maintenance completion; it does not establish live provider billing, OAuth/GitHub API availability, or a successful end-to-end agent task.

The [public GitHub Actions monitor](https://github.com/elliotshohet/freecoda/actions/workflows/public-monitor.yml) lives in this repository. It checks public readiness without account tokens, cron secrets, or privileged maintenance calls. Inspect its workflow triggers and dispatch it after deployment; a checked-in workflow does not prove that recurring monitoring or notifications are enabled. GitHub notification settings determine delivery of failures. Periodically confirm that expected runs continue appearing.

### Database recovery and secret rotation

The deployed Neon Free project was verified on October 17, 2026 with a six-hour history retention window. The free plan allows ten branches per project; the normal project has one branch. Recheck the current dashboard and plan limits before a recovery operation. A restore routine is required before expanding access: record a restore point, restore into an isolated branch/database, apply schema migrations there, and verify account ownership, encrypted project reads, and allowance accounting before changing production connections. Disable hosted inference/cloud admission during a real restore, preserve original data, reconcile provider spending that happened after the restore point, and smoke-test sign-in, device revocation and project access before reopening. The runbook alone does not establish a completed drill or an off-provider backup; the dated logical-drill result below records the verification that was actually performed. Keep any database export encrypted with restricted access and an explicit deletion schedule.

Production logical restore drills completed on October 17, 2026: all 25 public tables matched snapshot row counts and the logical schema hash, using PostgreSQL 18.6 for source/client/target. A second drill created a synthetic suspended project and marker through the actual production API, restored its server-encrypted record, decrypted it using the separately retained production cloud key, and verified the exact marker hash. The QA project was then deleted through the API; read-only checks confirmed zero remaining project rows or compute reservations. No AI call or Sandbox VM was used. One actual encrypted project payload was verified; no chat/run/event payloads existed in those snapshots. The private verification receipts are retained under `.data/recovery/`; encrypted backups, separate keys and receipts have owner-only permissions. Temporary databases and isolated containers were removed, and the existing PostgreSQL 17 development container was untouched. A separate Neon point-in-time drill created an isolated child of main at 23:10:00.412 UTC: read-only SQL recovered all 25 public tables and the synthetic project with its encrypted source payload, with zero Sandbox allocations. A later historical control at 23:11:35.299 UTC correctly had zero projects after cleanup. Both drill branches were deleted; the project returned to its single unchanged main branch, without changing production connections or the plan. Private evidence is recorded in `.data/recovery-neon-pitr.json`.

The reusable drill uses a production read-only exported snapshot and never writes to Neon:

```sh
bun --env-file=.env.production.local scripts/recovery-drill.ts
```

Supply the separately retained production `CLOUD_ENCRYPTION_KEY` to the process through the chosen secret manager or a restricted secret environment file when retained cloud records must be decrypted. A production `DATABASE_URL` environment file alone is not encryption-key custody: `.env.production.local` may not contain Vercel Secret values. Read only the cloud-key value from its retained source; do not load a local development environment over the production database connection. Do not print the key or copy it into receipts or archives.

Optional `FREECODA_RECOVERY_VERIFY_PROJECT_ID`, `FREECODA_RECOVERY_VERIFY_PATH` and `FREECODA_RECOVERY_VERIFY_SHA256` together require a specific restored project file to match its expected SHA-256 digest before cleanup. Fixture mode refuses absent/invalid retained cloud keys before starting a container or dump. These values are supplied at runtime; no QA project identifiers or marker content are committed to the script.

It creates its own PostgreSQL 18 Docker container under the existing Colima context, with 512 MB memory, RAM-backed database storage and no host port. It leaves the existing development/test container untouched. The production database currently uses PostgreSQL 18; a PostgreSQL 17 client/target is rejected. An operator can use `--container <prepared-postgres18-container>` with the `freecoda_restore` local superuser; that container is retained, while only the newly generated `freecoda_restore_*` database is dropped. Never point this option at a production container.

The dump streams directly into AES-256-GCM encryption; no plaintext dump is written to disk. `.data/recovery/` contains owner-only encrypted backups and verification manifests, with separate owner-only 32-byte key files outside the archive directory in `.data/recovery-keys/`. `FREECODA_RECOVERY_KEY_DIRECTORY` can select another private key directory; paths inside the archive directory are refused. The manifest records snapshot table counts, schema hash, client/server versions, authenticated decryption checks for stored cloud payloads when present, and isolated resource cleanup. Physical ordinal gaps from previously dropped columns are normalized while relative column order is preserved. Roles, ownership and database ACLs are outside this application-schema drill. Copy only the encrypted archive and receipt to backup storage. Transfer its key separately into an access-controlled key vault through an independent channel; never upload the archive and key directory together. Keep the cloud encryption key available for retained application payloads. These artifacts are sensitive and are not committed. The October 17 encrypted archive and a sanitized manifest were uploaded into a private owner-only Google Drive recovery folder; downloaded ciphertext matched the manifest SHA-256, and the downloaded manifest matched the uploaded bytes. No archive key or cloud encryption key was uploaded to Drive. Private remote object identifiers and verification evidence are in `.data/recovery-offsite/verification.json`. That rotated copy was subsequently migrated into the dedicated scheduled-recovery folder and its unmanaged connector-created copies were permanently removed. The daily backup and remote pruning configuration below now manages its recorded seven-day expiry. Local drill artifacts are retained for a maximum of seven days unless an incident requires an explicitly documented exception; the operator must delete each expired encrypted archive, receipt and matching key. The drill itself does not prune archives or configure off-site backup storage. A real production restore still requires an explicit target and the spending reconciliation/admission checks above.

Restore an existing downloaded archive without contacting the source database:

```sh
bun scripts/recovery-restore.ts --archive /private/backup.dump.aesgcm --manifest /private/backup.json --key /separate-vault/backup.key --application-key-file /separate-vault/cloud.key --context colima --receipt /private/restore-receipt.json
```

The archive key is the original 32-byte binary key. The optional application key file contains the retained 32-byte cloud key, either binary or base64 text. Supply it to verify encrypted application records; omitting it verifies only the database schema and counts. This command authenticates the entire archive before starting PostgreSQL, restores into a new network-isolated PostgreSQL 18 container, compares all table counts and the schema hash, and removes its container. No production database credentials are required and no plaintext dump is written to disk. On October 17, the actual Drive-downloaded archive passed this independent restore with all 25 tables matching and one encrypted application payload decrypted. The private receipt is `.data/recovery-downloaded/independent-restore-receipt.json`. This verifies the saved copy; recurring backup execution, remote expiry and independently recoverable key custody still require configuration.

The restore command ignores `DATABASE_URL` and preserves its input files. Its receipt destination must be new. Never put recovered key values in shell arguments, chat, or the Drive archive folder. An off-site copy is independently recoverable only after both keys can be retrieved separately; another-device iCloud Keychain verification remains an operator check.

Daily off-site recovery is configured on the operator Mac with the user LaunchAgent `com.freecoda.recovery-backup` at 04:15 local time. The initial real pipeline verified a fresh production snapshot, uploaded its encrypted archive and sanitized receipt through a dedicated Google OAuth credential, and downloaded both for byte verification. A separate expired synthetic pair proved remote deletion; replaying its upload reused the same objects. The app has only `drive.file` access to files created or explicitly opened with it, and uses its own private scheduled-recovery folder. No connector credentials are reused. Private authorization and expiry evidence is in `.data/recovery-drive/`; `~/Library/Application Support/FreecodaRecovery/.data/recovery-scheduled-status.json` reports the latest scheduled verified/failed run without credentials or data; the checkout retains the first manual verification receipt. This is a local schedule: the Mac must be logged in with Docker/Colima available, and failures require operator review. It is not an always-on hosted backup service or an alert-delivery guarantee.

The runner uses a separately retained archive master key with a fresh random GCM nonce for every archive. Its owner-only master file is outside both expiry directories; per-archive key copies can expire without deleting the master. The archive master and production cloud key are saved as separate Passwords entries at `recovery.freecoda.invalid`; the operator confirmed both appeared on another Apple device. Do not change either key without retaining and verifying the replacement independently. Keys are never uploaded to Drive.

```sh
# Configuration contains private credential/master-file references; keep it owner-only.
bun --env-file=apps/web/.env.local --env-file=.env.production.local --env-file=.data/recovery-drive/schedule.env scripts/recovery-scheduled.ts
bun --env-file=apps/web/.env.local --env-file=.env.production.local --env-file=.data/recovery-drive/schedule.env scripts/recovery-install-schedule.ts --install
launchctl print gui/$(id -u)/com.freecoda.recovery-backup
```

The scheduled runner serializes invocations, authenticates the private destination before exporting, prunes only its own tagged, private, hash-verified remote artifacts after their recorded seven-day expiry, verifies each new upload, and then applies local expiry. Interrupted uploads resume by exact metadata/content matching; conflicting names fail closed. The rotated one-time proof archive is now tagged in the managed folder, and its obsolete connector-created objects were permanently deleted. The installer bundles the audited runtime and copies only the required owner-only configuration into Application Support so launchd does not need access to the protected Documents directory. Reinstall after audited script changes or database/credential rotation; this refreshes the installed runtime and private configuration. The first actual launchd invocation completed successfully with exit code zero. Preserve the separately retained production cloud key; the Vercel environment pull alone does not recover it.

Run local recovery expiry as an explicit operator command. It previews by default and deletes only with `--apply`:

```sh
bun scripts/recovery-retention.ts
bun scripts/recovery-retention.ts --apply
```

The command matches only generated recovery receipt names and validated verified manifests with their recorded seven-day expiry. Archive and key paths must stay in their separately configured directories; symlink entries, malformed records, missing pairs, changed archive size/digest and unexpected paths are refused. A dry run prints aggregate counts only. Apply removes the expired encrypted archive, matching key and receipt; it does not delete arbitrary or unmanifested files. Investigate any rejected count rather than broadening a deletion glob. Operators can schedule this explicit apply command in their own trusted local runner; no such schedule is installed by the repository. The recorded production drill artifact has only been checked with dry-run and has not been deleted.

Rotate server credentials through Vercel environment management without printing values: update, redeploy, verify the affected operation, then revoke the old provider/GitHub credential. Rotating `BETTER_AUTH_SECRET` can invalidate sessions. Rotating `AD_SIGNING_SECRET` invalidates outstanding ad tokens. Rotating `CLOUD_PREVIEW_SECRET` requires stopping existing VMs and resuming them with the new verification key. Rotate `CRON_SECRET` with a deployment and verify a new authenticated maintenance run. `CLOUD_ENCRYPTION_KEY` is also needed to decrypt retained database backups: never replace it in place while encrypted records exist. Retain the old key securely and perform a tested re-encryption migration for every project/run/event payload before retiring it. No automatic encryption-key migration is currently implemented.

## Direct sponsors

Sponsor inquiries are stored by the website; there is no automatic email outreach or payment flow. Operators inspect inquiries and create campaigns only after securing an actual sponsor:

```sh
bun run campaign inquiries
bun run campaign create /private/path/campaign.json
bun run campaign list
bun run campaign pause <campaign-id>
```

Campaign JSON contains `sponsor`, `headline`, `description`, HTTPS `url`, `placement` (`web`, `terminal`, or `both`), ISO `startsAt` / `endsAt`, integer `impressionLimit`, and `active` (defaults to false). Use actual agreed copy; no advertisers are preloaded. Placements are labeled and selected without code, prompts, or personal targeting. House announcements appear when no campaign qualifies and do not count as paid impressions. Signed event tokens deduplicate impressions and clicks; they do not prove a human viewed an advertisement.

## Vercel deployment

The Vercel project uses `apps/web` as its root directory and the `elliotshohet/freecoda` GitHub repository. Configure production database/auth/signing secrets in Vercel, apply migrations using the intended database URL, then deploy. Production GitHub OAuth uses `https://freecoda.com/api/auth/callback/github`. Keep secrets out of build logs and browser bundles. Vercel manages DNS through `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.

The website and account service can be deployed while hosted inference remains closed. A deployed landing page does not imply hosted model readiness. CLI publishing and full interactive platform validation remain separate release work.

## Attribution

See LICENSE, NOTICE, and vendor/codebuff/NOTICE for the selectively reused Apache-2.0 editing helper. No Freebuff hosted services or advertising code are included.

AI Gateway authentication stays on the server. No Gateway or provider API key is delivered to hosted CLI users. Reservations count all input tokens at the uncached rate and all output tokens, including reasoning. Interrupted requests without final usage remain reserved for operator reconciliation.

## Cloud workspace beta

`/app` is the invited browser workspace. Source files and conversations are encrypted in PostgreSQL and expire seven days after activity. Users consent before creating a cloud project. Project deletion revokes access immediately, stops execution, and schedules retryable resource cleanup. Dependency and build caches are excluded from saved source; resuming reinstalls dependencies.

Untrusted project code runs in Vercel Sandbox under a separate Linux user. Model calls, GitHub App credentials, encryption keys, and AI Gateway credentials stay in the trusted backend. The exposed preview port belongs to a separate trusted proxy; short-lived signed tickets authorize HTTP and WebSocket access on a separate origin. Registry-only egress is intentional: projects requiring other external services are outside this beta.

Configure the cloud variables in `.env.example`, run migrations, and link the Vercel project before enabling `CLOUD_WORKSPACES_ENABLED`. Local Sandbox calls also need a current Vercel OIDC token. Production Secrets cannot be recovered with `vercel env pull`; preserve local development credentials. Workflow orchestration passes opaque project/run IDs, while private content stays in encrypted application storage.

Create a separate GitHub App with **Contents: read/write**, **Pull requests: read/write**, and the mandatory read-only Metadata permission. Set its setup URL to `https://freecoda.com/app` and allow selected repositories. The existing GitHub OAuth App remains responsible for login. Publishing checks repository access, the imported commit, and the reviewed diff, then creates a new branch and draft PR. It never updates the default branch or publishes GitHub workflow files.

Stay on Hobby: at most one active workspace per user, two globally, three saved projects, 100 MB source, two vCPUs, and fifteen minutes per session. Idle workspaces suspend after five minutes. Compute reservations conservatively cap monthly application sessions at 9,000 wall-clock seconds to fit five CPU-hours at two vCPUs; there is no paid upgrade. Platform quotas remain authoritative. Keep the flag disabled until the real sandbox, private preview, import, resume, and reviewed publication checks pass.
