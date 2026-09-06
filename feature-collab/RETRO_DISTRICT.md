# Retro: PAS-1149 ASSIGNED_DISTRICT Grant Hooks

**Session:** `b9528194` | **Branch:** `rk-0323-assigned-district-perms-mgmt` | **~2 hours** | **1,889 entries**

## Verdict: A- (unanimous across all three independent analysts)

Strong session — feature delivered cleanly with 5 user messages, comprehensive security coverage, and only minor process/technical gaps.

## Top Findings

| # | Finding | Source | Impact |
|---|---------|--------|--------|
| 1 | **CodeRabbit not waited on before declaring done** | Compliance | MODERATE — violates `feedback_review_monitoring_and_session_end.md` |
| 2 | **Conditional assertion pattern masks test failures** | Technical | MODERATE — `if (mock.called)` silently passes when mock is unexpectedly invoked |
| 3 | **Walking skeleton overshot TDD plan** | Experience + Compliance | LOW — positive outcome, but deviated from incremental strategy |
| 4 | **Double-sync in removeLocation** | Technical | LOW — idempotent, but wastes DB work |
| 5 | **E8 encoding violated 3rd session running** | Synthesizer | META — encodings exist but implementation agents don't see them |

## What Worked Well

- Model tier discipline (haiku/sonnet/opus correctly allocated)
- Self-review pipeline caught 3 real security bugs before PR
- 5 user messages to PR-ready (high autonomy, low friction)
- Scope isolation: in-scope vs pre-existing bugs correctly triaged
- Pre-commit typecheck gate followed
- CI monitoring launched after push
- Commits delegated to background agent with stdout redirected
- No force pushes; specific file staging instead of `git add -A`
- Structured TDD workflow (CONTRACTS.md → TEST_SPEC.md → RED → GREEN)
- Proactive merge conflict avoidance (fetch + rebase before push)

## Compliance Details

### Violations

1. **CodeRabbit feedback not actioned before declaring done (MODERATE)** — Orchestrator stated "CodeRabbit review pending but not blocking" and suggested `/clear` then `/retro`. Memory entry `feedback_review_monitoring_and_session_end.md` requires CI + CodeRabbit + user review to resolve before ending session.

2. **Rebase executed on main thread (MINOR)** — `git stash && git rebase origin/main && git stash pop` ran on orchestrator thread. Rule targets commits (pre-commit hooks block), not rebases — grey area.

3. **No `gh comment` posted after CI green (MINOR)** — Post-tool-use hook may not have been active during session.

### Successes

- Commits delegated to background haiku agent (Agent #23)
- Pre-commit typecheck + lint executed before commit dispatch
- No force pushes across entire session
- companyId sourced from JWT, never from request body/path
- Multi-tenancy filtering verified by dedicated security review agent
- Scope guardian dispatched; in-scope vs pre-existing issues separated

## Technical Quality Details

### Architecture & Patterns: A

- Curried repository functions, service-layer DI, factory object registration all match existing patterns
- `syncGrantsForDistrictLocationChange` correctly factored out of individual hooks
- `EjrShape` type cast annotated with explanation
- Correct Prisma idiom (two-query pattern for district → tagId → ResourceTag)

### Test Quality: A-

- 28 new tests with meaningful assertions (grant counts, permissionSetId/resourceId combos, deduplication, idempotency)
- Integration tests verify real DB state including `checkPermission` round-trips and multi-tenancy isolation (E2E-011)
- Edge cases: no-district (DIST-003), null permissionSetAssignedDistrictId (DIST-004), multi-district spanning (E2E-DIST-004)
- **Smell**: `if (mockGrantRepo.createMany.called)` in SYNC-005/013/015 should use `expect(mock.called).toBe(false)` as primary assertion
- **Gap**: No test for double-sync in `removeLocationFromDistrict` where employee is at both removed and remaining locations

### Missed Opportunities

1. **Double-sync in removal path** — Employees at both removed and remaining district locations get synced twice. Idempotent but wasted DB work. Could deduplicate employment ID sets before dispatching.
2. **Duplicated query** — `findLocationIdsByDistrictId` re-queries location IDs already available from `findByIdWithRelations`.
3. **Function placement** — `findDistrictLocationsByLocationIds` lives in `employment.repository.ts` but semantically belongs in `district.repository.ts`.

### Security

- Both new repo functions filter by `companyId`
- Integration test E2E-011 verifies cross-company isolation
- Grant sync non-fatal swallowing is deliberate and documented
- No injection, exposed secrets, or missing auth

## Root Causes

1. **CodeRabbit not waited on** — Orchestrator's completion logic treats CI green as exit signal. The memory entry exists but feature-collab Phase 9 criteria don't explicitly gate on CodeRabbit.

2. **Double-sync inefficiency** — Developer optimized for correctness (idempotent sync is safe) over efficiency (skip already-synced). Acceptable at current volume.

3. **Conditional assertion pattern** — Test author used `if (mock.called)` as guard instead of asserting `toBe(false)` directly. The mock factory tracks calls, so direct assertion is safe.

## Encoding Recommendations

### 1. Gate Phase 9 on CodeRabbit (Encodable → `.claude/skills/feature-collab.md`)

Add to Phase 9 exit criteria:
> "CodeRabbit review posted and all auto-comments resolved or acknowledged before suggesting /clear or /retro"

### 2. Strengthen E8 with concrete example (Encodable → `.claude/skills/enhance.md`)

Add specific example:
> "`if (mock.fn.called)` is a test smell. Use `expect(mock.fn.called).toBe(false)` to catch unexpected invocations."

### 3. Surface violated encodings to implementation agents (Encodable → `.claude/skills/feature-collab.md`)

When dispatching implementation agents, include TRIGGERED-VIOLATED encodings from the last 3 retros in the agent prompt. Closes the gap where encodings exist but agents don't see them.

## Trends (Last 5 Retros)

| Date | Branch | Compliance | Experience | Findings |
|------|--------|------------|------------|----------|
| 2026-03-24 | rk-0323-pending-invites | A- | B+ | 8 |
| 2026-03-24 | rk-0323-capture-bug-report | A- | A- | 6 |
| 2026-03-24 | rk-0323-assigned-district-perms-mgmt (prior) | A- | A | 5 |
| 2026-03-23 | rk-0323-better-signup-writes | A- | A | 4 |
| 2026-03-23 | rk-0321-all-locations-wildcard-grants | A- | A- | 3 |

**Pattern:** Compliance consistently A- across all 5 sessions — systematic process gap (CodeRabbit gate), not one-off issues. E8 (mocks-too-generous) violated in 3 of 5 sessions — encodings not reaching implementation agents.

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
