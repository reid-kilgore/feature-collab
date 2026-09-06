# WIP Status Sync Gaps

**Date**: 2026-03-30
**Reporter**: Reid (via Nasqueron investigation)
**System**: `wip` CLI + Claude Code hooks (`on-prompt.sh`, `on-stop.sh`)

## Symptom

Items in Nasqueron show stale statuses. Example: `rk-0329-cards-api` shows ACTIVE but the session is idle/waiting for input. The user has to manually correct statuses.

## How Hooks Work Today

Two Claude Code hooks drive status updates:

- **`~/.claude/hooks/on-prompt.sh`** (UserPromptSubmit) — sets item to ACTIVE when user submits a prompt
- **`~/.claude/hooks/on-stop.sh`** (Stop) — sets item to WAITING when Claude stops and waits for input

Both hooks use **location matching**: they iterate `~/panop/*/work.txt`, extract each item's `.loc`, and match against `$CWD` with a prefix match (`case "$cwd" in "$loc"*`). Guards prevent overwriting `IN_REVIEW` or `RETRO`.

## Gaps

### 1. No status update without an active Claude session
Hooks only fire during Claude lifecycle events. If a user stops working on an item without Claude running in that directory, the item stays ACTIVE indefinitely. There is no background daemon, cron job, or polling mechanism to detect idle items.

### 2. Location mismatch silently skips updates
If Claude is invoked in a subdirectory that doesn't prefix-match any item's `loc`, or in a different worktree, the hook finds no matching item and exits silently. No warning is surfaced.

### 3. No git/PR-based status triggers
Pushing a branch, opening a PR, merging, or going stale does not update wip status. A natural flow like ACTIVE -> PUSHED -> IN_PR -> MERGED requires manual intervention or separate tooling.

### 4. No stale-item detection
Items can sit in ACTIVE for days without any session activity. There's no mechanism to auto-demote stale items (e.g., ACTIVE for >24h with no commits -> WAITING).

### 5. No bidirectional Linear sync
`wip pull-linear` imports Linear issues into wip, but wip status changes don't propagate back to Linear. Linear issue state (e.g., moved to "Done") doesn't update the local wip item either.

## Affected Files

| Component | Path |
|-----------|------|
| Stop hook | `~/.claude/hooks/on-stop.sh` |
| Prompt hook | `~/.claude/hooks/on-prompt.sh` |
| Hook config | `~/.claude/settings.json` |
| wip CLI | `~/bin/wip` (symlink to `~/dev/fun_claude/feature-collab/wip`) |

## Possible Directions

- **Lightweight cron** (e.g., every 5 min): check git last-commit age per item, demote ACTIVE -> WAITING if stale
- **Git post-push hook**: update status on push (ACTIVE -> PUSHED or similar)
- **PR webhook or polling**: check for open PRs on item branches, update status accordingly
- **Fallback in hooks**: log a warning when no item matches `$CWD`, so silent misses are visible
- **Nasqueron-side inference**: show an "inferred" status badge based on git state (last commit age, PR existence) alongside the stored status
