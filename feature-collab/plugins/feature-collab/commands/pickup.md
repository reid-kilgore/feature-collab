---
name: pickup
description: "Use when resuming a feature-collab workflow from a previous session — reads HANDOFF.md and PLAN.md to restore context"
argument-hint: Optional path to PLAN.md (defaults to doc directory for current branch)
---

# Pickup: Re-enter Feature-Collab Workflow

You are a new session picking up a feature that was previously handed off. You have **zero memory** of the prior conversation. Everything you need is in the project files.

## Document Paths

All project documents live in a branch-specific directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
```

All references to PLAN.md, HANDOFF.md, etc. throughout this skill mean `$DOCS_DIR/<file>`.

## Why This Exists

A previous session used `/handoff` to persist all context before ending. Your job is to rebuild working context from those files, restore the todo list, and seamlessly continue the workflow using `/feature-collab`.

Plan location: $ARGUMENTS (if not specified, use `$DOCS_DIR/PLAN.md`)

## Step 1: Read the Transcript (if available)

If the `/read-transcript` skill is available, use it now to read the previous session's transcript. This gives you rich context beyond what the handoff documents capture — the reasoning behind decisions, the user's preferences and communication style, and any nuance that's hard to write down.

Focus on:
- What was the user's intent and priorities?
- What approaches were tried and why?
- What did the user approve or reject?
- What was the conversation tone and level of detail the user prefers?

If `/read-transcript` is not available, that's fine — proceed with document-based context only.

## Step 2: Load Core Documents

Read these files in order (skip any that don't exist, but PLAN.md is required):

1. **PLAN.md** — the single source of truth. Read the ENTIRE file.
   - Pay special attention to: Status, Scope Boundaries, Exit Criteria, Verification Results
2. **HANDOFF.md** — session-specific context from the previous agent
   - Pay special attention to: Current State, What Needs to Happen Next, Key Learnings, Warnings
3. **SESSION_STATE.md** — session metadata
4. **RISK_LEDGER.md** — read `Current Risk` at the top. If it exists and is >20%, surface this to the user immediately before resuming the dark factory. The previous session was in a high-risk state.

If HANDOFF.md doesn't exist, fall back to SESSION_STATE.md and PLAN.md alone. The workflow can still resume — you'll just need to infer state from PLAN.md.

## Step 3: Load Supporting Documents (Phase-Dependent)

Based on the current phase from PLAN.md Status, read the relevant supporting docs:

| Current Phase | Also Read |
|--------------|-----------|
| 0-1 (Discovery) | Nothing else needed |
| 2 (Contracts) | CONTRACTS.md, TEST_SPEC.md |
| 3 (Walking Skeleton) | CONTRACTS.md, TEST_SPEC.md |
| 4 (Architecture) | CONTRACTS.md, TEST_SPEC.md, DETAILS.md |
| 5 (Implementation) | CONTRACTS.md, TEST_SPEC.md, DETAILS.md, RISK_LEDGER.md |
| 6 (Security) | DETAILS.md, RISK_LEDGER.md |
| 7 (Exit Criteria) | TEST_SPEC.md, DETAILS.md |
| 8 (Documentation) | DECISIONS.md |

## Step 4: Restore the Todo List

If HANDOFF.md contains an Active Todo List, recreate it using TaskCreate:

1. Create a task for each todo item from the handoff
2. Set completed tasks to `completed`
3. Set the current in-progress task to `in_progress`
4. Leave future tasks as `pending`

If there's no HANDOFF.md, create the standard 9-phase todo list and mark phases as completed based on PLAN.md's Status section.

## Step 5: Confirm Understanding

Before continuing, summarize to the user what you understand:

> "Resuming **[feature name]** from Phase [N] ([phase name]).
>
> **Previous session**: [what was accomplished]
> **Current state**: [where things stand]
> **Next steps**: [what needs to happen]
> **[X] todos remaining**
>
> [If there are warnings from HANDOFF.md, mention them]
> [If there are open questions from HANDOFF.md, surface them]
>
> Continuing with `/feature-collab`..."

## Step 6: Re-enter the Workflow

Invoke `/feature-collab` to continue the workflow. The feature-collab skill will:

1. Detect the existing PLAN.md
2. Read the current phase from Status
3. Continue from where the previous session left off

**IMPORTANT**: Do NOT re-do completed phases. The feature-collab skill's Phase 0 checks for existing state and will skip completed work. Trust the documents.

## What NOT to Do

- **Don't re-explore the codebase** — Phase 1 exploration is already captured in PLAN.md's Codebase Context
- **Don't re-design architecture** — Phase 4 design is in DETAILS.md
- **Don't re-discuss scope** — scope was locked in Phase 1
- **Don't re-write tests** — tests were written in Phase 2
- **Don't ignore HANDOFF.md warnings** — the previous agent wrote them for a reason
- **Don't skip loading todos** — the task list drives progress tracking

## If Things Look Wrong

If the documents are inconsistent or seem stale:

1. Trust PLAN.md over other documents (it's the source of truth)
2. Trust the verification scorecard in PLAN.md (test-runner is authoritative)
3. If genuinely confused, ask the user before proceeding
4. Run `git log --oneline -10` to see recent commits for additional context

## Edge Cases

- **No HANDOFF.md exists**: The previous session ended without a clean handoff. Read PLAN.md and SESSION_STATE.md, infer the current state, and ask the user to confirm before continuing.
- **PLAN.md doesn't exist**: This is a fresh start, not a resume. Tell the user and suggest using `/feature-collab` directly instead.
- **Phase 0 (Setup)**: Nothing to resume — just run `/feature-collab` from the start.
- **Phase 8 (Complete)**: The feature is done. Tell the user and ask what they want to do next.
