<!--
Purpose: machine-readable session state. Process, not content.
Churns every session. PLAN.md does NOT churn between sessions.

If you find yourself writing rationale or design here, it belongs in PLAN.md.
If you find yourself writing phase/status/agent-log in PLAN.md, it belongs here.
-->

# Session State

<!-- current_state is the source-of-truth state name. Only the transition-decider agent writes this field; H6 hook enforces. Orchestrator reads. Valid values: INIT, DISCOVERY, CONTRACTS, SECURITY_REVIEW, ARCHITECTURE, VERIFICATION_PLANNING, IMPLEMENTATION, CRITERIA_REVIEW, SHIPPING. -->
current_state: INIT

**Feature**: [name — matches PLAN.md heading]
**Status**: [INITIALIZING | IN_PROGRESS | BLOCKED | AWAITING_USER | COMPLETE]
**Waiting For**: [explicit blocker — user input, agent return, external event]
**Last Updated**: [ISO timestamp]

## Scope Lock

**Status**: [UNLOCKED | LOCKED]
**Locked At**: [DISCOVERY checkpoint timestamp, if locked]
**Locked By**: [user confirmation reference]

Scope changes after lock require explicit user re-confirmation. Treat any drift as SCOPE_SHOVE.

## Active Todos

This is the live working list. For tracked work, file `bd` issues and link them here.

- [ ] [todo] — bd-id: [if any]
- [x] [done todo]

## Agent Dispatch Log

Append-only. Every agent dispatch and return.

| Time | Agent | Model | Goal | Result |
|------|-------|-------|------|--------|
| [ts] | code-explorer | sonnet | Trace auth flow | Returned: [3-line summary or PLAN.md section] |

## Decisions Awaiting User

Decisions the orchestrator surfaced but cannot make alone. Resolve before state transition.

- [ ] [decision] — surfaced [state], waiting since [ts]

## Verification Checkpoints

State transitions that have been confirmed. The Verification Gate (see skill) blocks progression past unchecked rows.

| Transition | Confirmed | By |
|------------|-----------|-----|
| DISCOVERY → CONTRACTS | [ ] | [user / orchestrator] |
| CONTRACTS → SECURITY_REVIEW | [ ] | |

## Session Boundaries

- Tool calls this session: [running count] / 100 max
- Checkpoint trigger: 50 calls or phase boundary
- Last checkpoint: [ts]

## If You're a New Session

Do NOT:
- Re-explore codebase (DISCOVERY work)
- Re-design architecture (ARCHITECTURE work)
- Re-discuss scope (locked in DISCOVERY)

Do:
1. Read PLAN.md (architecture + decisions)
2. Read this file (current process state)
3. Resume from current_state
