<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Feature: wip CLI — 4-state + phase-string contract

## Sections Needing Review
- [Scope Boundaries](#scope-boundaries-locked-after-phase-1)
- [Overview](#overview)
- [Codebase Context](#codebase-context)
- [Exit Criteria](#exit-criteria)

## Status
**Current Phase**: Implementation (Dark Factory — Phase 3+4 collapsed per user)
**Waiting For**: Autonomous — will report when tests green

## Scope Boundaries (LOCKED after Phase 1)

### In Scope (MVP)
- [ ] Collapse 8 item statuses → **4 states**: `NOT_STARTED`, `WORKING`, `NEEDS_INPUT`, `DONE`
- [ ] Add free-form **`phase`** field (≤15 chars) — human-readable project phase, e.g., `"Phase 2: Impl"`, `"Review"`, `"Retro"`
- [ ] New subcommand `wip phase <item> <text>` — sets/clears the phase string (validates ≤15 chars)
- [ ] Update `wip list` renderer to show phase column/indicator
- [ ] Update `wip get` to surface phase (already works via generic JSON dump, but confirm)
- [ ] Interactive UI (fzf browser) renders new state + phase string
- [ ] **Backwards-compat aliases** for one cycle: `ACTIVE`→WORKING, `WAITING`→NEEDS_INPUT, `BLOCKED`→NEEDS_INPUT, `NEW`→NOT_STARTED, `CLOSED`→DONE, `IN_REVIEW`→WORKING+phase="Review", `RETRO`→WORKING+phase="Retro". Accept both on input; emit deprecation notice to stderr.
- [ ] Update `wip --help` text: new state enum; demote `wip children` to an "Advanced" section or strip from the main USAGE block
- [ ] Update hook `~/.claude/hooks/on-prompt.sh` to emit new state names.
- [ ] Update hook `~/.claude/hooks/on-stop.sh` to set `NEEDS_INPUT` unconditionally (no phase-based or status-based guard).
- [ ] **Remove** `_is_agent_managed_status()` (`wip:495–500`) — the concept is retired. Removing the guard means `IN_REVIEW`/`RETRO`-style work shows as `NEEDS_INPUT` once Claude stops, which is the desired signal.
- [ ] Read-path compatibility: items stored with old statuses (`ACTIVE`, `WAITING`, etc.) continue to render correctly after upgrade — no migration required, since wip state is just a JSON field; old values map on read.

### Explicitly Out of Scope
- **feature-collab skill migration** — separate follow-up project. Skills keep calling `wip status ACTIVE`/`wip status WAITING` during the compat window.
- **Nasqueron color/phase rendering** — separate follow-up. Nasqueron will consume the new model once skills emit phases.
- **Schema migration / data rewrite** — storage stays JSONL with arbitrary keys; old items keep their old status values and are mapped on read.
- **New `phase` column in interactive fzf browser beyond a simple inline render** — keep the UI change minimal.
- **Hardening `phase`-length enforcement at read time** — length validated at write, read path accepts whatever is on disk.

### Fast Follows (Future PRs)
Tracked as beads; see `bd list` for live state. Initial set filed during scope lock.

### Scope Lock Status
**Status**: LOCKED (2026-04-20)
**Decisions captured**:
- `CLOSED` folds into `DONE` — one fewer concept.
- **Protected-phase concept abandoned entirely.** Rationale from user: protected items repeatedly lured them into checking what turned out to be Claude autonomously working. The signal was noise. `on-stop.sh` now always sets `NEEDS_INPUT`; `_is_agent_managed_status()` is deleted.

## Overview

The `wip` CLI currently exposes 8 item statuses (NEW / ACTIVE / BLOCKED / WAITING / IN_REVIEW / RETRO / DONE / CLOSED). In practice these conflate two orthogonal axes: *lifecycle state* (am I working on this?) and *current sub-phase* (review / retro / implementation). Nasqueron and feature-collab skills both feel this — Nasqueron can't render a consistent color cue per state, and skills embed phase info in freeform `wip note` prose instead of a queryable field.

This PR collapses the 8 statuses into **4 lifecycle states** plus a separate **`phase` display string** (≤15 chars). The 4-state enum drives color/label; the phase string is the human-readable "what are we doing right now." Backwards-compat aliases let skills migrate incrementally without a flag day.

## Decisions (pinned for implementers)
- **Phase whitespace**: preserve exactly as written (no trim).
- **on-stop.sh unconditional rule applies to all states**: including NOT_STARTED → NEEDS_INPUT. No exceptions; no guard.
- **Unicode length**: `wip phase` counts characters, not bytes.

## Constraints

- **No data migration.** Old items must keep working after upgrade without any `.work.txt` rewrite.
- **Hook agent-managed guard must survive.** Today's guard protects IN_REVIEW/RETRO from being overwritten to WAITING on Claude stop. The new equivalent: `WORKING`+phase∈{"Review","Retro"} (and any other skill-configured "protected phases") must not be clobbered to NEEDS_INPUT on stop.
- **wip is a single bash script.** Keep it that way — no new dependencies, no new runtime.
- **Works on Darwin (bash 3.2 / zsh) and Linux hourly-dev remotes.**

## Questions

### Immediate (Block Progress)
- [x] ~~CLOSED vs DONE~~ — **DECIDED**: fold CLOSED into DONE.
- [x] ~~Protected-phase allowlist~~ — **DECIDED**: abandon the concept; no guard in `on-stop.sh`.
- [ ] Q: Deprecation notices on stderr — too noisy during migration? **Proposal**: emit once per invocation, only when an alias is actually used, include "deprecated: use WORKING" style hint. (Non-blocking; default to proposal.)

### Open (Resolve Later)
- [ ] Q: Should `wip phase <item>` auto-truncate past 15 chars, or reject? **Tentative**: reject with clear error; scripts can pre-truncate.
- [ ] Q: Does the interactive browser need keybindings for the new states (currently `x`→BLOCKED, `d`→DONE)? **Tentative**: `x` stays mapped to NEEDS_INPUT (new BLOCKED); add nothing new for now.

---

## Codebase Context

Consuming **SPIKE_FINDINGS.md** (carried from `rk-swiftui-cli-spike`) — exploration is done, no new code-explorer agents needed unless unknowns surface.

### Impact map
| File | Why touched |
|---|---|
| `feature-collab/wip` (bash script) | Primary change surface — state enum, `cmd_phase`, `cmd_list` renderer, help text, alias table |
| `~/.claude/hooks/on-prompt.sh` | Update state name emitted in context injection |
| `~/.claude/hooks/on-stop.sh` | Update to set `NEEDS_INPUT` (was WAITING); update agent-managed-status guard to match new phase-based protection |
| `feature-collab/wip` help + README | Demote `wip children` from main USAGE |

### Pattern catalog (from spike)
- wip stores JSONL in `~/panop/<repo>/work.txt`; fields are arbitrary, `wip set` accepts any key (verified spike DEMO.md).
- `cmd_status` hardcodes the enum at line 289; `cmd_list` renders at lines 266–275; `cmd_set` is the generic arbitrary-key setter at 371–385.
- Agent-managed-status guard at `on-stop.sh:47–49` and `wip:495–500` (`_is_agent_managed_status()`).

### Risk register
- **Alias layer must handle BOTH write and read.** A user/hook/skill writing old name → map to new; reading old data on disk → map to new for rendering.
- **Deprecation noise** could drown terminals if every skill/hook invocation prints to stderr. Mitigation: `WIP_SILENT_DEPRECATION=1`, once-per-invocation emission.
- **Removing the hook guard** means any item that was previously pinned to `IN_REVIEW` or `RETRO` by an agent will now flip to `NEEDS_INPUT` at the next Claude stop. User-facing effect is intentional — the old guard was misleading — but document in the PR so skills/autopilot that relied on it know they can stop fighting it.

### 3-sentence direction
Add a compatibility layer in `wip` that normalizes status names on every write and render, then introduce the 4-state enum + `phase` field as the new source of truth. Update the two hooks to speak the new names and protect phase-based agent-managed work. Leave skills, Nasqueron, and data-at-rest alone — they continue to work via the alias layer until their own migrations land.

## Contracts
*To be filled in Phase 2 (see CONTRACTS.md)*

## Verification Plan
*To be filled in Phase 2 (see TEST_SPEC.md)*

## Architecture
*To be filled in Phase 4*

## Tasks
*To be filled in Phase 4 — will be encoded as beads via `bd`, not markdown TODO*

## Security Review Results
*Phase 7*

## Verification Results
*To be filled during Phase 5*

## Exit Criteria

### Must Have (PR cannot ship without)
- [ ] `wip status <item> <new-state>` accepts `NOT_STARTED`/`WORKING`/`NEEDS_INPUT`/`DONE` and rejects unknown states.
- [ ] `wip status <item> <old-state>` still works for all 8 legacy names; emits single-line deprecation notice.
- [ ] `wip phase <item> <text>` sets phase (≤15 chars); rejects longer. `wip phase <item> ""` clears.
- [ ] `wip list` (both human and `--json`) shows phase when set.
- [ ] `wip get` shows phase when set.
- [ ] Existing `~/panop/*/work.txt` items with `status: "ACTIVE"` render as WORKING in list without file modification.
- [ ] `on-stop.sh` unconditionally sets `NEEDS_INPUT`; `_is_agent_managed_status()` removed.
- [ ] `on-prompt.sh` context injection uses new state names.
- [ ] `wip --help` shows new enum and de-emphasizes `wip children`.
- [ ] All tests passing — unit (bash) + integration (end-to-end CLI invocations). TEST_SPEC.md drives this list.
- [ ] Security review: no critical/high issues.
- [ ] PLAN.md < 200 lines at ship time (currently above; will prune in Phase 9).

### Should Have
- [ ] Test coverage of every state × every alias.
- [ ] Deprecation notice is a single stderr line, suppressible via `WIP_SILENT_DEPRECATION=1`.

## Demo Scenarios
1. **New enum happy path**: `wip status demo WORKING`, `wip phase demo "Phase 5: Impl"`, `wip list` shows `WORKING [Phase 5: Impl]`.
2. **Legacy alias**: `wip status demo ACTIVE` → deprecation line to stderr, item status becomes WORKING.
3. **Hook integration**: Trigger `on-stop.sh` on a WORKING item → becomes NEEDS_INPUT. Run again with phase="Review" → still becomes NEEDS_INPUT (no guard).
4. **Data-at-rest compat**: Manually write `{"name":"x","status":"WAITING"}` to a work.txt, run `wip get x` → renders as NEEDS_INPUT.
5. **`wip phase` validation**: `wip phase x "this-is-way-too-long-to-fit"` → rejected with clear error.

---

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|

## Verification Plan

### Categories
| Cat | File | Tests |
|---|---|---|
| A | test_status_normalization.sh | 17 (A01–A16 + A06-remix) |
| B | test_phase_validation.sh | 13 (B01–B13) |
| C | test_help_output.sh | 9 (C01–C09) |
| D | test_integration.sh | 15 (D01–D15) |
| E | test_data_at_rest.sh | 10 (E01–E10) |
| F | test_deprecation.sh | 8 (F01–F08) |
| G | test_on_stop.sh | 8 (G01–G08) |
| H | test_on_prompt.sh | 4 (H01–H04) |
| I | test_infrastructure.sh | 6 (I01–I06) |

### RED Baseline (2026-04-20)

**Gate Status**: PASSED (all 9 categories matched; runner keyword fix applied — D→`integration`, E→`data_at_rest`, G→`on_stop`, H→`on_prompt`).

| Cat | Fail | Pass | Errored | Notes |
|---|---|---|---|---|
| A | 41 | 1 | no | Status normalization wholly unimplemented; legacy aliases rejected, canonical new names rejected |
| B | 15 | 5 | no | `wip phase` subcommand does not exist |
| C | 6 | 4 | no | Help text missing new states and `wip phase`; still advertises `wip children` in main USAGE |
| D | 14 | 1 | no | E2E flows fail because phase/normalize/hooks all missing |
| E | 9 | 1 | no | Data-at-rest read compat not implemented; legacy statuses render as-is |
| F | 8 | 0 | no | Deprecation notice never emitted; legacy aliases rejected before alias layer runs |
| G | 5 | 3 | no | on-stop.sh still sets WAITING, not NEEDS_INPUT; guard logic still in place |
| H | 3 | 1 | no | on-prompt.sh does not normalize legacy status in context line |
| I | 5 | 2 | no | `_is_agent_managed_status` still present in wip; on-stop.sh still references IN_REVIEW/RETRO; still writes WAITING |
| **Totals** | **106** | **18** | **0 files errored** | 9 files run, all exited with failures; none crashed before their case statements ran |

### Dominant RED reasons (historical — all resolved in impl)
- `wip phase` missing; legacy aliases not normalized; canonical names rejected by validator; deprecation never emitted; `_is_agent_managed_status` guard still live; `on-stop.sh` emits legacy WAITING + still has IN_REVIEW/RETRO guard; help missing new enum and still promotes `wip children`; `on-prompt.sh` leaks legacy status into context line; `wip list --json` schema drift.

### GREEN (post-impl)
124/124 passing. Independent test-runner verified. Scope-guardian clean. Security review PASS (3 pre-existing findings filed as beads, not introduced here).
