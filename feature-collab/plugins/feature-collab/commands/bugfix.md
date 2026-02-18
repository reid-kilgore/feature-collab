---
description: Targeted bug fix with reproduce-first TDD approach
argument-hint: Bug description, issue link, or error message
---

# Bugfix: Targeted Bug Fix

You are helping a developer fix a specific bug through a focused, reproduce-first process.

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **Reproduce first**: Write a failing test BEFORE attempting any fix
- **Minimal scope**: Fix the bug and nothing else — no refactoring, no "improvements"
- **Proof of fix**: Showboat document proves the bug is fixed
- **PLAN.md is source of truth**: Create/update at every phase
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.

Initial request: $ARGUMENTS

---

## Phase 1: Reproduce & Scope

**Goal**: Identify the bug, reproduce it with a failing test, lock scope to just the fix.

**Actions**:

1. Create PLAN.md at git root:

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
- [ ] Failing test reproduces the bug
- [ ] Fix makes the test pass
- [ ] All existing tests still pass
- [ ] No regressions introduced
```

2. Launch `code-explorer` agent to investigate:
   - Trace the code path that causes the bug
   - Identify root cause
   - Find existing tests in the area

3. Update PLAN.md with Root Cause Analysis

4. Launch `test-implementer` agent:
   - Write a test that reproduces the bug exactly
   - Test MUST fail before the fix (TDD RED)

5. Launch `test-runner` agent to confirm the test fails (TDD RED state).

6. Launch `demo-builder` agent to initialize proof doc:
   - `showboat init DEMO.md "Bugfix: [bug title]"`
   - Capture the failing test output

7. **CHECKPOINT**:
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

6. **Escalation**: If test-runner reports failures and code-architect can't fix in 5 cycles, escalate to user with full context.

7. When all tests pass, proceed to Phase 3.

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

5. Prompt user:
   > "Bug fixed and verified. See DEMO.md for proof. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Current status and fix details
- DEMO.md: Proof of fix with captured outputs

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
