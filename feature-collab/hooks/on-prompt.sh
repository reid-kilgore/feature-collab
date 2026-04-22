#!/usr/bin/env bash
# Claude Code UserPromptSubmit hook — injects wip context so Claude can update status
set -eo pipefail

WIP="$HOME/panop/wip"
[ -x "$WIP" ] || exit 0

input=$(cat) || exit 0
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null) || exit 0

[ -z "$cwd" ] && exit 0

# Always use $HOME/panop as the panop directory (ignore any inherited PANOP_DIR)
PANOP_DIR="$HOME/panop"
export PANOP_DIR

# --- Item lookup: try cwd prefix match first, then branch name fallback ---
item_name=""

# Strategy 1: cwd prefix match against item .loc
for workfile in "$PANOP_DIR"/*/work.txt; do
  [ -f "$workfile" ] || continue
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    loc=$(echo "$line" | jq -r '.loc // empty' 2>/dev/null) || continue
    [ -z "$loc" ] && continue
    status=$(echo "$line" | jq -r '.status // empty' 2>/dev/null) || continue
    [ "$status" = "CLOSED" ] || [ "$status" = "DONE" ] && continue
    case "$cwd" in
      "$loc"*) item_name=$(echo "$line" | jq -r '.name // empty' 2>/dev/null); break 2 ;;
    esac
  done < "$workfile"
done

# Strategy 2: match current git branch against item branch names
if [ -z "$item_name" ]; then
  branch=$(git -C "$cwd" branch --show-current 2>/dev/null) || true
  if [ -n "$branch" ]; then
    item_json=$("$WIP" get "$branch" 2>/dev/null) || true
    if [ -n "$item_json" ]; then
      item_name=$(echo "$item_json" | jq -r '.name // empty' 2>/dev/null) || true
    fi
  fi
fi

[ -z "$item_name" ] && exit 0

# Fetch current item state
item_json=$(WIP_SILENT_DEPRECATION=1 "$WIP" get "$item_name" 2>/dev/null) || exit 0
raw_status=$(echo "$item_json" | jq -r '.status // "unknown"' 2>/dev/null)
current_phase=$(echo "$item_json" | jq -r '.phase // empty' 2>/dev/null)

# Normalize legacy status to canonical for display
case "$raw_status" in
  NEW)        current_status="NOT_STARTED" ;;
  ACTIVE)     current_status="WORKING" ;;
  BLOCKED)    current_status="WAITING" ;;
  NEEDS_INPUT) current_status="WAITING" ;;
  IN_REVIEW)  current_status="WORKING" ;;
  RETRO)      current_status="WORKING" ;;
  CLOSED)     current_status="DONE" ;;
  "")         current_status="NOT_STARTED" ;;
  *)          current_status="$raw_status" ;;
esac

# Build phase string for context line
phase_info=""
if [ -n "$current_phase" ]; then
  phase_info=" | Phase: $current_phase"
fi

# Output context for Claude (stdout is injected into conversation)
cat <<EOF
[wip] Item: $item_name | Status: $current_status${phase_info}
If your work changes the state of this item (starting work, finishing a phase, completing a task, creating a branch), update wip accordingly:
  wip status $item_name <STATUS>    — set status (WORKING, WAITING, DONE, NOT_STARTED)
  wip phase $item_name "<text>"     — set phase string (<=15 chars)
  wip note $item_name "<text>"      — record progress
  wip add-branch $item_name <branch> — track a new branch
EOF
