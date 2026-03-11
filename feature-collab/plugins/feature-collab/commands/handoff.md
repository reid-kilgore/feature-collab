---
name: handoff
description: "Use when a conversation is hitting context limits, needs to be paused, or the user explicitly asks to save progress for a new session"
argument-hint: Optional reason for handoff (e.g., "context limit", "end of day")
---

# Handoff: Persist Context for Session Transfer

You are preparing a complete handoff so that a **new conversation** can pick up this feature exactly where you left off. The new session will have zero memory of this conversation — everything it needs must be written to files.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
EVERY FACT THE NEXT SESSION NEEDS MUST BE WRITTEN TO DISK — NOT REMEMBERED, NOT ASSUMED, NOT "OBVIOUS"
```

If it's not in HANDOFF.md or PLAN.md, it doesn't exist for the next session. Period.

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "PLAN.md already covers this" | PLAN.md tracks scope and status. HANDOFF.md tracks session-specific context, learnings, and next steps. Both are needed. |
| "The next agent can figure it out" | The next agent has ZERO context. Write it down or it's lost. |
| "This is obvious from the code" | Nothing is obvious to a blank context window. Be explicit. |
| "I'll just write a quick summary" | Quick summaries miss critical details. Follow the full template. |
| "The handoff is just a formality" | Handoff is the ONLY bridge between sessions. Treat it as critical. |

### Red Flags — STOP

- Writing a handoff without reading ALL project documents first
- Skipping sections of the HANDOFF.md template
- Writing vague next steps ("continue implementation") instead of specific ones
- Not capturing verbal agreements or learnings from the session
- Not updating SESSION_STATE.md

## Document Paths

All project documents live in a branch-specific directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
```

All references to PLAN.md, HANDOFF.md, etc. throughout this skill mean `$DOCS_DIR/<file>`.

## Why This Exists

Claude Code conversations hit context limits or need to be paused. When that happens, all in-memory understanding is lost. This skill ensures nothing falls through the cracks by writing everything a new agent needs into persistent documents referenced from PLAN.md.

Handoff reason: $ARGUMENTS

## Step 1: Read Current State

Resolve the doc directory first:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
```

Read ALL of these files from `$DOCS_DIR/` (skip any that don't exist):

1. **PLAN.md** — current phase, status, scope, scorecard, exit criteria
2. **SESSION_STATE.md** — session metadata
3. **CONTRACTS.md** — types, routes, signatures
4. **TEST_SPEC.md** — test specifications
5. **DETAILS.md** — implementation details
6. **DECISIONS.md** — architectural decisions

Also read the current todo list using TaskList.

## Step 2: Determine Current Phase and State

From PLAN.md's Status section, identify:

- **Current phase** (0-8)
- **What was being worked on** (the specific task or sub-task)
- **What was being waited for** (user input, test results, agent output, etc.)
- **Blockers or open questions** that need resolution

## Step 3: Write HANDOFF.md

Create or overwrite `$DOCS_DIR/HANDOFF.md` with the following structure:

```markdown
# Handoff Notes

**Created**: [timestamp]
**Reason**: [handoff reason or "context limit"]
**Feature**: [feature name from PLAN.md]

## Current State

**Phase**: [N] ([phase name])
**Sub-phase**: [what specifically was in progress]
**Waiting For**: [what needs to happen next]

## What Was Just Completed

[2-5 bullet points of what was accomplished in this session]

## What Needs to Happen Next

[Numbered list of immediate next steps, as specific as possible]

1. [Exact next action — e.g., "Run test-runner agent to verify scorecard after fixing auth middleware"]
2. [Following action]
3. [etc.]

## Active Todo List

[Copy of all pending and in-progress todos from the task list]

| ID | Status | Task |
|----|--------|------|
| 1  | completed | Phase 0: Session Setup |
| 2  | completed | Phase 1: Discovery & Scope Lock |
| 3  | in_progress | Phase 2: Contract Definition |
| ... | ... | ... |

## Key Learnings & Context

Things the next agent needs to know that aren't captured in other documents:

- [Codebase quirks discovered — e.g., "The auth middleware is in src/middleware/auth.ts, not where you'd expect"]
- [Decisions made verbally with user that aren't in DECISIONS.md yet]
- [Gotchas — e.g., "npm test requires DB to be running, use docker compose up -d first"]
- [Patterns — e.g., "This codebase uses Result types, not exceptions"]
- [Test status — e.g., "7/15 tests passing, auth-related tests all fail due to missing middleware"]

## Files to Read on Resume

Priority-ordered list of files the next session should read:

1. PLAN.md (always first — single source of truth)
2. HANDOFF.md (this file — session-specific context)
3. [other files relevant to current phase]

## Open Questions

Questions that were raised but not yet resolved:

- [ ] [Question — who needs to answer — blocking?]

## Warnings

[Anything the next agent should be careful about]

- [e.g., "Don't re-run the migration — it's already applied"]
- [e.g., "The user prefers X approach over Y — see DECISIONS.md"]
```

## Step 4: Update SESSION_STATE.md

Update SESSION_STATE.md to reflect the handoff:

```markdown
# Session State

## Current State
**Phase**: [N] ([phase name])
**Status**: HANDED OFF
**Last Updated**: [timestamp]
**Handoff Reason**: [reason]

## If You're a New Session

### Do
1. Read PLAN.md first (single source of truth)
2. Read HANDOFF.md (session-specific context and next steps)
3. Load the todo list from HANDOFF.md using TaskCreate
4. Use `/pickup` to re-enter the workflow

### Do NOT
- Re-explore codebase (done in Phase 1)
- Re-design architecture (done in Phase 4)
- Re-discuss scope (locked in Phase 1)
- Skip reading HANDOFF.md
```

## Step 5: Update PLAN.md References

Add a reference to HANDOFF.md in PLAN.md's Status section:

```markdown
## Status
**Current Phase**: [phase name]
**Status**: HANDED OFF — see HANDOFF.md for resume instructions
**Last Updated**: [timestamp]
```

If PLAN.md doesn't already list HANDOFF.md in its documents, add it.

## Step 6: Final Verification

1. Confirm HANDOFF.md was written and contains all sections
2. Confirm SESSION_STATE.md was updated
3. Confirm PLAN.md status was updated
4. Report to user:

> "Handoff complete. All context saved to HANDOFF.md. A new session can pick up with `/pickup`. Key state:
> - **Phase**: [N] ([name])
> - **Next step**: [brief description]
> - **[X] todos pending**"

## Key Principles

- **Write MORE than you think is needed** — the next agent has zero context
- **Be specific, not general** — "fix auth middleware in src/middleware/auth.ts:45" not "fix auth"
- **Capture verbal agreements** — if the user said something important that isn't in a doc, write it down
- **Learnings are gold** — codebase quirks and gotchas save the next agent enormous time
- **Reference PLAN.md** — HANDOFF.md supplements PLAN.md, it doesn't replace it
