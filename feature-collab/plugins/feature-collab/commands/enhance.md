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
3. **Execute mandatory skill phases even when trivial.** Don't skip phases because the feature is "too simple." If you believe a phase is genuinely inapplicable, see rule 5.
4. **Persist user decisions to PLAN.md immediately.** Don't rely on conversation context surviving compactions.
5. **Never skip phases without user permission.** If a phase seems inapplicable (e.g., test-gap-finder for a schema-only change), ask: "Phase [X] seems inapplicable because [reason] — skip it? (y/n)". Do not proceed past the phase until the user confirms. Silent phase-skipping is the #1 compliance violation across retros.

### Pre-PR Divergence Check

Before pushing for a PR, run `git diff --stat origin/main...HEAD` and verify the file count matches expected scope. Rebase first if diverged. Before rebasing, check if there's actually anything to rebase: `git log --oneline HEAD..origin/main`. If empty, skip the rebase. Blind rebase attempts waste cycles and can fail noisily.

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "It's just slightly over 200 lines" | The limit exists for a reason. Escalate to /feature-collab. |
| "I can quickly check the code myself" | Delegate to an agent. You orchestrate. |
| "Criteria-assessor is being pedantic" | Tell the user. Don't silently override. |
| "This doesn't need contracts for something this small" | Contracts prevent rework. Small scope ≠ skip process. |
| "Tests should be green now" | Launch test-runner. "Should" isn't verified. |
| "Let me summarize the contracts/scope/test plan here" | Reference PLAN.md or CONTRACTS.md by section link. Don't reproduce tables the user can already read. |
| "I'll just cast it with `as` to add the field" | Update the query to return the field. `as` casts on repository returns hide real bugs — the compiler can't verify the query actually returns the data. |
| "I'll widen the Prisma enum to `string` for testability" | Don't widen Prisma enums to `string` for testability — import enums in test files instead. Widening defeats type safety the same way `as` does. |
| "Tests are green so the implementation is correct" | Check that test doubles match real query shapes. Mocks that inject fields the actual query doesn't `select` will pass while prod breaks. |
| "I'll use `jest.fn()` for the mock" | Use `jest.fn<ActualFunctionType>()` with the real function's type signature. Untyped mocks silently accept wrong parameter counts — JS drops extra args, so tests pass by accident. TypeScript catches arity mismatches at compile time only if the mock is properly typed. |
| "Adding this related thing keeps it cohesive" | Check scope. If it's not in scope, it's a Fast Follow. |
| "The agent says it's done and the fix looks good" | When an agent touches allocation/money/auth code, open the agent's output file and skim its reasoning — not just the summary. Summaries describe intent; reasoning reveals concerns the agent may have dismissed. |
| "I'll note the deferral in PLAN.md" | When a plan item is explicitly deferred, create a tracking ticket (Linear issue or bd task) immediately. A deferred item in PLAN.md without a ticket is forgotten — PLAN.md is pruned at session end, and the deferral evaporates. |
| "I recommend currency.js for this" | Never assert library recommendations without verification. Check npm weekly downloads, last publish date, and open issues count before presenting. If you haven't verified, say 'I haven't checked the maintenance status' explicitly. |
| "The new utility function is cleaner" | When concept-tracing reveals an existing function that the new code would duplicate, add it to PLAN.md Follow-up section and note the duplication. Don't leave two functions doing the same thing without flagging it. |
| "The error handling is straightforward, existing tests cover it" | When changing error-handling behavior (e.g., `Promise.all` → `Promise.allSettled`), the test spec MUST include a test for the recovery/partial-failure path. The new behavior's whole point is different failure handling — if that path is untested, the change is untested. |
| "The user wants a rename/relabel" (when they said "underneath", "behind", "opaque") | Abstraction-boundary signals. Propose a separate encapsulating entity, not a rename. |
| "I'll include the full implementation for the deferred item in CONTRACTS.md" | Mark deferred items as stubs with a TODO, not full implementations. Over-scoping contracts leads to over-scoped plans. |
| "Do you have the dev server running?" | Start it yourself. Read package.json to find the command. |
| "Should I start the server for you?" | Yes, obviously. Don't ask — that's your job. Investigate and start it. |
| "The DB is empty so the demo would just show empty states" | Seed the database. Run the seed script or insert test data yourself. Empty DB is not an excuse to skip demos. |
| "I fixed the review comment" | After applying a review-feedback fix, re-read the full function and verify code *behavior* matches user intent before committing. Don't pattern-match feedback as a documentation issue when the user is pointing at a code branch. |
| "Let me apply another incremental fix for this review comment" | When a reviewer says "I still see X" after your fix, STOP. Re-read the original feedback and the full diff — your mental model of the problem is wrong. Do not apply another incremental edit. |
| "I'll commit the failing tests first for TDD RED" | If pre-commit hooks run the full test suite, intentionally-failing tests will block the commit. Write the tests, verify they fail locally, then implement before committing. Commit RED+GREEN together. |

### Red Flags — STOP

- Reading code directly instead of delegating
- Approaching 200 lines without flagging it
- Skipping contract definition because "it's small"
- Claiming completion without test-runner verification
- Asking the user to start servers, run seeds, or do infrastructure setup you could do yourself
- After 1+ compaction, invoke `/handoff` before resuming — do not rely on compressed summary alone
- If test doubles inject fields/states the actual query doesn't return, STOP — the test passes by accident. Re-sync tests must stub `findFirst` to return an existing record with the claimed prior status, not `null`. A `null` return tests first-time insert, not re-sync.
- After the 2nd manual patch to the same file in one session, pause and propose a root fix instead of applying a 3rd patch. Three patches to the same file means the first two didn't solve the problem — stop patching and investigate.
- Before dispatching work to an existing worktree/branch, run `gh pr list --head <branch>`. If an open PR exists, STOP — don't send agents to branches with open PRs unless explicitly instructed.

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
  CONTRACTS.md
  TEST_SPEC.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md, CONTRACTS.md, etc. throughout this skill mean `$DOCS_DIR/<file>`.

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

3. **Enumerate existing mechanics**: Before proposing a new UI affordance or API surface, enumerate existing mechanisms that achieve similar goals. "Does this capability already exist under a different name or in a different form?" Duplicate affordances waste implementation time and confuse users.

4. **Build-vs-buy evaluation**: For non-trivial algorithms (currency math, date parsing, CSV parsing, crypto), evaluate build-vs-buy during planning. Include an "Implementation approach" section in PLAN.md considering library options BEFORE implementation starts.

5. **Launch concept-tracing agents**: Spawn `code-explorer` agents to trace each concept through the codebase. One agent per concept, or group tightly related ones. Each agent reports: what exists, what patterns to follow, what might break.

   For field-swap or field-addition features, concept tracing MUST enumerate ALL query paths (Prisma `select`/`include`, SQL queries, API calls) that feed the function under change. Verify each path returns the new field. Missing a query path is the #1 cause of "tests pass but prod breaks" bugs.

   Protect the orchestrator's context window — delegate ALL code reading to agents.

4. **Synthesize findings** into PLAN.md. Must answer: what files will be touched, what patterns to follow, what might break. Enhancement research is complete when you can name every file that will change and why.

5. Launch `test-gap-finder` agent to audit EXISTING test coverage for the code being changed. This runs BEFORE contracts — gaps in existing coverage inform what contracts need to specify. The gap-finder reviews current tests against current code and reports: what's untested, what's fragile, what assumptions are baked in.

6. Create CONTRACTS.md with types, routes, and function signatures. Incorporate gap-finder's findings — if existing tests are missing edge cases, the contracts should specify them.

7. Launch `code-verifier` agent to generate TEST_SPEC.md from contracts.

8. Launch `test-gap-finder` agent again to review TEST_SPEC.md adversarially (different pass — this time checking the NEW spec, not existing coverage).

8. Launch `test-implementer` agent to write failing tests.

9. Launch `test-runner` agent to confirm RED state (tests should fail).

10. If APIs are being changed, list the changed/new endpoints in PLAN.md so the api-walkthrough agent (Phase 4) knows what to trace. The Bruno collection itself lives in `~/Library/Application Support/bruno/<collection>/`, not in this repo.


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
   - If scope-guardian returns any `SCOPE_SHOVE_CANDIDATE` blocks, surface each one to the user with the A/B choice as written. If the user picks (B), ask them to file the issue manually. If the user picks (A), expand scope and proceed. Never resolve shove candidates silently.

5. **Implementation proof capture** (if APIs changed): After tests go green, note the key changed endpoints in PLAN.md for the api-walkthrough agent in Phase 4.

6. **Escalation**: If 5 fix cycles fail, escalate to user.

8. **CONTRACTS reconciliation**: If the implementation diverged from CONTRACTS.md (e.g., a parameter was dropped, a function signature changed, a tx mechanism was simplified), update CONTRACTS.md to match reality and verify all test function calls match actual implementation signatures (parameter count and types). Tests written against a stale contract pass by accident in JS (extra args are silently dropped) and create phantom correctness.

9. **WIP**: `wip note <item> "Phase 2: Implementation complete, tests green"`

10. Proceed to Phase 3 when all tests pass.

### Commit Planning Artifacts

Dispatch a haiku agent to commit all planning documents before implementation begins. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md $DOCS_DIR/CONTRACTS.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```

**Pre-commit typecheck gate**: Before dispatching the commit agent, the orchestrator verifies `npx tsc --noEmit` passes from the relevant package directory. Do not delegate typecheck to the commit agent — catch type errors before they enter the commit.

**Pre-commit eslint gate**: Also run `npx eslint --no-fix` on all changed files before dispatching the commit agent. This is especially critical for new files with non-standard extensions (`.mjs`, `.cjs`, `.mts`) — existing ignore patterns may not cover them. If full suite has known unrelated failures, run only on the specific changed files rather than using `--no-verify`.

When an agent discovers the correct invocation for lint, test, or build commands through trial and error, record it in PLAN.md and include it in subsequent agent prompts. Do not force each agent to rediscover the same commands independently.

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

5. **User override handling**: If the user explicitly overrides a NOT_READY finding from criteria-assessor, code-reviewer, or code-security (e.g., "that's not an issue", "ignore that", "proceed anyway"):
   - Tell the user: "criteria-assessor flagged X, but proceeding because you overrode it."
   - Note the override in PLAN.md so future readers see what was waived and why.

6. **WIP**: `wip note <item> "Phase 3: Exit criteria READY"`

7. Proceed to Phase 4 when READY.

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

2. **API Demo (conditional, default for backend changes):** If this enhancement changed or added API endpoints, launch an `api-walkthrough` agent with the list of changed/new endpoints. The agent authors a Bruno walkthrough collection at `~/Library/Application Support/bruno/<collection>/` (sibling to existing collections). The collection captures auth via a login + `script:post-response` chain, then one `.bru` per endpoint with chained env-var IDs. The Bruno collection IS the proof.

   For non-API changes (schema-only, internal refactor, UI-only), skip the demo phase — ask the user to confirm per rule 5.

3. Update PLAN.md:

```markdown
## Status
**Current Phase**: Complete
**Completed**: [date]

## Summary
- **What was added**: [description]
- **Tests**: All passing (N/N)
- **Lines added**: [count] (within 200-line limit)
- **Proof**: See Bruno collection (if API changes) or test output
```

5. **Bisectable Commit Splitting**

   Dispatch a single haiku agent to split commits into clean layers before the PR goes up.

   **Pre-flight check**: Count lines in `git diff main...HEAD`. If fewer than 50 lines, skip splitting entirely — one commit is fine. Otherwise proceed.

   **Stash guard**: Run `git stash` if there are uncommitted changes (restore with `git stash pop` at the end).

   **3-layer split** (enhance-sized changes don't warrant more than 3 commits):
   - Layer 1 (Infrastructure): config files, package.json, tsconfig, CI, Dockerfiles
   - Layer 2 (Implementation + Tests): all production code and its tests
   - Layer 3 (Documentation): PLAN.md, CHANGELOG, README, docs/

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

   **Pre-push PR state check**: Before pushing, verify the branch's PR (if any) is not already merged or closed:
   ```bash
   PR_STATE=$(gh pr view --json state -q '.state' 2>/dev/null || echo "NONE")
   ```
   If `PR_STATE` is `MERGED` or `CLOSED`, do NOT push to this branch. Instead: create a new branch off main, cherry-pick or rewrite the changes, push the new branch, and open a new PR referencing the original.

   ```bash
   git push -u origin $(git branch --show-current)
   gh pr create --title "<concise title>" --body "$(cat <<'EOF'
   ## Summary
   <1-3 bullet points from PLAN.md>

   ## Test plan
   - [ ] All tests passing (verified by test-runner)
   - [ ] Bruno API collection (if API changes)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

   If the PR creation fails (e.g., merge conflict with main), rebase first, re-run typecheck, then retry.

   **CI flaky-test policy**: When a CI failure is diagnosed as flaky and unrelated to this PR, immediately run `gh run rerun --failed` and continue monitoring. Do not declare "PR ready" with red checks — the user should not have to babysit CI.

7. **Plan closure**: Dispatch a haiku agent to update PLAN.md — set phase to "Complete", set completion date, and check off all In Scope items that were delivered. An unclosed plan misleads future readers into thinking work is still in progress. This is not optional.

   **Post-PR plan sync**: If review feedback changes the interface or design (e.g., optional→required, new parameter, renamed field), update PLAN.md and CONTRACTS.md before committing the fix. Stale planning artifacts mislead future readers about what was actually shipped.

8. **WIP**: `wip status <item> IN_REVIEW && wip note <item> "enhance complete — PR up for review"`
   > `IN_REVIEW` tells hooks not to overwrite with ACTIVE/WAITING — preserves the status until a human acts.

9. Present the PR URL to the user and offer retrospective:
   > "PR is up: [URL]. For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Context Checkpoint

All state has been saved to disk:
- PLAN.md: Final status
- CONTRACTS.md: Type definitions
- Bruno collection (if API changes): `~/Library/Application Support/bruno/<collection>/`

**If your context feels heavy, now is a good time to `/clear` and then `/pickup` to continue with a fresh context window.**
