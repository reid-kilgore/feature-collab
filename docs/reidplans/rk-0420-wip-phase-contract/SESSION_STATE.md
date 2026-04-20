# Session State

## Current State
**Phase**: 1 (Discovery & Scope Lock)
**Status**: DRAFTING_SCOPE
**Last Updated**: 2026-04-20

## If You're a New Session

### Do NOT
- Re-explore the wip CLI / skill call-sites — the upstream spike already mapped this. See `SPIKE_FINDINGS.md` and `SPIKE_EVIDENCE.md`.
- Re-design the state enum. Decided: NOT_STARTED / WORKING / NEEDS_INPUT / DONE.

### Do
1. Read SPIKE_FINDINGS.md (carried over from `rk-swiftui-cli-spike` branch)
2. Read PLAN.md current section
3. Continue from current phase

## Session Boundaries
- Task tracking: `bd` (beads). `bd ready --json` to see ready tasks.
- Fast-follows and untracked work: file as new beads via `bd q` or `bd create`.
- `wip` item for this branch: not tracked (this project BUILDS wip; use bd instead).
