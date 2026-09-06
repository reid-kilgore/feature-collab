#!/bin/bash
# H1: refuses Edit/Write/git-commit from main thread when feature-collab workflow active.
# Active = SESSION_STATE.md present in cwd or any parent dir up to 5 levels.
#
# Subagent detection: Claude Code >= 2.1 does NOT export CLAUDE_SUBAGENT_ID into the
# subagent process env. It DOES deliver the spawned agent's id/type in the PreToolUse
# stdin payload (.agent_id / .agent_type). Main-thread tool calls have neither field.
# We read .agent_id from the event (legacy env var kept as fallback). This preserves
# the original intent exactly: subagent allowed, main thread blocked.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
cmd=$(echo "$event" | jq -r '.tool_input.command // ""')
agent_id=$(echo "$event" | jq -r '.agent_id // ""')
[[ -z "$agent_id" ]] && agent_id="${CLAUDE_SUBAGENT_ID:-}"

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

[[ -n "$agent_id" ]] && { echo '{"decision":"allow"}'; exit 0; }

if [[ "$tool" =~ ^(Edit|Write)$ ]] || [[ "$cmd" =~ git[[:space:]]+commit ]]; then
  echo '{"decision":"block","reason":"MAIN_THREAD_EDIT_OR_COMMIT: feature-collab workflow active; dispatch a subagent."}' >&2
  exit 2
fi

echo '{"decision":"allow"}'
