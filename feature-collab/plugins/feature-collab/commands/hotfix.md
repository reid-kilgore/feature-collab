---
description: Emergency production fix with failing test on prod branch
argument-hint: Production issue description or error
---

# Hotfix: Emergency Production Fix

You are helping a developer fix an urgent production issue with minimal risk and maximum speed.

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **Speed with safety**: Move fast but prove the fix works
- **Minimal change**: Touch as little code as possible
- **Test on prod branch**: Write failing test against the production branch
- **Cherry-pick back**: Fix goes to hotfix branch AND main
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents. Exception: git workflow commands (branch, cherry-pick) are orchestration and stay in the main thread.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting hotfix: [issue]"
# When creating hotfix branch: wip add-branch <item> hotfix/[name]
# At phase transitions: wip note <item> "Phase N: [status]"
# At completion: wip status <item> DONE
# When branch is merged: wip branch-status <item> <branch> MERGED
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Phase 1: Triage

**Goal**: Identify the issue, create hotfix branch, write failing test on prod branch.

**Actions**:

1. Launch `code-explorer` agent to determine the production branch (check remote branches and tags).

2. Create PLAN.md at git root:

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

7. Launch `demo-builder` agent to initialize proof doc and capture failing state.

9. **WIP**: `wip note <item> "Phase 1: Issue triaged, failing test on hotfix branch"`

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
   - test-runner captures results to DEMO.md via showboat integration

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

8. **WIP**: `wip note <item> "Phase 2: Hotfix applied, cherry-picked to main"`

9. **Escalation**: If 3 fix cycles fail (lower threshold for hotfixes), escalate immediately.

---

## Phase 3: Demo

**Goal**: Present proof of fix and readiness to deploy.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Demo
   **Waiting For**: User review
   ```

2. Launch `demo-builder` agent:
   - `uvx showboat verify DEMO.md`

3. Update PLAN.md:

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
- **Proof**: See DEMO.md

## Deploy Readiness
- [ ] Hotfix branch pushed
- [ ] Main branch updated
- [ ] Ready for deploy
```

4. **WIP**: `wip status <item> DONE && wip note <item> "hotfix complete — ready to deploy"`

5. Prompt user:
   > "Hotfix ready. Both hotfix branch and main have the fix with passing tests. See DEMO.md for proof. Run `mdannotate PLAN.md` to review. Push when ready:
   > ```
   > git push origin hotfix/[name]
   > git push origin main
   > ```"

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Hotfix details and deploy readiness
- DEMO.md: Proof of fix on both branches

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
