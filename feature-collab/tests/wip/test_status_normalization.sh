#!/usr/bin/env bash
# Category A — Unit: Status Normalization
# Tests A01–A16 (including A06-remix)
# No set -e: test runner must continue even when wip invocations fail.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=_helpers.sh
source "$SCRIPT_DIR/_helpers.sh"

echo "=== Category A: Status Normalization ==="
echo

# ── A01: NEW → NOT_STARTED, deprecation to stderr ────────────────────────────
echo "--- A01: NEW maps to NOT_STARTED ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item NEW >/dev/null 2>/tmp/wip-a01-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "NOT_STARTED" ]]; then
  echo "  PASS: A01 status on disk = NOT_STARTED"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A01 status on disk = $stored (expected NOT_STARTED)"
  FAIL=$((FAIL + 1))
fi
assert "A01 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a01-stderr.txt
cleanup

# ── A02: ACTIVE → WORKING, deprecation to stderr ─────────────────────────────
echo "--- A02: ACTIVE maps to WORKING ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item ACTIVE >/dev/null 2>/tmp/wip-a02-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "WORKING" ]]; then
  echo "  PASS: A02 status on disk = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A02 status on disk = $stored (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
assert "A02 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a02-stderr.txt
cleanup

# ── A03: BLOCKED → NEEDS_INPUT, deprecation to stderr ────────────────────────
echo "--- A03: BLOCKED maps to NEEDS_INPUT ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item BLOCKED >/dev/null 2>/tmp/wip-a03-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "NEEDS_INPUT" ]]; then
  echo "  PASS: A03 status on disk = NEEDS_INPUT"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A03 status on disk = $stored (expected NEEDS_INPUT)"
  FAIL=$((FAIL + 1))
fi
assert "A03 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a03-stderr.txt
cleanup

# ── A04: WAITING → NEEDS_INPUT, deprecation to stderr ────────────────────────
echo "--- A04: WAITING maps to NEEDS_INPUT ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item WAITING >/dev/null 2>/tmp/wip-a04-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "NEEDS_INPUT" ]]; then
  echo "  PASS: A04 status on disk = NEEDS_INPUT"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A04 status on disk = $stored (expected NEEDS_INPUT)"
  FAIL=$((FAIL + 1))
fi
assert "A04 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a04-stderr.txt
cleanup

# ── A05: IN_REVIEW (phase unset) → WORKING, phase=Review, deprecation ─────────
echo "--- A05: IN_REVIEW sets status=WORKING and phase=Review when phase unset ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item IN_REVIEW >/dev/null 2>/tmp/wip-a05-stderr.txt || true
stored_status=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
stored_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored_status" == "WORKING" ]]; then
  echo "  PASS: A05 status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A05 status = $stored_status (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ "$stored_phase" == "Review" ]]; then
  echo "  PASS: A05 phase = Review"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A05 phase = '$stored_phase' (expected Review)"
  FAIL=$((FAIL + 1))
fi
assert "A05 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a05-stderr.txt
cleanup

# ── A06: IN_REVIEW (phase already set) → WORKING, phase unchanged ─────────────
echo "--- A06: IN_REVIEW does not overwrite existing phase ---"
new_panop_dir
setup_item "item"
# Manually set phase directly in the JSON
printf '{"name":"item","status":"NOT_STARTED","loc":"/tmp/fake","phase":"Scoping"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
PANOP_DIR="$PANOP_DIR" "$WIP" status item IN_REVIEW >/dev/null 2>/tmp/wip-a06-stderr.txt || true
stored_status=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
stored_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored_status" == "WORKING" ]]; then
  echo "  PASS: A06 status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A06 status = $stored_status (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ "$stored_phase" == "Scoping" ]]; then
  echo "  PASS: A06 phase unchanged = Scoping"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A06 phase = '$stored_phase' (expected Scoping, must not overwrite)"
  FAIL=$((FAIL + 1))
fi
assert "A06 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a06-stderr.txt
cleanup

# ── A07: RETRO (phase unset) → WORKING, phase=Retro, deprecation ──────────────
echo "--- A07: RETRO sets status=WORKING and phase=Retro when phase unset ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item RETRO >/dev/null 2>/tmp/wip-a07-stderr.txt || true
stored_status=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
stored_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored_status" == "WORKING" ]]; then
  echo "  PASS: A07 status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A07 status = $stored_status (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ "$stored_phase" == "Retro" ]]; then
  echo "  PASS: A07 phase = Retro"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A07 phase = '$stored_phase' (expected Retro)"
  FAIL=$((FAIL + 1))
fi
assert "A07 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a07-stderr.txt
cleanup

# ── A08: RETRO (phase already set) → WORKING, phase unchanged ─────────────────
echo "--- A08: RETRO does not overwrite existing phase ---"
new_panop_dir
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"item","status":"NOT_STARTED","loc":"/tmp/fake","phase":"Planning"}\n' \
  > "$PANOP_DIR/testrepo/work.txt"
PANOP_DIR="$PANOP_DIR" "$WIP" status item RETRO >/dev/null 2>/tmp/wip-a08-stderr.txt || true
stored_status=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
stored_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty')
if [[ "$stored_status" == "WORKING" ]]; then
  echo "  PASS: A08 status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A08 status = $stored_status (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ "$stored_phase" == "Planning" ]]; then
  echo "  PASS: A08 phase unchanged = Planning"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A08 phase = '$stored_phase' (expected Planning, must not overwrite)"
  FAIL=$((FAIL + 1))
fi
assert "A08 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a08-stderr.txt
cleanup

# ── A09: CLOSED → DONE, deprecation to stderr ────────────────────────────────
echo "--- A09: CLOSED maps to DONE ---"
new_panop_dir
# Item needs a loc so it doesn't get deleted on DONE
setup_item "item" "/tmp/fake-loc-a09"
PANOP_DIR="$PANOP_DIR" "$WIP" status item CLOSED >/dev/null 2>/tmp/wip-a09-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "DONE" ]]; then
  echo "  PASS: A09 status on disk = DONE"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A09 status on disk = $stored (expected DONE)"
  FAIL=$((FAIL + 1))
fi
assert "A09 deprecation to stderr" grep -qi "deprecated" /tmp/wip-a09-stderr.txt
cleanup

# ── A10: NOT_STARTED (canonical) → no deprecation ────────────────────────────
echo "--- A10: NOT_STARTED is canonical, no deprecation ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item NOT_STARTED >/dev/null 2>/tmp/wip-a10-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "NOT_STARTED" ]]; then
  echo "  PASS: A10 status = NOT_STARTED"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A10 status = $stored (expected NOT_STARTED)"
  FAIL=$((FAIL + 1))
fi
if [[ ! -s /tmp/wip-a10-stderr.txt ]]; then
  echo "  PASS: A10 no deprecation to stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A10 unexpected stderr: $(cat /tmp/wip-a10-stderr.txt)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A11: WORKING (canonical) → no deprecation ────────────────────────────────
echo "--- A11: WORKING is canonical, no deprecation ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item WORKING >/dev/null 2>/tmp/wip-a11-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "WORKING" ]]; then
  echo "  PASS: A11 status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A11 status = $stored (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ ! -s /tmp/wip-a11-stderr.txt ]]; then
  echo "  PASS: A11 no deprecation to stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A11 unexpected stderr: $(cat /tmp/wip-a11-stderr.txt)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A12: NEEDS_INPUT (canonical) → no deprecation ────────────────────────────
echo "--- A12: NEEDS_INPUT is canonical, no deprecation ---"
new_panop_dir
setup_item "item"
PANOP_DIR="$PANOP_DIR" "$WIP" status item NEEDS_INPUT >/dev/null 2>/tmp/wip-a12-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "NEEDS_INPUT" ]]; then
  echo "  PASS: A12 status = NEEDS_INPUT"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A12 status = $stored (expected NEEDS_INPUT)"
  FAIL=$((FAIL + 1))
fi
if [[ ! -s /tmp/wip-a12-stderr.txt ]]; then
  echo "  PASS: A12 no deprecation to stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A12 unexpected stderr: $(cat /tmp/wip-a12-stderr.txt)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A13: DONE (canonical) → no deprecation ───────────────────────────────────
echo "--- A13: DONE is canonical, no deprecation ---"
new_panop_dir
setup_item "item" "/tmp/fake-loc-a13"
PANOP_DIR="$PANOP_DIR" "$WIP" status item DONE >/dev/null 2>/tmp/wip-a13-stderr.txt || true
stored=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status)
if [[ "$stored" == "DONE" ]]; then
  echo "  PASS: A13 status = DONE"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A13 status = $stored (expected DONE)"
  FAIL=$((FAIL + 1))
fi
if [[ ! -s /tmp/wip-a13-stderr.txt ]]; then
  echo "  PASS: A13 no deprecation to stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A13 unexpected stderr: $(cat /tmp/wip-a13-stderr.txt)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A14: BOGUS → exit 2, stderr lists canonical states ───────────────────────
echo "--- A14: BOGUS status → exit 2, error message lists canonical states ---"
new_panop_dir
setup_item "item"
actual_exit=0
PANOP_DIR="$PANOP_DIR" "$WIP" status item BOGUS >/dev/null 2>/tmp/wip-a14-stderr.txt || actual_exit=$?
if [[ "$actual_exit" -eq 2 ]]; then
  echo "  PASS: A14 exit code = 2"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A14 exit code = $actual_exit (expected 2)"
  FAIL=$((FAIL + 1))
fi
assert "A14 stderr mentions unknown status BOGUS" grep -qi "unknown status.*BOGUS\|BOGUS.*unknown" /tmp/wip-a14-stderr.txt
assert "A14 stderr lists NOT_STARTED" grep -q "NOT_STARTED" /tmp/wip-a14-stderr.txt
assert "A14 stderr lists WORKING" grep -q "WORKING" /tmp/wip-a14-stderr.txt
assert "A14 stderr lists NEEDS_INPUT" grep -q "NEEDS_INPUT" /tmp/wip-a14-stderr.txt
assert "A14 stderr lists DONE" grep -q "DONE" /tmp/wip-a14-stderr.txt
cleanup

# ── A15: WIP_SILENT_DEPRECATION=1 suppresses stderr ──────────────────────────
echo "--- A15: WIP_SILENT_DEPRECATION=1 suppresses deprecation ---"
new_panop_dir
setup_item "item"
actual_exit=0
WIP_SILENT_DEPRECATION=1 PANOP_DIR="$PANOP_DIR" "$WIP" status item ACTIVE >/dev/null 2>/tmp/wip-a15-stderr.txt || actual_exit=$?
if [[ "$actual_exit" -eq 0 ]]; then
  echo "  PASS: A15 exit 0"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A15 exit $actual_exit (expected 0)"
  FAIL=$((FAIL + 1))
fi
if [[ ! -s /tmp/wip-a15-stderr.txt ]]; then
  echo "  PASS: A15 nothing on stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A15 unexpected stderr: $(cat /tmp/wip-a15-stderr.txt)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A16: WAITING twice → deprecation emitted once per invocation ─────────────
echo "--- A16: deprecation emitted once per invocation, not accumulated ---"
new_panop_dir
setup_item "item"
# First invocation
PANOP_DIR="$PANOP_DIR" "$WIP" status item WAITING >/dev/null 2>/tmp/wip-a16-first.txt || true
first_count=0; first_count=$(grep -ci "deprecated" /tmp/wip-a16-first.txt 2>/dev/null) || true
if [[ "$first_count" -eq 1 ]]; then
  echo "  PASS: A16 first invocation: exactly 1 deprecation line"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A16 first invocation: $first_count deprecation lines (expected 1)"
  FAIL=$((FAIL + 1))
fi
# Second invocation
PANOP_DIR="$PANOP_DIR" "$WIP" status item WAITING >/dev/null 2>/tmp/wip-a16-second.txt || true
second_count=0; second_count=$(grep -ci "deprecated" /tmp/wip-a16-second.txt 2>/dev/null) || true
if [[ "$second_count" -eq 1 ]]; then
  echo "  PASS: A16 second invocation: exactly 1 deprecation line (not accumulated)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A16 second invocation: $second_count deprecation lines (expected 1)"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── A06-remix: seed phase via wip phase; IN_REVIEW must not overwrite ─────────
echo "--- A06-remix: wip phase sets phase; IN_REVIEW does not overwrite ---"
new_panop_dir
setup_item "item"
# Set phase via wip phase subcommand (which may not exist yet — that's expected RED)
PANOP_DIR="$PANOP_DIR" "$WIP" phase item "Scoping" >/dev/null 2>/dev/null || true
PANOP_DIR="$PANOP_DIR" "$WIP" status item IN_REVIEW >/dev/null 2>/dev/null || true
stored_status=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r .status 2>/dev/null || echo "UNKNOWN")
stored_phase=$(PANOP_DIR="$PANOP_DIR" "$WIP" get item 2>/dev/null | jq -r '.phase // empty' 2>/dev/null || echo "UNKNOWN")
if [[ "$stored_status" == "WORKING" ]]; then
  echo "  PASS: A06-remix status = WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A06-remix status = $stored_status (expected WORKING)"
  FAIL=$((FAIL + 1))
fi
if [[ "$stored_phase" == "Scoping" ]]; then
  echo "  PASS: A06-remix phase remains Scoping (not overwritten)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: A06-remix phase = '$stored_phase' (expected Scoping)"
  FAIL=$((FAIL + 1))
fi
cleanup

# cleanup temp files
rm -f /tmp/wip-a{01,02,03,04,05,06,07,08,09,10,11,12,13,14,15,16}*.txt 2>/dev/null || true

summary_and_exit "test_status_normalization.sh"
