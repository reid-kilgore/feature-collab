# Refined Proposal: gstack Insights → feature-collab

Based on analysis + user feedback. 7 work items.

---

## 1. WTF-Likelihood Budget (Persistent, Cross-Agent)

**What:** Quantitative risk score that accumulates across parallel agents and survives clears/pickups.

**Key constraint:** Can't live in-agent memory. Must be a file on disk that any agent can read/write atomically.

**Design:**
- File: `docs/reidplans/{branch}/RISK_LEDGER.md` (or `.json`) — lives alongside PLAN.md
- Each agent appends entries: `{agent, action, risk_delta, reason, timestamp}`
- Risk events: revert (+15), fix touching >3 files (+5), touching files outside scope (+20), fix after fix 15 (+1 each)
- Any agent reads current total before acting. If >20%, escalate to orchestrator
- HANDOFF.md includes current risk score. Pickup restores it.
- Orchestrator mentions current risk score at phase boundaries

**Why file-based:** Parallelized agents all see the same ledger. Clears don't lose it. Pickups restore it.

---

## 2. Retro Cross-Session State

**What:** Retros written to a well-known location so future retros can trend.

**Design:**
- Location: `~/.claude/feature-collab/retros/{project-slug}/`
- Each retro writes: `{date}-{branch}.json` with structured metrics
- retro-synthesizer reads prior retros for comparison when available
- Metrics to persist: compliance score, experience score, technical score, synthesis recommendations, encoded-into count
- Week-over-week display when prior data exists

---

## 3. Template-Based Skill Generation

**What:** Extract shared blocks from commands/agents into reusable fragments. Generate final files from templates.

**Design:**
- New directory: `plugins/feature-collab/templates/fragments/`
  - `orchestrator-rules.md` — the iron laws (currently copy-pasted across all commands)
  - `model-tiering.md` — haiku/sonnet/opus table
  - `escalation-protocol.md` — when to escalate to user
  - `phase-transition.md` — how to move between phases
  - `dark-factory-rules.md` — autonomous execution constraints
- Template files: `commands/*.md.tmpl` with `{{ORCHESTRATOR_RULES}}`, `{{MODEL_TIERING}}` etc.
- Generator script: `scripts/gen-skills.sh` — simple sed/envsubst, no build system needed
- No CI, but: generator can be run manually, and a `make generate` or npm script makes it easy
- Generated files committed (same as gstack pattern)

---

## 4. Bisectable Commit Splitting

**What:** Before creating the PR, analyze the full diff and produce commits that are each independently buildable. Foundation for stackable PRs later.

**Design:**
- New step in Phase 9 (or enhance the commit agent)
- Algorithm:
  1. Parse `git diff main...HEAD` into file groups
  2. Classify: infrastructure/config → types/interfaces → models/services+tests → controllers/handlers+tests → UI/views+tests → docs/changelog
  3. Stage and commit each group separately, verifying each passes typecheck
  4. If a group can't be isolated (circular dependency), merge with its dependency
- Commit messages reference the original plan/contracts for traceability
- The commit agent already runs in background — this extends its responsibilities

---

## 5. Workflow Metrics in Retro

**What:** Track operational metrics per workflow type, not git LOC stats.

**Metrics to capture:**
- **Per-workflow-type baselines:** enhance, feature-collab, bugfix, refactor, spike
  - Total wall-clock time (session start → PR/completion)
  - Number of phases/steps executed
  - Number of user interventions (AskUserQuestion calls)
  - Number of agent dispatches
  - Number of escalations from dark factory
  - Number of scope-guardian flags
  - Number of criteria-assessor NOT_READY verdicts before passing
- **Cross-session trending:** compare this session's metrics to historical baselines
- **Stored at:** `~/.claude/feature-collab/metrics/{project-slug}/{date}-{branch}.json`

**How retro uses it:** retro-synthesizer reads metrics and flags anomalies ("this enhance took 3x the average intervention count — investigate why")

---

## 6. Scope Pressure Release + Linear Shove

**What:** Two mechanisms that prevent scope creep from silently bloating the diff.

### 6a. Diff Pressure Gauge
- At key phase boundaries (after Phase 5 implementation waves, before Phase 8 exit criteria), the orchestrator reports:
  - "This implementation adds N new files and M modified files to the diff"
  - "Estimated diff size: +X / -Y lines"
  - Comparison to initial scope estimate from PLAN.md
- If actual diff is >2x estimated, orchestrator flags it explicitly and asks whether to continue or cut

### 6b. Linear Shove Conditions

**Critical constraint: Only scope-guardian can trigger a Linear shove.** No other agent knows this mechanism exists. This prevents agents from using Linear as a work-avoidance escape hatch.

**Anti-laziness safeguards:**
- Linear shove is a **scope pressure release**, not a work avoidance mechanism
- Only fires when scope-guardian detects a genuine scope breach
- **Every shove requires explicit user approval** — no silent offloading
- The question must frame the tradeoff honestly: "This is needed but exceeds scope. (A) Expand scope and do it now [recommended], or (B) file Linear issue? Risk of B: [specific consequence]"
- **Default recommendation is always "do it now"** unless it genuinely threatens branch coherence
- **Criteria-assessor still evaluates against ORIGINAL contracts** — shoving to Linear doesn't relax exit criteria. If the feature can't work without it, it can't ship without it.

**What qualifies for shove (all require user approval):**
- Scope-guardian flags discovered adjacent work (bugs in untouched code, unrelated tech debt)
- Scope-guardian flags a prerequisite refactor that would fundamentally change the branch's scope
- NOT: work the feature actually needs to meet its contracts

The `linear-issues` skill already exists — this codifies WHEN it triggers and WHO can trigger it.

---

## 7. False-Positive Suppression with Human Summary

**What:** When reviewers flag something that isn't actually a problem, persist it so it's never flagged again. But surface all suppressions to the user.

**Design:**
- File: `~/.claude/feature-collab/suppressions/{project-slug}.json`
- Schema: `{finding_type, pattern, reason, suppressed_by, date, agent}`
- Agents that read suppressions: code-reviewer, code-security, criteria-assessor
- **Human visibility requirement:**
  - Phase 8 (exit criteria) summary includes: "N findings were auto-suppressed based on prior sessions"
  - Clicking through shows the full suppression list with reasons
  - User can un-suppress ("actually, re-check X from now on")
  - HANDOFF.md includes suppression count
- **Decay:** Suppressions older than 90 days get re-evaluated (code may have changed)
- **Anti-reinforcement:** Suppressions are scoped to specific patterns, not broad categories. "Suppress 'missing error boundary in Button component'" not "suppress all missing error boundary findings"

---

## Implementation Sequence

These have natural dependencies:

```
Phase A (independent, can parallelize):
  [3] Template fragments     — foundational, makes future changes easier
  [2] Retro state location   — simple, just pick the path and update retro agents
  [5] Workflow metrics        — extends retro, independent of other items

Phase B (after templates exist):
  [1] Risk ledger             — new file format + updates to code-architect, orchestrator rules
  [6] Scope pressure + Linear shove — updates to orchestrator rules, scope-guardian, linear-issues

Phase C (after risk ledger):
  [4] Bisectable commits      — extends commit agent
  [7] False-positive suppression — extends reviewer agents, adds to exit criteria
```

Estimated total: This is a feature-collab-sized effort (~3 sessions).
