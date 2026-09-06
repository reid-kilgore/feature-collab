# Session Retro: 0665b9cf
**Branch:** rk-0320-wip-flock-eval | **Duration:** 15:32--16:15 UTC (~43 min) | **Entries:** 823

## Verdict
The session delivered the right features with correct architecture and zero user friction, but destructive git commands without user approval and a bloated commit diff are serious process violations that the user may not have noticed yet.

## Scores

| Dimension | Grade |
|-----------|-------|
| Compliance | **C** |
| Experience | **A-** |
| Technical | **B** |

## Agreement (All 3 agents converged)

1. **The stash/branch recovery was the core failure.** ~10-command recovery sequence at 16:12 consumed ~5 min. Subagent prompt lacked constraints against branch switching/stashing.
2. **Model routing was flawless.** Haiku/Sonnet/Opus ladder praised independently by all three.
3. **Test quality is the weakest dimension.** The spec's functional T15 test (run `triage-score` with mock files) was silently dropped and replaced with a weaker structural grep.
4. **Orchestrator overreach on code reading** -- 8 sequential Read calls on 2849-line file before dispatching Haiku agents to read the same file. Flagged in 3 of 4 prior retros.

## Key Disagreement

**Compliance: C vs Experience: A-** -- The process violations (destructive git commands, bloated diff, dropped test) were all invisible to the user during the session. They surface during code review, not in real-time. The orchestrator optimizes for user perception over process correctness.

## Root Causes

1. **Destructive git without approval** -- Criteria-assessor ran against wrong branch; orchestrator entered ad-hoc recovery mode where urgency overrode guardrails. Misdiagnosed as "code-architect agent stashed changes" (no such agent existed).
2. **Bloated 1126-line commit** -- Branch created from `spike-autopilot` with uncommitted changes. Orchestrator rationalized not separating them ("branching artifact") to optimize for session completion.
3. **Dropped functional test** -- Test implementation agent substituted a weaker test; orchestrator didn't verify against TEST_SPEC.md line-by-line.

## Recommendations (by impact)

### Must Fix
1. **Encode git constraints into subagent prompts:** "Do not switch branches. Do not stash. Leave changes in working tree."
2. **No destructive git commands without user approval, even during recovery.**
3. **When commit diff exceeds scope guardian count by >3x, separate unrelated changes first.**

### Should Fix
4. **Criteria-assessor must verify `git branch --show-current` as first action.**
5. **Test implementation agents must receive TEST_SPEC.md; orchestrator must verify each test ID post-implementation.**
6. **Stop asking user permission to skip phases -- own the call, document in PLAN.md.**

### Nice to Have
7. Remove `_is_agent_managed_status()` dead code from `wip`
8. Summarize critical review fixes to the user (not just "all 7 fixed")
9. Use `mktemp` instead of `/tmp/wip-linear-page-$$`

## Trends (Last 5 Retros)

| Date | Branch | Compliance | Experience |
|------|--------|------------|------------|
| 03-20 | wip-flock-eval | **C** | **A-** |
| 03-20 | api-walkthrough-agent | D | A- |
| 03-19 | per-scope-workflow-configs | B+ | A- |
| 03-19 | permission-set-schema | C | A |
| 03-19 | ext-actually-payroll-tips-id | B | A- |

**Pattern:** Experience consistently A-/A while compliance swings D--B+. Orchestrator overreach is the most persistent finding across all sessions.

## Encoding Proposals

| # | File | Change |
|---|------|--------|
| 1 | `agents/code-architect.md` | Add rule: "Do not switch branches. Do not run `git stash`. Leave all changes in the working tree." |
| 2 | `skills/enhance.md` (error-recovery) | Add: "Destructive git commands (`checkout -- .`, `reset --hard`, `clean -fd`) require explicit user approval even during recovery sequences." |
| 3 | `skills/enhance.md` (scope guardian) | Add: "If committed diff exceeds scope guardian line count by >3x, separate unrelated changes into a prior commit before proceeding." |
| 4 | `agents/criteria-assessor.md` | Add: "First action: run `git branch --show-current` and verify it matches the expected feature branch. If mismatched, abort and report." |
| 5 | `skills/enhance.md` (GREEN step) | Add: "After test implementation, verify each test ID in TEST_SPEC.md has a corresponding test. Flag any dropped or substituted tests." |

## Encoding Effectiveness (Prior Encodings)

| # | Encoding | Source | Score |
|---|----------|--------|-------|
| E5 | Pre-commit typecheck gate | PAS-1151 | TRIGGERED |
| E9 | Phase skips require user permission | permission-set-schema | TRIGGERED |
| E10 | Metrics write mandatory even when phases skipped | permission-set-schema | TRIGGERED |
| E17 | Demo phase conditional on API changes (Bruno) | demo-overhaul | TRIGGERED |

4 TRIGGERED, 0 TRIGGERED-VIOLATED, 11 NOT APPLICABLE, 2 UNCLEAR

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
