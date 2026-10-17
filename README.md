# Freecoda

A local coding agent with a Next.js account website. One plan: **free forever, supported by direct sponsors**. There are no paid credits, subscriptions, or user checkout. Hosted usage has fair-use limits and an operator spending cap. This monorepo is private during development.

## Workspace

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

## Run the CLI

```sh
bun run build:cli
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js login
node packages/cli/dist/index.js --cwd /path/to/project
```

The npm package is not published yet; use the source checkout. Sign in to use the free sponsored hosted allowance without an API key. Hosted access requires server configuration and a beta invitation; daily and shared capacity limits apply. `login`, `usage`, and `hosted` connect to the hosted service when available.

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

Integration tests require a separate local database named `freecoda_test` and refuse other database targets. GitHub Actions runs compilation, unit/integration checks, a production build, and CLI build/help smoke checks on Linux, macOS, and Windows. These smoke checks do not establish full interactive platform compatibility; Windows users should use WSL2 initially.

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

Invitations are limited to twenty beta accounts. The invitation script stores permission and sends no email. Reconciliation never guesses a refund; requests without a provider generation ID may need manual investigation. Run reconciliation and cleanup regularly through your operations scheduler.

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
