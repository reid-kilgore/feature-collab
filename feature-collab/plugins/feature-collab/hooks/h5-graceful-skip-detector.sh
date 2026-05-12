#!/bin/bash
# H5: post-Agent skip detector. Warns when output contains skip-without-escalate patterns.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
[[ "$tool" != "Agent" ]] && { echo '{"decision":"allow"}'; exit 0; }

output=$(echo "$event" | jq -r '.tool_response.output // ""')

if echo "$output" | grep -qiE 'skipped because|skipping (this|that)|n/a — moved on|moved on without' &&
   ! echo "$output" | grep -qiE 'escalating:|flagging:|cannot proceed:|asking user:|needs decision:'; then
  echo '{"decision":"warn","reason":"AGENT_GRACEFUL_SKIP_INSTEAD_OF_ESCALATE: agent skipped without escalation note. Anti-pattern rule 4."}' >&2
fi

echo '{"decision":"allow"}'
