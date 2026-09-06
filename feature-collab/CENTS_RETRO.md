# Session Retro: rk-0327-cents-convert-be

**Branch:** rk-0327-cents-convert-be | **Duration:** ~3h (19:05-22:08 UTC) | **Entries:** 191

## Verdict

Session delivered a correct, well-tested feature but wasted ~15 minutes building a hand-rolled parser before the user prompted the obvious library question — a planning gap that two of three analysts flagged independently.

## Grades

| Dimension | Grade |
|-----------|-------|
| Compliance | B |
| Experience | B+ |
| Technical Quality | B+ |

## Agreement (High Confidence Findings)

1. **Library evaluation happened too late.** Both experience and technical analysts flagged this. The user had to prompt "was there not a reasonable library to use here?" after 60 lines were written. The technical analyst documented the full rewrite. Confirmed planning gap.

2. **The `amountCents <= 0` guard is semantically ambiguous.** Technical flagged it as partially redundant. Compliance noted the utility throws exceptions (deviating from neverthrow). Both point to unclear ownership of the "zero-cent" validation boundary.

3. **Core implementation is correct and well-tested.** All three analysts agree the final `big.js` implementation is sound, tests are meaningful, and the feature was delivered.

## Disagreement (Interesting Tensions)

1. **Compliance says "FAIL on commit blocking" vs. Experience says "session flow was smooth."** The commit agent happened at session-end when the user was done making decisions. A blocking commit at session-end has zero user-facing impact. Compliance correctly identifies a process violation, but user impact dominates — this is low-priority.

2. **Compliance says "model selection FAIL" vs. Technical says nothing.** Model selection is a cost/efficiency concern, not a quality concern. Using Sonnet for a commit task wastes tokens but produces identical output. The violation is real but purely economic.

## Root Causes

1. **Hand-rolled-then-library rewrite** — The planning phase focused on *what* to convert and *where* to put it, but skipped the *how* question for the arithmetic. The agent assumed string parsing was the implementation approach without evaluating alternatives. A senior engineer's instinct — "currency math = use a library" — was missing from the planning evaluation.

2. **Unverified library recommendation (currency.js)** — The agent pattern-matched on "JavaScript currency library" and confidently asserted currency.js was pragmatic without checking npm stats, last publish, or maintenance status. The user's pushback ("you are just saying stuff") forced the research that should have preceded the recommendation. This is a recurring pattern: **confident assertion before evidence gathering**.

3. **Duplicate `dollarsToCents` left in csvTipUpload.service.ts** — The concept-tracing agents found the existing function during planning, but the scope was "manual tip import path only." The consolidation was implicitly deferred but never explicitly noted as a follow-up — no TODO, no ticket, no PLAN.md entry.

## Recommendations (Ordered by Impact)

### Must Fix

1. **During planning, evaluate build-vs-buy for any non-trivial algorithm** (currency math, date parsing, CSV parsing). The planning agent should include an "Implementation approach" section that considers library options before coding begins.
2. **Never assert library recommendations without verification.** Check npm stats before presenting. If unable to verify, explicitly state uncertainty.

### Should Fix

1. **When a new utility supersedes an existing function, flag the old one for consolidation** with a TODO or PLAN.md follow-up.
2. **Use Haiku for commit/PR agents** per the model selection table.
3. **Utility functions in a neverthrow codebase should return Result types** instead of throwing.

### Nice to Have

1. **Add service-level test for zero-cents edge case** (`"0.001"` rounds to 0, blocked by guard).

## Process Violations

- Commit agent blocked main thread (should use `run_in_background: true`)
- Sonnet used for commit/PR agent (should be Haiku per model table)
- No CI/CodeRabbit monitoring launched after PR push (declared "all done" prematurely)

## Metrics

| Metric | Compliance | Experience | Technical |
|--------|-----------|------------|-----------|
| Overall grade | B | B+ | B+ |
| Skill selection | F | N/A | N/A |
| Plan discipline | A | N/A | N/A |
| Agent dispatch | C | N/A | N/A |
| Architecture/patterns | N/A | N/A | B+ |
| Test quality | N/A | N/A | A- |
| Scope/churn | N/A | N/A | B |
| Efficiency | N/A | B+ | N/A |
| Flow | N/A | B+ | N/A |
| Communication | N/A | B | N/A |

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
