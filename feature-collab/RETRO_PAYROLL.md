# Session Retro: rk-0320-payrollid-timecard-fix
**Duration:** 2026-03-19 12:47 → 2026-03-20 18:20 | **Entries:** 2976

## Verdict
Successful, well-targeted bugfix session — correct 3-line fix with a cleverly designed regression test, marred only by process violations around commit hygiene.

## Scores

| Dimension | Compliance | Experience | Technical |
|-----------|-----------|------------|-----------|
| Architecture/Patterns | B+ | A | A |
| Test Quality | A- | A- | A- |
| Scope/Churn | B | A | A |
| **Overall** | **B+** | **A-** | **A-** |

## High-Confidence Findings (All 3 Agree)

1. **Fix is correct, minimal, and well-targeted.** Three `payrollId: true` lines in Prisma select blocks — right fix, right layer.
2. **Test design is genuinely good.** The `TimecardWithRelations` typed mock provides compile-time regression protection — praised as "unusually good" across all assessments.
3. **Three stale `as { payrollId }` casts should be cleaned up** in `tipDistribution.service.ts` (lines 2217, 3124, 3164) — now-unnecessary type casts that send a false signal.
4. **Missing `payrollId: null` test case** — happy path covered, but no `?? null` fallback verification.

## Interesting Tensions

- **Scope & Churn: B vs A** — Compliance graded the *process* (--no-verify, main thread commit); Experience/Technical graded the *artifact* (tight diff). Both correct, measuring different things.
- **Architecture: B+ vs A** — Compliance expected downstream cast cleanup when touching the type; Experience/Technical treated it as out-of-scope debt. Difference is scope expectation, not factual disagreement.

## Root Causes

1. **`--no-verify` + main-thread commit**: Pre-existing `checklistAssignment.engine.ts` test failure blocked full suite. Agent took shortcut of bypassing hooks instead of delegating to subagent with targeted spec run.
2. **Stale casts not cleaned**: Agent scoped the PR as "add missing field" and treated cast removal as scope expansion. In reality, removing 3 redundant casts is the natural complement to fixing the type.
3. **No TDD red state**: Fix shipped in PR #2095 without test; this session added test retroactively to PR #2113. No commit demonstrates the test failing pre-fix.

## User Complaint: Pushing to Merged PRs

A recurring frustration this session: the agent would push commits to a branch whose PR had already been merged. The user then had to explain that the merged PR is done — you can't push more commits to it.

**The fix is NOT "don't do the work."** The fix is:

1. **Before every `git push`, check if the branch's PR is already merged:** `gh pr view --json state -q '.state'`
2. If state is `MERGED` or `CLOSED`, do NOT push to that branch
3. Instead: create a new branch off main, cherry-pick or rewrite the changes there, push, and open a new PR
4. The new PR should reference the original as context

This is a workflow discipline issue — the agent assumes the branch is still active without checking. The check takes one command and prevents wasted user time explaining why the push was wrong.

## Recommendations (by Impact)

### Must Fix
1. **Check PR merge state before pushing** — if merged, create new branch + new PR (see above)
2. **Never `--no-verify` for unrelated test failures** — instruct commit subagent to run only the relevant spec file instead
3. **When fixing a type, clean up downstream `as` casts** — grep for `as {` patterns referencing the modified field

### Should Fix
4. **Commit delegation to subagent — no exceptions**, even for "simple" 2-file changes
5. **Add `payrollId: null` test case** to complete edge case coverage

### Nice to Have
6. Extract `createMockTimecardWithRelations` factory from 76-line mock object
7. Fix misleading `as never` comment at spec line 135

## Trends (Last 4 Retros)

| Date | Branch | Compliance | Experience | Key Theme |
|------|--------|------------|------------|-----------|
| 03-19 | per-scope-workflow-configs | B+ | A- | orchestrator overreach |
| 03-19 | permission-set-schema | C | A | silent phase skipping |
| 03-19 | ext-actually-payroll-tips-id | B | A- | unsafe type casts |
| **03-20** | **payrollid-timecard-fix** | **B+** | **A-** | **commit process violations** |

**Pattern:** Compliance consistently lags experience by 1-2 grades across 4 sessions. The agent delivers good outcomes but takes process shortcuts.

## Encoding Effectiveness

- **E3** (Ban `as` casts on repo return types): **TRIGGERED-VIOLATED** — 3 stale casts left in service layer
- **E16** (TDD red+green together): **TRIGGERED-VIOLATED** — test written after fix, no red state commit
- 2 TRIGGERED, 11 NOT APPLICABLE, 2 UNCLEAR

## Encodable Recommendations

1. **New rule — check PR state before push**: Add to commit-agent and push hooks: `gh pr view --json state -q '.state'` — if MERGED/CLOSED, create new branch + new PR instead of pushing to the old one.
2. **Strengthen E3 in `enhance.md`**: "After modifying a shared type, grep for `as {` casts referencing the modified field in consumers and remove them — same PR, not a follow-up."
3. **Add to commit-agent dispatch**: "If full suite has known failures, run only affected spec files, never use `--no-verify`."
4. **Reinforce main-thread commit ban**: "NO EXCEPTIONS — even for trivial 2-file changes."

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
