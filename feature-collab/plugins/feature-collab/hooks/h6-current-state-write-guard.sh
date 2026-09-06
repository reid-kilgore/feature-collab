#!/bin/bash
# H6: gate current_state writes in SESSION_STATE.md. Only transition-decider may write.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
target=$(echo "$event" | jq -r '.tool_input.file_path // ""')

[[ ! "$tool" =~ ^(Edit|Write)$ ]] && { echo '{"decision":"allow"}'; exit 0; }
[[ ! "$target" =~ SESSION_STATE\.md$ ]] && { echo '{"decision":"allow"}'; exit 0; }

new=$(echo "$event" | jq -r '.tool_input.new_string // .tool_input.content // ""')
old=$(echo "$event" | jq -r '.tool_input.old_string // ""')

if echo "$new"$'\n'"$old" | grep -qE '^[[:space:]]*current_state[[:space:]]*:'; then
  subagent=$(echo "$event" | jq -r '.agent_type // .tool_input.subagent_type // ""')
  agent_id="${CLAUDE_SUBAGENT_ID:-}"

  if [[ "$subagent" != *"transition-decider"* ]] && [[ "$agent_id" != *"transition-decider"* ]]; then
    echo '{"decision":"block","reason":"UNAUTHORIZED_STATE_FIELD_WRITE: only transition-decider may write current_state in SESSION_STATE.md."}' >&2
    exit 2
  fi
fi

echo '{"decision":"allow"}'
