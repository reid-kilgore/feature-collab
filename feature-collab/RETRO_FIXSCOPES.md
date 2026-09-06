# Session Retro: PAS-1148 Grant Logic + JRF workflowRoleId Fix

**Session**: `fc4f35b0-0340-4f70-a5f0-cc03df978cbd`
**Date**: 2026-03-19 to 2026-03-20
**Duration**: ~26h wall-clock
**Branch**: `rk-0319-more-perms-fix-scopes` / `rk-0320-jrf-workflowroleid-update-fix`
**PRs**: #2109 (main feature, merged), #2116 (empty, closed), #2120 (fix + tests, merged)

---

## Grades

| Dimension | Grade | Notes |
|-----------|-------|-------|
| Compliance | **B+** | Strong planning, CI monitoring, commit delegation. PR #2116 confusion. |
| Experience | **A-** | 12 user messages drove entire feature. Minimal back-and-forth. |
| Technical | **B** | Sound architecture, but 2 real bugs and convention violations found. |
| **Overall** | **B+** | |

---

## Bugs Found by Retro (Not Caught During Session)

### BUG 1: Empty `jobRoleIds` causes full-company employee scan (HIGH)

`employment.repository.ts:931` — `findActiveByCompanyAndJobRoles(companyId, [])` returns ALL active employees because `...(false && { ... })` adds no filter. Called from `jobRoleFamily.service.ts:803` when a JRF has no job roles. Each employee then triggers `syncGrantsForEmployment` — **O(N) queries for every employee in the company**.

### BUG 2: `grantedBy` set to employee's own userId (MEDIUM)

`employmentMembership.service.ts:133` — System-initiated grants use the employee's own `userId` instead of `"SYSTEM"`. The existing pattern in `permissionSetBootstrap.service.ts:261` correctly uses `"SYSTEM"`. Pollutes audit trails.

### BUG 3: Atomicity gap in standalone wrapper functions (MEDIUM)

The PLAN.md promised "repo mutation + grant sync are wrapped in a Prisma interactive transaction." This is true for `createEmployee` (correctly wrapped in `txRunner`), but the standalone wrapper functions (`addLocationAssignments`, `removeLocationAssignments`, etc.) call `await repo.mutate()` then `await grantRepo.createMany()` **without a transaction**. If grant creation fails after the location write succeeds, you get a half-committed state. This affects the `employmentInvitation.service.ts` path.

### CONVENTION: No neverthrow in `employmentMembership.service.ts` (LOW)

The only service in the directory that uses plain `async/throws` instead of `Result<ok, err>`. Violates the documented architectural invariant: "Services use neverthrow Result types — NO thrown exceptions."

### TESTS: Ghost parameters testing unimplemented features (LOW)

SYNC-010, WRAP-007/008 pass a `fakeTx` 4th argument to a 3-parameter function, testing transaction passthrough that was never implemented. `as any` on mocks hides the mismatch. These tests validate nothing about the stated behavior.

### TYPE: `findByIdForGrantSync` return type is a lie (LOW)

`employment.repository.ts:651` — Returns data with `jobRole.jobRoleFamily.workflowRole` but is typed as `EmploymentWithRelations | null` which doesn't include those nested relations. Forced inline type annotations in the service (lines 55-65) as a workaround. A proper fix would create `EmploymentWithGrantSyncRelations` type.

---

## Full Bug Table

| # | Severity | Issue | File |
|---|----------|-------|------|
| 1 | **HIGH** | Empty `jobRoleIds` → full company scan | `employment.repository.ts:931` |
| 2 | **MEDIUM** | `grantedBy: userId` instead of `"SYSTEM"` | `employmentMembership.service.ts:133` |
| 3 | **MEDIUM** | Atomicity gap in standalone wrappers | `employmentMembership.service.ts` wrappers |
| 4 | **LOW** | Ghost test params (tx passthrough never implemented) | `employmentMembership.service.spec.ts` |
| 5 | **LOW** | Missing neverthrow Result types | `employmentMembership.service.ts` |
| 6 | **LOW** | Type lie on `findByIdForGrantSync` return | `employment.repository.ts:651` |

---

## Process Findings

### What Worked Well

- **Planning discipline**: CriticMarkup annotations addressed, scope locked before implementation, contracts and test specs written before code
- **Autonomous execution**: ~12 user messages drove entire feature build, CI monitoring, review cycles, and debugging
- **Commit delegation**: All commits handled by background agents, main thread never blocked on pre-commit hooks
- **CI monitoring**: Monitored after every push via background agents; failures diagnosed, fixed, and re-monitored
- **Security posture**: companyId defense-in-depth on `deleteManyByIds`, NOT_FOUND→FORBIDDEN mapping, archived role filtering, multi-tenancy isolation tested (E2E-011)
- **Bruno API demo**: Proof-of-work collection documenting the ASSIGNED_LOCATION grant lifecycle
- **Communication**: Clear status tables, triage matrices for review findings (Fix/Skip/Dismiss verdicts), structured CI reports

### Root Causes of Failures

#### E5: Pre-commit typecheck skipped (3rd time in 6 sessions)

The commit agent didn't run `tsc --noEmit` before committing. A linter auto-"fixed" the Prisma `connect/disconnect` pattern to scalar assignment, which doesn't typecheck. This is a recurring violation that keeps causing CI round-trips.

#### E8: Mocks too generous — hid the workflowRoleId persistence bug

Unit tests mocked the JRF repo, so the fact that `update()` silently dropped `workflowRoleId` was invisible. The bug was only caught during staging acceptance testing. No round-trip test exercised `repo.update() → DB → read back`.

#### E12: Post-squash-merge PR confusion

After PR #2109 merged via squash, the assistant created PR #2116 for "remaining" commits without first checking `git diff main`. This led to a wasted episode of rebasing, cherry-picking, and conflict resolution before realizing everything was already merged.

---

## Additional Technical Observations

### Code Quality Notes

- **Type cast smell**: `jobRoleFamily.service.ts:772` uses `(existing as Record<string, unknown>).workflowRoleId` — unnecessary since `findById` returns `JobRoleFamily` from Prisma which includes `workflowRoleId` as a scalar field
- **Double filter**: `syncGrantsForEmployment` defensively checks `jobRole.isArchived` (line 68) even though `findByIdForGrantSync` already filters `where: { jobRole: { isArchived: false } }` at the database level
- **Inline type compensation**: Verbose inline type annotation at `employmentMembership.service.ts:55-65` compensates for the `EmploymentWithRelations` type not including the deeper `jobRoleFamily.workflowRole` relations that `findByIdForGrantSync` actually fetches
- **`in` operator improvement**: The fix uses `"workflowRoleId" in data` which is strictly more correct than the `!== undefined` check used by sibling `employmentGroup.repository.ts:248` — handles explicit `undefined` in partial update objects

### Test Quality Notes

- 24 unit tests + 10 integration tests for sync engine — good coverage of edge cases
- 6 round-trip integration tests added in PR #2120 to cover the persistence gap
- Integration approach was correct for this bug class (unit mocks can't catch field transformation failures)
- **Conditional guards in tests**: `employmentMembership.service.spec.ts:325-330` uses `if (mockGrantRepo.createMany.called)` around assertions — makes tests pass even when behavior isn't exercised
- **Heavy `as any` usage**: 30+ occurrences in unit tests bypass the type system that would catch argument mismatches

### Scope/Churn Notes

- Planning doc footprint (1,525 lines) vs implementation footprint (~343 lines source) is 4:1 ratio — session-local docs committed to main in `docs/reidplans/`
- Two-commit fix for workflowRoleId (scalar FK → connect/disconnect) represents legitimate Prisma discovery, not churn
- `mutateAssignments` in `employee.service.ts` bypasses the wrapper functions entirely (calls repo directly + single sync at end) — correct design for batch case, but means the exported wrappers only serve `employmentInvitation.service.ts` and tests

---

## Recommendations

### Encodable (can be turned into rules in skills/agents)

1. **Commit agent hard gate on `tsc --noEmit`** — Move from CLAUDE.md prose into the commit agent's dispatch prompt as a hard prerequisite. The commit agent should refuse to proceed if typecheck fails.

2. **Round-trip tests mandatory for manually-mapped repos** — When a repo method uses manual field mapping (not Prisma's auto-select), require at least one test that exercises `repo.update(field) → repo.findById() → assert field persisted`. Add to `test-route` and `test-service` skill templates.

3. **Post-merge branch check** — Before creating a follow-up PR on a branch that had a PR merged, always run `git diff main --stat` first. If empty, the branch is fully merged. Add to the commit/PR creation workflow.

4. **Empty array guard rule** — When passing array filters to Prisma queries with conditional spread (`...(arr.length > 0 && ...)`), add early return or guard when array is empty.

5. **CodeRabbit triage template** — The Fix/Skip/Dismiss matrix with justifications was effective. Encode this as the expected format when addressing automated review comments.

6. **Lint-modified check after commit hooks** — After a commit hook modifies files (auto-fix), verify the modifications still typecheck before accepting. Add to commit agent flow.

### Not Encodable (behavioral/context-dependent)

- "Be more thorough in initial test design" — too vague, but the round-trip test rule (recommendation #2) makes it structural
- Planning doc volume control — depends on feature complexity, no fixed rule applies

---

## Trend Data

| Metric | This Session | Trend |
|--------|-------------|-------|
| E5 (typecheck) violations | 1 | 3 of last 6 sessions |
| Compliance-Experience grade gap | B+ vs A- | Consistent across 5+ retros |
| Mocks-hiding-bugs incidents | 1 | Recurring pattern |
| Post-merge PR confusion | 1 | First occurrence |

The compliance-experience grade gap pattern (B+ vs A-) is consistent: the assistant delivers good outcomes but cuts process corners. Acceptable only as long as process violations don't cause bugs — but E5 and E8 violations did cause real issues this session.

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
- Note: this file is an md5-duplicate of the passcom copy; stamped together with its original.
