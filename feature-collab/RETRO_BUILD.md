# Session Retro: `rk-0319-faster-builds`

**Branch:** rk-0319-faster-builds | **Duration:** ~23h | **Entries:** 1368

## Verdict

Successful session — the core deliverable (85% Docker transpilation speedup) is technically sound and well-motivated, but two avoidable fix commits from skipping pre-flight checks introduced unnecessary CI round-trips.

## Scores

| Dimension | Compliance | Experience | Technical |
|-----------|-----------|------------|-----------|
| Architecture/Patterns | A | A | A |
| Scope/Churn | B+ | B | B |
| **Overall** | **A-** | **B+** | **A-** |

## High-Confidence Findings (All 3 Agents Agree)

1. **The esbuild implementation is technically excellent.** `#prisma/client` path alias handling, `bundle: false` for 1:1 transpilation, and ESM format were all correct.
2. **Two fix commits were avoidable.** `*.mjs` vs `**/*.mjs` glob bug and `build-check` rename breaking branch protection — both preventable with local pre-flight checks.
3. **`.d.ts` file matching in `collectTsFiles` is a minor robustness gap.** Harmless in practice, one-line fix.
4. **No tests needed** — appropriate for build-system change validated empirically.
5. **Worker Dockerfile descoping was correct** — documented, not overlooked.

## Interesting Tension

**A- (Compliance, Technical) vs B+ (Experience)** — This is the only recent session where compliance scored *higher* than experience, inverting the usual pattern. The inversion: this infrastructure task had no orchestrator/phase concerns (usual compliance deductions), but the Experience report caught a specific CLAUDE.md rule violation (pre-commit lint mandate skipped).

## Root Causes

1. **Skipped pre-commit eslint** — The `.mjs` file was new and in a subdirectory; existing ignore pattern only covered root-level. One local `eslint` run would have caught it.
2. **No branch protection check before CI rename** — `build-check` → `build-and-typecheck` broke the required-checks ruleset. A `gh api` call would have revealed this.
3. **`.d.ts` files matched by `collectTsFiles`** — `extname() === ".ts"` matches `.d.ts` too. Trivial fix: `!entry.name.endsWith('.d.ts')`.

## Recommendations (by impact)

| Priority | Recommendation | Encodable? |
|----------|---------------|------------|
| **Must** | Run eslint on new files before committing (already E5, needs strengthening) | Yes — commit-agent dispatch prompts |
| **Must** | Query branch protection before renaming CI jobs | Yes — new encoding in CI-editing checklist |
| **Should** | Add `.d.ts` exclusion to `collectTsFiles` | Direct code fix |
| **Should** | Include "run eslint on new files" in commit-agent prompts | Subsumes into E5 |
| Nice | Extract shared pnpm cache setup into reusable CI action | Future session |

## Trends (Last 6 Retros)

| Date | Branch | Compliance | Experience |
|------|--------|------------|------------|
| 2026-03-20 | **rk-0319-faster-builds** | **A-** | **B+** |
| 2026-03-20 | rk-0320-wip-flock-eval | C | A- |
| 2026-03-20 | rk-0320-payrollid-timecard-fix | B+ | A- |
| 2026-03-20 | rk-api-walkthrough-agent | D | A- |
| 2026-03-19 | rk-0319-per-scope-workflow-configs | B+ | A- |
| 2026-03-19 | rk-0319-permission-set-schema | C | A |

**Pattern:** This is the only session where compliance > experience. Infrastructure tasks sidestep orchestrator-related process friction (the usual compliance drag), while the CLAUDE.md lint mandate becomes the primary experience issue.

## Encoding Effectiveness

**E5 (Pre-commit typecheck gate): TRIGGERED-VIOLATED** — This is the only encoding that was relevant to the session, and it was violated. All other 16 encodings were not applicable (infrastructure session, no feature code).

## Encoding Proposals

1. **Strengthen E5 in commit-agent dispatch prompts** — Add explicit text: "For any new files (especially non-standard extensions like `.mjs`, `.cjs`), run `npx eslint --no-fix <file>` before committing."

2. **New encoding: CI job rename guard** — "Before renaming or removing a CI job in any workflow YAML, run `gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.contexts[]'` to verify the job name is not a required status check."

3. **Code fix: `.d.ts` filter** — Add `&& !entry.name.endsWith('.d.ts')` to `collectTsFiles` in `backend/scripts/build-esbuild.mjs`.

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
