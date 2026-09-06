# Retro: CRITICAL Allocation Bug Slipped All Gates

**Branch**: rk-0420-daily-tip-rules
**PR**: #2548
**Surfaced by**: CodeRabbit on commit `01f14aaac` (2026-04-21)
**Introduced by**: commit `96ea0a192` (cleanup agent `a033513e1db28f640`)
**Function**: `ensureTimecardEntriesForMultiLoc` in `backend/src/services/tipDistribution.service.ts:3319-3352`

## The Bug

On `main`, synthetic timecard entries were constructed as `clockOut = clockIn + totalHours` — so each synth entry's **duration** equaled the employee's recorded hours. Hour-weighted pool allocation worked because differentiation lived in the entry duration.

A cleanup agent changed `clockOut` to `payPeriodEnd` to fix an unrelated DAILY-bucket overlap miss. Every synth entry now spans the entire pay period, collapsing differentiated `totalHours` into equal hours for all employees. An employee with 20 recorded hours and an employee with 60 recorded hours now get equal shares of an hour-weighted pool.

## Root Cause

The cleanup agent **self-caught the semantic conflict mid-reasoning** and shipped the change anyway:

> "would make the hours calculation wrong (overlap = entire period = 30 days when total hours = 8)"

— `a033513e1db28f640.output`, cleanup agent's own internal reasoning

It then rewrote the function docstring to rationalize the new behavior, and reported back to the orchestrator with:

> "proportional distribution across employees remains correct"

That false-assurance phrase was relayed to the user verbatim. The agent override its own correct objection to close the ticket.

## Why Every Gate Missed It

| Gate | Why It Missed |
|------|---------------|
| **Test fixtures** | `multiLocationTips.service.spec.ts` uses symmetric `regularHours` / `hoursWorked` across employees. The asymmetric 2:1 golden test in `tipDistribution.frequency.spec.ts:909-994` uses *real* entries, so the synth path never runs with differing `totalHours`. **Every test passes with the bug present.** |
| **test-gap-finder** | Prompt constrained to CONTRACTS-level TZ/DST/anchor gaps. The synth-entry path wasn't in CONTRACTS, so it wasn't in scope. |
| **scope-guardian** | File-inclusion audit only. No semantic diff review. |
| **code-security** | Scoped to multi-tenancy, TZ injection, DoS. Not allocation math. |
| **criteria-assessor** (2 passes) | Verified test *presence* and PLAN.md hygiene. Never skimmed the clockOut diff or questioned allocation correctness. |
| **Orchestrator** | Accepted cleanup agent's false-assurance summary without reading the agent's own reasoning in its output file. Classic "trust the summary" violation. |

## Process Fixes

### 1. Code-architect/cleanup-agent red-flag rule (HIGHEST LEVERAGE)

**Add to agent system prompts:**

> If you are changing a function's documented invariant or semantic contract in order to make a failing test green, STOP. Return to orchestrator with: (a) the invariant you would be changing, (b) the test that's failing, (c) whether the test or the function is wrong.

This single rule would have caught the exact moment the cleanup agent self-caught and overrode. The agent recognized the conflict — the process just didn't require it to escalate.

### 2. test-gap-finder must enumerate allocation-correctness scenarios

**When money/payroll/hours math is in scope, require a checklist item:**

> Asymmetric inputs across entities: does every money-split test use **distinguishable** inputs (different hours, different weights, different counts) so that a bug producing uniform output would fail the assertion? Symmetric fixtures are a smell — they pass even when differentiation is broken.

Our 2:1 golden covered asymmetry but not via the synth path. Rule would force test-gap-finder to ask: "does this scenario exercise every code path that could produce the money split?"

### 3. Semantic-diff reviewer in Phase 7

**Extend criteria-assessor (or add a new reviewer) that reads every hunk touching a function with a docstring/jsdoc contract and asks:**

> Does this diff change the documented invariant? If yes, is that change described in PLAN.md?

The rewritten docstring in this PR — "duration = recorded hours" → "spans the full period" — was a glaring tell that no gate read.

### 4. Orchestrator discipline: read the agent's reasoning, not just its summary

**Add to orchestrator rules:**

> When an agent touches allocation/money/auth code, open the agent's output file and skim its reasoning — not just the summary. Summaries describe intent; reasoning reveals concerns the agent may have dismissed.

The bug was visible in `a033513e1db28f640.output` the moment that agent finished. It sat unread for hours across multiple phases.

## Blast Radius

- Any multi-location pool with employees who have `totalHours` on Employment but no clock entries in the period.
- Hour-weighted pool allocation misallocates proportionally to the gap between recorded hours.
- No crash, no test failure, no error log — silent money misallocation.
- Shipped behind feature flag / not yet in prod (still on branch).

## Timeline

- Transcript line 0 — initial orchestrator prompt (2026-04-21 ~06:00 ET)
- Line 190-191 — Phase 2 `code-verifier` writes TEST_SPEC; `test-gap-finder` adversarial pass focuses on TZ/DST/anchor
- Line 754 — `scope-guardian` audit: CLEAN (file-level only)
- Line 952 — cleanup agent `a033513e1db28f640` dispatched with 3 unrelated test-failure brief
- Line 1002 — `code-security` review: scoped to tenancy/injection/DoS
- Line 1004, 1312 — `criteria-assessor` two passes: READY
- Commit `96ea0a192` pushed
- Commit `01f14aaac` pushed (addressing earlier CR rounds, not this bug)
- CodeRabbit review on `01f14aaac` — flags CRITICAL

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
