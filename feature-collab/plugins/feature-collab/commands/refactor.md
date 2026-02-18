---
description: Restructure code without changing behavior, verified by existing tests
argument-hint: What to refactor and refactor goals
---

# Refactor: Restructure Without Behavior Change

You are helping a developer refactor code while proving that behavior is completely unchanged.

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **Behavior must not change**: All existing tests must pass before AND after
- **Characterize first**: Snapshot current behavior before touching anything
- **Proof via diff**: Showboat captures before/after to prove equivalence
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.

Initial request: $ARGUMENTS

---

## Phase 1: Characterize

**Goal**: Run existing tests, snapshot current behavior, define refactor goals.

**Actions**:

1. Create PLAN.md at git root:

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Refactor: [Title]

## Status
**Current Phase**: Characterize
**Waiting For**: User review

## Refactor Goals
- [Goal 1: e.g., "Extract shared logic into utility module"]
- [Goal 2: e.g., "Reduce cyclomatic complexity of processOrder()"]

## Current State
- **Test suite status**: [passing/failing count]
- **Files to modify**: [list]
- **Behavior snapshot**: See DEMO.md (before section)

## Scope

### In Scope
- [ ] [Specific restructuring 1]
- [ ] [Specific restructuring 2]

### Explicitly Out of Scope
- Any behavior changes
- Any new features
- Any bug fixes (unless they're blocking the refactor)

## Exit Criteria
- [ ] ALL existing tests still pass (zero regressions)
- [ ] Refactor goals achieved
- [ ] No behavior changes (showboat before/after match)
- [ ] Code is cleaner/simpler by stated goals
```

2. Launch `code-explorer` agent to map the code being refactored:
   - Current structure and dependencies
   - Existing test coverage
   - Risk areas

3. Launch `test-runner` agent to run ALL existing tests and record baseline.

4. Launch `demo-builder` agent to initialize proof doc and capture baseline test results.

5. **CHECKPOINT**:
   > "Current behavior characterized. All tests passing (N/N). Review [Refactor Goals](#refactor-goals) and [Scope](#scope). Say **'refactor'** to proceed."

---

## Phase 2: Refactor & Verify (Dark Factory)

**Goal**: Refactor code, ensure ALL existing tests still pass. Runs autonomously.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Refactor & Verify
   **Waiting For**: In progress (dark factory)
   ```

2. Launch `code-architect` agent to refactor:
   - Follow refactor goals from PLAN.md
   - Do NOT change any behavior
   - Do NOT add/remove tests
   - Preserve all public interfaces

3. Launch `test-runner` agent after refactoring:
   - Run the FULL test suite
   - Every single test must pass
   - Any failure means the refactor broke something

4. If tests fail:
   - Launch `code-architect` to fix (revert the breaking change, not "fix" the test)
   - Re-run `test-runner`
   - **Escalation**: After 5 cycles, escalate to user

5. test-runner captures after-refactor results to DEMO.md via showboat integration.

6. Launch `scope-guardian` agent:
   - Verify no behavior changes leaked in
   - Verify no new features were added

7. When all tests pass, proceed to Phase 3.

### Context Checkpoint

All state saved to disk. **If context feels heavy, `/clear` then `/pickup` to continue.**

---

## Phase 3: Demo

**Goal**: Present before/after proof to user.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Demo
   **Waiting For**: User review
   ```

2. Launch `demo-builder` agent:
   - Verify DEMO.md (re-run all captures, confirm before/after match)
   - Add summary showing behavior is unchanged

3. Update PLAN.md:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Refactor Summary
- **Goals achieved**: [list]
- **Tests**: All passing (N/N) — same count as before
- **Behavior changed**: NO (verified by showboat before/after)
- **Files modified**: [count]
- **Proof**: See DEMO.md
```

4. Prompt user:
   > "Refactor complete. All tests still passing. See DEMO.md for before/after proof. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Final status and refactor summary
- DEMO.md: Before/after proof with test results

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
