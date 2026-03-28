# Ideas: WIP Ecosystem

## SwiftUI App (WipViewer)

- Live tmux pane capture embedded in the detail view (SwiftTerm or captured text)
- Context window usage bar per session (green/yellow/red)
- Per-session token cost accumulator displayed in list row
- Session duration / time-in-current-status shown in list
- macOS notifications when agent transitions to BLOCKED or WAITING
- Menu bar mode: popover showing fleet summary ("3 running / 1 blocked")
- Global hotkey command palette for session switching (like Spotlight)
- PR/CI status badge per item (green check, red X, pending spinner)
- Kanban board view as alternative to list (columns = statuses)
- Parent/child grouping: show sub-tasks nested under the ticket that spawned them
- Inline note timeline with visual distinction between automated vs manual notes
- Activity velocity sparkline per session (tool calls per minute over time)
- "Last action" column showing what Claude last did (read file, ran test, etc.)
- Click-to-open: click item to focus its tmux window (like Enter in fzf TUI)
- Click-to-open: click Linear ID to open in browser
- Click-to-open: click PR number to open in GitHub
- Keyboard nav: Cmd+1-9 to jump to Nth active session
- Stall detection highlight: items with no heartbeat for N minutes turn red
- PLAN.md live reload (watch file for changes, re-render automatically)
- Diff view tab: show `git diff --stat` for the branch
- Cost budget bar: show spend vs autopilot budget limit per session
- Sound/chime on status transitions (configurable)
- Dark mode toggle independent of system (for screenshots/demos)
- Filter bar: filter by repo, status, or search by name
- Drag to reorder / manual priority ordering

## WIP CLI Tool

- Archive rotation: move DONE items older than N days to work.archive.txt
- Index by loc: maintain a loc→item lookup file for O(1) hook resolution
- Heartbeat file: agent writes timestamp on every LLM response to ~/.wip/sessions/<id>/heartbeat
- Structured exit status: agents write JSON on completion (status, reason, files_changed, next_action)
- `wip dashboard` command that starts a local HTTP server for remote monitoring
- `wip cost <item>` to show accumulated token/dollar cost for a session
- `wip stale` to list items with no activity in N hours
- `wip merge <item>` one-command: squash-rebase, delete worktree, close tmux window, mark DONE
- `wip queue` priority lane system for autopilot ticket dispatch
- WIP limits: configurable max concurrent ACTIVE sessions, new ones queue
- `wip resume <item>` to re-attach to a Claude session or start a new one with context
- `wip diff <item>` to show git diff stat without switching to the worktree
- `wip pr <item>` to show PR status, CI checks, review state inline
- `wip cost-report` aggregate cost across all sessions for a time period
- Bidirectional Linear sync: local status changes push comments to Linear
- Auto-friendly-name from Linear ticket title (instead of branch slug)
- `wip timeline` chronological view of all status transitions across all items
- `wip health` system check: stale items, zombie worktrees, orphaned tmux windows

## Claude Integration / Hooks

- Richer stop-hook data: capture WHY Claude stopped (finished, hit limit, needs input, error)
- Session turn count written to wip item on each hook fire
- Cost tracking: hook reads Claude's usage and writes to wip item
- Phase-aware status: instead of just ACTIVE, write "ACTIVE:Phase2" so you see workflow progress
- Auto-pickup: when you focus a WAITING tmux window, hook detects it and offers to resume
- Cross-session awareness: agent can query wip to see what other sessions are doing
- Blocked-reason field: when setting BLOCKED, require/prompt for a reason string
- Auto-escalation: if WAITING for >30min with no human interaction, send notification
- Context exhaustion warning: when context >80%, write a note and fire notification
- Handoff-to-human protocol: agent writes structured handoff (what's done, what's left, blockers)

## Autopilot Enhancements

- Live autopilot status in TUI/SwiftUI (which ticket, what phase, turn count)
- Autopilot cost dashboard: per-ticket cost tracking across all attempts
- Smarter triage: use git blame / file ownership to route tickets to the right worktree template
- Parallel autopilot: run N autopilot workers simultaneously on different tickets
- Autopilot dry-run preview: show what it WOULD do before committing to execution
- Post-merge cleanup automation: after PR merges, auto-archive wip item and delete worktree
- Autopilot learning: feed triage-score results back into the triage prompt
- Decompose visualization: show the sub-ticket tree an autopilot decompose created

## New Tools / Integrations

- `wip-web`: lightweight local web dashboard (single HTML file, reads wip list --json)
- QR code for phone monitoring: local server + QR code to check status from phone
- Raycast extension: search/switch wip items from Raycast
- Alfred workflow: same for Alfred users
- Git hook: on push, auto-update wip item with "pushed to remote" note
- PR webhook: GitHub webhook that updates wip status when PR is reviewed/merged
- Slack/Discord bot: post session summaries to a channel when items complete
- `wip-import`: bulk import existing worktrees into wip tracking
- Voice-to-context: use macOS dictation to speak ticket context when dispatching
- Screenshot capture: on WAITING, auto-capture the terminal state as an image for review
