<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup ({==highlight==}, {>>comment<<}, {++add++}, {--delete--})
- Claude: Uses {==highlights==} only
-->

# Proposal: Cut Verbosity in `commands/feature-collab.md` + Restructure Plan/State Templates

**Status**: REVISED — user feedback integrated, ready for final go
**Target files**: `commands/feature-collab.md` + new `templates/` skeletons + new `agents/` for Phase 8 mechanics
**Drafts to react to**:
- `DRAFT_PLAN_SKELETON.md` (plugin root)
- `DRAFT_SESSION_STATE_SKELETON.md` (plugin root)

## Resolved Decisions

User annotations from prior round, captured here so the plan reflects current state:

| Item | Resolution | Source |
|------|------------|--------|
| Templates dir | YES — bring back. **Hard-cap to 4 files**: PLAN, SESSION_STATE, CONTRACTS, TEST_SPEC. Agents over-spawn artifacts; the cap is the prevention. | L71 annotation |
| PLAN.md content | Restructure to senior-dev-to-senior-dev architecture tone. ASCII be/fe flow diagrams. Linear/bd field. Codebase Context appendix so later phases don't re-trace concepts. Fast follows must have tracking ID. | L71 + this thread |
| SESSION_STATE.md | Houses process state (phase, scope-lock, agent log, todos, verification checkpoints). Anchors clear/re-enter recovery. | This thread |
| Wave 2 (extract Orchestrator Discipline to shared doc) | **DROPPED**. Citing a doc makes Iron Law optional reading — kills the forcing function. Only the in-skill Red Flags ↔ Common Rationalizations dedup survives. | L103 annotation |
| Path resolution / worktrees | Confirmed critical (work happens almost exclusively in worktrees). Moot now since wave 2 dropped. | L132 annotation |

## Problem (unchanged)

`feature-collab.md` is 1038 lines. Half is necessary skill instructions. The other half is:

1. Operational agent prompts inlined into the skill (commit splitting, PR creation, pre-commit gates)
2. Long markdown templates the orchestrator is told to copy-paste verbatim
3. Redundant sections covering the same ground twice (Core Principles vs Orchestrator Discipline; Red Flags vs Common Rationalizations)

Cost: skill loaded into context every invocation. Edits ripple awkwardly when format and instructions are tangled.

## Goal

Cut `feature-collab.md` from 1038 → ~700 lines. Move agent-prompt content to dedicated agent files. Move templates to `templates/`. Restructure PLAN.md and SESSION_STATE.md to make them iteration-friendly artifacts rather than orchestrator runbook excerpts.

## Wave 1 — Self-Contained Cuts (low risk)

Touches only `commands/feature-collab.md` + creates new `agents/` + new `templates/`. Easy to review, easy to roll back.

### 1a. Redundancy cuts (~40 lines)

| Section | Lines | Action |
|---------|-------|--------|
| Core Principles (L114-127) | 14 | DELETE — every bullet duplicates Iron Laws / Transparency Rules / Verification Gate above |
| Red Flags (L84-97) | 14 | MERGE into Common Rationalizations table — drop duplicates ("Reading code directly", "Edit/Write on source files", "Skipping a phase") |
| Context Compaction (L189-202) | 14 | COMPRESS to 4 lines: "After compaction, re-invoke skill via /pickup. PLAN.md + SESSION_STATE.md are the recovery artifacts." |

### 1b. Extract Phase 8 operational mechanics → new agents

Phase 8 currently inlines three full agent prompts (~80 lines). Pull each into its own agent file. Skill becomes a one-line dispatch.

**New agent: `agents/commit-splitter.md`** (haiku)
- Owns: bisectable commit splitting logic (current L928-964)
- Includes: stash guard, layer classification, soft-reset, per-layer commit format, typecheck after each, edge-case rules
- Skill becomes: "Dispatch `commit-splitter` agent. Restructures commits into bisectable layers."

**New agent: `agents/pr-creator.md`** (haiku)
- Owns: pre-push PR-state check, push, gh pr create with body template (current L966-992)
- Skill becomes: "Dispatch `pr-creator` agent with PLAN.md Final Summary as PR body source."

**New agent: `agents/pre-commit-gates.md`** (haiku)
- Owns: debug marker sweep, typecheck, eslint (current L920-927)
- Skill becomes: "Dispatch `pre-commit-gates` agent before commit splitting."

Three separate agents (not one merged `release-pr.md`) because each is independently useful from `enhance.md` and `bugfix.md`.

### 1c. Inline templates → `templates/` dir

Templates currently inline in skill: PLAN.md skeleton, Architecture skeleton, SESSION_STATE.md, Final Summary (~185 lines of triple-backticked markdown).

**Move to `templates/` dir. Hard-cap to 4 files** (per user constraint — agents over-spawn artifacts):

- `templates/PLAN.skeleton.md`
- `templates/SESSION_STATE.skeleton.md`
- `templates/CONTRACTS.skeleton.md`
- `templates/TEST_SPEC.skeleton.md`

No DETAILS.md, DECISIONS.md, ARCHITECTURE.md, or other files. Architecture lives inline in PLAN.md (Approach + Codebase Context sections). Decisions live inline in PLAN.md (Key Decisions section). If an agent wants to spawn a fifth file, the skill should redirect them.

Skill cites paths (`templates/PLAN.skeleton.md`); orchestrator reads when needed.

### 1d. PLAN.md / SESSION_STATE.md content restructure (NEW)

Current PLAN.md skeleton mixes process state (phase, status, scope lock, sections-needing-review) with content (overview, architecture, codebase context). Reads like an orchestrator runbook, not a doc you'd want to redline.

Split:

**PLAN.md** — human-LLM iteration surface. Senior-dev-to-senior-dev tone. Sections (per `DRAFT_PLAN_SKELETON.md`):
- Linear / bd epic header
- Problem (prose)
- Approach (prose — the *story*, not a file list)
- Flow (ASCII be/fe diagram)
- Key Decisions (numbered, with alternatives considered)
- Open Questions (CriticMarkup-friendly)
- Scope (in / out / fast follows — fast follows MUST have tracking ID)
- Exit Criteria
- Verification (pointer to TEST_SPEC.md)
- Contracts (pointer to CONTRACTS.md)
- **Codebase Context** (appendix — impact map, patterns, risks; written in Phase 1, not re-derived later)
- Annotation Log

**SESSION_STATE.md** — process state, churns each session. Sections (per `DRAFT_SESSION_STATE_SKELETON.md`):
- Phase / sub-phase / status / waiting-for / last-updated
- Scope Lock status
- Active Todos (with bd-id refs)
- Agent Dispatch Log
- Decisions Awaiting User
- Verification Checkpoints
- Session Boundaries
- "If You're a New Session" recovery block

Re-entry path: clear context → re-invoke skill → skill loads PLAN.md + SESSION_STATE.md. Skill re-invocation restores discipline; SESSION_STATE restores process; PLAN.md restores design. Three-source recovery, no overlap.

### Wave 1 net effect

| Section | Before | After |
|---------|--------|-------|
| Preamble | ~120 lines | ~80 lines |
| Phase 8 | ~140 lines | ~50 lines |
| Inline templates | ~185 lines | ~10 lines (citations) |
| Other phases | ~593 lines | ~593 lines |
| **`feature-collab.md` total** | **1038** | **~733** |

New files: 3 agents (~50 lines each) + 4 templates (~80 lines each). Net plugin LOC: roughly flat, content lives in correct location. Templates are reusable across all 5 commands.

## Wave 2 — DROPPED

Original wave 2 proposed extracting Orchestrator Discipline (Iron Law, Transparency Rules, etc.) to a shared doc cited by all 5 skills. **Killed** based on L103 annotation:

> hmmmm idk, i kind of like this being forced into context, with this approach it is optional for the agent to read the iron law etc etc.

Correct call. The forcing function is the value — extraction defeats it. Only the in-skill Red Flags ↔ Common Rationalizations dedup (already in 1a) survives.

## Decisions Needed

### Decision 1: Wave 1 scope
- [ ] Approve all of 1a (redundancy cuts) — yes / no / partial
- [ ] Approve all of 1b (3 new agents) — yes / no
- [ ] Approve 1c (templates dir, 4-file cap) — yes / no
- [ ] Approve 1d (PLAN/SESSION_STATE restructure per drafts) — yes / no / iterate-on-drafts-more

### Decision 2: Drafts ready to graduate?
The two `DRAFT_*.md` files at plugin root are reactable shapes. Ready to become `templates/PLAN.skeleton.md` and `templates/SESSION_STATE.skeleton.md`?

- [ ] Drafts good as-is — promote
- [ ] Iterate further before promoting

## Out of Scope

- Phase numbering or workflow reshaping (already done in prior audits)
- Touching agent files other than the 3 new ones in wave 1b
- Anything in `agents/` not listed
- Touching `pickup.md` / `handoff.md`
- Cross-skill orchestrator extraction (was wave 2, dropped)

## Suggested Execution

1. User marks Decisions 1 + 2.
2. If approved: spawn sonnet code-architect with bounded scope:
   - Edit `commands/feature-collab.md` (cuts + Phase 8 dispatch swaps + template citations + Codebase Context section reference)
   - Create `agents/{commit-splitter,pr-creator,pre-commit-gates}.md`
   - Create `templates/{PLAN,SESSION_STATE,CONTRACTS,TEST_SPEC}.skeleton.md` (PLAN + SESSION_STATE seeded from drafts; CONTRACTS + TEST_SPEC adapted from current inline shapes)
   - Update `commands/{enhance,bugfix,hotfix,spike}.md` to reference shared templates (one-line edits — no orchestrator extraction)
3. One commit. Haiku agent for commit + push.
4. Smoke-test on next real `/feature-collab` run before declaring done.

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
| 2026-05-06 | Draft | Initial proposal | Pending user review |
| 2026-05-08 | Revised | User annotations on 1c, wave 2, path resolution | Integrated — wave 2 dropped, 1c constrained, 1d added |
| 2026-05-10 | Revised | PLAN/SESSION_STATE drafts written; Linear/bd field + tracking-ID requirement + Codebase Context appendix added | Pending final go |
