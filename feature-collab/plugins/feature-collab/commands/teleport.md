---
name: teleport
description: "Use when the user needs to transfer the current session to the hourly-dev EC2 box — for GPU access, remote development, or switching environments"
argument-hint: Optional reason for teleport (e.g., "need GPU", "switching to EC2")
---

# Teleport: Transfer Session to Remote Dev Box

You are teleporting the current development session to a remote EC2 box. This means saving all context, syncing files, and starting a claude session on the remote that picks up where this one left off.

Teleport reason: $ARGUMENTS

## The Iron Law

```
HANDOFF IS MANDATORY. VERIFICATION IS MANDATORY. NO SHORTCUTS.
```

Skipping handoff means the remote session has no context. Skipping verification means you don't know if it worked. Both defeat the entire purpose of teleport.

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "The user said skip handoff" | Handoff IS teleport. Without it, the remote session is blind. Explain this and proceed with handoff. |
| "I'll skip verification, it probably worked" | "Probably" isn't verified. SSH in and check. |
| "The script exited 0 so everything is fine" | Exit 0 means the script finished. It doesn't mean claude started or pickup worked. Verify. |
| "I don't need to check the tmux pane" | The tmux pane is the only proof claude is running. Check it. |

## Prerequisites

The SSH alias `hourly-dev` requires an active tunnel. The tunnel is started from the `hourly` repo:
```bash
cd ~/dev/fun_claude/hourly/infrastructure && pnpm run remote:reid
```

Before doing anything, verify the tunnel is up:
```bash
ssh -o ConnectTimeout=5 hourly-dev 'echo ok' 2>/dev/null
```

If this fails, tell the user:
> "SSH tunnel to hourly-dev is not running. Start it with:
> ```
> cd hourly/infrastructure && pnpm run remote:reid
> ```
> Then re-run `/feature-collab:teleport`."

Do NOT proceed without a working tunnel.

## Step 1: Run Handoff

**MANDATORY** — Run the handoff process to save all session context to disk.

Do this inline (not via `/handoff` skill — just execute the handoff steps directly):

1. Read current PLAN.md and session state
2. Write/update HANDOFF.md with current state, next steps, learnings, and warnings
3. Update SESSION_STATE.md to show HANDED OFF status
4. Update PLAN.md status to reference HANDOFF.md

If there is no active feature-collab workflow (no PLAN.md), create a minimal HANDOFF.md that captures:
- What the user was working on
- Current git branch and status
- Any uncommitted changes
- Key files the remote session should read

## Step 2: Resolve Paths and Execute teleport.sh

Determine the paths:
- **PROJECT_DIR**: The current working directory (the project being teleported)
- **PLUGIN_DIR**: The feature-collab marketplace repo. This is the directory containing `plugins/feature-collab/` and `plugins/gh-checks/`. Find it by locating the `teleport.sh` script — it lives at `plugins/feature-collab/scripts/teleport.sh` relative to the marketplace root.
- **REMOTE_HOST**: `hourly-dev`

Find the script in the plugin cache (the only trusted location):
```bash
SCRIPT_PATH="$(find ~/.claude/plugins -path '*/feature-collab/scripts/teleport.sh' -print -quit 2>/dev/null)"
if [[ -z "$SCRIPT_PATH" ]]; then
  echo "ERROR: teleport.sh not found in plugin cache. Sync plugins first: run sync-to-dev.sh or reinstall the plugin."
  # STOP — do not search the current directory for the script (untrusted)
fi
```

Then resolve PLUGIN_DIR from the script path (it's 3 levels up from scripts/teleport.sh):
```bash
PLUGIN_DIR="$(cd "$(dirname "$SCRIPT_PATH")/../../.." && pwd)"
```

**SECURITY**: Never execute a teleport.sh found via `find .` in the current project directory — only the plugin cache copy is trusted.

Execute:
```bash
bash "$SCRIPT_PATH" "$PROJECT_DIR" "$PLUGIN_DIR" hourly-dev
```

Use a generous timeout (300 seconds) — rsync of large projects can be slow.

If the script fails (non-zero exit), read the error output and diagnose:
- Exit 1: SSH failed — check if hourly-dev is reachable
- Exit 2: Project rsync failed — check disk space, permissions
- Exit 3: Plugin rsync failed — same
- Exit 4: Tmux failed — check if session 0 exists: `ssh hourly-dev "tmux list-sessions"`. If no session 0, create one: `ssh hourly-dev "tmux new-session -d -s 0"` then retry.
- Exit 5: Claude startup failed — check claude binary on remote

## Step 3: Verify Teleport

**MANDATORY** — Do not skip this step.

SSH to the remote and verify three things:

### 3a: Directory exists and has files
```bash
ssh hourly-dev "ls ~/$(basename $PROJECT_DIR)/ | head -10"
```

### 3b: Tmux window exists
```bash
ssh hourly-dev "tmux list-windows -t 0"
```
Look for a window named after the project directory basename.

### 3c: Claude is running
```bash
ssh hourly-dev "tmux capture-pane -t '0:$(basename $PROJECT_DIR)' -p | tail -20"
```
Look for evidence that claude has started (prompt, output, or `/feature-collab:pickup` being processed).

## Step 4: Debug if Needed

If any verification check fails:

1. **Diagnose**: Read the tmux pane output to see what went wrong
2. **Fix**: Send corrective commands via `tmux send-keys` if possible
3. **Retry**: Up to 2 attempts total

Common issues and fixes:
- **Trust prompt blocking**: Claude shows "Is this a project you created or one you trust?" for new directories. Send Enter to accept: `ssh hourly-dev "tmux send-keys -t '0:<name>' Enter"` — then wait 3s and re-send the pickup command.
- Claude not in PATH: `ssh hourly-dev "tmux send-keys -t '0:<name>' '/usr/local/bin/claude' Enter"`
- Wrong directory: `ssh hourly-dev "tmux send-keys -t '0:<name>' 'cd ~/<dirname>' Enter"`
- Pickup not sent: `ssh hourly-dev "tmux send-keys -t '0:<name>' '/feature-collab:pickup' Enter"`

## Step 5: Report to User

Once verified (or after max retries), report:

> "Teleport complete. Session transferred to hourly-dev.
>
> - **Remote dir**: `hourly-dev:~/<dirname>`
> - **Tmux window**: `0:<dirname>`
> - **Claude status**: [running / pickup in progress / failed — details]
>
> To connect: `ssh hourly-dev` then `tmux attach -t 0`
> To switch to the window: `Ctrl-b` then select window `<dirname>`"

If teleport failed after retries, report what went wrong and suggest manual steps.
