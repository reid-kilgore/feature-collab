# Feature: Linear Session Start from SwiftUI

## What It Does

A keyboard shortcut or button in WipViewer that lets you type a Linear issue ID (e.g., "PAS-123"), and the app:

1. Looks up the issue in the Linear cache
2. Creates a git worktree with the standard `rk-MMDD-<slug>` naming
3. Opens a new tmux window in that worktree
4. Creates PLAN.md pre-filled with Linear issue content
5. Registers the item in wip tracking with `linear_id` linked
6. Starts Claude in the tmux window
7. Selects that tmux window so you land right in it

End-to-end: hotkey → type "PAS-123" → enter → you're in a Claude session working the ticket.

## How It Works Today (wip CLI)

The existing flow is `wip _start_linear "PAS-123" "slug"` which:

- Reads Linear issue from `~/panop/.wip-linear` JSONL cache
- Writes a launcher script to `/tmp/wip-gwt-launch.sh`
- Runs `tmux new-window -n "slug" "zsh /tmp/wip-gwt-launch.sh"`
- The launcher calls `gwt` (a zsh function in ~/.zshrc) which: pulls main, creates worktree, creates PLAN.md, appends to work.txt
- Back in the caller: patches PLAN.md with Linear content, sets `linear_id` on the wip item
- Polls up to 30s for PLAN.md to appear (gwt creates it async in the tmux window)

## SwiftUI Implementation Approach

### Option A: Shell out to existing wip command (simplest)

```swift
// 1. User enters "PAS-123" in a text field / popover
// 2. App prompts for slug (or auto-generates from Linear title)
// 3. Shell out:
shell("wip _start_linear 'PAS-123' 'my-slug'")
// 4. After a short delay, send claude to the new window:
shell("/opt/homebrew/bin/tmux send-keys -t 'my-slug' 'claude' Enter")
// 5. Focus the tmux window:
shell("/opt/homebrew/bin/tmux select-window -t 'my-slug'")
```

Pros: Reuses all existing logic. No reimplementation.
Cons: Depends on `gwt` zsh function, the 30s poll for PLAN.md, and the tmp script dance.

### Option B: Reimplement in Swift (more control)

```swift
// 1. Read Linear issue from ~/panop/.wip-linear (JSONL, parse with JSONDecoder)
// 2. Compute branch name: "rk-\(datePrefix)-\(slug)"
// 3. Run git commands:
shell("cd ~/dev/passcom/hourly && git pull origin main && git worktree add ../\(branch)")
// 4. Create PLAN.md directly from Swift (Write file with Linear content)
// 5. Append JSON to ~/panop/passcom/work.txt
// 6. Set linear_id: shell("wip set '\(branch)' linear_id '\"PAS-123\"'")
// 7. tmux: new-window, send-keys cd + claude, select-window
```

Pros: No dependency on gwt function, no tmp script, no 30s poll.
Cons: Reimplements worktree creation logic. Must handle .env copies for hourly monorepo.

### Recommended: Option A first, Option B later

Option A gets us working in an hour. Option B is a refinement if the gwt dependency becomes a problem.

## UI Design

- **Trigger**: Cmd+L opens a floating input field (like Spotlight) or a sheet
- **Input**: Text field for "PAS-123". As you type, fuzzy-match against the Linear cache to show issue title
- **Slug**: Auto-generate from Linear title, editable. "Fix compensation gap" → "fix-compensation-gap"
- **Confirm**: Enter or "Start" button
- **Feedback**: Show progress ("Creating worktree...", "Starting Claude...", "Done")
- **Result**: The wip list auto-refreshes (1s poll) and the new item appears

## Dependencies

- Linear cache must be warm (`wip pull-linear` or `wip linear` to populate)
- tmux must be running (app detects via `/opt/homebrew/bin/tmux list-sessions`)
- `gwt` zsh function must be available (Option A only)
- `gh` CLI for PR creation later
- The hourly repo must be at `~/dev/passcom/hourly`

## Edge Cases

- Linear cache stale: offer to refresh (`wip pull-linear`)
- tmux not running: show error, suggest starting tmux
- Branch name collision: `git worktree add` will fail — detect and suggest alternative
- Already have a wip item for this Linear ID: show warning, offer to jump to existing
