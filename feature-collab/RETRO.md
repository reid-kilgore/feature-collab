# Session Retro: d60b6d93-9d1e-4e3d-ab9a-9f1631014ae3
**Branch:** rk-0330-employment-scoped-timeseries-queries | **Duration:** 2026-03-30T20:22 to 2026-03-31T17:48 (~21.5 hours) | **Entries:** 1166

## Verdict: Feature shipped with strong technical quality, but agent coordination failures and process shortcuts added ~45 minutes of waste and left documentation and test gaps that need cleanup.

## Compliance Summary
- **Workflow adherence: B-** -- Phases followed but architecture checkpoint entered without explicit user approval; DEMO.md exit criterion silently dropped
- **Agent dispatch: B+** -- Model tiers mostly correct; CodeRabbit assessment dispatched as Haiku when it required Sonnet-level judgment
- **Anti-rationalization: C** -- companyId security finding initially rationalized away before being corrected; boilerplate CodeRabbit replies left unaddressed for 3.5 hours
- **PR discipline: B** -- Schema PR correctly isolated, but 3 schema PRs where 1 was needed; force-push without user request
- **Process compliance: B-** -- Pre-commit typecheck run correctly; 3 commits on main thread; 14 sleep-polling instances

## Experience Summary
- **User satisfaction: B** -- Only 2 user corrections in 7 messages (high autonomy), but both corrections were for rules already in CLAUDE.md
- **Efficiency: C+** -- Fast spike and implementation phases (~30 min), but ~45 min lost to branch collisions, agent scope creep, and CodeRabbit reply loop
- **Communication: B+** -- Crisp status updates and phase transitions; silent incorrectness on CodeRabbit replies was the gap
- **Agent coordination: D+** -- Shared working directory caused repeated stash/branch collisions; 4 killed agents; unauthorized refactoring by test agent
- **Flow: C+** -- 3 schema PRs, branch collision overhead, and slow CodeRabbit cycle disrupted end-to-end flow

## Technical Quality Summary
- **Architecture/patterns: A-** -- Curried repository pattern, neverthrow boundaries, and filter-object approach all correct; one `throw new Error()` inconsistent with neverthrow contract
- **Test quality: A-** -- ~56 meaningful tests with good edge case coverage; batch path lacks unit tests; multi-tenancy isolation test is weak
- **Scope/churn: A** -- 0 unnecessary files touched, no artifacts or debug code
- **Security: A-** -- companyId correctly flows from JWT through all new paths; pre-existing `findByLocation` lacking companyId not flagged as fast-follow

## Agreement (High Confidence Findings)

1. **companyId security rationalization was a real problem.** Compliance flagged the anti-rationalization; technical flagged the CLAUDE.md security invariant; experience noted it as a user correction from documented rules. All three reports independently confirm this was a process failure where the assistant argued against a documented security requirement before being corrected.

2. **Agent coordination on shared working directory is the session's biggest operational failure.** Compliance documented concurrent agent branch/stash conflicts. Experience scored agent coordination 5/10 and identified 4 killed agents. Technical quality was unaffected (agents eventually produced correct code), but the time waste was significant.

3. **Test coverage gaps in the batch path.** Technical flagged `fetchBatchEmploymentTimeseries` as untested at unit level. Compliance noted integration tests were committed separately. Both point to the batch path -- the more complex new code -- having weaker coverage than the simpler single-employment path.

4. **throw new Error() at service.ts:414 is inconsistent.** Technical flagged this as violating the neverthrow contract. Compliance's anti-rationalization finding is thematically related -- both show the assistant treating "it works" as sufficient when the codebase has explicit conventions that say otherwise.

## Disagreement (Interesting Tensions)

1. **Compliance rates overall as "largely compliant with gaps" vs. Experience rates 6.5/10 (mediocre).**
   - Compliance sees phases followed, gates respected, schema PRs isolated -- structural process adherence.
   - Experience sees 45 minutes of wasted time, 4 killed agents, 3 schema PRs, and a 3.5-hour CodeRabbit loop.
   - **Mechanism**: Compliance evaluates whether the process was followed in structure (it was). Experience evaluates whether the process produced an efficient outcome (it did not). The process was followed in letter but the agent coordination layer -- which sits *below* the process framework -- broke down repeatedly. Process adherence is necessary but not sufficient for a good session.

2. **Technical rates A- (strong) vs. Experience rates 6.5/10 (mediocre).**
   - Technical sees clean code, correct patterns, good test coverage, minimal churn.
   - Experience sees branch collisions, slow cycles, and user corrections.
   - **Mechanism**: Technical quality evaluates the artifact produced. Experience evaluates the journey to produce it. The implementation work was fast and correct (~25 min for walking skeleton + 68 green tests). The overhead was entirely in git operations, agent coordination, and review cycles -- none of which affect code quality but all of which affect the user's experience of the session.

## Root Causes

1. **Shared working directory collisions** -- Root cause: The assistant dispatched multiple agents against the same git checkout without serialization or worktree isolation. The first collision should have triggered a policy change for the remainder of the session (use worktrees or serialize agents), but the same mistake was repeated.

2. **companyId rationalization** -- Root cause: The assistant applied domain reasoning ("locations are already company-scoped") to override an explicit security invariant in CLAUDE.md. The assumption was that understanding *why* a rule exists justifies not following it. The correct behavior is to follow documented security invariants unconditionally and flag disagreement as a question, not a conclusion.

3. **3 schema PRs instead of 1** -- Root cause: The partial index improvement was identified late (after the base schema PR was already in auto-merge). The race condition with auto-merge forced a second schema PR. The DROP+CREATE in a single migration file then forced a third. If the partial index had been designed correctly during the initial schema phase, one PR would have sufficed.

4. **Boilerplate CodeRabbit replies** -- Root cause: The agent tasked with replying to CodeRabbit comments was dispatched at too low a model tier (Haiku) and produced generic responses that didn't address the specific findings. No quality gate existed between agent output and posting to the PR.

5. **DEMO.md silently dropped** -- Root cause: Exit criteria were established during scope lock but not tracked as a checklist during the ship phase. The assistant moved to "done" without verifying all exit criteria.

## Recommendations (Ordered by Impact)

### Must Fix (these caused user friction or wasted significant time)

1. **Serialize or isolate concurrent agents on git repositories.** When dispatching multiple agents that touch the same repo, either use `git worktree` for isolation or run them sequentially. Never dispatch two agents that may switch branches or stage files on the same checkout. -- **Encodable**: `feature-collab.md` (add to agent dispatch rules)

2. **CodeRabbit reply agents must be Sonnet-tier and include a quality gate.** Assessing whether a review finding is valid requires judgment. The agent must quote the specific finding and explain why the code is correct or propose a fix. Generic/boilerplate replies must be caught before posting. -- **Encodable**: `enhance.md` (add to review-reply phase)

3. **Security invariants from CLAUDE.md are non-negotiable.** When a review finding references a documented security invariant (companyId filtering, JWT extraction, NOT_FOUND->FORBIDDEN), the fix must be applied without rationalization. Questions about whether the invariant is overconservative should be raised to the user, not resolved by the assistant. -- **Encodable**: `enhance.md` (add to anti-rationalization rules)

### Should Fix (process improvements that would prevent recurring issues)

1. **Exit criteria checklist verification before declaring "done."** Before the ship phase, explicitly enumerate all exit criteria from scope lock and verify each one. Missing items must be flagged to the user, not silently dropped. -- **Encodable**: `feature-collab.md` (add to ship phase)

2. **Design partial indexes fully before the schema PR.** When adding a new index, determine the WHERE clause and migration structure before creating the schema PR. This avoids the race condition with auto-merge that forced PR #2214. -- **Encodable**: `enhance.md` (add to schema phase checklist)

3. **Fix the throw new Error() at timeseries.service.ts:414.** Replace with `return err({ type: "INTERNAL_ERROR" })` to match the neverthrow contract. Add a unit test for the guard. -- Behavioral (one-time code fix)

4. **Add unit tests for fetchBatchEmploymentTimeseries.** The batch path has non-trivial logic (sequential iteration over series types, aggregation) and only has integration-level coverage. -- Behavioral (one-time test addition)

### Nice to Have (minor optimizations)

1. **Flag pre-existing companyId gaps as fast-follows.** When adding new methods with companyId filters to a file where pre-existing methods lack them, note the inconsistency in the PR description or a follow-up ticket. -- Behavioral

2. **Parallelize batch path DB calls.** `fetchBatchEmploymentTimeseries` iterates seriesTypes sequentially. `Promise.all` would reduce latency for team dashboard queries. -- Behavioral (performance optimization)

## Encoding Proposal

| # | Encoding | Target File | Placement | E# |
|---|----------|-------------|-----------|-----|
| R1 | Git isolation for concurrent agents (red flag + STOP) | `feature-collab.md`, `enhance.md` | New subsection after "File Scoping" | E18 |
| R2 | CodeRabbit reply quality gate | `enhance.md`, `feature-collab.md` | Rationalizations table + Phase 3 step | E19 |
| R3 | Security invariants non-negotiable | `enhance.md`, `feature-collab.md` | Rationalizations table | E20 |
| R4 | Exit criteria full enumeration | `feature-collab.md` | Phase 8 step 2 | E21 |
| R5 | Schema index design-first | `enhance.md` | Rationalizations table | E22 |
| R8 | Spike-to-implement metrics handoff | `spike.md` | Transition section | E23 |

Skipped (behavioral): R6 (fix throw), R7 (batch unit tests)

## Encoding Effectiveness

| # | Encoding | Source Retro | File | Score |
|---|----------|-------------|------|-------|
| E1 | Spike-to-implement hard gate | spike-autopilot | spike.md | TRIGGERED |
| E2 | Compaction requires /pickup re-invocation | spike-autopilot | feature-collab.md, enhance.md, bugfix.md, refactor.md, hotfix.md, release.md | TRIGGERED |
| E3 | Ban `as` casts on repository return types | PAS-1151 | enhance.md | NOT APPLICABLE |
| E4 | CI flaky-test re-trigger policy | PAS-1151 | enhance.md | NOT APPLICABLE |
| E5 | Pre-commit typecheck gate | PAS-1151 | enhance.md | TRIGGERED |
| E6 | Data pipeline trace for field-swap features | PAS-1151 | enhance.md | NOT APPLICABLE |
| E7 | Pass discovered commands to subsequent agents | PAS-1151 | enhance.md | UNCLEAR |
| E8 | Mocks-too-generous warning | PAS-1151 | enhance.md | NOT APPLICABLE |
| E9 | Phase skips require user permission | permission-set-schema | enhance.md | NOT APPLICABLE |
| E10 | Metrics write mandatory even when phases skipped | permission-set-schema | enhance.md | TRIGGERED-VIOLATED |
| E11 | Deferred CONTRACTS items must be stubs | permission-set-schema | enhance.md | NOT APPLICABLE |
| E12 | Check branch state before rebasing | permission-set-schema | enhance.md | TRIGGERED-VIOLATED |
| E13 | Review-feedback fix: verify behavior matches intent | per-scope-workflow | enhance.md | TRIGGERED |
| E14 | "I still see X" = re-read original feedback | per-scope-workflow | enhance.md | NOT APPLICABLE |
| E15 | Post-PR plan sync on design changes | per-scope-workflow | enhance.md | NOT APPLICABLE |
| E16 | TDD RED+GREEN commit together (hooks block RED) | per-scope-workflow | enhance.md | UNCLEAR |
| E17 | Demo phase conditional on API changes (Bruno) | demo-overhaul | enhance.md | NOT APPLICABLE |

**Summary:** 4 TRIGGERED, 2 TRIGGERED-VIOLATED, 8 NOT APPLICABLE, 2 UNCLEAR

**E10 violation detail:** The metrics file only captured the spike phase. When the session transitioned to feature-collab implementation, no new metrics file was written.

**E12 violation detail:** Concurrent agents caused branch conflicts. Branch state was not adequately checked before rebase operations, leading to the collision cascade.

## Trends (Last 5 Retros)

| Date | Branch | Compliance | Experience | Findings | Recommendations |
|------|--------|------------|------------|----------|-----------------|
| 2026-03-30 | rk-0330-identify-logical-worker-split | A | A- | 4 | 4 |
| 2026-03-27 | rk-0327-cents-convert-be | B | B+ | 5 | 6 |
| 2026-03-27 | rk-0327-team-filter-report-chain | A- | A- | 5 | 5 |
| 2026-03-27 | rk-0323-build-flags-spike | B+ | A- | 7 | 6 |
| 2026-03-25 | rk-0325-protect-admin-permission-workflows | B+ | A- | 4 | 6 |

**Pattern:** This session is a clear outlier compared to the last 5 retros. Prior sessions averaged B+ compliance and A- experience. This session drops to B- compliance and C+ experience, driven primarily by agent coordination failures that did not occur in simpler sessions.

## Metrics
| Metric | Compliance | Experience | Technical |
|--------|-----------|------------|-----------|
| Overall grade | B- | C+ | A- |
| Skill selection | B+ | N/A | N/A |
| Plan discipline | B- | N/A | N/A |
| Agent dispatch | B+ | N/A | N/A |
| Architecture/patterns | N/A | N/A | A- |
| Test quality | N/A | N/A | A- |
| Scope/churn | N/A | N/A | A |
| Efficiency | N/A | C+ | N/A |
| Flow | N/A | C+ | N/A |
| Communication | N/A | B+ | N/A |
| User corrections | 2 | 2 frustration signals | N/A |

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
