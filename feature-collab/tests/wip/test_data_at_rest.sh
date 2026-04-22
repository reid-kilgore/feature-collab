#!/usr/bin/env bash
# Category E — Integration: Data-at-Rest Compatibility
# Each test writes raw JSON directly to work.txt without invoking wip status,
# then asserts render output — confirming the READ path maps legacy values
# without modifying work.txt.
# Expected: FAIL on current wip script (TDD RED) for E01–E04, E06–E07, E09.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/_helpers.sh" ]]; then
  source "$SCRIPT_DIR/_helpers.sh"
else
  source "$SCRIPT_DIR/_helpers_integration.sh"
fi

WIP="$SCRIPT_DIR/../../wip"

echo "=== Category E: Data-at-Rest Compatibility ==="
echo

# Seed a single item directly into $PANOP_DIR/testrepo/work.txt.
# Caller must have called new_panop_dir first.
_seed_raw() {
  local json="$1"
  mkdir -p "$PANOP_DIR/testrepo"
  printf '%s\n' "$json" > "$PANOP_DIR/testrepo/work.txt"
}

# ── E01 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "ACTIVE" → wip list renders WORKING; file not modified
echo "--- E01: ACTIVE on disk renders as WORKING; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e01item","status":"ACTIVE","loc":"/tmp/fake-e01"}'
e01_wf="$PANOP_DIR/testrepo/work.txt"
e01_mt0=$(stat -f "%m" "$e01_wf" 2>/dev/null || stat -c "%Y" "$e01_wf" 2>/dev/null)
e01_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e01_mt1=$(stat -f "%m" "$e01_wf" 2>/dev/null || stat -c "%Y" "$e01_wf" 2>/dev/null)
e01_ok=1
echo "$e01_list" | grep -q "WORKING"    || { echo "  FAIL: E01 list did not show WORKING"; e01_ok=0; }
[[ "$e01_mt0" == "$e01_mt1" ]]          || { echo "  FAIL: E01 work.txt was modified"; e01_ok=0; }
if [[ "$e01_ok" -eq 1 ]]; then
  echo "  PASS: E01 ACTIVE → WORKING, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E02 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "WAITING" → wip list renders WAITING (canonical); file not modified
echo "--- E02: WAITING on disk renders as WAITING (canonical); file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e02item","status":"WAITING","loc":"/tmp/fake-e02"}'
e02_wf="$PANOP_DIR/testrepo/work.txt"
e02_mt0=$(stat -f "%m" "$e02_wf" 2>/dev/null || stat -c "%Y" "$e02_wf" 2>/dev/null)
e02_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e02_mt1=$(stat -f "%m" "$e02_wf" 2>/dev/null || stat -c "%Y" "$e02_wf" 2>/dev/null)
e02_ok=1
echo "$e02_list" | grep -q "WAITING" || { echo "  FAIL: E02 list did not show WAITING"; e02_ok=0; }
[[ "$e02_mt0" == "$e02_mt1" ]]       || { echo "  FAIL: E02 work.txt was modified"; e02_ok=0; }
if [[ "$e02_ok" -eq 1 ]]; then
  echo "  PASS: E02 WAITING → WAITING (canonical), file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E03 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "BLOCKED" → wip list renders WAITING; file not modified
echo "--- E03: BLOCKED on disk renders as WAITING; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e03item","status":"BLOCKED","loc":"/tmp/fake-e03"}'
e03_wf="$PANOP_DIR/testrepo/work.txt"
e03_mt0=$(stat -f "%m" "$e03_wf" 2>/dev/null || stat -c "%Y" "$e03_wf" 2>/dev/null)
e03_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e03_mt1=$(stat -f "%m" "$e03_wf" 2>/dev/null || stat -c "%Y" "$e03_wf" 2>/dev/null)
e03_ok=1
echo "$e03_list" | grep -q "WAITING" || { echo "  FAIL: E03 list did not show WAITING"; e03_ok=0; }
[[ "$e03_mt0" == "$e03_mt1" ]]       || { echo "  FAIL: E03 work.txt was modified"; e03_ok=0; }
if [[ "$e03_ok" -eq 1 ]]; then
  echo "  PASS: E03 BLOCKED → WAITING, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E04 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "NEW" → wip list renders NOT_STARTED; file not modified
echo "--- E04: NEW on disk renders as NOT_STARTED; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e04item","status":"NEW","loc":"/tmp/fake-e04"}'
e04_wf="$PANOP_DIR/testrepo/work.txt"
e04_mt0=$(stat -f "%m" "$e04_wf" 2>/dev/null || stat -c "%Y" "$e04_wf" 2>/dev/null)
e04_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e04_mt1=$(stat -f "%m" "$e04_wf" 2>/dev/null || stat -c "%Y" "$e04_wf" 2>/dev/null)
e04_ok=1
echo "$e04_list" | grep -q "NOT_STARTED" || { echo "  FAIL: E04 list did not show NOT_STARTED"; e04_ok=0; }
[[ "$e04_mt0" == "$e04_mt1" ]]           || { echo "  FAIL: E04 work.txt was modified"; e04_ok=0; }
if [[ "$e04_ok" -eq 1 ]]; then
  echo "  PASS: E04 NEW → NOT_STARTED, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E05 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "CLOSED" → not shown (filtered) OR shown as DONE; file not modified
# Both behaviors are acceptable. Showing raw "CLOSED" label is not acceptable.
echo "--- E05: CLOSED on disk filtered or rendered as DONE; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e05item","status":"CLOSED","loc":"/tmp/fake-e05"}'
e05_wf="$PANOP_DIR/testrepo/work.txt"
e05_mt0=$(stat -f "%m" "$e05_wf" 2>/dev/null || stat -c "%Y" "$e05_wf" 2>/dev/null)
e05_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e05_mt1=$(stat -f "%m" "$e05_wf" 2>/dev/null || stat -c "%Y" "$e05_wf" 2>/dev/null)
e05_ok=1
if echo "$e05_list" | grep -q "e05item"; then
  # Item present — must not show raw CLOSED
  if echo "$e05_list" | grep "e05item" | grep -qE "[[:space:]]CLOSED[[:space:]]"; then
    echo "  FAIL: E05 item shown with raw CLOSED status (should be DONE or filtered)"
    e05_ok=0
  fi
fi
[[ "$e05_mt0" == "$e05_mt1" ]] || { echo "  FAIL: E05 work.txt was modified"; e05_ok=0; }
if [[ "$e05_ok" -eq 1 ]]; then
  echo "  PASS: E05 CLOSED filtered or rendered as DONE, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E06 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "IN_REVIEW" → wip list renders WORKING; file not modified
echo "--- E06: IN_REVIEW on disk renders as WORKING; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e06item","status":"IN_REVIEW","loc":"/tmp/fake-e06"}'
e06_wf="$PANOP_DIR/testrepo/work.txt"
e06_mt0=$(stat -f "%m" "$e06_wf" 2>/dev/null || stat -c "%Y" "$e06_wf" 2>/dev/null)
e06_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e06_mt1=$(stat -f "%m" "$e06_wf" 2>/dev/null || stat -c "%Y" "$e06_wf" 2>/dev/null)
e06_ok=1
echo "$e06_list" | grep -q "WORKING"   || { echo "  FAIL: E06 list did not show WORKING"; e06_ok=0; }
[[ "$e06_mt0" == "$e06_mt1" ]]         || { echo "  FAIL: E06 work.txt was modified"; e06_ok=0; }
if [[ "$e06_ok" -eq 1 ]]; then
  echo "  PASS: E06 IN_REVIEW → WORKING, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E07 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "RETRO" → wip list renders WORKING; file not modified
echo "--- E07: RETRO on disk renders as WORKING; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e07item","status":"RETRO","loc":"/tmp/fake-e07"}'
e07_wf="$PANOP_DIR/testrepo/work.txt"
e07_mt0=$(stat -f "%m" "$e07_wf" 2>/dev/null || stat -c "%Y" "$e07_wf" 2>/dev/null)
e07_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e07_mt1=$(stat -f "%m" "$e07_wf" 2>/dev/null || stat -c "%Y" "$e07_wf" 2>/dev/null)
e07_ok=1
echo "$e07_list" | grep -q "WORKING"   || { echo "  FAIL: E07 list did not show WORKING"; e07_ok=0; }
[[ "$e07_mt0" == "$e07_mt1" ]]         || { echo "  FAIL: E07 work.txt was modified"; e07_ok=0; }
if [[ "$e07_ok" -eq 1 ]]; then
  echo "  PASS: E07 RETRO → WORKING, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E08 ───────────────────────────────────────────────────────────────────────
# Pre-seeded status "NOT_STARTED" (canonical) → wip list renders NOT_STARTED; file not modified
echo "--- E08: NOT_STARTED (canonical) renders as NOT_STARTED; file unchanged ---"
new_panop_dir
_seed_raw '{"name":"e08item","status":"NOT_STARTED","loc":"/tmp/fake-e08"}'
e08_wf="$PANOP_DIR/testrepo/work.txt"
e08_mt0=$(stat -f "%m" "$e08_wf" 2>/dev/null || stat -c "%Y" "$e08_wf" 2>/dev/null)
e08_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e08_mt1=$(stat -f "%m" "$e08_wf" 2>/dev/null || stat -c "%Y" "$e08_wf" 2>/dev/null)
e08_ok=1
echo "$e08_list" | grep -q "NOT_STARTED" || { echo "  FAIL: E08 list did not show NOT_STARTED"; e08_ok=0; }
[[ "$e08_mt0" == "$e08_mt1" ]]           || { echo "  FAIL: E08 work.txt was modified"; e08_ok=0; }
if [[ "$e08_ok" -eq 1 ]]; then
  echo "  PASS: E08 NOT_STARTED canonical passthrough, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E09 ───────────────────────────────────────────────────────────────────────
# Two items: one "ACTIVE", one "WORKING" → both render as WORKING; catches renderer-loop bugs
echo "--- E09: mixed ACTIVE and WORKING both render as WORKING; file unchanged ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"e09legacy","status":"ACTIVE","loc":"/tmp/fake-e09a"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
printf '{"name":"e09canonical","status":"WORKING","loc":"/tmp/fake-e09b"}\n' \
  >> "$PANOP_DIR/testrepo/work.txt"
e09_wf="$PANOP_DIR/testrepo/work.txt"
e09_mt0=$(stat -f "%m" "$e09_wf" 2>/dev/null || stat -c "%Y" "$e09_wf" 2>/dev/null)
e09_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
e09_mt1=$(stat -f "%m" "$e09_wf" 2>/dev/null || stat -c "%Y" "$e09_wf" 2>/dev/null)
e09_ok=1
echo "$e09_list" | grep -q "e09legacy"    || { echo "  FAIL: E09 e09legacy not listed"; e09_ok=0; }
echo "$e09_list" | grep -q "e09canonical" || { echo "  FAIL: E09 e09canonical not listed"; e09_ok=0; }
# Renderer-loop regression: raw "ACTIVE" must not appear in output
if echo "$e09_list" | grep -qE "[[:space:]]ACTIVE[[:space:]]"; then
  echo "  FAIL: E09 raw ACTIVE appeared in list output"
  e09_ok=0
fi
[[ "$e09_mt0" == "$e09_mt1" ]] || { echo "  FAIL: E09 work.txt was modified"; e09_ok=0; }
if [[ "$e09_ok" -eq 1 ]]; then
  echo "  PASS: E09 ACTIVE+WORKING both render as WORKING, file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── E10 ───────────────────────────────────────────────────────────────────────
# Item with NO status key: wip get exits 0; wip list renders without crashing;
# default render: NOT_STARTED
echo "--- E10: item with no status key: exits 0; renders as NOT_STARTED ---"
new_panop_dir
_seed_raw '{"name":"e10item","loc":"/tmp/fake-e10"}'
e10_wf="$PANOP_DIR/testrepo/work.txt"
e10_mt0=$(stat -f "%m" "$e10_wf" 2>/dev/null || stat -c "%Y" "$e10_wf" 2>/dev/null)
e10_get_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" get e10item >/dev/null 2>&1 || e10_get_exit=$?
e10_list_exit=0
e10_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || e10_list_exit=$?
e10_mt1=$(stat -f "%m" "$e10_wf" 2>/dev/null || stat -c "%Y" "$e10_wf" 2>/dev/null)
e10_ok=1
[[ "$e10_get_exit" -eq 0 ]]  || { echo "  FAIL: E10 wip get exited $e10_get_exit (expected 0)"; e10_ok=0; }
[[ "$e10_list_exit" -eq 0 ]] || { echo "  FAIL: E10 wip list exited $e10_list_exit (expected 0)"; e10_ok=0; }
if echo "$e10_list" | grep -q "e10item"; then
  echo "$e10_list" | grep "e10item" | grep -q "NOT_STARTED" \
    || { echo "  FAIL: E10 item without status did not default to NOT_STARTED"; e10_ok=0; }
fi
[[ "$e10_mt0" == "$e10_mt1" ]] || { echo "  FAIL: E10 work.txt was modified"; e10_ok=0; }
if [[ "$e10_ok" -eq 1 ]]; then
  echo "  PASS: E10 no-status item handled gracefully"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

echo
summary_and_exit "test_data_at_rest.sh"
