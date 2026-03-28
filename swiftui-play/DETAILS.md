# Details: WIP Ecosystem Ideas

Explanations for ideas that need context beyond the one-liner.

## Heartbeat-Based Stall Detection

The current hooks only fire on prompt-submit and stop events. Between those events, there's no signal. A heartbeat file (`~/.wip/sessions/<id>/heartbeat`) written on every LLM response would let a supervisor detect stalls — an agent that's been "thinking" for 10+ minutes with no output is likely stuck. The SwiftUI app or a background process polls heartbeat files and highlights stalled sessions. This is the difference between "ACTIVE" meaning "Claude is productively working" vs "Claude has been spinning for 20 minutes."

## Structured Exit Status

When Claude finishes and the stop hook fires WAITING, there's no record of WHY it stopped. Did it finish the task? Hit the turn limit? Get confused and bail? Need human input on a design decision? A structured exit file (`{status: "needs_input", reason: "Database schema choice: option A vs B", files_changed: ["src/db.ts"], next_action: "Review options in PLAN.md"}`) would let the TUI/app show actionable context instead of just "WAITING."

## Phase-Aware Status

Right now status is one of 8 values. But ACTIVE during Phase 1 (research) is very different from ACTIVE during Phase 2 (implementation). Writing "ACTIVE:Phase2:Implementation" to the status field (or a separate `phase` field) would let the UI show workflow progress at a glance. The skill scripts already write phase notes — this just surfaces it to the status level.

## Context Window Usage Bar

Claude Code sessions have a finite context window. When it fills up, the session either compresses (losing detail) or needs a handoff. Displaying remaining context as a colored bar (green <70%, yellow 70-85%, red >85%) per session would let you proactively intervene before context exhaustion causes degraded output. The challenge: this data isn't currently exposed by Claude Code in a machine-readable way.

## Activity Velocity Sparkline

Track tool calls per minute over a rolling window. A session making 10 tool calls/min is productively working. A session that dropped from 10/min to 1/min is probably stuck in a reasoning loop. A session at 0/min for 5+ minutes is stalled. A tiny sparkline in the list row makes this visible without opening each session.

## Parent/Child Session Grouping

When a feature-collab session spawns sub-agents (code-explorer, test-runner, etc.), those are invisible in wip. More importantly, when autopilot decomposes a ticket into 3 sub-tickets, each sub-ticket becomes its own wip item with no visual connection to the parent. Nesting child items under parents (with expand/collapse) would show the full work tree.

## WIP Limits

If you have 8 Claude sessions running simultaneously, your machine is resource-constrained and your attention is spread thin. A configurable WIP limit (e.g., max 5 ACTIVE) would queue new dispatches instead of launching them immediately. The queue itself becomes a useful prioritization tool — you see what's waiting and can reorder.

## Archive Rotation

The work.txt file has 257 items, 247 of which are DONE. Every hook fires a linear scan through all of them. Moving items older than N days to work.archive.txt (same format, just a different file that hooks don't scan) would speed up hook resolution and keep the active data small.

## O(1) Hook Resolution via Loc Index

Both hooks scan all work.txt files line-by-line to find which item matches the current working directory. With 257 items this takes ~50ms. With 1000 items it'll take ~200ms — on every single prompt. A separate index file mapping `loc → item_name` would make this O(1). The index rebuilds whenever work.txt changes (which is infrequent relative to hook fires).

## Menu Bar Fleet Summary

The existing menu bar app template (from the spike) is a natural home for an always-visible fleet status. A menu bar icon showing "3/1/0" (running/waiting/blocked) with a popover that expands to the full list. You'd see status without Cmd-tabbing to the app. The main window becomes the detail view you open when you need to act.

## Auto-Friendly-Name from Linear

Only 2% of items have a friendly_name set because it's manual. But most items have a `linear_id`, and Linear tickets have titles. Auto-populating friendly_name from the Linear ticket title on item creation would make the sidebar immediately readable: "Compensation gap indicator" instead of "rk-0327-comp-data-problems."

## Cross-Session Awareness

Today, each Claude session is isolated — it doesn't know what other sessions are doing. If session A is refactoring the auth module while session B is adding a new auth endpoint, they'll conflict. A `wip context` command that returns "here's what other active sessions are touching" would let agents avoid stepping on each other, or at minimum surface the risk.

## One-Command Merge Cleanup

After a PR merges, cleanup is manual: delete the worktree, close the tmux window, remove the branch, mark DONE in wip. `wip merge <item>` would do all of this atomically. Even better: a GitHub webhook that fires on PR merge and triggers this automatically.

## Cost Tracking

Autopilot has a $10/session budget but there's no visibility into spend during a session. Post-hoc, the retro captures token counts, but by then the money is spent. Real-time cost tracking would let you see "this bugfix has already cost $7 and it's only in Phase 1" and intervene. The challenge is the same as context window — Claude Code doesn't expose this in a machine-readable way during the session.

## Autopilot Parallel Workers

Autopilot currently runs a single polling loop processing one ticket at a time. With worktree isolation, there's no technical reason it can't run N workers simultaneously, each in its own worktree. A `wip autopilot --workers 3` would 3x throughput for a queue of independent tickets. The WIP limit concept applies here too — don't run more workers than the machine can handle.

## Voice-to-Context

When dispatching an agent on a complex ticket, you often want to add context: "Be careful with the auth module, we're migrating to OAuth next month" or "The tests are flaky on this endpoint, retry once before failing." Typing this is slow. macOS has built-in dictation (Fn-Fn). Piping dictation directly into the agent's system message would make complex dispatches much faster.
