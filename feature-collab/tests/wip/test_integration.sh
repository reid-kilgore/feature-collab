#!/usr/bin/env bash
# Category D — Integration: End-to-End CLI Flows (D01–D15)
# Each test creates its own isolated PANOP_DIR and cleans up after itself.
# Expected: ALL tests FAIL on the current wip script (TDD RED) — wip currently
# ignores the PANOP_DIR env var (line 5 hardcodes $HOME/panop), does not accept
# canonical status names, has no wip phase subcommand, and has no deprecation.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared helpers if present; otherwise fall back to local helpers.
if [[ -f "$SCRIPT_DIR/_helpers.sh" ]]; then
  # shellcheck source=_helpers.sh
  source "$SCRIPT_DIR/_helpers.sh"
else
  source "$SCRIPT_DIR/_helpers_integration.sh"
fi

WIP="$SCRIPT_DIR/../../wip"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

echo "=== Category D: Integration — End-to-End CLI Flows ==="
echo

# ── D01 ───────────────────────────────────────────────────────────────────────
# wip status item ACTIVE && wip get item | jq -r .status = WORKING  [§9.1]
echo "--- D01: ACTIVE normalizes to WORKING on disk ---"
new_panop_dir
setup_item "d01item"
PANOP_DIR="$PANOP_DIR" "$WIP" status d01item ACTIVE >/dev/null 2>&1 || true
result=$(PANOP_DIR="$PANOP_DIR" "$WIP" get d01item 2>/dev/null | jq -r '.status // empty' 2>/dev/null) || result=""
if [[ "$result" == "WORKING" ]]; then
  echo "  PASS: D01 ACTIVE → WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D01 expected WORKING, got '$result'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D02 ───────────────────────────────────────────────────────────────────────
# wip status item IN_REVIEW && wip get item | jq -r .phase = Review  [§9.2]
echo "--- D02: IN_REVIEW sets phase=Review when phase was unset ---"
new_panop_dir
setup_item "d02item"
PANOP_DIR="$PANOP_DIR" "$WIP" status d02item IN_REVIEW >/dev/null 2>&1 || true
result=$(PANOP_DIR="$PANOP_DIR" "$WIP" get d02item 2>/dev/null | jq -r '.phase // empty' 2>/dev/null) || result=""
if [[ "$result" == "Review" ]]; then
  echo "  PASS: D02 IN_REVIEW → phase=Review"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D02 expected phase=Review, got '$result'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D03 ───────────────────────────────────────────────────────────────────────
# wip phase item "xxxxxxxxxxxxxxxxx" (17 chars) → exit 2  [§9.3]
echo "--- D03: phase >15 chars rejected with exit 2 ---"
new_panop_dir
setup_item "d03item"
exit_code=0
PANOP_DIR="$PANOP_DIR" "$WIP" phase d03item "xxxxxxxxxxxxxxxxx" >/dev/null 2>&1 || exit_code=$?
if [[ "$exit_code" -eq 2 ]]; then
  echo "  PASS: D03 17-char phase → exit 2"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D03 expected exit 2, got $exit_code"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D04 ───────────────────────────────────────────────────────────────────────
# wip phase item "" && wip get item | jq 'has("phase")' = false  [§9.4]
echo "--- D04: phase cleared with empty string removes key ---"
new_panop_dir
setup_item "d04item"
PANOP_DIR="$PANOP_DIR" "$WIP" phase d04item "Review" >/dev/null 2>&1 || true
PANOP_DIR="$PANOP_DIR" "$WIP" phase d04item "" >/dev/null 2>&1 || true
result=$(PANOP_DIR="$PANOP_DIR" "$WIP" get d04item 2>/dev/null | jq 'has("phase")' 2>/dev/null) || result=""
if [[ "$result" == "false" ]]; then
  echo "  PASS: D04 empty phase clears key"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D04 expected has(phase)=false, got '$result'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D05 ───────────────────────────────────────────────────────────────────────
# wip --help exit 0, output contains all 4 canonical states and 'wip phase'  [§9.5]
echo "--- D05: --help exits 0 and contains canonical states + wip phase ---"
new_panop_dir
d05_exit=0
help_out=$(PANOP_DIR="$PANOP_DIR" "$WIP" --help 2>&1) || d05_exit=$?
d05_ok=1
[[ "$d05_exit" -eq 0 ]] || { echo "  FAIL: D05 --help exit code was $d05_exit"; d05_ok=0; }
echo "$help_out" | grep -q "NOT_STARTED" || { echo "  FAIL: D05 help missing NOT_STARTED"; d05_ok=0; }
echo "$help_out" | grep -q "WORKING"     || { echo "  FAIL: D05 help missing WORKING"; d05_ok=0; }
echo "$help_out" | grep -q "WAITING"     || { echo "  FAIL: D05 help missing WAITING"; d05_ok=0; }
echo "$help_out" | grep -q "DONE"        || { echo "  FAIL: D05 help missing DONE"; d05_ok=0; }
echo "$help_out" | grep -q "wip phase"   || { echo "  FAIL: D05 help missing 'wip phase'"; d05_ok=0; }
if [[ "$d05_ok" -eq 1 ]]; then
  echo "  PASS: D05 --help has all states and wip phase"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D06 ───────────────────────────────────────────────────────────────────────
# Pre-seed {"name":"x","status":"WAITING"} in work.txt; wip list shows WAITING (canonical); file mtime unchanged  [§9.6]
echo "--- D06: canonical WAITING on disk renders as WAITING without modifying file ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d06item","status":"WAITING","loc":"/tmp/fake-d06"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d06_wf="$PANOP_DIR/testrepo/work.txt"
d06_mtime_before=$(stat -f "%m" "$d06_wf" 2>/dev/null || stat -c "%Y" "$d06_wf" 2>/dev/null)
d06_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
d06_mtime_after=$(stat -f "%m" "$d06_wf" 2>/dev/null || stat -c "%Y" "$d06_wf" 2>/dev/null)
d06_ok=1
echo "$d06_list" | grep -q "WAITING" || { echo "  FAIL: D06 list did not show WAITING"; d06_ok=0; }
[[ "$d06_mtime_before" == "$d06_mtime_after" ]] || { echo "  FAIL: D06 work.txt was modified"; d06_ok=0; }
if [[ "$d06_ok" -eq 1 ]]; then
  echo "  PASS: D06 WAITING renders WAITING (canonical), file unchanged"
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D07 ───────────────────────────────────────────────────────────────────────
# on-stop.sh run against WORKING item with phase="Review" → status becomes WAITING  [§9.7]
echo "--- D07: on-stop.sh sets WAITING even when phase=Review ---"
new_panop_dir
d07_loc="/tmp/fake-d07-loc-$$"
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d07item","status":"WORKING","phase":"Review","loc":"%s"}\n' "$d07_loc" \
  > "$PANOP_DIR/testrepo/work.txt"
# on-stop.sh hardcodes WIP="$HOME/panop/wip". Create a temp HOME with our wip binary.
d07_home=$(mktemp -d /tmp/wip-d07-home-XXXXXX)
mkdir -p "$d07_home/panop"
cp -r "$PANOP_DIR/testrepo" "$d07_home/panop/"
cp "$WIP" "$d07_home/panop/wip"
chmod +x "$d07_home/panop/wip"
d07_on_stop="/Users/reid/.claude/hooks/on-stop.sh"
if [[ -x "$d07_on_stop" ]]; then
  HOME="$d07_home" bash "$d07_on_stop" <<< "{\"cwd\":\"$d07_loc\"}" >/dev/null 2>&1 || true
  d07_result=$(HOME="$d07_home" PANOP_DIR="$d07_home/panop" "$WIP" get d07item 2>/dev/null \
    | jq -r '.status // empty' 2>/dev/null) || d07_result=""
  if [[ "$d07_result" == "WAITING" ]]; then
    echo "  PASS: D07 on-stop WORKING+Review → WAITING"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: D07 expected WAITING after on-stop, got '$d07_result'"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  FAIL: D07 on-stop.sh not found at $d07_on_stop"
  FAIL=$((FAIL + 1))
fi
rm -rf "$d07_home"
cleanup

# ── D08 ───────────────────────────────────────────────────────────────────────
# wip list human output: item with phase shows "WORKING [Review]" format
echo "--- D08: wip list shows WORKING [Review] for item with phase ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d08item","status":"WORKING","phase":"Review","loc":"/tmp/fake-d08"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d08_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
if echo "$d08_list" | grep -qE "WORKING[[:space:]]*\[Review\]"; then
  echo "  PASS: D08 list shows WORKING [Review]"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D08 expected 'WORKING [Review]' in list output"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D09 ───────────────────────────────────────────────────────────────────────
# wip list human output: item without phase shows no bracket section
echo "--- D09: wip list shows no brackets for item without phase ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d09item","status":"WORKING","loc":"/tmp/fake-d09"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d09_list=$(PANOP_DIR="$PANOP_DIR" "$WIP" list 2>/dev/null) || true
if echo "$d09_list" | grep -q "d09item" && ! echo "$d09_list" | grep "d09item" | grep -q "\["; then
  echo "  PASS: D09 list has no brackets for item without phase"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D09 unexpected bracket in list output or item missing"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D10 ───────────────────────────────────────────────────────────────────────
# wip list --json output: item with phase includes "phase" key
echo "--- D10: wip list --json includes phase key when set ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d10item","status":"WORKING","phase":"Review","loc":"/tmp/fake-d10"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d10_json=$(PANOP_DIR="$PANOP_DIR" "$WIP" list --json 2>/dev/null) || true
if echo "$d10_json" | jq -e '.[0].phase' >/dev/null 2>&1; then
  echo "  PASS: D10 --json includes phase key"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D10 --json missing phase key"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D11 ───────────────────────────────────────────────────────────────────────
# wip list --json output: item without phase has no "phase" key (or null)
echo "--- D11: wip list --json has no phase key when phase not set ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d11item","status":"WORKING","loc":"/tmp/fake-d11"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d11_json=$(PANOP_DIR="$PANOP_DIR" "$WIP" list --json 2>/dev/null) || true
d11_phase=$(echo "$d11_json" | jq -r '.[0].phase // "ABSENT"' 2>/dev/null) || d11_phase="ABSENT"
if [[ "$d11_phase" == "ABSENT" ]] || [[ "$d11_phase" == "null" ]]; then
  echo "  PASS: D11 --json phase absent when not set"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D11 unexpected phase value '$d11_phase' in --json"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D12 ───────────────────────────────────────────────────────────────────────
# wip get item includes "phase" field when set
echo "--- D12: wip get includes phase field when set ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d12item","status":"WORKING","phase":"Scoping","loc":"/tmp/fake-d12"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d12_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get d12item 2>/dev/null \
  | jq -r '.phase // empty' 2>/dev/null) || d12_phase=""
if [[ "$d12_phase" == "Scoping" ]]; then
  echo "  PASS: D12 wip get includes phase"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D12 expected phase=Scoping from wip get, got '$d12_phase'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D13 ───────────────────────────────────────────────────────────────────────
# wip children <item> where item has no children: exits 0, produces valid output
# de-emphasis ≠ removal: wip children must still exist and exit 0
echo "--- D13: wip children exits 0 for item with no children ---"
new_panop_dir
setup_item "d13parent"
d13_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" children d13parent >/dev/null 2>&1 || d13_exit=$?
if [[ "$d13_exit" -eq 0 ]]; then
  echo "  PASS: D13 wip children exits 0 for childless item"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D13 wip children exit $d13_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D14 ───────────────────────────────────────────────────────────────────────
# wip list --json on item with only name, status, loc
# pipe through jq 'keys | sort' and diff against fixture key set
# Any added/removed key = fail; protects downstream consumers (Nasqueron, skills)
#
# REGRESSION NOTE: The fixture at tests/wip/fixtures/json_keys_baseline.txt pins
# the exact set of top-level keys that downstream consumers depend on.
#   - Key disappears (e.g. "branches" → "branch_list"): consumers silently break.
#   - New key added without updating fixture: this test fails intentionally.
# Update the fixture in a deliberate commit and document the change in the PR.
echo "--- D14: wip list --json key set matches fixture baseline ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"d14item","status":"WORKING","loc":"/tmp/fake-d14"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
d14_json=$(PANOP_DIR="$PANOP_DIR" "$WIP" list --json 2>/dev/null) || true
d14_actual=$(echo "$d14_json" | jq -r '.[0] | keys | sort | .[]' 2>/dev/null | sort) || d14_actual=""
d14_baseline=$(sort "$FIXTURES_DIR/json_keys_baseline.txt")
if [[ "$d14_actual" == "$d14_baseline" ]]; then
  echo "  PASS: D14 --json key set matches baseline"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D14 --json key set mismatch"
  echo "    Expected (fixture):"
  echo "$d14_baseline" | sed 's/^/      /'
  echo "    Actual:"
  echo "$d14_actual" | sed 's/^/      /'
  diff <(echo "$d14_baseline") <(echo "$d14_actual") | head -20 || true
  FAIL=$((FAIL + 1))
fi
cleanup

# ── D15 ───────────────────────────────────────────────────────────────────────
# wip status <item> BOGUS → exact stderr string check
# Pinned exact string from CONTRACTS.md §1 Rejection:
#   "wip: unknown status 'BOGUS'. Valid: NOT_STARTED, WORKING, NEEDS_INPUT, DONE"
# If the message format changes, update this test and document the change.
echo "--- D15: unknown status produces exact stderr message ---"
new_panop_dir
setup_item "d15item"
D15_EXPECTED="wip: unknown status 'BOGUS'. Valid: NOT_STARTED, WORKING, WAITING, DONE"
d15_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status d15item BOGUS 2>&1 >/dev/null) || true
if [[ "$d15_stderr" == "$D15_EXPECTED" ]]; then
  echo "  PASS: D15 exact unknown-status stderr matches"
  PASS=$((PASS + 1))
else
  echo "  FAIL: D15 stderr mismatch"
  echo "    Expected: [$D15_EXPECTED]"
  echo "    Actual:   [$d15_stderr]"
  FAIL=$((FAIL + 1))
fi
cleanup

echo
summary_and_exit "test_integration.sh"
