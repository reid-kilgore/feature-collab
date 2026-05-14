#!/bin/bash
# H5: post-Agent skip detector. Warns when output contains skip-without-escalate patterns.
# PostToolUse: empty stdout = no action. stderr + exit 2 feeds warning back to Claude.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
[[ "$tool" != "Agent" ]] && exit 0

output=$(echo "$event" | jq -r '.tool_response.output // ""')

if echo "$output" | grep -qiE 'skipped because|skipping (this|that)|n/a — moved on|moved on without' &&
   ! echo "$output" | grep -qiE 'escalating:|flagging:|cannot proceed:|asking user:|needs decision:'; then
  echo "AGENT_GRACEFUL_SKIP_INSTEAD_OF_ESCALATE: agent skipped without escalation note. Anti-pattern rule 4." >&2
  exit 2
fi

exit 0
