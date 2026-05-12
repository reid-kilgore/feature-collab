#!/bin/bash
# H-test-spec-commit-lock: refuses transition into IMPLEMENTATION unless TEST_SPEC.md is committed.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
target=$(echo "$event" | jq -r '.tool_input.file_path // ""')

[[ ! "$tool" =~ ^(Edit|Write)$ ]] && { echo '{"decision":"allow"}'; exit 0; }
[[ ! "$target" =~ SESSION_STATE\.md$ ]] && { echo '{"decision":"allow"}'; exit 0; }

new=$(echo "$event" | jq -r '.tool_input.new_string // .tool_input.content // ""')

if echo "$new" | grep -qE '^[[:space:]]*current_state[[:space:]]*:[[:space:]]*IMPLEMENTATION'; then
  if ! git ls-files --error-unmatch TEST_SPEC.md > /dev/null 2>&1; then
    echo '{"decision":"block","reason":"TEST_SPEC_NOT_COMMITTED: TEST_SPEC.md is not tracked in git. Commit it before entering IMPLEMENTATION."}' >&2
    exit 2
  fi
  if ! git diff --quiet HEAD TEST_SPEC.md 2>/dev/null; then
    echo '{"decision":"block","reason":"TEST_SPEC_NOT_COMMITTED: TEST_SPEC.md has uncommitted changes. Commit them before entering IMPLEMENTATION."}' >&2
    exit 2
  fi
fi

echo '{"decision":"allow"}'
