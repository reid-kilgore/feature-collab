#!/usr/bin/env bash
# Top-level wip test runner.
# Executes every test_*.sh in this directory, aggregates results, reports summary.
#
# I04/I06 gate: before running tests, verifies that each category A–I has at
# least one matching test file. Exits non-zero with a clear message if any
# category has 0 files.
#
# Category mapping (case-insensitive filename match):
#   A = status_normalization
#   B = phase_validation
#   C = help_output
#   D = integration  (was e2e_flows)
#   E = compat_read  (data_at_rest)
#   F = deprecation
#   G = hook_on_stop
#   H = hook_on_prompt
#   I = infrastructure  (guard_removed)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TOTAL_PASS=0
TOTAL_FAIL=0
FILES_RUN=0
GATE_FAIL=0

# ── Category gate ─────────────────────────────────────────────────────────────
# _cat_keyword <letter> — echoes the keyword(s) for that category letter
_cat_keyword() {
  case "$1" in
    A) echo "status_normalization" ;;
    B) echo "phase_validation" ;;
    C) echo "help_output" ;;
    D) echo "integration" ;;
    E) echo "data_at_rest" ;;
    F) echo "deprecation" ;;
    G) echo "on_stop" ;;
    H) echo "on_prompt" ;;
    I) echo "infrastructure guard_removed" ;;
    *) echo "" ;;
  esac
}

echo "=== wip test suite — category gate check ==="
echo

for letter in A B C D E F G H I; do
  keywords="$(_cat_keyword "$letter")"
  found=0
  for kw in $keywords; do
    count=$(ls "$SCRIPT_DIR"/test_*"${kw}"*.sh 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 0 ]]; then
      found=1
      break
    fi
  done
  if [[ "$found" -eq 0 ]]; then
    echo "  GATE FAIL: Category $letter has 0 files (expected keyword(s): $keywords)"
    GATE_FAIL=$((GATE_FAIL + 1))
  else
    echo "  GATE OK:   Category $letter"
  fi
done

echo

if [[ "$GATE_FAIL" -gt 0 ]]; then
  echo "ERROR: $GATE_FAIL category/categories have 0 test files — aborting."
  echo "Add the missing test_*.sh files before running the suite."
  exit 1
fi

echo "All categories present. Running tests..."
echo

# ── Per-file execution ────────────────────────────────────────────────────────

for test_file in "$SCRIPT_DIR"/test_*.sh; do
  [[ -f "$test_file" ]] || continue
  name="$(basename "$test_file")"
  echo "--- Running: $name ---"

  # Run in a subshell; capture exit code without aborting the runner.
  file_pass=0
  file_fail=0
  set +e
  output=$(bash "$test_file" 2>&1)
  exit_code=$?
  set -e

  echo "$output"

  # Extract per-file pass/fail counts from summary line produced by summary_and_exit.
  # Expected format: "=== Results (...): N passed, M failed ==="
  if echo "$output" | grep -qE 'Results.*: [0-9]+ passed, [0-9]+ failed'; then
    file_pass=$(echo "$output" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | tail -1)
    file_fail=$(echo "$output" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' | tail -1)
  elif [[ "$exit_code" -eq 0 ]]; then
    # No summary line but exited 0 — count as 1 pass
    file_pass=1
    file_fail=0
  else
    # No summary line and non-zero exit — count as 1 fail
    file_pass=0
    file_fail=1
  fi

  TOTAL_PASS=$((TOTAL_PASS + ${file_pass:-0}))
  TOTAL_FAIL=$((TOTAL_FAIL + ${file_fail:-0}))
  FILES_RUN=$((FILES_RUN + 1))

  if [[ "$exit_code" -eq 0 ]]; then
    echo "  -> $name: PASSED"
  else
    echo "  -> $name: FAILED (exit $exit_code)"
  fi
  echo
done

# ── Aggregate summary ─────────────────────────────────────────────────────────

echo "============================================"
echo "  Files run : $FILES_RUN"
echo "  Total PASS: $TOTAL_PASS"
echo "  Total FAIL: $TOTAL_FAIL"
echo "============================================"

[[ "$TOTAL_FAIL" -eq 0 ]] && exit 0 || exit 1
