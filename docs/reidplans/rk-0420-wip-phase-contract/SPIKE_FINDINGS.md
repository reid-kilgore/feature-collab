<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Spike: Nasqueron trim + wip state model redesign

## Status
**Current Phase**: Report
**Waiting For**: User review

## Question
Three converging threads:
1. **Nasqueron**: which features to cut (starting with direct-to-Claude send), and where are Linear/GitHub integrations over-engineered?
2. **wip**: redesign status model to 4 states (NOT_STARTED / WORKING / NEEDS_INPUT / DONE) + ≤15-char display string for the current project phase.
3. **feature-collab skills**: every call site that sets/reads wip state so the new contract is designed against real usage.

---

## Findings

### 1. Nasqueron — small, tidy, with two hotspots
Source: `/Users/reid/dev/fun_claude/swiftui-play/Sources` (~4,000 LOC / 28 files).

**Send-to-Claude removal is clean (~80 LOC).**
- `WipDetailView.swift:573–583` — `submitClaudeInput()` (text input → dispatch)
- `WipDetailView.swift:513–525` — `quickButton()` slash-command dispatch
- `TmuxService.swift:111–119` — `sendToClaudeSession(loc, message)` (tmux send-keys)

Preview/render path is separate and stays:
- `WipDetailView.swift:261–276` — `refreshClaudeOutput()` poller
- `TmuxService.swift:27–38, 83–107, 123–133` — pane lookup + capture (used by preview)

Shared state to audit on removal: claudeInputText cache, pane-height cache (`WipDetailView.swift:14–26`). `ClaudeSession.swift` model stays.

**Documents tab is independent.** No references to `sendToClaudeSession()` / `claudeInputText`. Safe.

**Polling hotspots (not previously known):**
| Refresh | Interval | Cost | Easy win |
|---|---|---|---|
| active items | **2 s** | shell spawn every 2 s reading every `work.txt` | coalesce → 5 s |
| sessions | **1 s** | file I/O per item, every second | coalesce → 5 s |
| claude output | 3–5 s | tmux capture | leave |
| docs watch | 3 s | mtime stat, only when tab visible | leave |
| linear cache sync | 60 s | `wip pull-linear` subprocess | leave |
| PR status | on-demand, 60 s TTL | `gh pr list` | leave |

**Linear/GitHub are less over-engineered than feared.**
- Linear: on-disk cache at `~/panop/.wip-linear*` (written by `wip pull-linear`), plus on-demand live GraphQL search in `LinearStartView`. The live search is the main candidate to cut — rely on cache only, accept ≤60 s staleness.
- Two Linear pickers exist (`LinearStartView` + `LinearPickerSheet`) — could merge (~50 LOC saved).
- GitHub: thin `gh pr list` wrapper, 60 s TTL, on-demand only. Fine as-is.

### 2. wip — 8 statuses collapse cleanly to 4
Source: `/Users/reid/dev/fun_claude/feature-collab/wip` (single bash script, JSONL storage in `~/panop/<repo>/work.txt`).

**Storage is already extensible.** `wip set <item> <key> <value>` accepts arbitrary keys (verified at wip:371–385). Adding a `phase` field needs **zero schema migration** — just a new key and render code.

**Proposed mapping:**
| Current | → | New | Notes |
|---|---|---|---|
| NEW | → | NOT_STARTED | |
| ACTIVE | → | WORKING | primary state |
| BLOCKED | → | NEEDS_INPUT | external blocker |
| WAITING | → | NEEDS_INPUT | Claude stopped, user's turn |
| IN_REVIEW | → | WORKING + phase="Review" | agent-managed; keep hook guard |
| RETRO | → | WORKING + phase="Retro" | agent-managed; keep hook guard |
| DONE | → | DONE | |
| CLOSED | → | DONE | or keep separate if "abandoned" semantics matter |

The agent-managed-status hook guard at `on-stop.sh:47–49` stays — without it, WORKING+Review would get overwritten to NEEDS_INPUT every stop.

**Surface to update inside wip itself:**
- `cmd_status` validator (line 289) — new enum
- `cmd_list` renderer (lines 266–275) — show phase column
- `cmd_help` — new states + de-emphasize `wip children`
- Hooks `~/.claude/hooks/on-prompt.sh`, `on-stop.sh` — map to new enum

**`wip children` is safe to de-emphasize.** Grep confirms: **only `project-lead` skill uses it.** No leaf-level skill depends on children. Parent/child is established at creation via `wip start --linear` and read rarely after that.

### 3. feature-collab skills — ~35 call sites, mechanical migration
Every `wip` invocation across the plugin:

| Skill | Common calls | Phases |
|---|---|---|
| feature-collab | `status ACTIVE`, `note "Phase N…"`, `add-branch`, `status IN_REVIEW`, `branch-status … MERGED` | 0 Setup / 1 Scope / 2 Contracts / 3 Skeleton / 4 Arch / 5 Impl / 6 Review / 7 Security / 8 Exit / 9 Demo |
| enhance | `status ACTIVE`, `note "Phase N…"`, `status IN_REVIEW` | 1 Scope / 2 Impl / 3 Review / 4 Verify / 5 Demo |
| bugfix | same shape | 1 Reproduce / 2 Fix / 3 Demo |
| hotfix | + `add-branch hotfix/…` | 1 Triage / 2 Fix / 3 Demo |
| refactor | standard | 1 Characterize / 2 Refactor / 3 Demo |
| spike | standard | 1 Explore / 2 Report |
| release | + `add-branch` | 1 Plan / 2 Execute / 3 Verify |
| systematic-debug | standard | 1 Investigate / 2 Patterns / 3 Hypothesis / 4 Fix |
| project-lead | + `children`, `status WAITING` on handoff | 0 Orient → 6 Handoff |
| retro | `status RETRO`, `status WAITING` | 1–3 |

**Pattern is uniform.** Every skill already emits a `wip note "Phase N: ..."` at each phase boundary. Migration is mostly:
- `wip note <item> "Phase 2: Impl — ..."` → `wip phase <item> "Phase 2: Impl"` (new command) + keep `note` for the prose.
- `wip status <item> ACTIVE` → `wip status <item> WORKING`
- `wip status <item> WAITING` → `wip status <item> NEEDS_INPUT`
- `wip status <item> IN_REVIEW|RETRO` → `wip status <item> WORKING` + `wip phase` set to `"Review"` / `"Retro"`

**"say X" prompts** (`say 'lock scope'`, `say 'done'`, `say 'implement'`) are the *human-gate* signals. Formalize by having the skill set `NEEDS_INPUT` at those exact points — Nasqueron's color cue then reflects the gate without the user reading the transcript.

**Update surface:** ~17 skill command files + ~6 workflow YAMLs + wip CLI + 2 hooks + adapter scripts. Bulk is one-for-one text substitution; mechanical.

---

## Recommendations

Do in this order — earlier pieces lock contracts for the later pieces.

1. **`/feature-collab` — wip CLI: state + phase contract.**
   Add `wip phase <item> <≤15-char-text>` subcommand, new 4-state enum with backwards-compat aliases for one release cycle (ACTIVE→WORKING, WAITING→NEEDS_INPUT, etc. accepted but deprecated). Update `wip list` / interactive UI to render phase. Update help to demote `wip children`. Update on-prompt/on-stop hooks for new names + keep the agent-managed guard. **Scope: single bash script + two hooks + help text. ~200–300 LOC.**

2. **`/feature-collab` — skill migration.** Parallelizable across skills via `/work-graph`. Each skill: swap `status` strings, add `wip phase` calls at phase-boundary docs, convert "say X" prompts to emit `status NEEDS_INPUT`. De-emphasize `wip children` in help/examples everywhere except `project-lead`. **Scope: ~17 command files + ~30 agent files, mostly mechanical edits.**

3. **`/feature-collab` — Nasqueron trim + new-state rendering.** Remove send-to-Claude path (~80 LOC). Coalesce active/session timers (2 s→5 s, 1 s→5 s, ~10 LOC). Update sidebar to color-code by new 4-state + render phase string. Optional: merge `LinearStartView` + `LinearPickerSheet` (~50 LOC), cut live GraphQL search in favor of cache-only. **Scope: ~150–250 LOC net removal + small rendering additions.**

4. **(optional, later) `/enhance` — Linear picker merge** if not bundled into #3.

## Trade-offs
| Option | Pros | Cons |
|---|---|---|
| **Ship wip CLI first, then skills+Nasqueron in parallel** (recommended) | Contract locked once; skill + Swift work truly independent | Two in-flight branches; user must coordinate merges |
| Bundle everything into one feature-collab | Atomic contract change | Big PR, slow review, hard to revert partial work |
| Skills-first, wip last | Lets us validate the state model against real call sites before coding wip | Skills would call a not-yet-existing `wip phase` — awkward |

## Follow-up Actions
- [ ] Kick off `/feature-collab` for **wip CLI contract change** (rec #1). Carry this PLAN.md forward as Phase 1 context.
- [ ] Once wip CLI is on main, spawn `/work-graph` to parallelize **skill migration** (rec #2) and **Nasqueron trim** (rec #3).
- [ ] Decide CLOSED vs DONE: keep CLOSED separate, or fold into DONE? (recommend: fold — one fewer concept.)
- [ ] Decide whether IN_REVIEW/RETRO survive as *phases* under WORKING (recommend: yes, via phase string — preserves hook guard without a new state).

## Status
**Current Phase**: Complete
**Completed**: 2026-04-20
