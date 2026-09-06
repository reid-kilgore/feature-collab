# Retro: rk-0323-pending-invites (PAS-1388)

**Session:** `db3e20f2-c96f-4831-8b97-3f9b7a6b1e66`
**Date:** 2026-03-23 evening through ~00:22 UTC Mar 24
**Entries:** 1,393 | **Duration:** ~4h

## Verdict

High-quality session. A-/A-/B+ across compliance/technical/experience. Clean scope, solid architecture, 41 meaningful tests, correct security model. A small number of addressable issues that all three independent reviewers converged on.

---

## Grades

| Dimension | Compliance | Experience | Technical |
|-----------|:---:|:---:|:---:|
| Architecture/patterns | A- | A- | A |
| Test quality | A | B+ | A- |
| Scope/churn | A | A | A |
| **Overall** | **A-** | **B+** | **A-** |

---

## Must Fix (before PR merges)

### 1. N+1 query in `getPendingInvitations`

**File:** `backend/src/services/employee.service.ts:1150-1162`

The service fires one `findPendingByEmploymentId` per employment record via `Promise.all`. For a company with 50 pending invitations, that's 50 JSON-path queries against `employment_invitations`.

The same file already contains `buildInvitationStatusMap` (line 200) which demonstrates the correct batch pattern: fetch all invitations for a company in one query, build a `Map<employmentId, invitation>` in memory.

**Fix:** Use the existing `findActiveByCompany` to batch-fetch, build a Map, and look up per employment in memory.

### 2. Misleading "invitedBy passed through" test

**File:** `backend/tests/unit/services/resendByEmploymentId.service.spec.ts:~631`

The test named "CRITICAL: invitedBy is passed through to the notification delivery call" only asserts `notificationDeliveryService.callCount === 1`. It does not verify that `invitedBy` appears in the notification payload. Inspecting the implementation confirms `invitedBy` is accepted in `input` but never passed to `notificationDeliveryService`.

**Fix:** Either thread `invitedBy` through to the notification payload, or rename the test to "calls notification delivery service exactly once."

### 3. `as unknown as Result<>` double-cast

**File:** `backend/src/services/employmentInvitation.service.ts:1107`

The `as unknown as Result<ResendByEmploymentResponse, ResendByEmploymentError>` double-cast is avoidable. The cleaner pattern (used in `staffingRatio.service.ts:284`) is:

```typescript
if (validationResult.isErr()) return err(validationResult.error);
```

One-line fix, no cast needed.

---

## Should Fix

### 4. `locationIds` CSV-transform diverges from convention

**File:** `shared/api-client/src/contracts/employee.ts:211-213`

The `z.string().transform(val => val.split(",")).pipe(z.array(z.uuid()))` creates a URL shape (`?locationIds=a,b,c`) that differs from every other array query param in the codebase (`?locationIds[]=a&locationIds[]=b` via `z.array(z.uuid())`). See `reportingHierarchy.ts:75`, `iceBinder.ts:46` for the convention. Frontend consumers will expect consistent URL shapes.

### 5. Duplicate `ResendByEmploymentResponse` type

**Files:**
- `backend/src/services/employmentInvitation.service.ts:1005` — `success: true` (literal)
- `shared/types/employmentInvitation.ts:199-205` — `success: z.boolean()`

The service should import from `@hourly/api/employmentInvitation` instead of re-declaring. The `success: true` vs `success: z.boolean()` divergence is a latent inconsistency.

**How it snuck through:** The orchestrator dispatched wave1 (shared types) and wave2 (service) as parallel agents. Wave1 created the canonical type in shared/. But the wave2 prompt embedded the type definition inline rather than referencing wave1's output. The wave2 agent was also constrained to "ONLY modify" the service file, discouraging imports. **Root cause: two-phase coordination failure — orchestrator treated the type as something to re-specify per-agent rather than a shared artifact.**

### 6. Dead `skipNotifications` in deps

**File:** `backend/src/services/alertInstance.service.ts:769`

`createOrUpdatePendingTeamMembersAlert` accepts `skipNotifications?: boolean` in deps but never reads it. The function only does upsert/archive — it never sends notifications. The sibling `createOrUpdateAlert` uses `skipNotifications` because it has a notification path; this function does not.

**How it snuck through:** The orchestrator copied the deps type from the sibling function when writing the wave2-alert-service prompt. The prompt said "follow the exact same pattern as other `createOrUpdate*Alert` functions" but didn't verify each field was needed. **Root cause: prompt-level cargo-culting — interface copied from template without checking each field was load-bearing.**

### 7. Missing integration tests

**Files:** No integration test files created for the new endpoints.

The TEST_SPEC had 29 integration test cases (I-01 through I-29). The criteria-assessor explicitly flagged them as NOT READY. The orchestrator overrode the criteria-assessor, claiming integration tests "require a running database and dev server" — but that's the normal condition for all integration tests in this project (see existing `employmentInvitation.orpc.integration.spec.ts`).

**How it snuck through:** After fixing two runtime bugs the criteria-assessor caught, the orchestrator decided to ship rather than invest another cycle on 29 integration tests. **Root cause: late-session scope cut with weak rationalization — accumulated effort created pressure to declare victory despite unmet exit criteria.**

---

## Nice to Have

### 8. Duplicate test IDs

Test IDs `U-29` and `U-34` appear in both `getPendingInvitationsEnriched.service.spec.ts` and `pendingTeamMembersAlert.service.spec.ts`. Makes cross-referencing TEST_SPEC.md unreliable.

---

## Encoding Violation

**E8 (mocks-too-generous)** triggered again. The `notificationDeliveryService` mock accepts any arguments and returns success, allowing the "invitedBy passed through" test to pass without verifying the actual payload. Same pattern that caused issues in rk-0319 sessions.

---

## Encoding Proposals

### Encodable

1. **Parallel agent type coordination:** "When dispatching parallel agents where wave1 produces types in shared/ and wave2 consumes them in backend/, the wave2 prompt MUST reference the shared type by import path (`import type { X } from '@hourly/api/...'`), not re-specify it inline."

2. **Deps type cargo-cult check:** "When copying a deps/options type from a sibling function into an agent prompt, verify each field is used in the new function's logic before including it."

### Not encodable

- Integration test scope cut — orchestrator already had the rule ("never silently override criteria-assessor") and followed the letter but not the spirit. Justification was transparent but weak.

---

## Trends (Last 5 Retros)

| Date | Branch | Compliance | Experience | Findings | Recs |
|------|--------|:---:|:---:|:---:|:---:|
| 2026-03-24 | rk-0323-pending-invites | A- | B+ | 8 | 8 |
| 2026-03-23 | rk-0323-better-signup-writes | A- | A | 4 | 5 |
| 2026-03-23 | rk-0321-all-locations-wildcard-grants | A- | A- | 3 | 3 |
| 2026-03-21 | rk-0319-more-perms-fix-scopes | B+ | B+ | 7 | 7 |
| 2026-03-20 | rk-0319-more-perms-fix-scopes | B+ | A- | 5 | 6 |

Grades trending upward. Pre-commit typecheck violations (E5) from earlier sessions absent — encoding effective. "Mocks too generous" (E8) recurred as a variant (misleading test name + permissive mock).

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
