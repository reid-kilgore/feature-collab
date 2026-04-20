#!/usr/bin/env bash
# Category B — Unit: Phase Validation
# Tests B01–B13
# No set -e: test runner must continue even when wip invocations fail.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_helpers.sh
source "$SCRIPT_DIR/_helpers.sh"

echo "=== Category B: Phase Validation ==="
echo

# ── B01: 3-char phase → exit 0, stored correctly ─────────────────────────────
echo "--- B01: 3-char phase accepted ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "abc" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B01 exit 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B01 exit $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored" == "abc" ]]; then
  echo "  PASS: B01 phase stored = abc"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B01 phase stored = '$stored' (expected abc)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B02: exactly 15 chars → exit 0, phase stored ────────────────────────────
echo "--- B02: 15-char phase accepted ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "123456789012345" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B02 exit 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B02 exit $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored" == "123456789012345" ]]; then
  echo "  PASS: B02 phase stored correctly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B02 phase stored = '$stored' (expected 123456789012345)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B03: 16 chars → exit 2, stderr mentions length ───────────────────────────
echo "--- B03: 16-char phase rejected with exit 2 ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "1234567890123456" >/dev/null 2>/tmp/wip-b03-stderr.txt || actual_exit=$?
if [[ "$actual_exit" -eq 2 ]]; then
  echo "  PASS: B03 exit 2"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B03 exit $actual_exit (expected 2)"
  FAIL=$((FAIL + 1))
fi
# stderr must say "phase must be ≤15 chars (got 16)"
assert "B03 stderr mentions ≤15 chars" grep -q "15" /tmp/wip-b03-stderr.txt
assert "B03 stderr mentions got 16" grep -q "16" /tmp/wip-b03-stderr.txt
cleanup

# ── B04: empty string → exit 0, phase key absent ─────────────────────────────
echo "--- B04: empty string clears phase ---"
new_panop_dir
setup_item "item"
# First set a phase
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "somevalue" >/dev/null 2>&1 || true
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B04 exit 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B04 exit $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
has_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq 'has("phase")')
if [[ "$has_phase" == "false" ]] || [[ "$has_phase" == "null" ]]; then
  echo "  PASS: B04 phase key absent after clear"
  PASS=$((PASS + 1))
else
  # Also accept null value
  phase_val=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // "null"')
  if [[ "$phase_val" == "null" ]] || [[ -z "$phase_val" ]]; then
    echo "  PASS: B04 phase is null/empty after clear"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: B04 phase = '$phase_val' (expected absent/null)"
    FAIL=$((FAIL + 1))
  fi
fi
cleanup

# ── B05: no text arg → exit 0, prints current phase to stdout ────────────────
echo "--- B05: no text arg prints current phase ---"
new_panop_dir
setup_item "item"
actual_exit=0
stdout_out=$(PANOP_DIR="$PANOP_DIR" "$WIP" phase item 2>/dev/null) || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B05 exit 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B05 exit $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
# stdout should be empty string when phase is unset (or just a newline)
if [[ -z "$stdout_out" ]] || [[ "$stdout_out" == "" ]]; then
  echo "  PASS: B05 stdout is empty when phase unset"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B05 stdout = '$stdout_out' (expected empty)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B06: set then read back ───────────────────────────────────────────────────
echo "--- B06: set phase then read back via wip phase <item> ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "Phase 2: Impl" >/dev/null 2>&1 || true
stdout_out=$(PANOP_DIR="$PANOP_DIR" "$WIP" phase item 2>/dev/null) || true
if [[ "$stdout_out" == "Phase 2: Impl" ]]; then
  echo "  PASS: B06 round-trip = 'Phase 2: Impl'"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B06 round-trip = '$stdout_out' (expected 'Phase 2: Impl')"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B07: Unicode chars counted as chars not bytes ────────────────────────────
echo "--- B07: 4 Unicode chars (café) accepted (char count not byte count) ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "café" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B07 exit 0 (4 chars accepted)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B07 exit $actual_exit (expected 0 — 4 Unicode chars should be accepted)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B08: 16 chars (common real-world mistake) → exit 2 ───────────────────────
echo "--- B08: 'Phase 1: Scoping' (16 chars) rejected ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "Phase 1: Scoping" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 2 ]]; then
  echo "  PASS: B08 exit 2 (16 chars rejected)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B08 exit $actual_exit (expected 2)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B09: set phase, clear with "", key absent from JSON ──────────────────────
echo "--- B09: set then clear; phase key absent after clear ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "Review" >/dev/null 2>&1 || true
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "" >/dev/null 2>&1 || true
has_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq 'has("phase")')
if [[ "$has_phase" == "false" ]]; then
  echo "  PASS: B09 phase key absent after clear"
  PASS=$((PASS + 1))
else
  phase_val=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // "null"')
  if [[ "$phase_val" == "null" ]] || [[ -z "$phase_val" ]]; then
    echo "  PASS: B09 phase is null/empty after clear"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: B09 phase = '$phase_val' after clear (expected absent)"
    FAIL=$((FAIL + 1))
  fi
fi
cleanup

# ── B10: shell metachar '$HOME' stored literally ─────────────────────────────
echo "--- B10: literal \$HOME stored and read back as literal ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" phase item '$HOME' >/dev/null 2>&1 || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored" == '$HOME' ]]; then
  echo "  PASS: B10 literal \$HOME stored and read back"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B10 stored = '$stored' (expected literal \$HOME)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B11: whitespace preserved exactly ────────────────────────────────────────
# PLAN.md says "preserve exactly as written (no trim)".  We pin this behavior.
echo "--- B11: leading/trailing spaces preserved exactly ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "  Review  " >/dev/null 2>&1 || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored" == "  Review  " ]]; then
  echo "  PASS: B11 whitespace preserved exactly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B11 stored = '$stored' (expected '  Review  ' with preserved spaces)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B12: nonexistent item → exit non-zero, no orphan entry ───────────────────
echo "--- B12: nonexistent item → exit non-zero, no orphan created ---"
new_panop_dir
setup_item "realitem"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase nonexistent-item "x" >/dev/null 2>/tmp/wip-b12-stderr.txt || actual_exit=$?
if [[ "$actual_exit" -ne 0 ]]; then
  echo "  PASS: B12 exit non-zero for missing item"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B12 exit 0 (expected non-zero for missing item)"
  FAIL=$((FAIL + 1))
fi
# Verify no orphan entry was created for nonexistent-item
item_count=0; item_count=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null | grep -c "nonexistent-item") || true
if [[ "$item_count" -eq 0 ]]; then
  echo "  PASS: B12 no orphan entry created"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B12 orphan entry was created for nonexistent-item"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── B13: 15 emoji → exit 0 (char count, not byte count) ─────────────────────
echo "--- B13: 15 emoji accepted (char count, not byte count) ---"
new_panop_dir
setup_item "item"
# 15 emoji: each is 4 bytes in UTF-8, but should count as 1 char each
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "🎉🎊🎨🎭🎪🎬🎮🎯🎲🎰🎱🎳🎴🎸🎵" >/dev/null 2>&1 || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: B13 exit 0 (15 emoji accepted as 15 chars)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: B13 exit $actual_exit (expected 0 — 15 emoji = 15 chars, not 60 bytes)"
  FAIL=$((FAIL + 1))
fi
cleanup

# cleanup temp files
rm -f /tmp/wip-b03-stderr.txt /tmp/wip-b12-stderr.txt 2>/dev/null || true

summary_and_exit "test_phase_validation.sh"
