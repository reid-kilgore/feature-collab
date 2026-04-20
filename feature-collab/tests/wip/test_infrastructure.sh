#!/usr/bin/env bash
# Category I — Removed Guard: static analysis tests.
# These tests verify by grep that legacy guard logic has been removed
# and that the new canonical status (NEEDS_INPUT) is present.
# No subprocess wip invocations needed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_helpers.sh
source "$SCRIPT_DIR/_helpers.sh"

WIP="$SCRIPT_DIR/../../wip"
ON_STOP="$HOME/.claude/hooks/on-stop.sh"
RUN_TESTS="$SCRIPT_DIR/run_tests.sh"

echo "=== Category I: Removed Guard (static analysis) ==="
echo

echo "--- I01: _is_agent_managed_status absent from wip ---"
assert_not_grep \
  "I01: _is_agent_managed_status not present in wip" \
  "_is_agent_managed_status" \
  "$WIP"

echo "--- I02: on-stop.sh has no IN_REVIEW conditional logic ---"
assert_not_grep \
  "I02: IN_REVIEW not present in on-stop.sh" \
  "IN_REVIEW" \
  "$ON_STOP"

echo "--- I03: on-stop.sh has no RETRO conditional logic ---"
assert_not_grep \
  "I03: RETRO not present in on-stop.sh" \
  "RETRO" \
  "$ON_STOP"

echo "--- I04: on-stop.sh sets NEEDS_INPUT (not WAITING) ---"
assert_grep \
  "I04: NEEDS_INPUT present in on-stop.sh" \
  "NEEDS_INPUT" \
  "$ON_STOP"

echo "--- I05: wip script has no call site for _is_agent_managed_status ---"
# Redundant with I01 but TEST_SPEC.md lists both separately — each row gets a test.
# I01 checks for the definition; I05 checks for any call site (including comments).
# We use grep -c and assert it equals 0.
assert \
  "I05: zero call sites for _is_agent_managed_status in wip" \
  bash -c "[ \"\$(grep -c '_is_agent_managed_status' '$WIP')\" -eq 0 ]"

echo "--- I06: run_tests.sh enforces 0-files-per-category gate ---"
# Verify the runner file exists and contains the gate logic.
assert \
  "I06: run_tests.sh exists" \
  test -f "$RUN_TESTS"

assert_grep \
  "I06: run_tests.sh contains category-gate logic (references category letters)" \
  "0 files" \
  "$RUN_TESTS"

echo
summary_and_exit "test_infrastructure.sh"
