---
name: release
description: "Use when preparing a release branch — cherry-picking commits, resolving conflicts, updating changelogs, and verifying the release candidate"
argument-hint: Target branch name and commits/PRs to include
---

# Release: Prepare Release Branch

You are helping a developer prepare a release branch by selecting commits, resolving conflicts, and verifying the result.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
EVERY COMMIT IN THE RELEASE MUST BE VERIFIED — NO "IT WORKED IN DEV" ASSUMPTIONS
```

A release ships to users. Every shortcut here becomes a production incident.

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "It passed CI so it's fine" | CI doesn't catch everything. Run the full verification suite. |
| "This commit is trivial, skip verification" | Trivial commits cause non-trivial outages. Verify everything. |
| "We can hotfix it if something breaks" | Hotfixes are expensive. Catch it now. |
| "The cherry-pick applied cleanly" | Clean apply ≠ correct behavior. Test the result. |
| "We're under time pressure" | Shipping broken code costs more time than verifying. |

### Red Flags — STOP

- Cherry-picking without verifying each commit individually
- Skipping the full test suite before tagging
- Not resolving merge conflicts properly (taking "ours" or "theirs" blindly)
- Rushing past the changelog
- Not confirming the release branch matches the intended scope

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

**Agent model table** — match the task, not the agent name:

| Task | Model | Examples |
|------|-------|----------|
| Read/find/trace/list code | Haiku | code-explorer, test-runner, commit agent |
| Implement/refactor/debug | Sonnet | code-architect, conflict resolution |
| Plan/synthesize/assess | Opus | release scope decisions |
| CI monitoring | Haiku | gh-checks agent (single agent with poll loop, NOT sleep+check background tasks) |

## Core Principles

- **User controls what's included**: Never cherry-pick without confirmation
- **Tests must pass**: Release branch must have a green test suite
- **Traceability**: Every included commit is documented
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents. Exception: git workflow commands (branch, cherry-pick) are orchestration and stay in the main thread.
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
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting release: [version]"
# When creating release branch: wip add-branch <item> <release-branch>
# At phase transitions: wip note <item> "Phase N: [status]"
# At completion: wip note <item> "release complete — ready to push/merge"
# DONE status is set only after branch is merged (not by this skill)
# When branch is merged: wip branch-status <item> <branch> MERGED && wip status <item> DONE
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Context Compaction

When conversation is compacted, invoke `/pickup` to continue — do not continue from the compressed summary alone. Your summary must include: current phase, what you were waiting for, and the instruction to re-invoke via `/pickup`.

## Phase 1: Plan

**Goal**: User specifies target branch, commits to include. Confirm the plan.

**Actions**:

1. Launch `code-explorer` agent to gather recent git log and present commits for user selection.

2. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`):

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Release: [version/branch name]

## Status
**Current Phase**: Plan
**Waiting For**: User confirmation

## Release Target
- **Branch**: [release/v1.2.0]
- **Base**: [main or tag]

## Commits to Include
| # | Commit | Message | PR | Include? |
|---|--------|---------|----|----------|
| 1 | abc123 | Add feature X | #45 | Yes |
| 2 | def456 | Fix bug Y | #46 | Yes |
| 3 | ghi789 | Refactor Z | #47 | No (defer) |

## Commits to Exclude
| Commit | Message | Reason |
|--------|---------|--------|
| ghi789 | Refactor Z | Not ready for release |

## Exit Criteria
- [ ] Release branch created
- [ ] All selected commits cherry-picked
- [ ] Conflicts resolved (if any)
- [ ] All tests passing on release branch
- [ ] Release documented
```

3. **WIP**: `wip note <item> "Phase 1: Release plan ready, awaiting confirmation"`

4. **CHECKPOINT**:
   > "Release plan ready. Review [Commits to Include](#commits-to-include). Say **'prepare'** to create the release branch."

---

## Phase 2: Execute

**Goal**: Create branch, cherry-pick commits, resolve conflicts, run tests.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Execute
   **Waiting For**: In progress
   ```

2. Create the release branch:
   ```bash
   git checkout -b [release-branch] [base]
   ```

3. **WIP**: Track the new branch:
   ```bash
   wip add-branch <item> [release-branch]
   wip note <item> "Phase 2: Release branch created from [base]"
   ```

3. Cherry-pick each commit in order:
   ```bash
   git cherry-pick [commit-hash]
   ```

4. **If conflicts occur**:
   - Show the conflict to the user
   - Suggest resolution based on code context
   - **Do NOT auto-resolve** — get user confirmation
   - After resolution: `git add . && git cherry-pick --continue`

5. Launch `demo-builder` agent to initialize proof doc and capture the release git log.

6. Launch `test-runner` agent on the release branch:
   - Full test suite must pass
   - All curl tests must pass
   - test-runner captures results to DEMO.md via showboat integration

7. If tests fail, work with user to resolve.

---

## Phase 3: Verify & Communicate

**Goal**: Document the release and confirm readiness.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Verify & Communicate
   **Waiting For**: User review
   ```

2. Launch `demo-builder` agent:
   - Verify DEMO.md (re-run all captures)
   - Capture final git log showing included commits

3. Update PLAN.md:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Release Summary
- **Branch**: [release-branch]
- **Commits included**: [count]
- **Conflicts resolved**: [count]
- **Tests**: All passing (N/N)
- **Proof**: See DEMO.md

## Included Changes
[Summary of what's in this release]

## Known Issues
[Any caveats or known issues with this release]
```

4. **WIP**: `wip note <item> "release complete — ready to push/merge"`

5. Prompt user:
   > "Release branch ready. See DEMO.md for proof. Run `mdannotate PLAN.md` to annotate and review. When ready, push with `git push origin [release-branch]`."

6. Offer retrospective:
   > "For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Release details and status
- DEMO.md: Proof with git log and test results

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
