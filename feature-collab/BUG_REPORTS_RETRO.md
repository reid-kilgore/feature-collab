# Retro: Support Ticket Capture Infrastructure (PAS-1277)

**Date:** 2026-03-24
**Branch:** `rk-0323-capture-bug-report`
**Session:** `b822b95e-dc8f-47c0-8576-7e6235519317`
**Workflow:** feature-collab (37 agent dispatches, 0 skill invocations)

## Scores

| Dimension | Grade | Notes |
|-----------|-------|-------|
| Compliance | A- | Clean TDD workflow, proper phase execution |
| Experience | A- | Efficient session, no wasted loops |
| Technical | B+/A- | Strong patterns, one real bug shipped |

## What Was Built

Backend capture infrastructure for support tickets: Zod schemas, oRPC contract, service, repository, 12 unit tests, 17 integration tests. ~1,156 lines added across 14 files.

## What Went Well

- **Pattern adherence:** Contract, handler, service, repository all slot precisely into established conventions. Matches `holiday.handlers.ts` and siblings exactly.
- **Multi-tenancy security:** Airtight. `companyId` from JWT only, cross-company screenshot access blocked via `validateFileUploads` filtering by both `id` AND `companyId`, `FORBIDDEN` returned instead of `NOT_FOUND`.
- **TDD execution:** Stubs from planning commit replaced cleanly by implementation. No false starts or churn in production code.
- **Test quality:** 29 tests with meaningful assertions on field values, not just `isOk()`. Good edge case coverage (cross-company screenshots, inactive employment, auth failures).
- **Scope discipline:** No unnecessary files touched. Feature commit is tightly scoped.

## Findings (by priority)

### P1: catch-all VALIDATION_ERROR masks DB failures as HTTP 400

**[PAS-1393](https://linear.app/passcom/issue/PAS-1393)** — `supportTicket.service.ts:111-116` catches any thrown exception and maps it to `{ type: "VALIDATION_ERROR" }`. The handler maps VALIDATION_ERROR to HTTP 400 BAD_REQUEST. A database outage would return 400 to clients instead of 500.

**Root cause:** The catch path has zero test coverage. A single unit test (`mockRepo.create.rejects(new Error("DB timeout"))`) would have exposed the semantic error immediately.

**Fix:** Drop the try-catch entirely, matching `holiday.service.ts` and all sibling services. Let oRPC's global error handler return 500.

### P2: Default-parameter repo injection diverges from convention

**[PAS-1394](https://linear.app/passcom/issue/PAS-1394)** — The service uses `repo = defaultSupportTicketRepository` as a default parameter. Every other handler passes the repo explicitly (e.g., `holiday.handlers.ts:52`). This is the only service in the codebase using this pattern.

**Fix:** Pass `repo: supportTicketRepository` explicitly from the handler.

### P3: Unnecessary findMany round-trip inside transaction

**[PAS-1395](https://linear.app/passcom/issue/PAS-1395)** — After `createMany` for screenshots, the repo re-queries them with `findMany`. The `screenshotFileIds` are already known; no new information gained.

**Fix:** `screenshots: screenshotFileIds.map(id => ({ fileUploadId: id }))`.

### P3: employmentId response schema overstates nullability

**[PAS-1396](https://linear.app/passcom/issue/PAS-1396)** — `SupportTicketResponseSchema` marks `employmentId` as `.nullable()` but the service guarantees non-null. Leaks DB schema ambiguity to the API contract.

**Fix:** Change to `z.uuid()` in the response schema.

### P3: Unreachable default branch in handler

**[PAS-1397](https://linear.app/passcom/issue/PAS-1397)** — `SupportTicketError` has exactly 3 members, all explicitly matched. The `default:` branch is dead code. Removing it lets TypeScript exhaustiveness checking catch future additions.

### Note: Commit message accuracy

The commit message claims "17 integration tests (all passing)" but the demo run showed 6 failures (auth setup returns `undefined` for `accessToken`). This is an environment issue, not a code bug, but the message overstates the test state.

## Process Observations

- **No scaffolding skill used:** The `add-orpc-endpoint` skill was not invoked despite being available. The feature-collab workflow used code-explorer and code-architect agents to manually write the endpoint. The catch-all bug might have been avoided if the skill's template had a guard against it — but it also might not, since the skill's own template includes `VALIDATION_ERROR` in its error union.
- **Error-path TDD gap:** The TDD stubs included ~8 validation tests that were correctly removed (Zod handles validation at the oRPC layer). However, no error-path tests replaced them — the catch block was added without a corresponding test. This is a recurring pattern: happy paths get TDD attention, error paths get added "for safety" without coverage.
- **Removed tests were the right call:** The 9 deleted validation unit tests were principled removals (testing Zod's job at the service layer is wrong). The integration tests cover those paths instead.

## Encoding Recommendations

Two rules identified for encoding into skill/agent definitions. Status: **pending user decision** on whether to encode into `add-orpc-endpoint` only vs. both `add-orpc-endpoint` and `feature-collab:code-architect`.

1. **No catch-all try-catch mapping to VALIDATION_ERROR** — Services must not use catch blocks that map infrastructure exceptions to business error types. Let exceptions propagate to the oRPC global error handler.
2. **Test the catch path** — If a service has a catch block, the test file must include a test where the repo method rejects with an Error, verifying the error type and HTTP status code mapping.

## Changes Applied

Processed 2026-08-19 (batch: 21 unique reports 2026-03-16..04-21; user-approved).

- Canonical files changed: decision-elicitation program (merged PR #2 of meta-agent-repo):
  delivery-core decision registers, blocking taxonomy, scoping-miss ledger, gap-question
  standard, recommendation guards, final-review reconciliation; criteria-assessor register
  integrity; code-architect unpinned-choice and invariant-change escalation. This batch
  (rk-0819-retro-ingest): test-gap-finder + test-implementer test-precision rules;
  feature-collab artifact-type carve-outs and CI-rename guard; delivery-core agent-failure
  surfacing; retro-synthesizer encoding-table prune.
- Project follow-up: none — product findings marked unverified-historical per user decision
  2026-08-17 (no verification, no tickets).
- Pressure-test: behavioral, fresh gpt-5.6-terra Codex subjects — carve-out gaming refused on
  exact rule text; all three baited test-precision violations flagged by rule. PASS.
- Skipped duplicates (already present in current skills): pre-commit typecheck gate,
  merged-PR push check, post-squash diff check, divergence check, worktree isolation,
  branch verification, CI monitoring discipline, money asymmetric-fixture rule,
  invariant-change STOP, orchestrator-reads-reasoning, abstraction-boundary handling
  (upgraded to the behavioral two-corrections frame check), outage model-tier rule.
- Skipped as project-specific or unsupported: per-repo staging URLs, Hourly schema-PR
  convention (lives in repo CLAUDE.md), one-time code fixes listed in the reports,
  keyword-based "underneath" detection (superseded by the frame-check rule), grades and
  E-number bookkeeping (retired).
