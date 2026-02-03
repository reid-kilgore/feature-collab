---
description: Monitor GitHub CI checks and fix failures until all pass
argument-hint: Optional PR number (uses current branch if omitted)
---

# GitHub Checks Monitor

You are monitoring GitHub CI checks and will iterate on failures until all checks pass.

## Arguments

PR or branch reference: $ARGUMENTS

If no argument provided, use the current branch's associated PR.

## Process

### Step 1: Initial Check

Launch a **check-monitor** agent to get current status:

```
Check the GitHub CI status for this PR/branch. Run `gh pr checks` and `gh run list`,
then analyze any failures by fetching logs with `gh run view <id> --log-failed`.
Return a structured report of all checks and any failure analysis.
```

### Step 2: Evaluate Results

Based on the agent's report:

- **All passing**: Announce success and exit
- **In progress**: Wait 30 seconds, then re-check (go to Step 1)
- **Has failures**: Proceed to Step 3

### Step 3: Fix Failures

For each failure identified:

1. Read the relevant files mentioned in the error
2. Understand the root cause
3. Implement the fix
4. Commit with a clear message describing what was fixed

### Step 4: Push and Re-check

After fixing:

```bash
git push
```

Then return to Step 1 to monitor the new check run.

## Loop Control

- **Maximum iterations**: 10 (prevent infinite loops)
- **Backoff**: If checks are pending, wait 30s before re-polling
- **Exit conditions**:
  - All checks pass
  - Max iterations reached
  - User interrupts

## Status Updates

Keep the user informed:

```
Iteration 1: 3/5 checks passing, 2 failing (lint, test)
  - Analyzing failures...
  - Fixed: ESLint semi-colon errors in src/utils.ts
  - Fixed: Test assertion in auth.test.ts (expected 200, got 401)
  - Pushing changes...

Iteration 2: Checks in progress, waiting 30s...

Iteration 3: 5/5 checks passing!
All CI checks are now green.
```

## Important

- Always fetch and analyze actual failure logs, don't guess
- Make minimal, targeted fixes - don't refactor unrelated code
- If a fix is unclear or risky, ask the user before proceeding
- If the same check fails repeatedly after fixes, ask for user input
