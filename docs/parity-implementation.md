# Local desktop parity implementation

October 20, 2026. Local/unreleased source only. No publication, production data change, production build or broad UI QA is implied.

## Source changes

- `desktop-session-manager.ts` coordinates real service instances with separate session IDs, histories/drafts/config storage, approval ownership, cancellation and current-session IPC. Different roots can run independently; overlapping physical paths or a shared Git repository identity serialize whole turns. No Git worktrees are created. Interactive terminals hold an exclusive repository lease. These are coordination boundaries, not an OS sandbox.
- Session records and partial stream hydration let the UI show statuses and switch back to a running conversation. Background approvals are recovered by descriptor when a session is selected. A restart restores records as interrupted; explicitly selecting one loads saved context at idle, without replaying commands or prompts.
- Renderer session controls create/switch/stop/close real sessions. Context transitions flush drafts, invalidate stale suggestions, and protect dirty editor content. Tab only inserts text. Native preview/voice views suspend before HTML approval/settings dialogs; showing an existing preview preserves its browsing history.
- `interactive-terminal.ts` provides a macOS `script(1)` PTY relay with bounded plain-text output and direct input/interrupt/close controls. This is fixed-size, non-emulated terminal output; resize/full-screen TUI parity is incomplete. Windows/Linux report unavailable rather than silently replacing the PTY with pipes.
- `external-agents.ts` discovers installed Codex/Claude commands without starting them or checking authentication. Explicit connection runs an interactive CLI with its own account/configuration/approvals/billing. This is not a managed protocol adapter or a FreeCoda-hosted free inference session.
- `usage.ts` and migration `0013_parallel_zero_cost_reservations.sql` describe admission of at most three pending, verified zero-cost free reservations. Unknown, nonzero or uncertain outstanding reservations block concurrent admission. Existing accounting advisory/row locks and costly-request uniqueness remain. This change is local source; deployed server behavior is unchanged.

## Storage and migration

Primary desktop history/draft keys and credential storage stay in their legacy locations. Additional sessions use `parallel-sessions/<uuid>` beneath the app's private data directory; child tokens are memory-only. `desktop-sessions.json` is an account-scoped manifest, written privately/atomically. Closing a session retains its history/draft files; it is not cloud conversation deletion. Explicit account changes stop sibling sessions and clear their cached credentials. The manifest does not auto-replay execution after a crash.

The SQL migration has been applied only to the isolated loopback `freecoda_test` database for integration verification. Production databases retain their one-active-reservation index until a later authorized migration/deployment. Desktop concurrent calls to an unchanged hosted server may still receive an admission conflict. Do not drop the old index manually; the source migration and admission code must be reviewed and rolled out together. No versions/tags or release claims were added.

## Evidence and limitations

Performed: source and combined-diff inspection, official upstream source/license review, and independent code review. Review fixes cover physical/Git-root lease overlap, lease lifetime after startup errors, pending approval recovery, account/terminal consent races, transcript hydration and stale suggestion scoping.

Verified locally: `bun run test` passed 213 tests across 58 files (1,395 assertions); the four newly added suites were verified separately in the focused command below and are now included in the curated script. `bun run typecheck` passed across root, web and desktop. The focused ten-file command covering session/service integration, stream reconciliation, admission, terminal security, local agent, workspace switching, voice and suggestions passed 51 tests with 388 assertions. Inference integration used loopback fixtures and terminal tests used fake processes.

Not performed: production compilation/package builds, production database migration, broad browser/Electron QA, live microphone qualification, external CLI starts/sign-in, paid inference, deployment and publishing. A separately authorized source/dev launch is for user testing; its startup outcome does not qualify all feature paths.

Still partial or intentionally unsupported:

- Voice stays dependent on Electron speech-recognition support; opening its in-app panel is not proof of microphone transcription/playback.
- External CLI TUI/version compatibility, PTY cleanup on every platform and runtime concurrency behavior require later authorized checks.
- Full terminal emulation/resizing, managed external-agent approvals, split chat panes and end-to-end multimodal attachment submission are not implemented as complete parity features.
- The hosted model remains the approved zero-price route. No broader paid catalog, paid fallback, account credential transfer or billing integration is introduced.
- This coordinator supports user-created parallel sessions, not autonomous specialist subagent planning/delegation by the model.

The guarded command `bun --env-file=.env.test.local test tests/parallel-usage-db.integration.test.ts` passed 5 tests with 19 assertions against loopback `freecoda_test`: twelve competing requests admitted exactly three; uncertain requests blocked retries; costly admission stayed serialized with accounting restored; unverified rows failed closed; independent accounts each admitted three. Random fixtures were cleaned without truncating existing data. Final desktop typecheck passed after review fixes for hydration ordering and native terminal permission checks.

## Remaining verification

1. Production rollout remains pending; isolated PostgreSQL migration/admission behavior is verified above.
2. Actual Electron UI exercise of separate-root runs, background approvals and transcript continuity; service integration fixtures for these ownership/serialization boundaries passed.
3. Account change and permission revocation during terminal consent/discovery; PTY close/child cleanup; missing external binaries and explicit separate-account connection.
4. Modal/voice/preview ordering, preview history, suggestion acceptance without submission, archive/Undo, dirty editor navigation and restart-without-replay recovery.
5. Transactional migration/admission behavior on an isolated test database before any later deployment. No production migration is authorized by this checklist.

## Exact focused verification command

```sh
bun test tests/desktop-sessions.test.ts tests/desktop-session-stream.test.ts tests/parallel-usage-admission.test.ts tests/desktop-interactive-terminal.test.ts tests/desktop-local-agent.test.ts tests/desktop-workspace-switching.test.ts tests/desktop-security.test.ts tests/desktop-voice.test.ts tests/desktop-suggestions.test.ts tests/desktop-composer-suggestions.test.ts
```

Result after final renderer review: 51 passed, 0 failed, 388 assertions. `git diff --check` also passed. Independent service/security/backend and renderer reviews were completed; no additional blocking source finding remained. This does not replace the unperformed live UI/microphone/external-agent checks.
