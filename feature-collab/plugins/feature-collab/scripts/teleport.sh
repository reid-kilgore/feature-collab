#!/usr/bin/env bash
# Teleport a project to a remote dev box via rsync + tmux + claude
# Usage: teleport.sh [--dry-run] <project_dir> <plugin_marketplace_dir> <remote_host>
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

PROJECT_DIR="${1:?Usage: teleport.sh [--dry-run] <project_dir> <plugin_marketplace_dir> <remote_host>}"
PLUGIN_DIR="${2:?Usage: teleport.sh [--dry-run] <project_dir> <plugin_marketplace_dir> <remote_host>}"
REMOTE_HOST="${3:?Usage: teleport.sh [--dry-run] <project_dir> <plugin_marketplace_dir> <remote_host>}"

# Validate REMOTE_HOST — must be a simple hostname/alias, not SSH options
if [[ ! "$REMOTE_HOST" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "ERROR: Invalid remote host '$REMOTE_HOST' — must be alphanumeric/dots/dashes only" >&2
  exit 1
fi

DIRNAME="$(basename "$PROJECT_DIR")"

# Shell-escape DIRNAME for safe embedding in remote shell strings
SAFE_DIRNAME="$(printf '%s' "$DIRNAME" | sed "s/'/'\\\\''/g")"

# Tildes expand on remote side via SSH, not locally
# shellcheck disable=SC2088
REMOTE_PROJECT="~/$SAFE_DIRNAME"
# shellcheck disable=SC2088
REMOTE_PLUGINS="~/.claude/plugins/marketplaces/feature-collab-marketplace/"
SSH_OPTS=(-o ConnectTimeout=5)

echo "=== Teleport: $DIRNAME -> $REMOTE_HOST ==="

# Step 1: Validate SSH connectivity (tunnel must be running)
echo ">> Checking SSH connectivity..."
if "$DRY_RUN"; then
  echo "[dry-run] ssh ${SSH_OPTS[*]} $REMOTE_HOST 'echo ok'"
else
  if ! ssh "${SSH_OPTS[@]}" -- "$REMOTE_HOST" 'echo ok' >/dev/null 2>&1; then
    echo "ERROR: SSH connection to $REMOTE_HOST failed." >&2
    echo "Is the tunnel running? Start it with:" >&2
    echo "  cd hourly/infrastructure && pnpm run remote:reid" >&2
    exit 1
  fi
fi
echo "   SSH OK"

# Step 2: Create remote directory
echo ">> Creating remote directory $REMOTE_PROJECT..."
if "$DRY_RUN"; then
  echo "[dry-run] ssh $REMOTE_HOST mkdir -p -- '$SAFE_DIRNAME'"
else
  ssh -- "$REMOTE_HOST" "mkdir -p -- '$SAFE_DIRNAME'"
fi

# Step 3: Rsync project (set +e to handle failure with custom exit code)
echo ">> Syncing project..."
if "$DRY_RUN"; then
  echo "[dry-run] rsync -az --exclude=... $PROJECT_DIR/ $REMOTE_HOST:$REMOTE_PROJECT/"
else
  set +e
  rsync -az \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    --exclude='.next' \
    --exclude='dist' \
    --exclude='.turbo' \
    --exclude='__pycache__' \
    "$PROJECT_DIR/" "$REMOTE_HOST:~/$DIRNAME/"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "ERROR: Project rsync failed (exit $rc)" >&2
    exit 2
  fi
fi
echo "   Project synced"

# Step 4: Rsync plugins
echo ">> Syncing plugins..."
if "$DRY_RUN"; then
  echo "[dry-run] rsync -az --exclude=... $PLUGIN_DIR/ $REMOTE_HOST:$REMOTE_PLUGINS"
else
  set +e
  rsync -az \
    --exclude='.DS_Store' \
    --exclude='.git' \
    --exclude='.claude/settings.local.json' \
    "$PLUGIN_DIR/" "$REMOTE_HOST:$REMOTE_PLUGINS"
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "ERROR: Plugin rsync failed (exit $rc)" >&2
    exit 3
  fi
fi
echo "   Plugins synced"

# Step 5: Create tmux window
echo ">> Creating tmux window '$DIRNAME'..."
if "$DRY_RUN"; then
  echo "[dry-run] ssh $REMOTE_HOST \"tmux new-window -t 0 -n '$SAFE_DIRNAME'\""
else
  if ! ssh -- "$REMOTE_HOST" "tmux new-window -t 0 -n '$SAFE_DIRNAME'" 2>/dev/null; then
    echo "ERROR: Failed to create tmux window (is tmux session 0 running?)" >&2
    exit 4
  fi
fi
echo "   Tmux window created"

# Step 6: Start claude in the tmux window
echo ">> Starting claude..."
if "$DRY_RUN"; then
  echo "[dry-run] ssh $REMOTE_HOST \"tmux send-keys -t '0:$SAFE_DIRNAME' 'cd ~/$SAFE_DIRNAME && claude' Enter\""
else
  ssh -- "$REMOTE_HOST" "tmux send-keys -t '0:$SAFE_DIRNAME' 'cd ~/$SAFE_DIRNAME && claude' Enter"
fi
echo "   Claude starting in tmux window '$DIRNAME'"

# Step 7: Handle trust prompt and send pickup command
# Claude shows a trust prompt for new directories. We need to accept it first.
echo ">> Waiting for claude to initialize (8s)..."
if "$DRY_RUN"; then
  echo "[dry-run] sleep 8"
  echo "[dry-run] check for trust prompt and accept if present"
  echo "[dry-run] ssh $REMOTE_HOST \"tmux send-keys -t '0:$SAFE_DIRNAME' '/feature-collab:pickup' Enter\""
else
  sleep 8
  # Check if trust prompt is showing and accept it
  PANE_CONTENT=$(ssh -- "$REMOTE_HOST" "tmux capture-pane -t '0:$SAFE_DIRNAME' -p" 2>/dev/null || true)
  if echo "$PANE_CONTENT" | grep -qF "Yes, I trust this folder"; then
    echo "   Trust prompt detected — accepting..."
    ssh -- "$REMOTE_HOST" "tmux send-keys -t '0:$SAFE_DIRNAME' Enter"
    sleep 3
  fi
  echo ">> Sending /feature-collab:pickup..."
  ssh -- "$REMOTE_HOST" "tmux send-keys -t '0:$SAFE_DIRNAME' '/feature-collab:pickup' Enter"
fi

echo ""
echo "=== Teleport complete ==="
echo "Remote dir:    $REMOTE_HOST:$REMOTE_PROJECT"
echo "Tmux window:   0:$DIRNAME"
echo "Status:        claude starting with /feature-collab:pickup"
