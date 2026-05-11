#!/bin/bash
# H1: refuses Edit/Write/git-commit from main thread when feature-collab workflow is active.
# Active = SESSION_STATE.md present in cwd or any parent dir up to 5 levels.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
cmd=$(echo "$event" | jq -r '.tool_input.command // ""')
agent_id="${CLAUDE_SUBAGENT_ID:-}"

# Scope: only fire if feature-collab is active (SESSION_STATE.md in cwd or parent)
dir="$PWD"
found=0
for _ in 1 2 3 4 5; do
  if [[ -f "$dir/SESSION_STATE.md" ]]; then
    found=1
    break
  fi
  parent="$(dirname "$dir")"
  [[ "$parent" == "$dir" ]] && break
  dir="$parent"
done
[[ "$found" -eq 0 ]] && { echo '{"decision":"allow"}'; exit 0; }

# Subagent calls are allowed
[[ -n "$agent_id" ]] && { echo '{"decision":"allow"}'; exit 0; }

# Main thread: refuse Edit, Write, and Bash(git commit)
if [[ "$tool" =~ ^(Edit|Write)$ ]] || [[ "$cmd" =~ git[[:space:]]+commit ]]; then
  echo '{"decision":"block","reason":"MAIN_THREAD_EDIT_OR_COMMIT: feature-collab workflow active; dispatch a subagent."}' >&2
  exit 2
fi

echo '{"decision":"allow"}'
