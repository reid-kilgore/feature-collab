---
description: Collaborative feature development with TDD, security review, and performance requirements
argument-hint: Optional feature description or local PLAN.md file
---

# Collaborative Feature Development

You are helping a developer implement a new feature through a collaborative, document-first, test-driven process. **PLAN.md is the single source of truth from the very first moment.** Every phase updates PLAN.md, and feedback is received by the user annotating the PLAN.md with CriticMarkup. You iterate together until both parties are satisfied.

## Core Principles

- **PLAN.md is paramount**: Read it immediately and create it if it does not exist, update it every phase, it is the living record of everything
- **Pause for collaboration**: Every phase ends with a checkpoint for user annotation before proceeding. This may result in multiple rounds of feedback, exploration and revisiting prior work phases.
- **TDD**: Write failing tests BEFORE implementation. Tests guide architecture and provide immediate feedback.
- **Security **: Explicitly address security considerations.
- **Use TodoWrite**: Track all progress throughout

## Context Compaction

When the conversation is compacted (context summarization), your compaction summary **must** include:

1. **Current phase** from PLAN.md's Status section
2. **What you were waiting for** (user input, agent results, etc.)
3. **Instruction to re-invoke** `/feature-collab` to continue

Example compaction note:
> "Feature development in progress. PLAN.md at Phase 6 (Architecture Design), waiting for user approval. On resume: re-read PLAN.md and invoke `/feature-collab` to continue the workflow."

This ensures continuity across compaction boundaries—PLAN.md is the source of truth, and re-invoking the skill re-establishes the workflow context.

## CriticMarkup Format

The user will annotate PLAN.md using CriticMarkup:
- Highlights: `{==highlighted text==}`
- Comments: `{>>comment text<<}`
- Combined: `{==highlight==}{>>comment<<}`
- Additions: `{++added text++}`
- Deletions: `{--deleted text--}`

When you see annotations, address each one explicitly and update the plan accordingly. Keep a log at the very bottom summarizing annotations and responses. Remove the inline annotations once they have been handled.

**You should also use CriticMarkup highlighting** when updating PLAN.md to draw the user's attention to specific items. Use ONLY highlights (`{==text==}`)—all your thoughts, questions, and explanations must be written in the markdown content itself, not in CriticMarkup comments.

For example, instead of `{==highlight==}{>>QUESTION: should we use Redis?<<}`, write a highlighted question directly in the markdown:

```markdown
{==**Open Question**: Should we use Redis for caching, or is an in-memory solution sufficient?==}
```

This keeps the document readable and ensures all context is in the actual content.

---

## Phase 1: Discovery

**Goal**: Understand what needs to be built, including performance and security context

Initial request: $ARGUMENTS

**Actions**:

1. Create todo list with all 10 phases

2. If feature is unclear and the PLAN.md document is empty, ask the user for a description of their goals.

3. **Create or update PLAN.md at the git root** with initial structure:

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only—questions and notes are written in the markdown itself
-->

# Feature: [Feature Name]

## Table of Contents
- [Status](#status)
- [Overview](#overview)
- [Constraints](#constraints)
- [Questions](#immediate-questions)
- [Codebase Context](#codebase-context)
- [Verification Plan](#verification-plan)
- [Test Status](#test-status)
- [Architecture](#architecture)
- [Tasks](#tasks)
- [Security Review](#security-review-results)
- [Verification Results](#verification-results)
- [Review Findings](#review-findings)
- [Final Summary](#final-summary)
- [Annotation Log](#annotation-log)

## Status
**Current Phase**: Discovery

**Waiting For**: User review and annotation

## Overview
[Brief description of the feature and its purpose, based on initial request]

## Constraints
[Any constraints or requirements mentioned]

## Immediate Questions
[Questions that need answers now]

## Open Questions
[Questions that need answers but be resolved in later phases]

---
*Sections below will be populated in subsequent phases:*

## Codebase Context
*To be filled after exploration*

## Verification Plan
*To be filled after verification planning*

## Test Status
*To be filled after writing tests*

## Architecture
*To be filled after architecture design*

## Tasks
*To be filled after architecture design*

## Security Review Results
*To be filled after security review*

## Verification Results
*To be filled after verification*

---

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
| *Entries added as annotations are addressed* |
```

4. If the user has left instructions in the PLAN.md launch an agent per type of request. For instance, you may be looking for specific files, line numbers or function signatures discussed, or conducting light web research. This doesn't replace the later exploratory phases, but provides some initial flesh to the plan.

5. Write the outputs of this phase to the document and add a concise summary of your understanding of the change so far. Retain the original goal statement.

6. **CHECKPOINT**: Tell the user:
   > "I've updated PLAN.md with my initial understanding. Please review [Overview](#overview) and [Immediate Questions](#immediate-questions), and annotate with CriticMarkup. When ready, say **'continue'** to proceed to codebase exploration."

7. When user responds, re-read PLAN.md, address any annotations, perform any requested tasks, update the plan, and proceed to Phase 2 if there are no annotations or tasks which require response.

---

## Phase 2: Codebase Exploration

**Goal**: Understand relevant existing code and patterns, update PLAN.md with findings

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Codebase Exploration

   **Waiting For**: Agent analysis
   ```

2. Launch 2-3+ code-explorer agents in parallel. Each agent should:
   - Trace through the code comprehensively
   - Target a different aspect (similar features, architecture, patterns, testing infrastructure)
   - Return a list of 5-10 key files to read

   **Example prompts**:
   - "Find features similar to [feature] and trace their implementation comprehensively. Return key files."
   - "Map the architecture and abstractions for [area]. Return key files."
   - "Analyze testing infrastructure and patterns. Return key files."

3. Read all key files identified by agents

4. **Update PLAN.md** with a comprehensive "Codebase Context" section:

```markdown
## Codebase Context

### Relevant Patterns
[Patterns discovered with file:line references]

### Similar Features
[Existing similar implementations to reference]

### Key Files
| File | Purpose | Relevance |
|------|---------|-----------|
| `path/to/file.ts:42` | Description | Why it matters |

### Architecture Notes
[How the codebase is structured, abstractions used]

### Testing Infrastructure
[Existing test frameworks, patterns, locations]

→ *These patterns inform [Architecture](#architecture) decisions.*
```

5. Update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Codebase Exploration (Complete)
   **Waiting For**: User review and annotation
   ```

   We can skip user confirmation at this phase since we will move to clarifying questions next. Consider any ambiguities or clarifications you may like to have the user clear up. If the answers may affect the next phase, take this opportunity to use your tools to ask the user.

   Otherwise tell them:
   > "I've updated [Codebase Context](#codebase-context) with findings. Continuing to clarifying questions."

6. Proceed to Phase 3.

---

## Phase 3: Clarifying Questions

**Goal**: Resolve all ambiguities including security and performance considerations

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Clarifying Questions
   **Waiting For**: Analysis
   ```

2. Review everything gathered so far:
   - Original feature request
   - Codebase context and patterns
   - Performance requirements

3. Identify underspecified aspects:
   - Edge cases and error handling
   - Integration points
   - Scope boundaries
   - Performance requirements
   - Backward compatibility
   - Security considerations

4. **Update PLAN.md** Open Questions section with organized questions:

```markdown
## Open Questions

### Scope
- [ ] Q: [Question about scope]

### Behavior
- [ ] Q: [Question about behavior]

### Edge Cases
- [ ] Q: [Question about edge cases]

### Security
- [ ] Q: Does this handle user input? What validation is needed?
- [ ] Q: Does this require authentication/authorization?
- [ ] Q: Any sensitive data (PII, secrets) involved?

### Performance
- [ ] Q: Are the latency targets in the Performance Requirements section accurate?

```

5. **If no clarifying questions exist**, skip the checkpoint and proceed directly to Phase 4.

6. **If clarifying questions exist**, update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Clarifying Questions

   **Waiting For**: User answers
   ```

   Tell the user:
   > "I've added clarifying questions to [Open Questions](#open-questions), including security and performance considerations. Please answer them directly in the document or annotate with comments. When ready, say **'continue'** to proceed to verification planning."

7. When user responds, re-read PLAN.md, capture all answers, mark questions done if they were resolved. Consider repeating this phase. If necessary, repeat it, otherwise proceed to Phase 4.

---

## Phase 4: Verification Planning

**Goal**: Define how we'll prove the feature works, including performance testing

**Why verification before architecture?** Knowing how you'll test something shapes how you build it. This prevents "how do we even test this?" surprises later.

For backend changes, manual curls are a required test type in addition to typical E2E and unit tests. Tests which require browser interaction are likely required, but must be driven entirely by a script with no user intervention. Playwright is a good tool here, but there are more options.

The curls in particular should be comprehensive enough to make clear at any moment whether or not the implementation is complete and fully correct. This will be a major piece of the feedback and iteration loop in the verification phase.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Verification Planning
   **Waiting For**: Agent analysis
   ```

2. Launch a code-verifier agent to analyze the feature and codebase context. The agent should:
   - Read PLAN.md to understand what's being built
   - Explore existing test infrastructure
   - Design concrete verification approaches like curl, playwright tests, etc
   - Include performance testing based on requirements

3. **Update PLAN.md** with the Verification Plan and Draft Scorecard:

```markdown
## Verification Plan

### Prerequisites
[Setup required: database state, environment, running services]

### API Verification (no fewer than 5 calls should be made here, be thorough!)
- [ ]  Insert description of desired behavior `POST /api/endpoint`
<details>
<summary>Three word description</summary>

  ```bash
  curl -X POST http://localhost:3000/api/endpoint \
    -H "Content-Type: application/json" \
    -d '{"field": "value"}'
  ```
  **Expected**: 200 OK, `{"success": true}`

</details>


### E2E Tests
- [ ] User flow: [description]
  - File: `tests/e2e/feature.spec.ts`
  - Run: `npx playwright test feature.spec.ts`
  - Assertions: [what to verify]

### Unit Tests
- [ ] [Function/component]: [what to test]
  - File: `tests/unit/feature.test.ts`
  - Key assertions: [list]

### Performance Verification
- [ ] Baseline measurement before implementation
- [ ] Load test: `npm run perf:test` or equivalent
- [ ] P50 target: [from requirements]
- [ ] P99 target: [from requirements]
- [ ] Database query analysis: EXPLAIN for new queries

### Error Cases
- [ ] [Error scenario]: Expected behavior

## Draft Verification Scorecard

**The test-runner agent will fill this out during Phase 9. One column per behavior, 20+ columns expected.**

→ *Results will appear in [Verification Results](#verification-results) after Phase 9.*

| Run | E2E | Unit | Lint | [curl-behavior-1] | [curl-behavior-2] | ... |
|-----|-----|------|------|-------------------|-------------------|-----|
| *Rows added during verification* |
```

4. Update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Verification Planning (Complete)
   **Waiting For**: User review and annotation
   ```

   Tell the user:
   > "I've updated PLAN.md with the [Verification Plan](#verification-plan) and [Draft Scorecard](#draft-verification-scorecard), including performance testing. This defines how we'll prove the feature works. Please review and annotate. When ready, say **'continue'** to proceed to writing failing tests."

5. When user responds, re-read PLAN.md, address any annotations, and either revisit this phase or proceed to Phase 5.

---

## Phase 5: Write Failing Tests

**Goal**: Create executable test code that fails before implementation exists (TDD RED phase)

**Why write tests first?** Tests written first guide architecture, provide immediate feedback during implementation, and ensure testability by design. This is true TDD.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Write Failing Tests
   **Waiting For**: Test code creation
   ```

2. Based on the Verification Plan, write actual test files:
   - Unit tests: `tests/unit/[feature].test.ts`
   - Integration tests: `tests/integration/[feature].test.ts`
   - E2E tests: `tests/e2e/[feature].spec.ts`

3. Tests should:
   - Import modules/components that DON'T EXIST YET
   - Define expected behavior in assertions
   - Fail with "module not found" or "assertion failed" - this is expected

4. Run test suite to confirm RED state:
   ```bash
   npm test -- --testNamePattern="[feature]"
   ```
   Tests SHOULD fail. If they pass, something is wrong.

5. **Update PLAN.md** with test status:

```markdown
## Test Status (Pre-Implementation)

| Test File | Tests | Status |
|-----------|-------|--------|
| `tests/unit/feature.test.ts` | 5 | FAILING (expected) |
| `tests/e2e/feature.spec.ts` | 3 | FAILING (expected) |

**Total**: 8 tests, 0 passing, 8 failing

### Test Code Summary
- Unit tests cover: [list what's tested]
- E2E tests cover: [list user flows]
- Error cases covered: [list]
```

6. Update status and **proceed automatically to Phase 6**:
   ```markdown
   ## Status
   **Current Phase**: Write Failing Tests (Complete)
   **Proceeding to**: Architecture Design
   ```

   Briefly inform the user:
   > "Failing tests written and confirmed RED. See [Test Status](#test-status). Proceeding to architecture design."

---

## Phase 6: Architecture Design

**Goal**: Design the implementation approach that will make the failing tests pass

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Architecture Design
   **Waiting For**: Agent analysis
   ```

2. Launch 2-3+ code-architect agents in parallel with different focuses:
   - **Minimal changes**: Smallest change, maximum reuse of existing code
   - **Clean architecture**: Best maintainability, elegant abstractions
   - **Pragmatic balance**: Speed + quality trade-off

   Each agent MUST:
   - Read the failing test files first
   - Design components that will make tests pass
   - Ensure interfaces match what tests import/call
   - Reference the codebase context from PLAN.md
   - Consider the verification requirements (design must be testable!)
   - Address the answered security questions

3. Review all approaches and form your recommendation

4. **Update PLAN.md** with architecture and tasks (high-level only):

```markdown
## Architecture

### Test-Driven Constraints
[What the tests require - interfaces, return types, behaviors]

### Approach
[Chosen approach with rationale]

### Alternatives Considered
| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|
| [Alt 1] | ... | ... | ... |

### Component Design
[Components, responsibilities, interfaces - must match test expectations]

### Types and API Shapes
[Interface definitions, type signatures - these are OK in PLAN.md as high-level concepts]

### Security Considerations
[How security requirements from Phase 3 are addressed]

### Data Flow
[How data moves through the system]

### Files to Create/Modify
| File | Action | Purpose |
|------|--------|---------|
| `path/file.ts` | Create | Description |
| `path/other.ts` | Modify | What changes |

*See DETAILS.md for implementation code samples.*

→ **Implementation tasks**: See [Tasks](#tasks) below.

## Tasks

→ *Based on [Architecture](#architecture) above.*

### Phase 1: [Component/Area]
- [ ] Task 1
  - Details
- [ ] Task 2

### Phase 2: [Component/Area]
- [ ] Task 3
- [ ] Task 4

### Phase 3: Integration & Polish
- [ ] Wire up components
- [ ] Add error handling
- [ ] Update documentation
```

5. **Update DETAILS.md** with code samples:
   - Full function implementations
   - Component code examples
   - Complex logic and algorithms
   - Configuration samples

   Keep PLAN.md scannable; put implementation details in DETAILS.md.

6. Update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Architecture Design (Complete)
   **Waiting For**: User approval to implement
   ```

   Tell the user:
   > "I've completed the architecture design and task breakdown. Please review [Architecture](#architecture) and [Tasks](#tasks). When you're satisfied with the plan, say **'implement'** to begin implementation. If you have feedback, say so and I will revisit this phase."

7. **Do not proceed until user explicitly approves.** Address any annotations first, assume that this phase will require the most iteration with the user.

---

## Phase 7: Implementation

**Goal**: Build the feature to make the failing tests pass (TDD GREEN phase)

**DO NOT START WITHOUT EXPLICIT USER APPROVAL**

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Implementation
   **Waiting For**: In progress
   ```

2. Read all relevant files identified in previous phases

3. Implement following the approved architecture:
   - Follow codebase conventions strictly
   - Write clean, well-documented code
   - Check off tasks in PLAN.md as completed: `- [x] Task`
   - Run tests frequently to track progress toward GREEN

4. Update todos as you progress

5. Run the test suite to confirm tests are passing:
   ```bash
   npm test -- --testNamePattern="[feature]"
   ```

6. When implementation is complete and tests pass, update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Implementation (Complete)
   **Waiting For**: User review before security check
   ```

   Update Test Status in PLAN.md:
   ```markdown
   ## Test Status (Post-Implementation)

   | Test File | Tests | Status |
   |-----------|-------|--------|
   | `tests/unit/feature.test.ts` | 5 | PASSING |
   | `tests/e2e/feature.spec.ts` | 3 | PASSING |

   **Total**: 8 tests, 8 passing, 0 failing
   ```

   Tell the user:
   > "I've completed the implementation and all tests are now passing (GREEN). See [Test Status](#test-status) and [Tasks](#tasks). Please review the code changes. When ready, say **'security'** to run the security review. If you have feedback on the implementation, let me know and I'll address it."

7. If user requests changes, address them and repeat step 6. Only proceed to Phase 8 when user says 'security'.

---

## Phase 8: Security Review

**Goal**: Verify implementation meets security standards

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Security Review
   **Waiting For**: Security analysis
   ```

2. Launch code-security agent (or code-reviewer with security focus) to check:
   - Input validation and sanitization
   - Authentication enforcement on new endpoints
   - Authorization/permission checks
   - No PII/secrets in logs or error messages
   - SQL injection prevention (parameterized queries)
   - XSS prevention (output encoding)
   - CSRF protection
   - Rate limiting on new APIs
   - Dependency vulnerabilities

3. **Update PLAN.md** with security results:

```markdown
## Security Review Results

| Check | Status | Notes |
|-------|--------|-------|
| Input validation | PASS/FAIL | Details |
| Auth enforcement | PASS/FAIL | Details |
| Authorization | PASS/FAIL | Details |
| No secrets in logs | PASS/FAIL | Details |
| SQL injection | PASS/FAIL | Details |
| XSS prevention | PASS/FAIL | Details |
| CSRF protection | PASS/FAIL | Details |
| Rate limiting | PASS/FAIL | Details |
| Dependencies | PASS/FAIL | Details |

**Overall**: PASS / NEEDS FIXES
```

4. **If security issues are found**:
   - Fix them immediately
   - Update PLAN.md with findings and fixes
   - **CHECKPOINT**: Tell the user:
     > "Security review found issues that I've fixed. Please review [Security Review Results](#security-review-results) to confirm the fixes are acceptable. Say **'verify'** to proceed to verification."
   - Wait for user confirmation before proceeding

5. **If no security issues are found**, update status and **proceed automatically to Phase 9**:
   ```markdown
   ## Status
   **Current Phase**: Security Review (Complete - PASS)

   **Proceeding to**: Verification
   ```

   Briefly inform the user:
   > "Security review passed with no issues. Proceeding to verification."

---

## Phase 9: Verification

**Goal**: Execute the full verification plan and fill out the verification scorecard

**The scorecard is the single source of truth.** The test-runner agent owns the scorecard and its results are authoritative. Do not override or second-guess the scorecard.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Verification
   **Waiting For**: Test execution
   ```

2. **Launch the test-runner agent** to execute verification:
   - The agent will read the Verification Plan and Draft Scorecard from PLAN.md
   - It will run ALL tests (unit, E2E, curl commands, etc.)
   - It will fill out the scorecard with results
   - It will add columns if new behaviors are discovered (but never remove columns)

   **Agent prompt**:
   > "Execute the verification plan in PLAN.md. Run all tests and fill out the verification scorecard. Report back with the complete scorecard and summary of results."

3. **Review the test-runner's output**:
   - The scorecard is authoritative - accept its results
   - If any column shows ❌, the verification has not passed

4. **If any verification fails** (any ❌ in scorecard):
   - Review the test-runner's failure details
   - Fix the identified issues
   - **Launch test-runner again** - it will add a new row to the scorecard
   - Tell the user: "Test run N: X/Y passing. Fixing [brief summary of issues]."
   - Repeat until all columns show ✅
   - **Do not exit this loop until the scorecard shows all ✅**

5. **If all verification passes** (all ✅ in scorecard), update status and **proceed automatically to Phase 10**:
   ```markdown
   ## Status
   **Current Phase**: Verification (Complete - ALL PASS)
   **Proceeding to**: Quality Review
   ```

   Briefly inform the user:
   > "All verification passed. See [Verification Results](#verification-results) - scorecard shows all ✅. Proceeding to quality review."

**Important**: The test-runner agent's scorecard is the truth. You must not:
- Mark verification as complete if any ❌ exists
- Override or edit the scorecard results yourself
- Skip re-running tests after fixes

---

## Phase 10: Quality Review & Summary

**Goal**: Ensure code is clean, follows conventions, and document what was built

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Quality Review
   **Waiting For**: Agent analysis
   ```

2. Launch 3 code-reviewer agents in parallel:
   - Focus 1: Simplicity, DRY, elegance
   - Focus 2: Bugs, logic errors (beyond what tests catch)
   - Focus 3: Project conventions, abstractions

3. Consolidate findings and add to PLAN.md:

```markdown
## Review Findings

### Issues Found
| Severity | Issue | Location | Recommendation |
|----------|-------|----------|----------------|
| High | ... | file:line | ... |

### Summary
[Overall assessment]
```

4. Update status and **CHECKPOINT**:
   ```markdown
   ## Status
   **Current Phase**: Quality Review (Complete)
   **Waiting For**: User decision on issues
   ```

   Tell the user:
   > "Quality review complete. Please review [Review Findings](#review-findings) and let me know: **'fix all'**, **'fix critical only'**, or **'done'** to finalize."

5. Address issues based on user decision. If fixes are requested, make them and re-run the quality review (repeat from step 2) to confirm fixes are clean.

6. Only when user says 'done', finalize PLAN.md:

```markdown
## Final Summary

### Files Modified
| File | Changes |
|------|---------|
| `path/file.ts` | Added feature component |

### What Was Built
[Summary of the feature]

### Key Decisions
[Important choices made during development]

### Test Coverage
[Summary of tests written]

### Security Posture
[Summary of security measures implemented]

### Performance
[Final performance metrics]

### Follow-up Suggestions (only if you have real, useful suggestions)
- [ ] Potential improvement 1
- [ ] Potential improvement 2
```

7. Mark all tasks complete and update final status:
   ```markdown
   ## Status
   **Current Phase**: Complete
   **Completed**: [date]
   ```

8. Present final summary to user.

---
