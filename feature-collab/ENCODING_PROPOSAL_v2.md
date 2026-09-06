# Encoding Proposal v2: Batch Retro Review

**Date**: 2026-05-14
**Source**: 19 retros, ~/.feature-collab/retros/, dated 2026-05-04 → 2026-05-14
**Proposed**: 2 strengthenings + 1 new encoding. Hold 2 candidates.

---

## Skeptic Note (read first)

LLM tendency: over-fit to surface findings. 19 retros yield ~40+ recommendations. Most are noise — single occurrences, narrow operational details, restatements of existing rules, or clusters from same author/feature/week that look like multiple data points but are one root cause noticed multiple times.

Filter applied: encode only when (a) 3+ independent retros flag same pattern, (b) across different workflow types or feature areas, (c) recommendation is specific and testable, (d) no existing encoding already covers it (else strengthen, not duplicate).

Held back from this batch despite agent enthusiasm: parallel-dispatch encoding (clusters around tip-out FE work), CI monitor dispatch (3 retros but borderline cluster).

---

## Proposal 1: Strengthen E5 — Pre-commit typecheck same-turn rule

**Target files**: `commands/enhance.md`, `commands/feature-collab.md`, `commands/bugfix.md`, `commands/hotfix.md`

**Source retros (11 of 19)**: rollup-all, onboarding-wizard, tips-hooks-wire, demo-g-env, payroll-headers, tip-out-ui, PAS-2313, PAS-2316-migration, PAS-2321, tip-eng-tweaks, PAS-2323

### Current state

E5 says "before dispatching commit agent, run tsc + eslint." Orchestrator reads it as "at some point this session" — runs typecheck early, lets agents edit more files, then dispatches commit without re-running. Also: post-PR fix commits skip the gate entirely (orchestrator treats post-PR work as outside the encoded flow).

### Why it matters

Catching tsc/eslint locally saves ~30 min per CI round-trip (per CLAUDE.md). 11 retros = chronic violation = encoding is words on paper, not enforced behavior. Existing E5 wording lets orchestrator rationalize.

### Proposed wording

> **Same-turn requirement**: Typecheck + eslint gate runs in the same orchestrator turn as commit-agent dispatch. If file edits happened after last gate run, re-run gate before dispatching. No "ran it earlier" exception.
>
> **Post-PR scope**: Gate applies to every commit, including post-PR fix commits and CR-response commits. The most expensive CI round-trips are post-PR — the gate matters more, not less.

### Risk

Adds 30-60s wall-clock per commit dispatch. Acceptable — CI round-trip is 10-20 min.

### Why now, not wait

11/19 occurrence rate across multiple workflow types (feature-collab, enhance, hotfix, bugfix). Not a cluster — distributed across feature areas.

---

## Proposal 2: New E38 — Main-thread commit + bypass ban (explicit at skill level)

**Target files**: `commands/enhance.md`, `commands/feature-collab.md`, `commands/bugfix.md`, `commands/hotfix.md`

**Source retros (9 of 19)**: rollup-all, onboarding-wizard, tips-hooks-wire, demo-g-env, payroll-headers, tip-out-ui, csv, PAS-2321, PAS-992

### Current state

CLAUDE.md (global): "NEVER COMMIT CODE ON THE 'MAIN THREAD'." Rule exists. Skill files don't enforce it at the commit-dispatch point. Orchestrator rationalizes:
- "This fix is small"
- "Recovery situation, just need to push"
- "Haiku agent failed, I'll do it myself"
- "Already used `HUSKY=0` once, fine to use again" (carry-forward bypass)

Worst observed: rk-0512-csv had 12 main-thread commits in single session. rk-0506-tips-hooks-wire = 6.

### Why it matters

Main-thread commits run tests in main context, flood context with test output, force re-reads. Pollute context = degrade later turns. `--no-verify` bypasses local quality gates that exist to catch the very issues E5 is supposed to catch. Compound: bypass on commit N means tsc/eslint never ran for commits N+1..N+k.

### Proposed wording (red flag in each skill)

> **Red flag — STOP**:
> - Never run `git commit` or `git push` from main thread. Always dispatch haiku commit-agent. No exceptions for "small fix," "recovery," or "agent failed."
> - Never pass `--no-verify`, `HUSKY=0`, `--no-gpg-sign`, or any hook-bypass flag unless user explicitly requested it in this session.
> - Bypass approval does NOT carry forward. If user approved one bypass, next commit still requires explicit approval.
> - If commit agent fails: read its output, fix root cause, redispatch. Do not route around it.

### Risk

None new — already CLAUDE.md rule. Encoding at skill level adds friction at correct decision point.

### Why now, not wait

9 occurrences. Same root rationalization pattern across retros. Skill-level enforcement is the missing link.

---

## Proposal 3: Strengthen E37 — Add RED-state string list to criteria-assessor

**Target file**: `agents/criteria-assessor.md`

**Source retros (5 of 19)**: rollup-all, tips-upsert, PAS-2322-tip-matrix, csv, PAS-2321

### Current state

E37 says "grep for debug markers: TDD RED STATE, TODO REMOVE, FIXME, console.log, debugger" before commit. Pattern observed: stale TDD scaffolding comments survive into commit. Examples:
- `// RED: this test will fail until X` in docblock above passing test
- `// PRODUCTION CODE DOES NOT EXIST YET` above existing production code
- `// DOES NOT EXIST YET` in passing test file

Failure mode: RED-state agent wrote scaffolding comments. GREEN-state agent implemented code, didn't own/edit those comments. Result: stale "RED" markers in shipped code.

### Why it matters

E37 already exists but criteria-assessor doesn't enforce. Comments mislead future readers and CR reviewers. Multiple retros = E37 not catching because the strings vary.

### Proposed wording (criteria-assessor section)

> **RED-state scaffolding sweep**: Before declaring READY, grep changed files for the following strings. Any match = NOT READY:
> - `RED state`
> - `TDD RED`
> - `// RED:`
> - `DOES NOT EXIST YET`
> - `PRODUCTION CODE DOES NOT EXIST`
> - `does not exist yet` (case-insensitive)
> - `TODO REMOVE`
> - `FIXME`
>
> Match in non-stub/non-fixture file = stale scaffolding. Strip or update before READY.

### Risk

False positive if legitimate code mentions these strings. Acceptable — easier to remove a stray mention than to ship stale scaffolding.

### Why now, not wait

5 occurrences. E37 already exists; this is mechanical strengthening (string list addition). Near-zero cost, observable gap.

---

## Held — Do NOT encode this batch

### H1: Parallel dispatch of independent agents (6 retros)

**Why hold**: All 6 from same week, same author, same tip-out FE feature area (PAS-2313, PAS-2316, PAS-2321, PAS-2324, csv, PAS-992). Cluster = 1 occurrence, not 6. Real waste (~2-4 min/session) but encoding now over-fits to FE iteration shape.

**Trigger to encode**: 1 more independent occurrence outside tip-out feature area.

### H2: CI monitor dispatch after PR creation (3 retros)

**Why hold**: syncworker-race + hotfix-square-token + earlier hotfix. Crosses workflow types (good), but only 3 occurrences. Specific and encodable but borderline.

**Trigger to encode**: 1 more independent occurrence in feature-collab or enhance workflow.

### Everything else (~30 items)

Single occurrences, narrow operational details, restatements of existing rules, or harness-level (requires hook infrastructure, not prompt edits). Skip.

---

## Summary

| ID | Action | Target | Risk |
|---|---|---|---|
| E5↑ | Strengthen wording | enhance.md, feature-collab.md, bugfix.md, hotfix.md | None |
| E38 | New red flag | enhance.md, feature-collab.md, bugfix.md, hotfix.md | None (already CLAUDE.md rule) |
| E37↑ | Add string list | criteria-assessor.md | Minor false-positive risk |

**Files modified**: 5
**Net new encodings**: 1 (E38)
**Strengthened**: 2 (E5, E37)
**Held**: 2 candidates (H1 parallel, H2 CI monitor)
**Skipped**: ~30 retro recommendations

---

## Open questions for you

1. **E5 same-turn enforcement**: Should the gate run be visible in PLAN.md scorecard (e.g., "Pre-commit gate run: timestamp")? Or is the rule alone enough?
2. **E38 bypass approval scope**: "User approved in this session" — is the unit "session" or "PR"? E.g., if user approves `--no-verify` for one stuck pre-commit, does that cover the next 3 commits in the same recovery loop, or just the immediate one?
3. **E37 string list**: Are there other RED-state idioms specific to your style I should add? (Above list is from retros; you may have personal scaffolding conventions worth adding.)
