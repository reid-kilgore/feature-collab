---
description: Small enhancement (<200 lines) with contract-first TDD
argument-hint: Enhancement description
---

# Enhance: Small Enhancement

You are helping a developer implement a small enhancement (<200 lines of production code) through a contract-first TDD process.

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **Small scope enforced**: If the enhancement exceeds ~200 lines, recommend `/feature-collab` instead
- **Contracts before code**: Define types and interfaces first
- **Tests before implementation**: TDD RED-GREEN
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.

Initial request: $ARGUMENTS

---

## Phase 1: Scope & Contract

**Goal**: Define what's being added, write contracts, write failing tests.

**Actions**:

1. Create PLAN.md at git root:

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Enhancement: [Title]

## Status
**Current Phase**: Scope & Contract
**Waiting For**: User review

## Description
[What's being added and why]

## Scope

### In Scope
- [ ] [Specific deliverable 1]
- [ ] [Specific deliverable 2]

### Explicitly Out of Scope
- [Things deliberately excluded]

## Contracts
[Types, interfaces, function signatures — see CONTRACTS.md]

## Exit Criteria
- [ ] All new tests passing
- [ ] All existing tests still passing
- [ ] Enhancement works as specified
- [ ] Code follows existing patterns
- [ ] < 200 lines of production code added
```

2. Launch `code-explorer` agent to understand the area being enhanced.

3. Create CONTRACTS.md with types, routes, and function signatures.

4. Launch `code-verifier` agent to generate TEST_SPEC.md from contracts.

5. Launch `test-gap-finder` agent to review TEST_SPEC.md adversarially.

6. Launch `test-implementer` agent to write failing tests.

7. Launch `test-runner` agent to confirm RED state (tests should fail).

8. Launch `demo-builder` agent to initialize proof doc and capture failing state.

9. **CHECKPOINT**:
   > "Contracts defined, tests written and failing (TDD RED). Review [Contracts](#contracts) and [Scope](#scope). Say **'implement'** to begin implementation."

---

## Phase 2: Implement (Dark Factory)

**Goal**: Make all tests pass. Runs autonomously after user approval.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Implement
   **Waiting For**: In progress (dark factory)
   ```

2. Launch `code-architect` agent to implement:
   - Follow CONTRACTS.md and DETAILS.md
   - Make failing tests pass
   - Stay within scope

3. Launch `test-runner` agent after implementation:
   - Verify new tests pass
   - Verify existing tests still pass

4. Launch `scope-guardian` agent:
   - Verify implementation stays within scope
   - Flag if approaching 200-line limit

5. test-runner captures results to DEMO.md via showboat integration.

6. **Escalation**: If 5 fix cycles fail, escalate to user.

7. Proceed to Phase 3 when all tests pass.

### Context Checkpoint

All state saved to disk. **If context feels heavy, `/clear` then `/pickup` to continue.**

---

## Phase 3: Verify (Dark Factory)

**Goal**: Final verification pass. Runs autonomously.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Verify
   **Waiting For**: In progress (dark factory)
   ```

2. Launch `test-runner` agent for full test suite run.

3. Launch `criteria-assessor` agent to check exit criteria.

4. If criteria-assessor returns NOT READY, fix and re-assess (up to 3 cycles).

5. Proceed to Phase 4 when READY.

---

## Phase 4: Demo

**Goal**: Present proof of enhancement to user.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Demo
   **Waiting For**: User review
   ```

2. Launch `demo-builder` agent:
   - Verify DEMO.md (re-run all captures)
   - Add final captures

3. If web enhancement, launch `browser-verifier` agent.

4. Update PLAN.md:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Summary
- **What was added**: [description]
- **Tests**: All passing (N/N)
- **Lines added**: [count] (within 200-line limit)
- **Proof**: See DEMO.md
```

5. Prompt user:
   > "Enhancement complete and verified. See DEMO.md for proof. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Final status
- CONTRACTS.md: Type definitions
- DEMO.md: Proof of work

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
