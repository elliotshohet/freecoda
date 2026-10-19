# Private administrator dashboard

`/admin` shows read-only aggregate account, AI request, cloud runtime, conversation sync, and advertising metrics. Choose a rolling 7, 30, or 90 day UTC observation window. `/api/admin/metrics?days=30` returns the same protected aggregates with `Cache-Control: no-store`.

Set the server-only `ADMIN_GITHUB_IDS` environment variable to a comma-separated allowlist of immutable GitHub numeric account IDs. Obtain the IDs from GitHub's authenticated account or repository-owner API and verify the operator's authority before granting access. An empty allowlist denies everyone. Browser sign-in must map to an allowed GitHub OAuth account; device tokens, unlisted accounts and suspended profiles cannot access this dashboard. No role is granted based on signup order, repository settings, display name, or email alone. Keep this environment setting out of client bundles.

The initial operator is the existing `elliotshohet/freecoda` repository owner, verified through authenticated GitHub account ID and repository administrator permission. Configure this identity explicitly in local and production environments; it is not a code default. Authorized administrators see a Business & operations link in account settings. Other users cannot see the link and receive a private-route denial.

## What the figures mean

- AI-active accounts are distinct non-null account IDs with an inference reservation created in the selected window. The denominator includes operator/testing activity. It is not visitor traffic, paying customers, or a retained-user cohort.
- Recorded provider cost sums settled reservation ledger amounts for requests created in that window. Pending and uncertain reservations are displayed separately. This excludes platform compute, database/storage, support, subscription fees and credit reconciliation.
- Cost per AI-active account divides that recorded amount by the above request-account count. No activity produces an unavailable ratio, not a fabricated zero customer cost.
- Cloud runtime reports settled sandbox seconds, not an infrastructure invoice. Conversation counts do not expose contents or personal identifiers.
- Campaign counters are lifetime delivery values for the 50 most recent campaigns, because event timestamps are not recorded. Recorded clicks and impressions are not verified human attention. Sponsor inquiries use their actual creation dates.
- Vercel billing/credits, acquisition channels, visitor conversion, advertiser revenue, and profit remain explicitly unavailable until connected to appropriate measured data. Do not infer them from the provider ledger or campaign counters.

No campaign mutation, user-management action, price change, or billing purchase is exposed. Keep the business analysis, raw billing exports and account records private; do not publish them with this source repository.

## Validation

Run `bun test tests/admin.test.ts` and `bun --env-file=.env.test.local test tests/admin.integration.test.ts`. Integration coverage uses signed browser sessions in the isolated `freecoda_test` database to check anonymous, non-admin, device-token and allowlisted access, observation bounds, no-store responses, aggregate accuracy, and absence of account email fields.
