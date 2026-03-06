# Handoff Notes

**Created**: 2026-03-05T18:30:00Z
**Reason**: Session learned a lot, need to record and potentially create local skills
**Feature**: Feature-collab plugin improvements — anti-rationalization, pressure testing, workflow hardening

## Current State

**Phase**: N/A (improvement session, not a feature-collab workflow)
**Sub-phase**: Implementing fixes discovered during pressure testing + real-world transcript diagnosis
**Waiting For**: 4 empirical pressure tests still running in background (test-runner, test-implementer, criteria-assessor, orchestrator)

## What Was Accomplished This Session

### Major Deliverables
- **Anti-rationalization infrastructure** across all 6 agents + 7 orchestrator commands (Iron Laws, rationalization tables, red flags, verification gates)
- **Pressure tested all 7 agent types** — predicted results: 6/28 baseline → 28/28 with anti-rat
- **Empirical validation running** — 48 isolated sub-agent runs across 6 agents. scope-guardian and demo-builder returned 4/4 baseline (predictions were too pessimistic). 4 more agents pending.
- **SessionStart hook** — built, deployed, verified firing in production. Injects skill routing guidance on session start/clear/compact/resume.
- **Handoff→hook→pickup workflow** — tested end-to-end with synthetic mid-feature state, 7/7 evaluation criteria passed
- **Plugin.json fix** — hooks field was missing, preventing hook loading
- **Concept extraction in Phase 1** — feature-collab and enhance now decompose features into concepts, launch one explorer per concept, synthesize into impact map + pattern catalog + risk register
- **Spike→collab/enhance transition** — spike findings feed directly into Phase 1, no redundant research
- **Demo-builder hardened** — curls/screenshots/walkthroughs are the demo, NOT test output. Explicit DO/DON'T guidance.
- **Mandatory demo capture during dark factory** — orchestrator must invoke demo-builder after first and final green test runs, not defer to end
- **Criteria-assessor checks DEMO.md** — empty DEMO.md is automatic FAIL
- **Skill name fix** — hook now uses fully qualified names (`feature-collab:feature-collab`, not `feature-collab`)
- **Transcript diagnosis** — parsed real conversation from passcom repo, confirmed orchestrator simply forgot demo-builder during dark factory (no rationalization, just absent from mental model)

### Commits (all pushed to origin/main)
1. `385a448` — feat: add anti-rationalization infrastructure, verification gates, and pressure testing
2. `e41f8ae` — fix: declare hooks field in plugin.json so SessionStart hook loads
3. `99dc7b8` — feat: pressure test all 5 remaining agents — 6/24 baseline → 24/24 with anti-rat
4. `71ee585` — fix: close 4 gaps found by pressure testing + add orchestrator pressure test

### Uncommitted Changes (need commit + push)
- `plugins/feature-collab/agents/criteria-assessor.md` — Demo/proof-of-work mandatory check added
- `plugins/feature-collab/agents/demo-builder.md` — Complete rewrite of demo guidance (curls yes, test output no)
- `plugins/feature-collab/commands/enhance.md` — Concept extraction in Phase 1, mandatory demo capture in Phase 2
- `plugins/feature-collab/commands/feature-collab.md` — Concept extraction in Phase 1, mandatory demo capture in Phase 5, new rationalization rows
- `plugins/feature-collab/commands/spike.md` — Transition-to-implementation section
- `plugins/feature-collab/hooks/session-start` — Fully qualified skill names, spike guidance fix
- `plugins/feature-collab/pressure-tests/demo-builder/empirical.md` — Empirical results (4/4 both)
- `plugins/feature-collab/pressure-tests/scope-guardian/empirical.md` — Empirical results (4/4 both)
- `plugins/feature-collab/pressure-tests/orchestrator/demo-skip-diagnosis.md` — Transcript diagnosis

## What Needs to Happen Next

1. **Commit and push uncommitted changes** — all the fixes above are staged but not committed
2. **Check for remaining empirical pressure test results** — 4 agents (test-runner, test-implementer, criteria-assessor, orchestrator) had empirical tests running. Check if `empirical.md` files appeared in their pressure-test directories. If not, re-run.
3. **Analyze empirical vs predicted discrepancy** — scope-guardian and demo-builder both scored 4/4 baseline empirically (predicted 0/4 and 1/4). The forced-choice A/B/C format may be too easy. Consider: open-ended scenarios where the agent must recognize the pressure without labeled options. This is a methodological finding worth documenting.
4. **Consider local skills for this repo** — user mentioned "including as local skills in this repo if useful." Potential candidates:
   - A `/sync-plugin` skill that copies repo files → plugin cache (currently manual)
   - A `/run-pressure-test` skill wrapper that's repo-specific (vs the general `/pressure-test` in the plugin)
5. **Update PLAN-anti-rationalization.md** — the existing plan doc is stale; should be updated to reflect completion + the new work done this session
6. **Update memory** — save stable patterns to MEMORY.md (anti-rat methodology, empirical testing insights, demo guidance, concept extraction)

## Key Learnings & Context

### Anti-Rationalization Methodology
- **Common Rationalizations table is the highest-impact single section** — agents generate the exact excuses it pre-debunks. Acts as a runtime pattern matcher.
- **Option C ("reasonable middle ground") is the most dangerous failure mode** — looks compliant but breaks guarantees. Agents gravitate to C under pressure.
- **Test-runner and scope-guardian are the most vulnerable** agents without guardrails (0/4 baseline in predictions).
- **"Under pressure, reasoning is the first casualty. Anti-rat sections replace reasoning with lookup, which is pressure-resistant."** — key insight from orchestrator pressure test.
- **Empirical vs predicted: forced-choice format may be too easy** — scope-guardian and demo-builder both scored 4/4 baseline empirically despite predicted failures. Open-ended scenarios needed for true validation.

### Demo Guidance (from real-world failure)
- Orchestrator forgot to invoke demo-builder during dark factory — no rationalization, just absent from mental model
- Criteria-assessor approved 9/9 exit criteria with empty DEMO.md
- Fix: explicit MANDATORY step + criteria-assessor check + rationalization rows
- **Demos are curls + screenshots + code walkthroughs. NOT test output.**

### Concept Extraction Pattern
- User's prompt: extract every concept/assumption → agent team to trace each → concise summary
- Integrated into Phase 1 of feature-collab and enhance
- Exit gate: "can you name every file that will be touched and what might break?"
- User explicitly wants thorough research even at token cost — "it cascades into the rest of our work"

### Spike Transition
- Spikes can feed into collab/enhance — findings carry forward as Phase 1 context
- Hook now only suggests spike when "you genuinely don't know what to build yet"

### Plugin Cache Sync
- Plugin loads from `~/.claude/plugins/cache/feature-collab-marketplace/feature-collab/2.0.0/`, NOT from repo
- Must manually copy after editing (no auto-sync mechanism yet)
- `sync-to-dev.sh` exists but is untracked

### Hook Architecture
- `plugin.json` MUST declare `"hooks": "./hooks/hooks.json"` for hooks to load
- Hook fires on startup|resume|clear|compact
- `CLAUDE_PLUGIN_ROOT` is set by Claude Code to the cache path
- Skill names require `feature-collab:` prefix (e.g., `feature-collab:feature-collab`)

## Files to Read on Resume

1. This file (HANDOFF.md)
2. `PLAN-anti-rationalization.md` — original plan (stale but gives background)
3. `plugins/feature-collab/pressure-tests/README.md` — methodology
4. `plugins/feature-collab/agents/*.md` — all agent prompts (with anti-rat)
5. `plugins/feature-collab/commands/*.md` — all orchestrator commands
6. `plugins/feature-collab/hooks/session-start` — the hook script
7. `plugins/feature-collab/pressure-tests/*/empirical.md` — empirical results (may not all exist yet)

## Open Questions

- [ ] Should we create a `/sync-plugin` local skill? User mentioned wanting local skills.
- [ ] Should empirical pressure tests use open-ended format instead of A/B/C? Forced choice may be too easy.
- [ ] Should the pressure-test skill itself be updated with empirical methodology (spawn sub-agents, not predict)?
- [ ] Do we need orchestrator pressure tests for the OTHER orchestrators (bugfix, hotfix, refactor, enhance)?

## Warnings

- **4 background agents may still be running** — check `ps aux | grep claude` and check for empirical.md files in pressure-test directories
- **Uncommitted changes exist** — commit before doing anything else
- **Plugin cache must be synced manually** — if you edit agent/command files, copy them to `~/.claude/plugins/cache/feature-collab-marketplace/feature-collab/2.0.0/`
- **The empirical pressure tests showed baselines perform better than predicted** — don't over-rely on predicted results, always validate empirically
