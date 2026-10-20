# Freebuff source reuse inventory

Reviewed October 20, 2026. This records source inspection and provenance, not a legal opinion or runtime validation.

## Existing reused component retained

| Field | Evidence |
| --- | --- |
| Upstream | `https://github.com/CodebuffAI/freebuff` |
| Pinned commit | `645290efd76451a9e15a6924817689946ca06cd4` |
| Original file | `packages/agent-runtime/src/generate-diffs-prompt.ts`, `tryToDoStringReplacementWithExtraIndentation` |
| Local destination | `vendor/codebuff/indentation.ts` |
| Integration | `packages/core/src/workspace.ts` calls the helper for indentation-adjusted replacement, then rejects ambiguous replacement matches. |
| Applicable source terms inspected | Root `LICENSE` (Apache License 2.0) and `NOTICE` at the pinned commit; no nested LICENSE/NOTICE appeared in that commit's tree. |
| Required notices retained | Root `NOTICE`, `vendor/codebuff/NOTICE`, `vendor/codebuff/LICENSE`, and root `LICENSE`. Root NOTICE already names Codebuff copyright, upstream commit and the local modification. |
| Dependencies | Existing local helper; no new upstream SDK/runtime dependency introduced in this execution. |

The pinned source and current root license/notice were read from the official Git repository. This execution retains the existing adaptation and attribution; it does not claim the helper was newly imported.

## Current upstream candidates inspected

Reference snapshot: `553796b69f2c1567cfce5f06ccd63051f8feb432` in the same official repository. Root LICENSE and NOTICE were inspected; SDK package metadata also declares Apache-2.0. Those facts do not license unpublished desktop/backend code, branding, or unrelated dependencies.

| Candidate | Decision and reason |
| --- | --- |
| `packages/agent-runtime/src/tools/handlers/tool/spawn-agent-utils.ts` and related spawn handlers | Not copied. Context extraction and runtime wiring depend on Codebuff agent templates, scoped runtime dependencies, service calls, billing and other internal contracts. Importing that stack would not preserve FreeCoda's existing approvals, history/account ownership and free inference boundary without substantial additional integration. The desktop coordinator is a FreeCoda-native adapter over existing `LocalAgentService`, rather than a second agent engine. |
| `common/src/constants/freebuff-desktop-sessions.ts` | Not copied. This is primarily model/access-tier/paid-slot policy and service headers, not a portable session UI or workspace executor. FreeCoda does not import its paid entitlements or attention/installation telemetry. |
| `sdk/src/agent-publisher-trust.ts` | Not copied. Useful trust guidance, but FreeCoda does not load remote executable registry templates. Its reviewed plugin/skill/MCP installation model remains in place. No implicit always-trusted upstream publisher was introduced. |
| `sdk/src/impl/byok-lock.ts` | Not copied. It recovers PID-based BYOK locks using a loopback reaper mutex. Desktop per-repository run leases are in-process and do not require copying a BYOK configuration-lock mechanism. |
| Desktop external-agent integration | No suitable complete public managed desktop protocol adapter was established in the inspected snapshot. New adapters use the agents' documented interactive CLI entry points, not private desktop source. |

No new Freebuff code, images, wordmarks, screenshots, marketing copy, account system, ad profiling, paid catalog or provider credentials were imported. New session/terminal/preview glue is first-party FreeCoda code; upstream research is not presented as copied implementation. FreeCoda branding, app identity and canonical `elliotshohet/freecoda` release feed remain unchanged.

## Interactive CLI references

- Codex: `https://developers.openai.com/codex/cli/reference/`
- Claude Code: `https://code.claude.com/docs/en/cli-reference`

Discovery checks executable presence only. Connection requires a future explicit in-app action and native privilege/account/billing consent. No external agent, credential flow or terminal was started during source implementation. CLI flags are version-dependent; installed-version compatibility and full-screen TUI behavior remain unverified.

## Project ownership correction

The current root and CLI project LICENSE appendices now identify `Copyright 2026 Freecoda contributors`, matching the existing project NOTICE. Apache-2.0 terms are unchanged. The upstream `Copyright 2025 Freebuff, Inc.` remains verbatim in `vendor/codebuff/LICENSE`, and Codebuff attribution remains in component/root notices. Those identify the reused helper, not ownership of FreeCoda's original code. Historical release/license archives were preserved rather than rewritten. Comparison links and pinned provenance stay in this inventory/parity documentation because they are necessary evidence for this task.
