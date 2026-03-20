#!/usr/bin/env bash
# Tests for wip autopilot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIP="$SCRIPT_DIR/../../wip"
PASS=0
FAIL=0

assert() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

assert_grep() {
  local name="$1" pattern="$2" file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_grep() {
  local name="$1" pattern="$2" file="$3"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== wip autopilot tests ==="
echo

echo "--- T1: Syntax check ---"
assert "bash -n wip" bash -n "$WIP"

echo "--- T2: Dispatch recognized ---"
output=$("$WIP" autopilot --dry-run --once 2>&1) || true
if [[ "$output" != *"Unknown command"* ]]; then
  echo "  PASS: autopilot dispatches correctly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: autopilot not recognized"
  FAIL=$((FAIL + 1))
fi

echo "--- T3: Dry-run exercises triage ---"
if [[ "$output" == *"triage"* ]] || [[ "$output" == *"Triage"* ]] || [[ "$output" == *"TRIAGE"* ]] || [[ "$output" == *"classification"* ]]; then
  echo "  PASS: dry-run reaches triage"
  PASS=$((PASS + 1))
else
  echo "  FAIL: dry-run does not reach triage"
  FAIL=$((FAIL + 1))
fi

echo "--- T4: Prompt files exist ---"
PROMPT_DIR="$SCRIPT_DIR/../../plugins/feature-collab/prompts/autopilot"
assert "triage.md exists" test -f "$PROMPT_DIR/triage.md"
assert "execute.md exists" test -f "$PROMPT_DIR/execute.md"
assert "decompose.md exists" test -f "$PROMPT_DIR/decompose.md"

echo "--- T5: Prompt safety rules ---"
assert_grep "triage has NEEDS_HUMAN" "NEEDS_HUMAN" "$PROMPT_DIR/triage.md"
assert_grep "execute has BLOCKED" "BLOCKED" "$PROMPT_DIR/execute.md"
assert_grep "decompose has sensitive sub-tasks" "Sensitive sub-tasks" "$PROMPT_DIR/decompose.md"

echo "--- T6: Security filters ---"
assert_grep "creator isMe filter" "isMe" "$WIP"
assert_grep "max-budget-usd guard" "max-budget-usd" "$WIP"

echo "--- T7: Bash 3 compatibility ---"
assert_not_grep "no declare -A" "declare -A" "$WIP"

echo "--- T8: No timeout command ---"
# Check only the autopilot section for 'timeout' as a command
autopilot_section=$(sed -n '/# ── autopilot/,/# ── dispatch/p' "$WIP")
if echo "$autopilot_section" | grep -q '^[[:space:]]*timeout '; then
  echo "  FAIL: timeout command found in autopilot section"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: no timeout command"
  PASS=$((PASS + 1))
fi

echo "--- T9: Lock helpers exist ---"
assert "_lock_workfile exists" grep -q '_lock_workfile' "$WIP"
assert "_unlock_workfile exists" grep -q '_unlock_workfile' "$WIP"

echo "--- T10: _update_line uses locking ---"
# Extract _update_line function body and check for lock call
assert "_update_line uses locking" bash -c "sed -n '/_update_line()/,/^}/p' '$WIP' | grep -q '_lock_workfile'"

echo "--- T11: Lock uses mkdir (not flock) ---"
assert "lock uses mkdir not flock" bash -c "sed -n '/_lock_workfile()/,/^}/p' '$WIP' | grep -q 'mkdir'"

echo "--- T12: Stale lock cleanup ---"
assert "stale lock has PID check" bash -c "sed -n '/_lock_workfile()/,/^}/p' '$WIP' | grep -q 'kill -0'"

echo "--- T13: --triage-all --save flag recognized ---"
# This needs dry-run to avoid hitting Linear API. Just check it doesn't say "Unknown argument"
assert "--save flag recognized" bash -c "$WIP autopilot --triage-all --save /tmp/wip-test-triage.jsonl 2>&1 | grep -qv 'Unknown argument'"

echo "--- T14: triage-score dispatch recognized ---"
assert "triage-score dispatches" bash -c "$WIP triage-score /dev/null 2>&1 | grep -qv 'Unknown command'"

echo "--- T15: Lock cleanup on deletion paths ---"
# Check that the inline awk deletion blocks in cmd_status also use locking
assert "deletion paths use locking" bash -c "grep -c '_lock_workfile\|_unlock_workfile' '$WIP' | awk '{exit (\$1 >= 4 ? 0 : 1)}'"

echo
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
