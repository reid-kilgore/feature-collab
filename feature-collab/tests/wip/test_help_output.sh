#!/usr/bin/env bash
# Category C — Unit: Help Output
# Tests C01–C09
# No set -e: test runner must continue even when wip invocations fail.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_helpers.sh
source "$SCRIPT_DIR/_helpers.sh"

echo "=== Category C: Help Output ==="
echo

# Capture help output once for reuse across checks
HELP_STDOUT=$("$WIP" --help 2>/dev/null) || true
HELP_STDOUT_PLAIN=$("$WIP" help 2>/dev/null) || true

# ── C01: wip --help exits 0 ───────────────────────────────────────────────────
echo "--- C01: wip --help exits 0 ---"
actual_exit=0
"$WIP" --help >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: C01 wip --help exits 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C01 wip --help exits $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi

# ── C02: stdout contains NOT_STARTED ─────────────────────────────────────────
echo "--- C02: stdout contains NOT_STARTED ---"
if echo "$HELP_STDOUT" | grep -q "NOT_STARTED"; then
  echo "  PASS: C02 stdout contains NOT_STARTED"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C02 stdout does not contain NOT_STARTED"
  FAIL=$((FAIL + 1))
fi

# ── C03: stdout contains WORKING ─────────────────────────────────────────────
echo "--- C03: stdout contains WORKING ---"
if echo "$HELP_STDOUT" | grep -q "WORKING"; then
  echo "  PASS: C03 stdout contains WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C03 stdout does not contain WORKING"
  FAIL=$((FAIL + 1))
fi

# ── C04: stdout contains WAITING ─────────────────────────────────────────────
echo "--- C04: stdout contains WAITING ---"
if echo "$HELP_STDOUT" | grep -q "WAITING"; then
  echo "  PASS: C04 stdout contains WAITING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C04 stdout does not contain WAITING"
  FAIL=$((FAIL + 1))
fi

# ── C05: stdout contains DONE ────────────────────────────────────────────────
echo "--- C05: stdout contains DONE ---"
if echo "$HELP_STDOUT" | grep -q "DONE"; then
  echo "  PASS: C05 stdout contains DONE"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C05 stdout does not contain DONE"
  FAIL=$((FAIL + 1))
fi

# ── C06: stdout contains "wip phase" in USAGE-style context ──────────────────
echo "--- C06: stdout contains 'wip phase' ---"
if echo "$HELP_STDOUT" | grep -q "wip phase"; then
  echo "  PASS: C06 stdout contains 'wip phase'"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C06 stdout does not contain 'wip phase'"
  FAIL=$((FAIL + 1))
fi

# ── C07: "wip children" not in main USAGE block ──────────────────────────────
# Contract: may appear in ADVANCED section, but not the main USAGE block.
# We check that if it appears at all, it is preceded by ADVANCED (case-insensitive).
echo "--- C07: wip children not in main USAGE block ---"
# Strategy: extract only lines before "ADVANCED" and check those don't contain "wip children"
main_block=$(echo "$HELP_STDOUT" | awk '/[Aa][Dd][Vv][Aa][Nn][Cc][Ee][Dd]/{exit} {print}')
if echo "$main_block" | grep -q "wip children"; then
  echo "  FAIL: C07 'wip children' found in main USAGE block (before ADVANCED section)"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: C07 'wip children' not in main USAGE block"
  PASS=$((PASS + 1))
fi

# ── C08: stdout contains DEPRECATED or deprecated ────────────────────────────
echo "--- C08: stdout documents deprecated aliases ---"
if echo "$HELP_STDOUT" | grep -qi "deprecated"; then
  echo "  PASS: C08 stdout mentions DEPRECATED/deprecated"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C08 stdout does not mention DEPRECATED or deprecated"
  FAIL=$((FAIL + 1))
fi

# ── C09: "wip help" exits 0 and produces same output ─────────────────────────
echo "--- C09: wip help (no dashes) exits 0 and matches --help output ---"
actual_exit=0
"$WIP" help >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: C09 wip help exits 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C09 wip help exits $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
if [[ "$HELP_STDOUT_PLAIN" == "$HELP_STDOUT" ]]; then
  echo "  PASS: C09 wip help output matches wip --help output"
  PASS=$((PASS + 1))
else
  echo "  FAIL: C09 wip help output differs from wip --help output"
  FAIL=$((FAIL + 1))
fi

summary_and_exit "test_help_output.sh"
