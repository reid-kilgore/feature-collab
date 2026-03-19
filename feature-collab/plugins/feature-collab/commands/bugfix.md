---
name: bugfix
description: "Use when something that previously worked is now broken — a regression, a failing test, or a user-reported defect"
argument-hint: Bug description, issue link, or error message
---

# Bugfix: Targeted Bug Fix

You are helping a developer fix a specific bug through a focused, reproduce-first process.

**Violating the letter of the rules is violating the spirit of the rules.**

## Orchestrator Discipline

You are the ORCHESTRATOR. You do not read code, run tests, or implement. You dispatch agents, synthesize their outputs, update PLAN.md, and talk to the user.

### The Iron Law

```
FIX ONLY THE BUG — NOTHING ELSE SHIPS IN THIS PR
```

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I can quickly check the code myself" | Delegate to code-explorer. You orchestrate. |
| "I understand the domain from reading the code" | Check existing tests first. Code tells you what it does; tests tell you what it's supposed to do. A prior session designed a fix that reversed guard logic because it skipped this step. |
| "While fixing this I noticed another issue" | Separate ticket. File it with `linear-issues` agent. Not this PR. |
| "This refactor would prevent the bug class entirely" | That's an enhance or refactor, not a bugfix. |
| "The surrounding code is messy, let me clean it up" | Scope creep. Fix the bug only. |
| "Tests should be green now" | Launch test-runner. "Should" isn't verified. |
| "Do you have the dev server running?" | Start it yourself. Read package.json to find the command. |
| "Should I start the server for you?" | Yes, obviously. Don't ask — that's your job. Investigate and start it. |
| "The DB is empty so the demo would just show empty states" | Seed the database. Run the seed script or insert test data yourself. Empty DB is not an excuse to skip demos. |

### Red Flags — STOP

- Reading code directly instead of delegating
- Fixing more than the reported bug
- Skipping the reproduction test (TDD RED)
- Claiming fix works without test-runner verification
- Asking the user to start servers, run seeds, or do infrastructure setup you could do yourself

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- **Read the agent's frontmatter `model:` field** before dispatching — it specifies the correct model. Do not default to the orchestrator's model tier.
- Never use Opus for agents that just run commands or read files

**Agent model table** — match the task, not the agent name:

| Task | Model | Examples |
|------|-------|----------|
| Read/find/trace/list code | Haiku | code-explorer (concept tracing), test-runner, commit agent |
| Implement/refactor/debug | Sonnet | code-architect, test-implementer, systematic-debug |
| Plan/synthesize/assess | Opus | criteria-assessor |
| CI monitoring | Haiku | gh-checks agent (single agent with poll loop, NOT sleep+check background tasks) |

## Core Principles

- **Reproduce first**: Write a failing test BEFORE attempting any fix
- **Minimal scope**: Fix the bug and nothing else — no refactoring, no "improvements"
- **Proof of fix**: Showboat document proves the bug is fixed
- **PLAN.md is source of truth**: Create/update at every phase
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
  DEMO.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md, DEMO.md throughout this skill mean `$DOCS_DIR/PLAN.md`, `$DOCS_DIR/DEMO.md`.

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting bugfix: [description]"
# At phase transitions: wip note <item> "Phase N: [status]"
# When creating branches: wip add-branch <item> <branch>
# At completion: wip status <item> IN_REVIEW  (agent-managed — hooks won't overwrite)
# DONE status is set only after branch is merged (not by this skill)
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Context Compaction

When conversation is compacted, invoke `/pickup` to continue — do not continue from the compressed summary alone. Your summary must include: current phase, what you were waiting for, and the instruction to re-invoke via `/pickup`.

## Metrics Tracking

The orchestrator tracks workflow efficiency metrics for this session. These feed into retro baselines and anomaly detection.

**Schema** — maintain this object in working memory throughout the session:

```json
{
  "workflow_type": "bugfix",
  "started_at": "<ISO timestamp — set at skill start>",
  "phases_executed": 0,
  "user_interventions": 0,
  "agent_dispatches": 0,
  "dark_factory_escalations": 0,
  "scope_guardian_flags": 0,
  "criteria_not_ready_count": 0,
  "completed_at": null
}
```

**Increment rules**:
- `phases_executed` — increment at each phase boundary (1→2, 2→3, etc.)
- `user_interventions` — increment each time the orchestrator asks the user a question or waits for user input ("say 'lock scope' to proceed" counts; follow-up clarifications count)
- `agent_dispatches` — increment each time an agent is launched (parallel agents = N increments)
- `dark_factory_escalations` — increment when the escalation path in Phase 2 (systematic-debug + 2 cycles + user escalation) reaches the user
- `scope_guardian_flags` — increment each time scope-guardian returns a flag or finding (not every dispatch — only dispatches that produce actionable flags)
- `criteria_not_ready_count` — increment each time criteria-assessor returns NOT READY

**Write metrics at workflow completion** (Phase 3 Demo, before PR handoff):

```bash
mkdir -p ~/.feature-collab/metrics
BRANCH=$(git branch --show-current)
DATE=$(date +%Y-%m-%d)
cat > ~/.feature-collab/metrics/${DATE}-${BRANCH}.json << 'EOF'
{ <metrics object with completed_at set to current ISO timestamp> }
EOF
```

Individual agents do not need to know about metrics — this is orchestrator-only bookkeeping.

---

## Phase 1: Reproduce & Scope

**Goal**: Identify the bug, reproduce it with failing tests, lock scope to just the fix.

**Actions**:

1. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`):

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Bugfix: [Bug Title]

## Status
**Current Phase**: Reproduce & Scope
**Waiting For**: User review

## Bug Description
[What's broken — symptoms, error messages, affected code]

## Reproduction Steps
1. [Step to reproduce]
2. [Expected vs actual behavior]

## Root Cause Analysis
[After investigation — what's actually wrong and why]

## Scope (LOCKED after Phase 1)

### In Scope
- [ ] Fix: [specific fix description]
- [ ] Test: Failing test that reproduces the bug

### Explicitly Out of Scope
- Any refactoring of surrounding code
- Any feature additions
- Any "while we're here" improvements

## Exit Criteria
- [ ] Failing tests reproduce the bug
- [ ] Fix makes the test pass
- [ ] All existing tests still pass
- [ ] No regressions introduced
```

2. **Before designing any fix**, launch a `code-explorer` agent to find existing tests for the affected code path. A single grep for test assertions on the affected function/model reveals what the expected behavior IS before you decide what it SHOULD be. Skipping this step caused a guard logic reversal in a prior session — the fix contradicted the existing test expectations.

3. Launch `code-explorer` agent to investigate using the **systematic debugging methodology** (see `/feature-collab:systematic-debug`):
   - **Phase 1 — Root Cause Investigation**: Read error carefully, reproduce consistently, review recent changes, gather diagnostic evidence across system boundaries
   - **Phase 2 — Pattern Analysis**: Find working examples, compare working vs broken, identify violated assumptions
   - Agent MUST return: the specific mechanism causing the failure, the specific condition triggering it, and a hypothesis log

   If the first investigation is inconclusive, launch `systematic-debug` agent for deeper analysis before proceeding.

3. Update PLAN.md with Root Cause Analysis

4. Launch `test-implementer` agent:
   - Write a test that reproduces the bug exactly
   - Test MUST fail before the fix (TDD RED)

5. Launch `test-runner` agent to confirm the test fails (TDD RED state).

6. Launch `demo-builder` agent to initialize proof doc:
   - `showboat init DEMO.md "Bugfix: [bug title]"`
   - Capture the failing test output

7. **WIP**: `wip note <item> "Phase 1: Bug reproduced, failing test written"`

### Commit Planning Artifacts

Dispatch a haiku agent to commit planning documents. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md $DOCS_DIR/DEMO.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```

### Context Checkpoint

All state saved to disk:
- PLAN.md: Bug description, root cause, scope
- DEMO.md: Failing test capture

**If your context feels heavy, `/clear` then `/pickup` to continue.**

8. **CHECKPOINT**:
   > "Bug reproduced with failing test. Root cause identified. Review [Root Cause Analysis](#root-cause-analysis) and [Scope](#scope). Say **'lock scope'** to proceed with the fix."

---

## Phase 2: Fix & Verify (Dark Factory)

**Goal**: Fix the bug, verify all tests pass. Runs autonomously after user approval.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Fix & Verify
   **Waiting For**: In progress (dark factory)
   ```

2. Launch `code-architect` agent to implement the fix:
   - ONLY modify what's needed to fix the bug
   - Follow existing code patterns
   - No refactoring

3. Launch `test-runner` agent to verify:
   - The reproduction test now passes
   - ALL existing tests still pass
   - Run curl tests if applicable
   - test-runner captures results to DEMO.md via showboat integration

4. Launch `scope-guardian` agent:
   - Verify the fix didn't change anything outside scope
   - Flag any scope creep

6. **Escalation**: If test-runner reports failures and code-architect can't fix in 3 cycles, launch `systematic-debug` agent to apply the full 4-phase methodology before trying more fixes. If still failing after systematic debug + 2 more cycles, escalate to user with full context including the hypothesis log.

7. **WIP**: `wip note <item> "Phase 2: Bug fixed, all tests green"`

8. Launch `criteria-assessor` agent (lightweight):
   - Verify exit criteria from Phase 1 are met
   - Confirm reproduction test passes, all other tests pass, no regressions
   - If NOT READY, fix and re-assess (max 3 cycles)

9. When all tests pass and criteria met, proceed to Phase 3.

---

## Phase 3: Demo

**Goal**: Present proof of fix to user.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Demo
   **Waiting For**: User review
   ```

2. Launch `demo-builder` agent:
   - Verify DEMO.md (re-run all captures)
   - Add final summary

3. If this is a web bug, launch `browser-verifier` agent for visual confirmation.

4. Update PLAN.md with final status:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Fix Summary
- **Root Cause**: [one-line summary]
- **Fix**: [one-line summary]
- **Tests**: All passing (N/N)
- **Proof**: See DEMO.md
```

5. **WIP**: `wip status <item> IN_REVIEW && wip note <item> "bugfix complete — PR ready for human review"`
   > `IN_REVIEW` tells hooks not to overwrite with ACTIVE/WAITING — preserves the status until a human acts.

6. Prompt user:
   > "Bug fixed and verified. See DEMO.md for proof. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

7. Offer retrospective:
   > "For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Current status and fix details
- DEMO.md: Proof of fix with captured outputs

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
