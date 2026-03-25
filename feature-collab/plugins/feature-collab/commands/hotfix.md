---
name: hotfix
description: "Use when production is broken, users are affected, and an emergency fix must ship immediately on the prod branch"
argument-hint: Production issue description or error
---

# Hotfix: Emergency Production Fix

You are helping a developer fix an urgent production issue with minimal risk and maximum speed.

**Violating the letter of the rules is violating the spirit of the rules.**

## Orchestrator Discipline

You are the ORCHESTRATOR. You do not read code, run tests, or implement. You dispatch agents, synthesize their outputs, update PLAN.md, and talk to the user. Exception: git workflow commands (branch, cherry-pick) are orchestration.

### The Iron Law

```
MINIMAL CHANGE ONLY — URGENCY IS NOT AN EXCUSE TO SKIP VERIFICATION
```

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Production is down, skip the test" | Write the reproduction test. It takes minutes and prevents regressions. |
| "I can see the fix is obvious, just deploy" | Obvious fixes still need test-runner verification. |
| "We'll add tests later" | Later means never. TDD RED-GREEN now. |
| "This related issue should be fixed too" | One fix per hotfix. Other issues get their own tickets. |
| "Cherry-pick conflicts can be resolved later" | Escalate conflicts immediately. Don't let them linger. |

### Red Flags — STOP

- Deploying without test-runner verification
- Fixing more than the production issue
- Skipping the reproduction test because "it's urgent"
- Resolving cherry-pick conflicts without user input

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- **Read the agent's frontmatter `model:` field** before dispatching — it specifies the correct model. Do not default to the orchestrator's model tier.
- Never use Opus for agents that just run commands or read files

**Agent model table** — match the task, not the agent name:

| Task | Model | Examples |
|------|-------|----------|
| Read/find/trace/list code | Haiku | code-explorer (concept tracing), test-runner, commit agent |
| Implement/refactor/debug | Sonnet | code-architect, test-implementer |
| Plan/synthesize/assess | Opus | criteria-assessor |
| CI monitoring | Haiku | gh-checks agent (single agent with poll loop, NOT sleep+check background tasks) |

## Core Principles

- **Speed with safety**: Move fast but prove the fix works
- **Minimal change**: Touch as little code as possible
- **Test on prod branch**: Write failing test against the production branch
- **Cherry-pick back**: Fix goes to hotfix branch AND main
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents. Exception: git workflow commands (branch, cherry-pick) are orchestration and stay in the main thread.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md throughout this skill mean `$DOCS_DIR/PLAN.md`.

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting hotfix: [issue]"
# When creating hotfix branch: wip add-branch <item> hotfix/[name]
# At phase transitions: wip note <item> "Phase N: [status]"
# At completion: wip status <item> IN_REVIEW  (agent-managed — hooks won't overwrite)
# DONE status is set only after branch is merged (not by this skill)
# When branch is merged: wip branch-status <item> <branch> MERGED && wip status <item> DONE
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Context Compaction

When conversation is compacted, invoke `/pickup` to continue — do not continue from the compressed summary alone. Your summary must include: current phase, what you were waiting for, and the instruction to re-invoke via `/pickup`.

## Phase 1: Triage

**Goal**: Identify the issue, create hotfix branch, write failing test on prod branch.

**Actions**:

1. Launch `code-explorer` agent to determine the production branch (check remote branches and tags).

2. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`):

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Hotfix: [Issue Title]

## Status
**Current Phase**: Triage
**Waiting For**: User review

## URGENCY: HIGH

## Issue
- **Symptom**: [What users are seeing]
- **Impact**: [Who/what is affected]
- **Production branch/tag**: [branch or tag name]

## Root Cause
[After investigation]

## Hotfix Plan
- **Branch**: hotfix/[name]
- **Base**: [production branch/tag]
- **Fix**: [one-line description]
- **Cherry-pick to**: main

## Scope (STRICT)

### In Scope
- [ ] Fix the specific production issue
- [ ] Failing test reproducing the issue

### Explicitly Out of Scope
- EVERYTHING else

## Exit Criteria
- [ ] Failing test reproduces the issue
- [ ] Fix makes the test pass
- [ ] All existing tests pass on hotfix branch
- [ ] Fix cherry-picked to main cleanly
- [ ] All tests pass on main after cherry-pick
```

3. Create hotfix branch:
   ```bash
   git checkout -b hotfix/[name] [production-branch]
   ```

4. **WIP**: Track the new branch:
   ```bash
   wip add-branch <item> hotfix/[name]
   wip note <item> "Phase 1: Hotfix branch created from [production-branch]"
   ```

5. Launch `code-explorer` agent to trace the issue.

5. Launch `test-implementer` agent to write failing test.

6. Launch `test-runner` agent to confirm the test fails (TDD RED state).

7. **WIP**: `wip note <item> "Phase 1: Issue triaged, failing test on hotfix branch"`

### Commit Planning Artifacts

Dispatch a haiku agent to commit planning documents. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```

### Context Checkpoint

All state saved to disk:
- PLAN.md: Issue, root cause, hotfix plan, scope

**If your context feels heavy, `/clear` then `/pickup` to continue.**

10. **CHECKPOINT**:
    > "Issue triaged, failing test written on hotfix branch. Review [Root Cause](#root-cause) and [Hotfix Plan](#hotfix-plan). Say **'fix'** to proceed."

---

## Phase 2: Fix & Verify (Dark Factory)

**Goal**: Fix on hotfix branch, run tests, cherry-pick to main. Runs autonomously.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Fix & Verify
   **Waiting For**: In progress (dark factory)
   ```

2. Launch `code-architect` agent to fix:
   - MINIMAL change only
   - On the hotfix branch

3. Launch `test-runner` agent:
   - Reproduction test now passes
   - ALL existing tests still pass

4. Cherry-pick to main:
   ```bash
   git checkout main
   git cherry-pick hotfix/[name]
   ```

5. If cherry-pick conflicts:
   - **Escalate to user immediately** — hotfixes don't tolerate ambiguity
   - Show the conflict and proposed resolution

6. Launch `test-runner` agent on main to verify tests pass after cherry-pick.

7. Launch `scope-guardian` agent to verify minimal change.

8. Launch `criteria-assessor` agent (lightweight):
   - Verify exit criteria from Phase 1 are met
   - Confirm fix works on both branches, all tests pass
   - If NOT READY, fix and re-assess (max 2 cycles — hotfixes have lower threshold)

9. **WIP**: `wip note <item> "Phase 2: Hotfix applied, cherry-picked to main"`

10. **Escalation**: If 3 fix cycles fail (lower threshold for hotfixes), escalate immediately.

---

## Phase 3: Wrap-up

**Goal**: Present proof of fix and readiness to deploy.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Wrap-up
   **Waiting For**: User review
   ```

2. Update PLAN.md:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Hotfix Summary
- **Issue**: [description]
- **Root Cause**: [one-line]
- **Fix**: [one-line]
- **Hotfix branch**: hotfix/[name] — tests passing
- **Main branch**: cherry-pick applied — tests passing

## Deploy Readiness
- [ ] Hotfix branch pushed
- [ ] Main branch updated
- [ ] Ready for deploy
```

3. **WIP**: `wip status <item> IN_REVIEW && wip note <item> "hotfix complete — ready to deploy/merge"`
   > `IN_REVIEW` tells hooks not to overwrite with ACTIVE/WAITING — preserves the status until a human acts.

4. Prompt user:
   > "Hotfix ready. Both hotfix branch and main have the fix with passing tests. Run `mdannotate PLAN.md` to review. Push when ready:
   > ```
   > git push origin hotfix/[name]
   > git push origin main
   > ```"

5. Offer retrospective:
   > "For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Hotfix details and deploy readiness

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
