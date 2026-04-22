#!/usr/bin/env bash
# Claude Code Stop hook — sets WAITING unconditionally (Claude can't act post-stop)
set -eo pipefail

WIP="$HOME/panop/wip"
[ -x "$WIP" ] || exit 0

input=$(cat) || exit 0
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null) || exit 0

[ -z "$cwd" ] && exit 0

# Always use $HOME/panop as the panop directory (ignore any inherited PANOP_DIR)
PANOP_DIR="$HOME/panop"
export PANOP_DIR

# --- Item lookup: cwd prefix match, then branch name fallback ---
item_name=""

for workfile in "$PANOP_DIR"/*/work.txt; do
  [ -f "$workfile" ] || continue
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    loc=$(echo "$line" | jq -r '.loc // empty' 2>/dev/null) || continue
    [ -z "$loc" ] && continue
    status=$(echo "$line" | jq -r '.status // empty' 2>/dev/null) || continue
    [ "$status" = "DONE" ] && continue
    case "$cwd" in
      "$loc"*) item_name=$(echo "$line" | jq -r '.name // empty' 2>/dev/null); break 2 ;;
    esac
  done < "$workfile"
done

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

# Unconditionally set WAITING (no guard for phase or status)
# Note: stderr flows through so deprecation notices (for legacy on-disk statuses) are visible
"$WIP" status "$item_name" WAITING >/dev/null || true

# Notifications now handled by Nasqueron app (status change detection)
