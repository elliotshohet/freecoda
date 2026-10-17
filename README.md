# Freecoda

A coding agent for the browser, desktop, and terminal. One plan: **free forever, supported by direct sponsors**. There are no paid credits, subscriptions, or user checkout. Hosted usage has fair-use limits and an operator spending cap. This monorepo is private during development.

## Workspace

- `apps/desktop`: native Linux, macOS, and Windows client with local editor, hosted AI chat, approved commands, and private desktop history.
- `apps/web`: website, GitHub sign-in, device authorization, inference proxy, transactional usage accounting, and sponsor placements.
- `packages/cli`: interactive terminal client and local conversation history.
- `packages/core`: repository tools, approval handling, model transports, and agent loop.
- `packages/contracts`: shared validation and allowance rules.
- `scripts`: migrations, invitations, sponsor operations, reconciliation, and model evaluation.

## Local development

Use Bun 1.3.5 or newer, Node.js 24, Docker, and PostgreSQL 17.

```sh
bun install --frozen-lockfile
# Set FREECODA_DB_PASSWORD in a private root .env file first.
docker compose up -d
# Copy .env.example to apps/web/.env.local and configure local DATABASE_URL,
# BETTER_AUTH_SECRET, AD_SIGNING_SECRET, and GitHub OAuth credentials.
bun run db:migrate
bun run dev
```

Open http://127.0.0.1:3010. PostgreSQL binds to loopback on port 5439. The website reports actual service configuration and disables unavailable integrations. Never commit `.env` files or credentials. Use a separate OAuth callback for localhost: `http://127.0.0.1:3010/api/auth/callback/github`.

## Desktop app

```sh
bun run desktop:dev
# Build installers on the target platform; no publishing.
bun run desktop:build
bun run desktop:package -- --mac dmg zip --x64
```

See [desktop setup and installers](apps/desktop/README.md) for Linux AppImage/DEB, Windows NSIS, Intel/Apple Silicon macOS, private CI artifacts, and signing status. Opening a folder requires explicit trust before reading project files. Writes and commands require approval. Hosted sign-in opens the system browser; credentials stay in the main process.

## Run the CLI

```sh
bun run build:cli
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js login
node packages/cli/dist/index.js --cwd /path/to/project
```

The CLI is published as `freecoda`; install with `npm install --global freecoda@0.1.1`. Sign in to use the free sponsored hosted allowance without an API key. Hosted access requires server configuration and a beta invitation; daily and shared capacity limits apply. `login`, `usage`, and `hosted` connect to the hosted service when available.

<details>
<summary>Advanced settings: optional API key</summary>

Run `node packages/cli/dist/index.js provider configure` only if you want to connect your own provider and model. Your provider bills you directly under its pricing and data policies. This does not add sponsored credits or increase your Freecoda allowance. `FREECODA_PROVIDER_KEY` supplies a key without saving it in configuration. Run `node packages/cli/dist/index.js hosted` to return to hosted mode.

</details>

Repository trust precedes reading context. Writes show a diff and require approval; shell commands require separate approval and **are not an OS sandbox**. Symlinks, common credential paths, and `.gitignore` / `.freecodaignore` exclusions are respected by repository tools. Shell commands can access files beyond those tools, so review them carefully. Conversations and optional provider keys are saved locally with owner-only permissions. `history clear` removes the current repository's conversation.

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

Hosted inference uses Vercel AI Gateway with server-side OpenAI BYOK. Set `OPENAI_API_KEY` on the server and authenticate Gateway with Vercel OIDC or `AI_GATEWAY_API_KEY`. Vercel currently requires a valid payment card and purchased Gateway credits for BYOK; OpenAI usage is billed to the provider key, and Gateway may fall back to its system credentials. Keep the application budget active because Vercel Gateway budgets do not cap BYOK spend.

Run `bun scripts/configure-openai.ts` with the intended database environment to save the candidate. Run the full evaluation with `--model openai/gpt-5-mini --provider openai --byok --max-cost-usd 1`. After reviewing a passing report, `bun scripts/configure-openai.ts --approve` approves that model; it requires a matching full-suite report less than 24 hours old. Enable `HOSTED_INFERENCE_ENABLED=true` separately and deploy.

Hosted inference stays disabled with `HOSTED_INFERENCE_ENABLED=false` until actual evaluation, provider privacy review, funding, and account authorization are verified. No model is approved automatically.

```sh
# Inspect exact live model IDs and pricing.
bun run models:sync
# Save a candidate as unapproved, using the intended environment's DATABASE_URL.
bun --env-file=apps/web/.env.local scripts/sync-models.ts <model-id> <provider>
# OpenAI BYOK requires OPENAI_API_KEY plus Gateway authentication.
# Gateway models require AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN. Evaluation makes real billable requests.
bun --env-file=.env.local scripts/evaluate.ts --model <model-id> --provider <provider> --max-cost-usd 1
```

The evaluation runs twelve disposable repository fixtures covering edits, planning, review, approval refusal, ignored credentials, traversal, and untrusted instructions. It verifies the live provider endpoint, restricts routing, disallows prompt training, and applies conservative per-request price reservations. BYOK does not imply zero data retention. The report records full-token provider cost estimates separately from Gateway-reported charges: zero Gateway cost does not mean OpenAI usage was free. A credential-free report is saved to ignored `.data/evaluation.json`. The harness never approves a model or enables inference. Authentication or billing failures stop the run and are recorded as infrastructure blockers. Passing fixtures establish a narrow launch baseline, not universal model correctness.

Operators must separately inspect current provider retention/zero-data-retention terms and the selected provider’s actual cost/usage metadata, confirm supported tool calling and streaming, review the report, and approve the selected catalog record explicitly before enabling hosted inference. Hosted requests enforce daily allowance, an application-wide monthly cap, and one unresolved reservation per user. Interrupted requests retain their reservation until provider evidence reconciles them.

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

### Database recovery and secret rotation

Confirm the actual Neon restore window and backup/export policy for the deployed project in its dashboard; availability depends on its configured plan. A restore routine is required before expanding access: record a restore point, restore into an isolated branch/database, apply schema migrations there, and verify account ownership, encrypted project reads, and allowance accounting before changing production connections. Disable hosted inference/cloud admission during a real restore, preserve original data, reconcile provider spending that happened after the restore point, and smoke-test sign-in, device revocation and project access before reopening. The runbook alone does not establish a completed drill or an off-provider backup; the dated logical-drill result below records the verification that was actually performed. Keep any database export encrypted with restricted access and an explicit deletion schedule.

A production logical restore drill completed on October 17, 2026: all 25 public tables matched snapshot row counts and the logical schema hash, using PostgreSQL 18.6 for source/client/target. No stored cloud payloads were present in that snapshot, so that run did not exercise payload decryption. The private verification receipt is retained under `.data/recovery/`; its encrypted backup, separate key and receipt all have owner-only permissions. The temporary database and its isolated container were removed, and the existing PostgreSQL 17 development container was untouched. This verifies logical application recovery, not Neon point-in-time restoration or an off-site backup policy.

The reusable drill uses a production read-only exported snapshot and never writes to Neon:

```sh
bun --env-file=.env.production.local scripts/recovery-drill.ts
```

It creates its own PostgreSQL 18 Docker container under the existing Colima context, with 512 MB memory, RAM-backed database storage and no host port. It leaves the existing development/test container untouched. The production database currently uses PostgreSQL 18; a PostgreSQL 17 client/target is rejected. An operator can use `--container <prepared-postgres18-container>` with the `freecoda_restore` local superuser; that container is retained, while only the newly generated `freecoda_restore_*` database is dropped. Never point this option at a production container.

The dump streams directly into AES-256-GCM encryption; no plaintext dump is written to disk. `.data/recovery/` contains owner-only encrypted backups and verification manifests, with separate owner-only 32-byte key files outside the archive directory in `.data/recovery-keys/`. `FREECODA_RECOVERY_KEY_DIRECTORY` can select another private key directory; paths inside the archive directory are refused. The manifest records snapshot table counts, schema hash, client/server versions, authenticated decryption checks for stored cloud payloads when present, and isolated resource cleanup. Physical ordinal gaps from previously dropped columns are normalized while relative column order is preserved. Roles, ownership and database ACLs are outside this application-schema drill. Copy only the encrypted archive and receipt to backup storage. Transfer its key separately into an access-controlled key vault through an independent channel; never upload the archive and key directory together. Keep the cloud encryption key available for retained application payloads. These local artifacts are sensitive; they are not committed, uploaded, or evidence of an independently managed off-site backup or Neon point-in-time restore drill. Local drill artifacts are retained for a maximum of seven days unless an incident requires an explicitly documented exception; the operator must delete each expired encrypted archive, receipt and matching key. This script does not automatically prune archives or configure off-site backup storage. A real production restore still requires an explicit target and the spending reconciliation/admission checks above.

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

The Vercel project uses `apps/web` as its root directory and the private `elliotshohet/freecoda` GitHub repository. Configure production database/auth/signing secrets in Vercel, apply migrations using the intended database URL, then deploy. Production GitHub OAuth uses `https://freecoda.com/api/auth/callback/github`. Keep secrets out of build logs and browser bundles. Vercel manages DNS through `ns1.vercel-dns.com` and `ns2.vercel-dns.com`.

The website and account service can be deployed while hosted inference remains closed. A deployed landing page does not imply hosted model readiness. CLI publishing and full interactive platform validation remain separate release work.

## Attribution

See LICENSE, NOTICE, and vendor/codebuff/NOTICE for the selectively reused Apache-2.0 editing helper. No Freebuff hosted services or advertising code are included.

OpenAI BYOK through AI Gateway uses the server-only `OPENAI_API_KEY` environment variable. No API key is delivered to CLI users. Reservations count all input tokens at the uncached rate and all output tokens, including reasoning. Interrupted requests without final usage remain reserved for operator reconciliation.

## Cloud workspace beta

`/app` is the invited browser workspace. Source files and conversations are encrypted in PostgreSQL and expire seven days after activity. Users consent before creating a cloud project. Project deletion revokes access immediately, stops execution, and schedules retryable resource cleanup. Dependency and build caches are excluded from saved source; resuming reinstalls dependencies.

Untrusted project code runs in Vercel Sandbox under a separate Linux user. Model calls, GitHub App credentials, encryption keys, and AI Gateway BYOK stay in the trusted backend. The exposed preview port belongs to a separate trusted proxy; short-lived signed tickets authorize HTTP and WebSocket access on a separate origin. Registry-only egress is intentional: projects requiring other external services are outside this beta.

Configure the cloud variables in `.env.example`, run migrations, and link the Vercel project before enabling `CLOUD_WORKSPACES_ENABLED`. Local Sandbox calls also need a current Vercel OIDC token. Production Secrets cannot be recovered with `vercel env pull`; preserve local development credentials. Workflow orchestration passes opaque project/run IDs, while private content stays in encrypted application storage.

Create a separate GitHub App with **Contents: read/write**, **Pull requests: read/write**, and the mandatory read-only Metadata permission. Set its setup URL to `https://freecoda.com/app` and allow selected repositories. The existing GitHub OAuth App remains responsible for login. Publishing checks repository access, the imported commit, and the reviewed diff, then creates a new branch and draft PR. It never updates the default branch or publishes GitHub workflow files.

Stay on Hobby: at most one active workspace per user, two globally, three saved projects, 100 MB source, two vCPUs, and fifteen minutes per session. Idle workspaces suspend after five minutes. Compute reservations conservatively cap monthly application sessions at 9,000 wall-clock seconds to fit five CPU-hours at two vCPUs; there is no paid upgrade. Platform quotas remain authoritative. Keep the flag disabled until the real sandbox, private preview, import, resume, and reviewed publication checks pass.
