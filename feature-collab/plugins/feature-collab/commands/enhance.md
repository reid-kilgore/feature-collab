---
name: enhance
description: "Use when adding a small improvement (<200 lines) to existing functionality — a new option, a UI tweak, or a minor behavior change"
argument-hint: Enhancement description
---

# Enhance: Small Enhancement

You are helping a developer implement a small enhancement (<200 lines of production code) through a contract-first TDD process.

**Violating the letter of the rules is violating the spirit of the rules.**

## Orchestrator Discipline

You are the ORCHESTRATOR. You do not read code, run tests, or implement. You dispatch agents, synthesize their outputs, update PLAN.md, and talk to the user.

### The Iron Law

```
STAY UNDER 200 LINES — IF IT GROWS, SWITCH TO /FEATURE-COLLAB
```

### Orchestrator Never Edits Source

The orchestrator dispatches agents. It does not use `Edit` or `Write` on source files. If a quick fix is needed, dispatch a targeted `code-architect` agent. This is not negotiable regardless of how small the change is.

### Transparency Rules

1. **Never silently drop user-requested phases.** If the user's invocation includes activities the skill doesn't cover (e.g., mutation testing), say so: "enhance doesn't include mutation testing — should I add it?"
2. **Never silently override criteria-assessor.** If you disagree with NOT READY, tell the user why in one sentence.
3. **Execute mandatory skill phases even when trivial.** demo-builder for a simple enhancement takes 30 seconds — don't skip it because the feature is "too simple."
4. **Persist user decisions to PLAN.md immediately.** Don't rely on conversation context surviving compactions.

### Pre-PR Divergence Check

Before pushing for a PR, run `git diff --stat origin/main...HEAD` and verify the file count matches expected scope. Rebase first if diverged.

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "It's just slightly over 200 lines" | The limit exists for a reason. Escalate to /feature-collab. |
| "I can quickly check the code myself" | Delegate to an agent. You orchestrate. |
| "This feature is too simple for a demo" | Demo-builder takes 30 seconds. A simple curl is one of the best demo cases. |
| "Criteria-assessor is being pedantic" | Tell the user. Don't silently override. |
| "This doesn't need contracts for something this small" | Contracts prevent rework. Small scope ≠ skip process. |
| "Tests should be green now" | Launch test-runner. "Should" isn't verified. |
| "Let me summarize the contracts/scope/test plan here" | Reference PLAN.md or CONTRACTS.md by section link. Don't reproduce tables the user can already read. |
| "Adding this related thing keeps it cohesive" | Check scope. If it's not in scope, it's a Fast Follow. |
| "The user wants a rename/relabel" (when they said "underneath", "behind", "opaque") | Abstraction-boundary signals. Propose a separate encapsulating entity, not a rename. |
| "Do you have the dev server running?" | Start it yourself. Read package.json to find the command. |
| "Should I start the server for you?" | Yes, obviously. Don't ask — that's your job. Investigate and start it. |
| "The DB is empty so the demo would just show empty states" | Seed the database. Run the seed script or insert test data yourself. Empty DB is not an excuse to skip demos. |

### Red Flags — STOP

- Reading code directly instead of delegating
- Approaching 200 lines without flagging it
- Skipping contract definition because "it's small"
- Claiming completion without test-runner verification
- Asking the user to start servers, run seeds, or do infrastructure setup you could do yourself

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- **Read the agent's frontmatter `model:` field** before dispatching — it specifies the correct model. Do not default to the orchestrator's model tier.
- Never use Opus for agents that just run commands or read files

**Agent model table** — match the task, not the agent name:

| Task | Model | Examples |
|------|-------|----------|
| Read/find/trace/list code | Haiku | code-explorer (concept tracing), test-runner, commit agent |
| Implement/refactor/debug | Sonnet | code-architect, test-implementer |
| Plan/synthesize/assess | Opus | criteria-assessor, architecture selection |
| CI monitoring | Haiku | gh-checks agent (single agent with poll loop, NOT sleep+check background tasks) |

## Core Principles

- **Small scope enforced**: If the enhancement exceeds ~200 lines, recommend `/feature-collab` instead
- **Contracts before code**: Define types and interfaces first
- **Tests before implementation**: TDD RED-GREEN
- **PLAN.md is source of truth**
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
  DEMO.md
  CONTRACTS.md
  TEST_SPEC.md
  RISK_LEDGER.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md, DEMO.md, etc. throughout this skill mean `$DOCS_DIR/<file>`.

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting enhance: [description]"
# At phase transitions: wip note <item> "Phase N: [status]"
# When creating branches: wip add-branch <item> <branch>
# At completion: wip status <item> IN_REVIEW  (agent-managed — hooks won't overwrite)
# DONE status is set only after branch is merged (not by this skill)
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Metrics Tracking

The orchestrator tracks workflow efficiency metrics for this session. These feed into retro baselines and anomaly detection.

**Schema** — maintain this object in working memory throughout the session:

```json
{
  "workflow_type": "enhance",
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
- `user_interventions` — increment each time the orchestrator asks the user a question or waits for user input ("say 'implement' to begin" counts; follow-up clarifications count)
- `agent_dispatches` — increment each time an agent is launched (parallel agents = N increments)
- `dark_factory_escalations` — increment when the 5-failure escalation in Phase 2 is triggered and the user is interrupted
- `scope_guardian_flags` — increment each time scope-guardian returns a flag or finding (not every dispatch — only dispatches that produce actionable flags)
- `criteria_not_ready_count` — increment each time criteria-assessor returns NOT READY

**Write metrics at workflow completion** (Phase 5, before PR handoff):

```bash
mkdir -p ~/.claude/feature-collab/metrics
BRANCH=$(git branch --show-current)
DATE=$(date +%Y-%m-%d)
cat > ~/.claude/feature-collab/metrics/${DATE}-${BRANCH}.json << 'EOF'
{ <metrics object with completed_at set to current ISO timestamp> }
EOF
```

Individual agents do not need to know about metrics — this is orchestrator-only bookkeeping.

---

## Phase 1: Scope & Contract

**Goal**: Define what's being added, write contracts, write failing tests.

**Actions**:

1. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`):

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

2. **Concept Extraction**: Before touching code, decompose the enhancement into every concept, assumption, and unspoken dependency it implies. List them in PLAN.md:
   ```markdown
   ## Concepts to Trace
   - [Concept 1]: [why it matters]
   - [Assumption 1]: [what we're assuming]
   ```
   Even small enhancements have implicit assumptions about existing code. Surface them.

3. **Launch concept-tracing agents**: Spawn `code-explorer` agents to trace each concept through the codebase. One agent per concept, or group tightly related ones. Each agent reports: what exists, what patterns to follow, what might break.

   Protect the orchestrator's context window — delegate ALL code reading to agents.

4. **Synthesize findings** into PLAN.md. Must answer: what files will be touched, what patterns to follow, what might break. Enhancement research is complete when you can name every file that will change and why.

5. Launch `test-gap-finder` agent to audit EXISTING test coverage for the code being changed. This runs BEFORE contracts — gaps in existing coverage inform what contracts need to specify. The gap-finder reviews current tests against current code and reports: what's untested, what's fragile, what assumptions are baked in.

6. Create CONTRACTS.md with types, routes, and function signatures. Incorporate gap-finder's findings — if existing tests are missing edge cases, the contracts should specify them.

7. Launch `code-verifier` agent to generate TEST_SPEC.md from contracts.

8. Launch `test-gap-finder` agent again to review TEST_SPEC.md adversarially (different pass — this time checking the NEW spec, not existing coverage).

8. Launch `test-implementer` agent to write failing tests.

9. Launch `test-runner` agent to confirm RED state (tests should fail).

10. Launch `demo-builder` agent to initialize proof doc and capture failing state.

11. **Initialize Risk Ledger**: Create `$DOCS_DIR/RISK_LEDGER.md`:
    ```markdown
    # Risk Ledger
    Current Risk: 0%

    ## Events
    | Timestamp | Agent | Event | Delta | Running Total | Description |
    |-----------|-------|-------|-------|---------------|-------------|
    ```

12. **WIP**: `wip note <item> "Phase 1: Contracts defined, tests written (TDD RED)"`

13. **CHECKPOINT**:
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
   - If scope-guardian returns any `SCOPE_SHOVE_CANDIDATE` blocks, surface each one to the user with the A/B choice as written. If the user picks (B), dispatch `linear-issues` agent to file the issue. If the user picks (A), expand scope and proceed. Never resolve shove candidates silently.

5. **MANDATORY demo capture**: After tests go green, launch `demo-builder` agent to capture proof-of-work — test output, curl results, key code walkthroughs. Do NOT defer all demo work to Phase 5. Captures during implementation are more valuable than reconstructed captures.

6. **Risk check**: Before each fix cycle, read `$DOCS_DIR/RISK_LEDGER.md`. If `Current Risk > 20%`, STOP and escalate to user immediately — do not dispatch another code-architect.

7. **Escalation**: If 5 fix cycles fail, escalate to user.

8. **WIP**: `wip note <item> "Phase 2: Implementation complete, tests green"`

9. Proceed to Phase 3 when all tests pass.

### Commit Planning Artifacts

Dispatch a haiku agent to commit all planning documents before implementation begins. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md $DOCS_DIR/CONTRACTS.md $DOCS_DIR/DEMO.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```

## Context Compaction

When conversation is compacted, **the current skill must be fully re-invoked** — do not continue from the compressed summary alone.

Your compaction summary **must** include:

1. **Current phase** from PLAN.md Status section
2. **What you were waiting for** (user input, agent results, etc.)
3. **Instruction to re-invoke** `/pickup` to continue with full prompt reload

**Why**: After compaction, the iron law, 200-line limit awareness, and delegation rules are no longer in context. PLAN.md is the recovery artifact — without it, re-invocation has nothing to restore from.

### Context Checkpoint

All state saved to disk. **If context feels heavy, `/clear` then `/pickup` to continue.**

---

## Phase 3: CodeRabbit Review (Dark Factory)

**Goal**: Run CodeRabbit locally and incorporate its feedback. Runs autonomously.

**Actions**:

1. Update PLAN.md status:
   ```markdown
   ## Status
   **Current Phase**: CodeRabbit Review
   **Waiting For**: In progress (dark factory)
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

7. **WIP**: `wip note <item> "Phase 3: CodeRabbit review complete"`

8. Proceed to Phase 4.

---

## Phase 4: Verify (Dark Factory)

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

5. **User override handling**: If the user explicitly overrides a NOT_READY finding from criteria-assessor, code-reviewer, or code-security (e.g., "that's not an issue", "ignore that", "proceed anyway"):
   - Tell the user: "criteria-assessor flagged X, but proceeding because you overrode it."
   - Ask: "Should I suppress this finding for future sessions? (y/n)"
   - If yes, ask for a brief reason, then write the suppression:

   ```bash
   SLUG=$(git remote get-url origin 2>/dev/null | sed 's/.*\///' | sed 's/\.git$//' || basename $(git rev-parse --show-toplevel))
   mkdir -p "$HOME/.claude/feature-collab/suppressions"
   SUPPRESSION_FILE="$HOME/.claude/feature-collab/suppressions/${SLUG}.json"
   # Read existing entries (or start with []), append new entry, write back
   # Entry schema: {"finding_type": "...", "pattern": "...", "reason": "...", "agent": "...", "date": "YYYY-MM-DD", "expires": "YYYY-MM-DD"}
   # Set expires = today + 90 days
   ```

   Only the orchestrator writes suppressions. Never suppress broad categories — the `pattern` must be specific enough to identify the particular finding.

6. **Suppression summary**: At the end of Phase 4, before proceeding to Phase 5, report:
   > "Suppressions active for this project: N total, M applied this session"
   > List each active (non-expired) suppression: `- [finding_type] / [pattern] (expires: [date], reason: [reason])`

   If no suppressions file exists for this project, skip this summary.

7. **WIP**: `wip note <item> "Phase 4: Exit criteria READY"`

8. Proceed to Phase 5 when READY.

---

## Phase 5: Demo

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

5. **Bisectable Commit Splitting**

   Dispatch a single haiku agent to split commits into clean layers before the PR goes up.

   **Pre-flight check**: Count lines in `git diff main...HEAD`. If fewer than 50 lines, skip splitting entirely — one commit is fine. Otherwise proceed.

   **Stash guard**: Run `git stash` if there are uncommitted changes (restore with `git stash pop` at the end).

   **3-layer split** (enhance-sized changes don't warrant more than 3 commits):
   - Layer 1 (Infrastructure): config files, package.json, tsconfig, CI, Dockerfiles
   - Layer 2 (Implementation + Tests): all production code and its tests
   - Layer 3 (Documentation): PLAN.md, DEMO.md, CHANGELOG, README, docs/

   **Soft-reset to main**:
   ```bash
   git reset --soft $(git merge-base HEAD main)
   ```

   **Commit each layer separately** (skip layers with no files). Commit message format:
   ```
   <layer-type>: <descriptive summary>

   Extracted from: <original commit messages, one per line>
   ```

   **Typecheck after each commit** (TypeScript projects only):
   ```bash
   npx tsc --noEmit
   ```
   If typecheck fails, abort: hard-reset to the pre-split state, squash everything into one commit with original messages preserved, and report the failure.

   The agent reports back: how many commits were created and whether typecheck passed.

6. **Push and create PR**:

   Dispatch a haiku agent to push the branch and create the PR. This is not optional — the workflow ships code.

   ```bash
   git push -u origin $(git branch --show-current)
   gh pr create --title "<concise title>" --body "$(cat <<'EOF'
   ## Summary
   <1-3 bullet points from PLAN.md>

   ## Test plan
   - [ ] All tests passing (verified by test-runner)
   - [ ] DEMO.md proof-of-work attached

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   If the PR creation fails (e.g., merge conflict with main), rebase first, re-run typecheck, then retry.

7. **Plan closure**: Dispatch a haiku agent to update PLAN.md — set phase to "Complete", set completion date, and check off all In Scope items that were delivered. An unclosed plan misleads future readers into thinking work is still in progress. This is not optional.

8. **Downstream ticket updates**: After PR is created, check if any related Linear tickets need context from decisions made in this PR. Launch `linear-issues` agent to update downstream tickets that reference this enhancement or depend on its output.

8. **WIP**: `wip status <item> IN_REVIEW && wip note <item> "enhance complete — PR up for review"`
   > `IN_REVIEW` tells hooks not to overwrite with ACTIVE/WAITING — preserves the status until a human acts.

9. Present the PR URL to the user and offer retrospective:
   > "PR is up: [URL]. For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Final status
- CONTRACTS.md: Type definitions
- DEMO.md: Proof of work

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
