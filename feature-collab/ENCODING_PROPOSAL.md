# Encoding Proposal: Batch Retro Ingestion

**Date**: 2026-04-28
**Source retros**: 12 NEW retros (Mar 19 – Apr 23) + RETRO_CRIT.md
**Proposed changes**: 3 strengthenings + 20 new encodings across 8 files

---

## Strengthenings (Existing Encodings — violated 2-3x+)

### E2 — Compaction requires /pickup re-invocation
- **Current form**: Rationalizations table entry in enhance.md, feature-collab.md, bugfix.md, refactor.md, hotfix.md, release.md
- **Violations**: 3x+ (timeseries, handlebar, onboarding)
- **Proposed**: Promote to red flag: "After 1+ compaction, invoke `/handoff` before resuming — do not rely on compressed summary alone"
- **Source**: handlebar, onboarding-loc-inactive

### E3 — Ban `as` casts on repository return types
- **Current form**: Rationalizations table entry in enhance.md
- **Violations**: 2x (payroll-tips-id, sq-team-imp)
- **Proposed**: Add adjacent rationalizations entry: "Don't widen Prisma enums to `string` for testability — import enums in test files instead. Widening defeats type safety the same way `as` does."
- **Source**: sq-team-imp

### E8 — Mocks-too-generous warning
- **Current form**: 2 rationalizations table entries in enhance.md
- **Violations**: 3x+ (sq-team-imp, baseball-cards-next, handlebar)
- **Proposed**: **PROMOTE to red flag with STOP**: "If test doubles inject fields/states the actual query doesn't return, STOP — the test passes by accident. Re-sync tests must stub `findFirst` to return an existing record with the claimed prior status, not `null`. A `null` return tests first-time insert, not re-sync."
- **Source**: sq-team-imp, baseball-cards-next, handlebar

---

## New Encodings

### E18 — STOP: invariant change to make test green
- **Target**: `agents/code-architect.md`
- **Placement**: Red Flags — STOP section (new bullet) + Rationalizations table entry
- **Encoding**: If you are changing a function's documented invariant or semantic contract in order to make a failing test green, STOP. Return to orchestrator with: (a) the invariant you would be changing, (b) the test that's failing, (c) whether the test or the function is wrong.
- **Rationalization entry**: "I need to update the docstring to match my fix" → "If the docstring describes an invariant (not just a summary), changing it IS changing the contract. Escalate — don't rewrite."
- **Source**: RETRO_CRIT (rk-0420-daily-tip-rules)
- **Confidence**: HIGH — directly catches the moment cleanup agent a033513e self-caught the semantic conflict and overrode it

### E19 — Asymmetric inputs for money/allocation tests
- **Target**: `agents/test-gap-finder.md`
- **Placement**: New gap category "Allocation/Money-Split Gaps" after existing categories
- **Encoding**: When money/payroll/hours/weighted-pool math is in scope: does every money-split test use **distinguishable** inputs across entities (different hours, different weights, different counts)? Symmetric fixtures are a smell — they pass even when differentiation is broken. A bug that produces uniform output must fail at least one assertion.
- **Source**: RETRO_CRIT
- **Confidence**: HIGH — symmetric fixtures masked the `clockOut = payPeriodEnd` bug across all test suites

### E20 — Short-circuit tests must assert negative path
- **Target**: `agents/test-gap-finder.md`
- **Placement**: Add to Functional Gaps section
- **Encoding**: Short-circuit/early-return tests must assert the skipped code path was NOT called (e.g., `expect(heavyQuery).not.toHaveBeenCalled()`), not just that output is correct. Without the negative assertion, the test passes even if the short-circuit is broken and the full path runs.
- **Source**: team-filter-report-chain
- **Confidence**: MEDIUM — specific, testable, 1 occurrence

### E21 — Concurrency invariants at service boundaries
- **Target**: `agents/test-gap-finder.md`
- **Placement**: New gap category "Concurrency/Race Gaps" after existing categories
- **Encoding**: At service-layer write boundaries, enumerate concurrency invariants: create-first + P2002 upsert, advisory locks, TOCTOU on provisioning, serializable isolation. If a service creates-then-updates across two calls without a transaction or idempotency guard, flag it.
- **Source**: handlebar
- **Confidence**: MEDIUM — TOCTOU on manager-group provisioning missed by gap-finder because prompt doesn't enumerate concurrency

### E22 — Existing invariants vs new feature surface
- **Target**: `agents/test-gap-finder.md`
- **Placement**: Add to Functional Gaps section
- **Encoding**: When a new feature changes implicit guarantees (e.g., partitioning data by location that was previously unpartitioned), check: what existing predicates depend on the old guarantee? A predicate like `canContinue()` that assumes "all items in one bucket" silently breaks when items split across locations.
- **Source**: onboarding-loc-inactive
- **Confidence**: MEDIUM — `canContinue` predicate was silently broken; subtle but real

### E23 — Docstring invariant diff check
- **Target**: `agents/criteria-assessor.md`
- **Placement**: New subsection "Docstring Invariant Review" under Specific Checks to Perform
- **Encoding**: For every hunk touching a function with a docstring/jsdoc contract: did the documented invariant change? If yes, is that change described in PLAN.md? If no PLAN.md reference, flag NOT READY. A rewritten docstring that changes semantics (e.g., "duration = recorded hours" → "spans the full period") is a contract change, not a documentation update.
- **Source**: RETRO_CRIT
- **Confidence**: HIGH — the rewritten docstring was a glaring tell that no gate read

### E24 — Test title drift check
- **Target**: `agents/test-implementer.md`
- **Placement**: Phase step with verification (add near end of implementation process)
- **Encoding**: Before finalizing TEST_SPEC, re-read the final implementation and verify test titles/descriptions still match actual code paths. Title drift from Phase 2 → Phase 5 is a known failure mode — test [1.1.3] may describe behavior that was restructured in Phase 4. Grep test file for each TEST_SPEC title and confirm the described behavior matches the implementation.
- **Source**: handlebar (3rd retro to flag this pattern)
- **Confidence**: HIGH — recurrence demands a phase step, not just guidance

### E25 — Orchestrator reads agent reasoning, not just summary
- **Target**: `commands/enhance.md` + `commands/feature-collab.md`
- **Placement**: Rationalizations table entry in both files
- **Encoding**: "The agent says it's done and the fix looks good" → "When an agent touches allocation/money/auth code, open the agent's output file and skim its reasoning — not just the summary. Summaries describe intent; reasoning reveals concerns the agent may have dismissed. A false-assurance summary sat unread for hours in the CRIT incident."
- **Source**: RETRO_CRIT
- **Confidence**: HIGH — bug was visible in agent's own reasoning output; orchestrator relayed false-assurance summary verbatim

### E26 — CR feedback scope gate
- **Target**: `commands/enhance.md` + `commands/feature-collab.md`
- **Placement**: Rationalizations table entry in both files
- **Encoding**: "CodeRabbit suggested this improvement so I'll add it" → "CR feedback must pass a scope gate before being actioned. Classify each finding as `in-scope-of-PLAN` / `out-of-scope-defer` / `blocking-correctness`. Out-of-scope items require user approval before implementation. Actioning out-of-scope CR feedback without re-checking PLAN.md caused 2 wasted commits + reversions."
- **Source**: handlebar + onboarding-loc-inactive (2 retros)
- **Confidence**: HIGH — identical finding in 2 independent retros

### E27 — Contract phase: enumerate existing mechanics
- **Target**: `commands/enhance.md` (contract phase section)
- **Placement**: Phase step in contract/planning phase
- **Encoding**: Before proposing a new UI affordance or API surface, the contract phase must enumerate existing mechanisms that achieve similar goals. "Does this capability already exist under a different name or in a different form?" A Skip button was proposed without discovering that Delete already handled the exclusion use case — 2 commits + tests discarded.
- **Source**: handlebar + onboarding-loc-inactive (2 retros)
- **Confidence**: HIGH — identical finding in 2 independent retros

### E28 — Deferred items need tracking tickets
- **Target**: `commands/enhance.md`
- **Placement**: Rationalizations table entry
- **Encoding**: "I'll note the deferral in PLAN.md" → "When a plan item is explicitly deferred, create a tracking ticket (Linear issue or bd task) immediately. A deferred item in PLAN.md without a ticket is forgotten — PLAN.md is pruned at session end, and the deferral evaporates."
- **Source**: protect-admin-permission-workflows
- **Confidence**: MEDIUM — backfill never happened because deferral was only in PLAN.md

### E29 — Build-vs-buy evaluation during planning
- **Target**: `commands/enhance.md`
- **Placement**: Phase step in planning/contract phase
- **Encoding**: During planning, evaluate build-vs-buy for non-trivial algorithms (currency math, date parsing, CSV parsing, crypto). Include an "Implementation approach" section in PLAN.md considering library options BEFORE implementation starts. 15 min was wasted hand-rolling cents conversion before rewriting to big.js after user prompted "was there not a library?"
- **Source**: cents-convert-be
- **Confidence**: MEDIUM — specific waste, user had to intervene

### E30 — Library recommendations require verification
- **Target**: `commands/enhance.md`
- **Placement**: Rationalizations table entry
- **Encoding**: "I recommend currency.js for this" → "Never assert library recommendations without verification. Check npm weekly downloads, last publish date, and open issues count before presenting. If you haven't verified, say 'I haven't checked the maintenance status' explicitly. User called out an unverified recommendation as 'just saying stuff.'"
- **Source**: cents-convert-be
- **Confidence**: MEDIUM — trust erosion from confident-but-unverified recommendation

### E31 — Flag superseded functions for consolidation
- **Target**: `commands/enhance.md`
- **Placement**: Rationalizations table entry
- **Encoding**: "The new utility function is cleaner" → "When concept-tracing reveals an existing function that the new code would duplicate (e.g., existing `dollarsToCents` in csvTipUpload.service.ts), add it to PLAN.md Follow-up section and note the duplication. Don't leave two functions doing the same thing without flagging it."
- **Source**: cents-convert-be
- **Confidence**: MEDIUM — duplicate left unflagged

### E32 — Error-handling changes need recovery tests
- **Target**: `commands/enhance.md`
- **Placement**: Rationalizations table entry
- **Encoding**: "The error handling is straightforward, existing tests cover it" → "When changing error-handling behavior (e.g., `Promise.all` → `Promise.allSettled`), the test spec MUST include a test for the recovery/partial-failure path. The new behavior's whole point is different failure handling — if that path is untested, the change is untested."
- **Source**: baseball-cards-next
- **Confidence**: MEDIUM — root bug was `Promise.all→allSettled` with zero recovery test coverage

### E33 — Check for open PR before dispatching to worktree
- **Target**: `commands/enhance.md` + `commands/feature-collab.md`
- **Placement**: Red flag
- **Encoding**: Before dispatching work to an existing worktree/branch, run `gh pr list --head <branch>`. If an open PR exists, STOP — don't send agents to branches with open PRs unless explicitly instructed. False-start agent was dispatched to a branch that already had a PR up.
- **Source**: baseball-cards-next
- **Confidence**: MEDIUM — preventable waste

### E34 — Triple-repeat patch triggers root-fix proposal
- **Target**: `commands/enhance.md`
- **Placement**: Red flag
- **Encoding**: After the 2nd manual patch to the same file in one session, orchestrator pauses and proposes a root fix instead of applying a 3rd patch. Three patches to the same file means the first two didn't solve the problem — stop patching and investigate. `preview-deploy.sh` was patched 3× instead of root-fixed once.
- **Source**: onboarding-loc-inactive
- **Confidence**: MEDIUM — specific, mechanical trigger

### E35 — Serialize concurrent agents on shared checkout
- **Target**: `commands/feature-collab.md`
- **Placement**: Red flag with STOP
- **Encoding**: Never dispatch two agents that may stage files or commit on the same git checkout simultaneously. Use `git worktree` for isolation, or run agents sequentially. 4 agents were killed and ~45 min was wasted from shared working directory collisions in a single session.
- **Source**: employment-scoped-timeseries-queries
- **Confidence**: HIGH — 45 min wasted, most impactful operational failure in batch

### E36 — Consolidation sub-phase after code-architect fan-out
- **Target**: `commands/feature-collab.md`
- **Placement**: Phase step (new consolidation sub-phase after implementation)
- **Encoding**: After code-architect fan-out (multiple agents implementing across files), dispatch a haiku agent to grep for ≥3 callsites of ≥10-line repeated blocks and propose a shared helper. Create-first + P2002 upsert pattern was copy-pasted 6× across 2 services with no deduplication.
- **Source**: handlebar
- **Confidence**: MEDIUM — real duplication, but this is a heavyweight phase step for feature-collab only

### E37 — Strip debug markers before commit
- **Target**: `commands/feature-collab.md`
- **Placement**: Phase step in commit phase
- **Encoding**: Before commit phase, grep for debug/WIP markers: `TDD RED STATE`, `TODO REMOVE`, `FIXME`, `console.log` in test files, `debugger` statements. Strip or flag before committing. A `TDD RED STATE` header shipped in a prod test file.
- **Source**: handlebar
- **Confidence**: MEDIUM — detectable via grep, embarrassing to ship

---

## Skipped (9 items)

| Recommendation | Source | Reason |
|---|---|---|
| Spike: check .gitignore before commit dispatch | logical-worker-split | Narrow operational detail for spike.md |
| Spike: orphan audit (enum → handler mapping) | logical-worker-split | Too narrow to enum-dispatcher pattern |
| CodeRabbit reply agents must be Sonnet-tier | timeseries-queries | Model table in enhance.md already covers model selection |
| Security invariants from CLAUDE.md are non-negotiable | timeseries-queries | "Follow the rules" restated — not a new encodable rule |
| Exit criteria verification before declaring done | timeseries-queries | Already covered by criteria-assessor's existing Iron Law + verification gate |
| Spike-to-implement metrics transition | timeseries-queries | Narrow operational detail for spike.md |
| Pre-existing wip items DONE without confirmation | baseball-cards-next | Already a rule that was violated; re-encoding won't fix the violation |
| Systemic gaps → bd epic not single ticket | whyishandlebarnotc | Targets beads-plan-to-epic skill, not feature-collab plugin |
| Each prod UPDATE/DELETE gets own pre-flag | whyishandlebarnotc | Single occurrence, hotfix-specific, low recurrence signal |

---

## Summary

| Category | Count |
|---|---|
| Existing encodings strengthened | 3 (E2, E3, E8) |
| New encodings | 20 (E18–E37) |
| Files modified | 8 |
| Skipped recommendations | 9 |
| Source retros processed | 13 |

### Files touched

| File | Changes |
|---|---|
| `agents/code-architect.md` | E18 (red flag + rationalization) |
| `agents/test-gap-finder.md` | E19, E20, E21, E22 (2 new gap categories + 2 additions to Functional Gaps) |
| `agents/criteria-assessor.md` | E23 (new subsection) |
| `agents/test-implementer.md` | E24 (phase step) |
| `agents/retro-synthesizer.md` | E-table update (20 new rows) |
| `commands/enhance.md` | E2↑, E3↑, E8↑, E25–E34 (strengthenings + 10 new entries) |
| `commands/feature-collab.md` | E25, E26, E27, E33, E35, E36, E37 (7 entries, some shared with enhance.md) |
