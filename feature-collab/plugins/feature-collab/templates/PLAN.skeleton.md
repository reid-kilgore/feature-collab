<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup ({==highlight==}, {>>comment<<}, {++add++}, {--delete--})
- Claude: Uses {==highlights==} only
-->

# Feature: [Name]

> One-line elevator pitch. What this is, who it's for, why now.

**Linear**: [TEAM-1234 or — if none]
**bd epic**: [bd-id or — if none]

## Problem

What's broken or missing in the current system. Two or three short paragraphs. Concrete user-visible symptom or business need first, then the underlying technical gap. No solutioning here.

## Approach

How we plan to solve it, told as a story. Lead with the shape of the change, not the file list. A senior dev reading this should be able to repeat the plan back in their own words after one read.

Cover, in prose:
- The shape: what new component(s) appear, what existing component(s) change, what stays untouched.
- The seam: where the new code attaches to the existing system (which interface, which call site).
- The trade: what we're giving up to get this (perf, simplicity, generality, scope).

## Flow

ASCII diagram of the relevant request/data flow. Include both backend and frontend paths if both are touched. Mark new boxes/arrows with `*`. Example shape:

```
  Browser                  API                       DB
  ─────                    ───                       ──
  [Form] ──submit──> [POST /thing]* ──insert──> (things)
                          │
                          ├──enqueue──> [worker]* ──notify──> [email]
                          │
                          └──audit──> (audit_log)
```

Keep it small (≤ ~15 boxes). If you need more, split into "happy path" and "error path" diagrams.

## Key Decisions

Numbered, each with rationale and at least one alternative considered. This section is the most valuable part of the doc for future readers — write it like you're explaining to the next dev *why*, not *what*.

1. **[Decision]** — [one-sentence statement]
   - Why: [reasoning]
   - Considered: [alternative], rejected because [reason]

2. **[Decision]** — ...

## Open Questions

Things we don't know yet, or things we want the human to weigh in on. Use the annotation guide above — leave room for `{>>response<<}`.

- [ ] **Q1**: [question]
- [ ] **Q2**: [question]

## Scope

### In
- [bullet] — [why it earns its slot]

### Out
- [bullet] — [why not now; link to fast-follow if filed]

### Fast follows (separate PRs)
Every fast follow MUST have a tracking ID — Linear, bd, or both. No bare bullets.

| Tracking ID | Item | Why deferred |
|-------------|------|--------------|
| TEAM-1234 / bd-xyz | ... | ... |

## Exit Criteria

What "done" means for this PR. Single short list, must-haves only. No "should haves" — those are fast-follows.

- [ ] [Criterion]
- [ ] All tests pass (unit + integration)
- [ ] Demo: [Bruno collection name] OR [non-API proof]

## Verification

Pointer only. Full plan in `TEST_SPEC.md`. Note any verification approach that's non-obvious or worth flagging here (e.g. "manual smoke required because feature is UI-only").

## Contracts

Pointer only. Full contracts in `CONTRACTS.md`.

## Codebase Context

Durable reference for later states. Populated in DISCOVERY by concept-tracing agents; should NOT be re-derived in later states. If something here is wrong, fix it in place rather than re-running exploration.

### Impact map
Every file expected to be touched, plus why. Add rows as scope sharpens; do not delete (use strikethrough if a file drops out, so the history is visible).

| Path | Touch type | Why |
|------|------------|-----|
| `path/to/file.ts` | edit / new / delete | [reason] |

### Patterns to follow
Existing patterns the new code must mirror, with concrete file references. One sentence each.

- **[Pattern name]** — see `path/to/example.ts:42`. [What it does, why we follow it.]

### Risk register
What's fragile, what's untested, what might break.

- **[Risk]** — [scope of blast / mitigation / file refs]

---

## Carry-Forward Notes

Append-only. Populated automatically when an `iterate` transition fires. The re-entered state MUST read these before any action.

| Date | Trigger ID | Iterated from → to | Missed | Re-entered state MUST | Evidence |
|------|-----------|--------------------|--------|------------------------|----------|

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
