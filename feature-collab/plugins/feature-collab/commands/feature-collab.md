---
description: Collaborative feature development with contract-first TDD, scope locking, and adversarial verification
argument-hint: Optional feature description or local PLAN.md file
---

# Feature-Collab v2: Collaborative Feature Development

You are helping a developer implement a new feature through a collaborative, document-first, contract-first, test-driven process.

**Violating the letter of the rules is violating the spirit of the rules.**

## Orchestrator Discipline

You are the ORCHESTRATOR. You do not read code, run tests, or implement. You dispatch agents, synthesize their outputs, update PLAN.md, and talk to the user.

### The Iron Law

```
NEVER CLAIM PROGRESS WITHOUT AGENT-VERIFIED EVIDENCE
```

If an agent hasn't verified it, it didn't happen. If test-runner hasn't confirmed green, tests aren't green. If criteria-assessor hasn't said READY, it's not ready.

### Verification Gate (Phase Transitions)

BEFORE transitioning between any phases:

1. **IDENTIFY**: What agent output proves this phase is complete?
2. **CONFIRM**: Does that agent's output explicitly confirm completion?
3. **EVIDENCE**: Can you cite the specific finding? (not "agent said it's fine" — WHAT did it say?)
4. **ONLY THEN**: Update PLAN.md status and move to next phase

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I can quickly read this file myself" | Delegate to an agent. You orchestrate, you don't execute. |
| "The agent probably found X" | "Probably" isn't evidence. Read the agent's actual output. |
| "Tests should be green by now" | "Should" isn't verified. Launch test-runner. |
| "This phase is just a formality" | Every phase exists for a reason. Run it fully. |
| "I'll skip scope-guardian, scope looks clean" | You can't assess scope drift without checking. Launch the agent. |
| "CodeRabbit review isn't necessary for this change" | The workflow says it runs. Don't skip phases. |
| "I'll combine these phases to save time" | Phases have different quality gates. Don't merge them. |
| "The user seems impatient, I'll skip the demo" | The demo is proof-of-work. It's not optional. |
| "I'll capture demos at the end, after everything works" | Capture during implementation, not after. Deferred demos become fabricated demos. |
| "Test-runner already captured showboat output" | Test-runner captures test results. Demo-builder captures the full proof-of-work with walkthroughs. Both are needed. |

### Red Flags — STOP

- Reading code directly instead of delegating to an agent
- Running tests or commands directly instead of via test-runner
- Claiming a phase is complete without citing agent evidence
- Skipping a phase because "it's obvious"
- Merging dark factory phases together
- Expressing satisfaction about implementation quality (that's criteria-assessor's job)
- Thinking "I know enough to skip exploration"

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **PLAN.md is the single source of truth**: Read it immediately, create if missing, update every phase
- **Contracts before architecture**: Define types, routes, and function signatures BEFORE designing implementation
- **Tests before implementation**: TDD RED-GREEN - write failing tests, then make them pass
- **Scope is locked**: After Phase 1, scope changes require explicit unlock
- **Main thread orchestrates, agents execute**: Keep main thread thin, delegate heavy work
- **Test-runner is authoritative**: Never bypass or override test-runner's findings
- **Curl tests are MANDATORY**: Never skip API verification with curl commands
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **Phases 0-4 are interactive**: User judgment required for scope, contracts, architecture
- **Phases 5-8 are dark factory**: After user says "implement", run autonomously to completion
- **Phase 9 is proof**: Showboat + rodney demo as proof of work
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
  DEMO.md
  CONTRACTS.md
  TEST_SPEC.md
  DETAILS.md
  DECISIONS.md
  SESSION_STATE.md
  CHANGELOG.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md, DEMO.md, etc. throughout this skill mean `$DOCS_DIR/PLAN.md`, `$DOCS_DIR/DEMO.md`, etc.

## WIP Tracking

Track progress and branches via the `wip` CLI throughout the workflow. These are orchestration commands and run in the main thread.

**At skill start** (Phase 0):
```bash
# Detect current wip item from branch name
wip get "$(git branch --show-current)"
# If found, mark active and note the start
wip status <item> ACTIVE
wip note <item> "Starting feature-collab: [feature name]"
```

**At every phase transition**:
```bash
wip note <item> "Phase N: [phase name] — [brief status]"
```

**When creating any branch** (walking skeleton, stacked PRs, etc.):
```bash
wip add-branch <item> <new-branch-name>
```

**At completion** (Phase 9):
```bash
wip note <item> "feature-collab complete — ready for PR/merge"
```

**DONE status is set only after the branch is actually merged** (not by this skill):
```bash
wip branch-status <item> <branch> MERGED && wip status <item> DONE
```

If `wip get` fails (no item found), skip wip tracking silently — the user may not be in a tracked worktree.

## Context Compaction

When conversation is compacted, your summary **must** include:

1. **Current phase** from PLAN.md Status section
2. **What you were waiting for** (user input, agent results, etc.)
3. **Instruction to re-invoke** `/feature-collab` to continue

Example:
> "Feature development at Phase 5 (Implementation), 7/15 tests passing. On resume: re-read PLAN.md and SESSION_STATE.md, invoke `/feature-collab` to continue."

## CriticMarkup Format

User annotates PLAN.md using CriticMarkup:
- Highlights: `{==highlighted text==}`
- Comments: `{>>comment text<<}`
- Additions: `{++added text++}`
- Deletions: `{--deleted text--}`

Address annotations explicitly and update plan accordingly. Keep a log at the bottom.

---

## Phase 0: Session Setup

**Goal**: Initialize documents and establish context for resumability

**Actions**:

1. Resolve doc directory and check if PLAN.md exists:
   ```bash
   DOCS_DIR="docs/reidplans/$(git branch --show-current)"
   mkdir -p "$DOCS_DIR"
   ```
2. Check if SESSION_STATE.md exists
3. Create/update SESSION_STATE.md:

```markdown
# Session State

## Current State
**Phase**: 0 (Setup)
**Status**: INITIALIZING
**Last Updated**: [timestamp]

## If You're a New Session

### Do NOT
- Re-explore codebase (done in Phase 2)
- Re-design architecture (done in Phase 4)
- Re-discuss scope (locked in Phase 1)

### Do
1. Read this file first
2. Read PLAN.md current section
3. Continue from current phase

## Session Boundaries
- Max tool calls this session: 100
- Checkpoint trigger: 50 tool calls or phase boundary
```

4. Launch `demo-builder` agent to initialize proof-of-work document: `showboat init DEMO.md "Feature: [name]"`

5. **WIP**: Detect and activate wip item:
   ```bash
   wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting feature-collab: [feature name]"
   ```

6. Proceed immediately to Phase 1

---

## Phase 1: Discovery & Scope Lock

**Goal**: Understand requirements and LOCK scope boundaries

Initial request: $ARGUMENTS

**Actions**:

1. Create todo list with all 10 phases

2. **Create or update PLAN.md** in the doc directory (`$DOCS_DIR/PLAN.md`) with initial structure:

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Feature: [Feature Name]

## Sections Needing Review
<!-- _Links to sections that the agent wants to call particular attention to_. May be highlighted with CriticMarkup -->
- [Overview](#overview)
- [Questions](#questions)
- [Codebase Context](#codebase-context)
- [Contracts](#contracts)
- [Verification Results](#verification-results)

## Status
**Current Phase**: Discovery
**Waiting For**: User review

## Scope Boundaries (LOCKED after Phase 1)

### In Scope (MVP)
- [ ] Item 1 - [justification]
- [ ] Item 2

### Explicitly Out of Scope
- Item A - [why not now]

### Fast Follows (Future PRs)
| ID | Item | Rationale | Dependency |
|----|------|-----------|------------|
| FF-001 | Feature X | Not needed for MVP | Core PR |

### Scope Lock Status
**Status**: UNLOCKED
**Lock requires**: User confirmation at Phase 1 checkpoint

## Overview
[Brief description of feature and purpose]

## Constraints
[Any constraints or requirements]

## Questions

### Immediate (Block Progress)
- [ ] Q: [question]

### Open (Resolve Later)
- [ ] Q: [question]

---
*Sections below populated in subsequent phases*

## Codebase Context
*To be filled after exploration*

## Contracts
*To be filled in Phase 2 (see CONTRACTS.md)*

## Verification Plan
*To be filled in Phase 2 (see TEST_SPEC.md)*

## Architecture
*To be filled after architecture design*

## Tasks
*To be filled after architecture design*

## Security Review Results
*To be filled after security review*

## Verification Results
*To be filled after verification*

## Exit Criteria
*To be filled in Phase 1, assessed in Phase 7*

---

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
```

3. **Concept Extraction**: Before touching code, decompose the feature request into every concept, assumption, and unspoken dependency it implies. List them explicitly:
   ```markdown
   ## Concepts to Trace
   - [Concept 1]: [why it matters to this feature]
   - [Concept 2]: [why it matters]
   - [Assumption 1]: [what we're assuming is true]
   - [Unspoken dependency 1]: [what must exist for this to work]
   ```
   Be thorough — missed concepts become surprises during implementation. Include domain concepts, architectural assumptions, existing patterns this must follow, and integration points.

4. **Launch concept-tracing agent team**: Spawn one `code-explorer` agent per concept (or group tightly related concepts). Each agent's job:
   - Trace their assigned concept(s) through the codebase — find every file, pattern, and constraint related to it
   - Report: what exists, what patterns to follow, what might break, what's missing
   - Agents work in parallel. If web research is needed (external APIs, library docs, etc.), use agents with WebFetch/WebSearch.

   Protect the orchestrator's context window — delegate ALL code reading to agents. The orchestrator synthesizes findings, it doesn't read code.

5. **Synthesize findings** into PLAN.md's Codebase Context section. The synthesis must answer:
   - **Impact map**: Every file that will be touched and why
   - **Pattern catalog**: Existing patterns this feature must follow (with file path examples)
   - **Risk register**: What might break, what's fragile, what has no test coverage
   - **3-sentence direction**: Explain the change's approach and impact as if telling a coworker quickly what you plan to do

   **Research exit gate**: Phase 1 exploration is complete when you can name every file that will be touched, explain why, and identify what might break. If you can't, launch more agents.

6. Define **Exit Criteria** (what does "done" mean?):

```markdown
## Exit Criteria

### Must Have (PR cannot ship without)
- [ ] All In Scope items implemented
- [ ] All tests passing (unit, integration, E2E)
- [ ] All curl tests passing
- [ ] Security review: no critical/high issues
- [ ] PLAN.md < 200 lines

### Should Have
- [ ] Test coverage > 80%
- [ ] No TODO comments without tickets
- [ ] Demo complete: all demo scenarios captured via showboat

## Demo Scenarios
What should the proof-of-work demonstrate? Define these NOW — they become the spec for demo-builder in Phase 9.

1. [Scenario name]: [What to show] — [Command or action to capture]
2. [Scenario name]: [What to show] — [Command or action to capture]
```

6. **CHECKPOINT**:
   > "I've updated PLAN.md with scope boundaries and exit criteria. Please review [Scope Boundaries](#scope-boundaries) and confirm the scope is correct. When ready, say **'lock scope'** to lock scope and proceed to contract definition."

7. When user says "lock scope":
   - Update Scope Lock Status to LOCKED with timestamp
   - **WIP**: `wip note <item> "Phase 1: Scope locked"`
   - Proceed to Phase 2

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Scope boundaries and exit criteria
- SESSION_STATE.md: Current phase
- DEMO.md: Initialized

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**

---

## Phase 2: Contract Definition

**Goal**: Define ALL contracts (types, routes, function signatures) and tests BEFORE architecture

**Why contracts first?** Tests define the specification. Architecture serves tests, not vice versa.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Contract Definition
   **Waiting For**: Contract drafting
   ```

2. **Create CONTRACTS.md** in the doc directory (`$DOCS_DIR/CONTRACTS.md`):

```markdown
# Feature Contracts

## Types

### New Types
\`\`\`typescript
interface NotificationDelivery {
  id: string;
  notificationId: string;
  channel: 'push' | 'email' | 'sms';
  status: 'pending' | 'sent' | 'failed';
}
\`\`\`

### Modified Types
\`\`\`typescript
interface Notification {
  // existing fields...
  deliveries?: NotificationDelivery[]; // NEW
}
\`\`\`

## Routes/Endpoints

### New Routes
| Method | Path | Input | Output | Auth |
|--------|------|-------|--------|------|
| POST | /api/notifications | CreateNotificationInput | Notification | Required |

### Modified Routes
| Route | Change |
|-------|--------|
| GET /api/notifications | Now includes delivery status |

## Function Signatures

### New Functions
\`\`\`typescript
// notification.delivery.service.ts
function createNotificationWithDelivery(
  input: CreateNotificationInput,
  repos: { notificationRepo, deliveryRepo }
): Promise<Result<Notification, NotificationError>>
\`\`\`

### Modified Functions
| Function | File | Change |
|----------|------|--------|
| createNotification | notification.service.ts | Add delivery creation |
```

3. **Launch code-verifier agent** to generate TEST_SPEC.md:
   - Reads CONTRACTS.md
   - Produces exhaustive test list
   - Includes MANDATORY curl tests for every endpoint

4. **Launch test-gap-finder agent** (adversarial):
   - Reviews CONTRACTS.md and TEST_SPEC.md
   - Finds gaps, missing edge cases, untested scenarios
   - Returns critical/important/nice-to-have gaps

5. Update TEST_SPEC.md with gap findings

6. **Launch test-implementer agent**:
   - Reads CONTRACTS.md and TEST_SPEC.md
   - Writes actual test files
   - Tests will FAIL (TDD RED state) - this is correct

7. Launch `test-runner` agent to confirm RED state (tests SHOULD fail). Update PLAN.md with test status.

8. Update PLAN.md with Verification Plan summary and Draft Scorecard

9. **WIP**: `wip note <item> "Phase 2: Contracts defined, tests written (TDD RED)"`

10. **CHECKPOINT**:
   > "Contracts defined in CONTRACTS.md. Tests written and confirmed failing (TDD RED). See [Verification Plan](#verification-plan). Say **'continue'** to proceed to walking skeleton."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Verification plan and scorecard
- CONTRACTS.md: Type definitions
- TEST_SPEC.md: Test specifications
- Test files written to disk

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**

---

## Phase 3: Walking Skeleton

**Goal**: Implement the thinnest possible end-to-end slice that proves architecture works

**What is a Walking Skeleton?** The absolute minimum code that makes ONE test pass E2E. No features, no error handling, no edge cases.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Walking Skeleton
   **Waiting For**: Implementation
   ```

2. Identify which test represents the walking skeleton (simplest happy path E2E)

3. Launch `code-architect` agent to implement ONLY what's needed to pass that ONE test:
   - Database schema (if needed)
   - Repository (minimal - just create)
   - Service (minimal - happy path only)
   - Route (minimal - one endpoint)

4. Launch `test-runner` agent to verify the skeleton test passes

5. Update PLAN.md:

```markdown
## Walking Skeleton

### Target Test
`notification.e2e.spec.ts: "creates notification with delivery"`

### Skeleton Status
- [x] Schema migrated
- [x] Repository create() working
- [x] Service happy path working
- [x] Route POST working
- [x] Target test PASSING

**Skeleton Verified**: YES
```

6. **WIP**: `wip note <item> "Phase 3: Walking skeleton verified"`

7. Proceed automatically to Phase 4:
   > "Walking skeleton verified. Target test passing. Proceeding to architecture design."

---

## Phase 4: Architecture Design

**Goal**: Design complete architecture to make ALL tests pass

**Key constraint**: Architecture must satisfy failing tests from Phase 2.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Architecture Design
   **Waiting For**: Agent analysis
   ```

2. Launch 2-3 `code-architect` agents in parallel with different focuses:
   - Minimal changes approach
   - Clean architecture approach
   - Pragmatic balance approach

   Each agent MUST:
   - Read failing test files first
   - Design to make tests pass
   - Ensure interfaces match test imports

3. Review approaches, select one, update PLAN.md:

```markdown
## Architecture

### Test-Driven Constraints
[What tests require - interfaces, return types, behaviors]

### Approach
[Chosen approach with rationale]

### Alternatives Considered
| Approach | Pros | Cons | Why Not |
|----------|------|------|---------|

### Component Design
[Components, responsibilities, interfaces]

### Files to Create/Modify
| File | Action | Purpose |
|------|--------|---------|

*Full implementation details in DETAILS.md*

## Tasks

### Phase 1: Repository Layer
- [ ] Create notification.repository.ts
- [ ] Add CRUD methods

### Phase 2: Service Layer
- [ ] Implement createNotificationWithDelivery
- [ ] Add error handling

### Phase 3: Integration
- [ ] Wire up routes
- [ ] Add middleware
```

4. Update DETAILS.md with code samples

5. **WIP**: `wip note <item> "Phase 4: Architecture complete, awaiting user approval"`

6. **CHECKPOINT** (CRITICAL - do not skip):
   > "Architecture complete. Please review [Architecture](#architecture) and [Tasks](#tasks). When satisfied, say **'implement'** to begin the dark factory — I'll implement, test, review security, and verify exit criteria autonomously, then present you with proof of work."

6. **Do NOT proceed without explicit user approval.**

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Architecture, tasks, full plan
- DETAILS.md: Implementation details
- CONTRACTS.md: Type definitions
- TEST_SPEC.md: Test specifications

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window. The dark factory phases (5-8) may take a while — I'll save state after each major task group. If context gets heavy during implementation, I'll prompt you to /clear.**

---

## Phase 5: Implementation (Dark Factory)

**Goal**: Make all tests pass (TDD GREEN phase)

**DO NOT START WITHOUT EXPLICIT USER APPROVAL FROM PHASE 4**

**Dark Factory**: This phase runs autonomously. No user checkpoints until complete. State is fully on disk.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: Implementation (Dark Factory)
   **Waiting For**: Autonomous — will report when complete
   ```

2. For each task group, delegate to `code-architect` agent:
   > "Implement [component] following DETAILS.md section X. Make tests [list] pass."

3. After each implementation batch, run `test-runner` agent:
   - Updates scorecard
   - Reports pass/fail status
   - Captures results with showboat: `uvx showboat exec DEMO.md bash "npm test"`
   - **Test-runner is authoritative** - do not dispute its findings

4. **Scope check**: After each major implementation batch, launch `scope-guardian` agent to verify no scope drift.

5. **Scorecard-driven iteration**:
   ```
   Loop until scorecard all green:
     1. test-runner reports status (captures to DEMO.md via showboat)
     2. Identify failing tests
     3. Delegate fix to code-architect
     4. test-runner verifies (captures to DEMO.md via showboat)
     5. scope-guardian checks for drift (every 2-3 cycles)
   ```

6. **MANDATORY demo capture during dark factory**: After the FIRST green test run and after the FINAL green test run, launch `demo-builder` agent to capture proof-of-work:
   - Test suite output (via `showboat exec`)
   - Curl test results (via `showboat exec`)
   - Key code walkthroughs showing implementation (via `showboat exec` with sed/grep)

   Do NOT defer all demo work to Phase 9. Captures during implementation are more valuable than reconstructed captures after the fact. Phase 9 adds final polish and verification, it should not be building the demo from scratch.

7. **CRITICAL: Test-Runner Authority**
   - Main thread MUST NOT claim tests pass without test-runner verification
   - Main thread MUST NOT skip curl tests
   - Main thread MUST NOT override test-runner findings
   - If test-runner says it fails, it fails. Period.

8. **Escalation (5 failure cycles)**: If test-runner reports failures and code-architect can't fix them in 5 cycles, **escalate to user** with:
   - What was tried (all 5 attempts summarized)
   - Current error state
   - Proposed next approach
   - Ask user for guidance before continuing

9. **WIP**: `wip note <item> "Phase 5: All tests green"`

10. When scorecard shows all green, proceed directly to Phase 6 (no user checkpoint).

---

## Phase 6: CodeRabbit Review (Dark Factory)

**Goal**: Run CodeRabbit locally and incorporate its feedback.

**Dark Factory**: Continues autonomously from Phase 5.

**Actions**:

1. Update status:
   ```markdown
   ## Status
   **Current Phase**: CodeRabbit Review (Dark Factory)
   **Waiting For**: Autonomous — CodeRabbit analysis
   ```

2. Launch `code-reviewer` agent to run CodeRabbit locally:
   - Run `npx coderabbitai review` (or the project-configured CodeRabbit CLI command)
   - Collect all findings: bugs, style issues, suggestions, security concerns

3. Launch `code-architect` agent to address actionable CodeRabbit findings:
   - Fix bugs and security issues flagged by CodeRabbit
   - Apply style/pattern suggestions that align with project conventions
   - Skip suggestions that conflict with the existing architecture or are out of scope
   - Document any skipped findings with rationale in PLAN.md

4. Launch `test-runner` agent to verify no regressions after fixes.

5. Launch `code-reviewer` agent to re-run CodeRabbit and confirm findings are resolved.

6. Update PLAN.md with CodeRabbit Review Results:
   ```markdown
   ## CodeRabbit Review
   - **Findings**: [count] total
   - **Fixed**: [count]
   - **Skipped (with rationale)**: [count]
   - **Remaining**: 0 actionable
   ```

7. **WIP**: `wip note <item> "Phase 6: CodeRabbit review complete"`

8. Proceed directly to Phase 7 (no user checkpoint).

---

## Phase 7: Security Review (Dark Factory)

**Goal**: Verify implementation meets security standards

**Dark Factory**: Continues autonomously from Phase 5.

**Actions**:

1. Update status:
   ```markdown
   ## Status
   **Current Phase**: Security Review (Dark Factory)
   **Waiting For**: Autonomous — security analysis
   ```

2. Launch `code-security` agent to check:
   - Input validation
   - Authentication enforcement
   - Authorization/permission checks
   - No secrets in logs
   - SQL injection prevention
   - XSS prevention
   - Rate limiting

3. Update PLAN.md with Security Review Results

4. **If issues found**:
   - Fix them automatically via `code-architect`
   - Re-run `code-security` to verify fixes
   - Capture results: `uvx showboat exec DEMO.md bash "npm test"` (ensure no regressions)

5. **WIP**: `wip note <item> "Phase 7: Security review clear"`

6. Proceed directly to Phase 8 (no user checkpoint).

---

## Phase 8: Exit Criteria Assessment (Dark Factory)

**Goal**: Adversarial assessment of whether we're actually done

**Dark Factory**: Continues autonomously from Phase 7.

**Actions**:

1. Update status:
   ```markdown
   ## Status
   **Current Phase**: Exit Criteria Assessment (Dark Factory)
   **Waiting For**: Autonomous — assessment
   ```

2. Compile exit criteria from Phase 1 and all subsequent phases

3. Launch `scope-guardian` agent for final scope audit (was implementation in scope?)

4. Launch `criteria-assessor` agent (adversarial):
   - Independently verifies each criterion using the Verification Gate
   - Runs tests itself — does NOT trust test-runner's previous reports
   - Checks code matches claims
   - Verifies Demo Scenarios from Phase 1 are covered in DEMO.md
   - Returns READY or NOT READY verdict

4. **If NOT READY**:
   - Address all FAIL items via `code-architect`
   - Launch criteria-assessor again
   - Repeat until READY (max 3 cycles, then escalate to user)

5. **WIP**: `wip note <item> "Phase 8: Exit criteria READY"`

6. **If READY**: Proceed to Phase 9

---

## Phase 9: Demo & Documentation

**Goal**: Build proof-of-work, finalize documents, prepare for PR

**This phase returns to interactive mode — user reviews the proof.**

**Actions**:

1. Update status:
   ```markdown
   ## Status
   **Current Phase**: Demo & Documentation
   **Waiting For**: Proof generation
   ```

2. Launch `demo-builder` agent:
   - Run `uvx showboat verify DEMO.md` to re-run all captures and confirm they still pass
   - Add final summary to DEMO.md
   - Capture final test run, curl results, any key outputs

3. **If this is a web feature**, launch `browser-verifier` agent:
   - Create rodney walkthrough script
   - Run the walkthrough, capture screenshots
   - Add screenshots to DEMO.md via `uvx showboat image`

4. Prune PLAN.md to final summary (<200 lines):
   - Keep: Status, Final Summary, key decisions
   - Move details to DECISIONS.md
   - Archive exploration notes if valuable

5. Ensure DECISIONS.md is complete (architectural decision records)

6. Generate CHANGELOG.md for PR description

7. Update Final Summary:

```markdown
## Final Summary

### Files Modified
| File | Changes |
|------|---------|

### What Was Built
[Summary]

### Key Decisions
[Important choices - see DECISIONS.md for full rationale]

### Test Coverage
[Summary of tests]

### Security Posture
[Summary of security measures]

### Proof of Work
See DEMO.md for re-executable proof that the feature works.

## Status
**Current Phase**: Complete
**Completed**: [date]
```

8. **WIP**: `wip note <item> "feature-collab complete — ready for PR/merge"`

9. **Final CHECKPOINT**:
   > "Feature complete. PLAN.md finalized. DEMO.md contains proof of work. Ready for PR. See [Final Summary](#final-summary).
   >
   > Run `mdannotate PLAN.md` to annotate and review in your browser, or review PLAN.md directly."

---

## Stacked PR Guidance

**For medium-to-large features only** (>200 lines, >5 files).

Small changes ship as single PRs. Large changes use stacked PRs:

| Change Size | Strategy |
|-------------|----------|
| Small (<200 lines, <5 files) | Single PR |
| Medium (200-600 lines) | Consider 2-3 stacked PRs |
| Large (>600 lines) | Required 3-5 stacked PRs |

Each stacked PR must be a **complete working vertical slice**:
- PR #1: Walking skeleton (working E2E)
- PR #2: Repository layer (tests pass)
- PR #3: Service layer (tests pass)
- PR #4: API + integration (all tests pass)

PRs merge in order: #1 → main, #2 → main, #3 → main...

---

## Quick Reference

| Phase | Mode | Checkpoint | User Action |
|-------|------|------------|-------------|
| 0 | Interactive | None | Auto |
| 1 | Interactive | Scope review | "lock scope" |
| 2 | Interactive | Contracts/tests | "continue" |
| 3 | Interactive | None | Auto |
| 4 | Interactive | **CRITICAL** | "implement" (starts dark factory) |
| 5 | **Dark Factory** | None (escalate after 5 failures) | Auto |
| 6 | **Dark Factory** | CodeRabbit review + fix | Auto |
| 7 | **Dark Factory** | None | Auto |
| 8 | **Dark Factory** | None (escalate after 3 cycles) | Auto |
| 9 | Interactive | Final + Demo | Review DEMO.md, `mdannotate PLAN.md` |
