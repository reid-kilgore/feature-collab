#!/usr/bin/env bash
# Category F — Integration: Deprecation Notice (F01–F08)
# Tests confirm legacy status inputs emit exactly one deprecation line to
# stderr, canonical inputs emit nothing, WIP_SILENT_DEPRECATION=1 suppresses,
# and on-stop.sh deduplicates so only one deprecated line fires even if both
# read-normalize and write-normalize paths could fire.
#
# TDD RED: F01, F02, F08 FAIL on current wip script (no deprecation emitted).
# F03–F07 coincidentally pass today (no stderr) — regression guards for GREEN.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/_helpers.sh" ]]; then
  source "$SCRIPT_DIR/_helpers.sh"
else
  source "$SCRIPT_DIR/_helpers_integration.sh"
fi

WIP="$SCRIPT_DIR/../../wip"

echo "=== Category F: Deprecation Notice ==="
echo

# ── F01 ───────────────────────────────────────────────────────────────────────
# wip status item ACTIVE → exactly 1 line to stderr matching "deprecated"
echo "--- F01: ACTIVE emits exactly 1 deprecated line to stderr ---"
new_panop_dir
setup_item "f01item"
f01_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f01item ACTIVE 2>&1 >/dev/null) || true
f01_count=$(echo "$f01_stderr" | grep -c "deprecated" 2>/dev/null) || f01_count=0
if [[ "$f01_count" -eq 1 ]]; then
  echo "  PASS: F01 exactly 1 deprecated line on stderr"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F01 expected 1 deprecated line, got $f01_count (stderr: '$f01_stderr')"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F02 ───────────────────────────────────────────────────────────────────────
# wip status item ACTIVE stderr line contains both "ACTIVE" and "WORKING"
echo "--- F02: ACTIVE deprecation line references ACTIVE and WORKING ---"
new_panop_dir
setup_item "f02item"
f02_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f02item ACTIVE 2>&1 >/dev/null) || true
f02_ok=1
echo "$f02_stderr" | grep -q "ACTIVE"  || { echo "  FAIL: F02 stderr missing 'ACTIVE'"; f02_ok=0; }
echo "$f02_stderr" | grep -q "WORKING" || { echo "  FAIL: F02 stderr missing 'WORKING'"; f02_ok=0; }
if [[ "$f02_ok" -eq 1 ]]; then
  echo "  PASS: F02 deprecation line references ACTIVE and WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F02 stderr was: '$f02_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F03 ───────────────────────────────────────────────────────────────────────
# WIP_SILENT_DEPRECATION=1 wip status item ACTIVE → stderr empty
# Note: only exact value "1" suppresses; "0", "true", "yes" do NOT suppress.
echo "--- F03: WIP_SILENT_DEPRECATION=1 suppresses deprecation ---"
new_panop_dir
setup_item "f03item"
f03_stderr=$(WIP_SILENT_DEPRECATION=1 PANOP_DIR="$PANOP_DIR" "$WIP" status f03item ACTIVE 2>&1 >/dev/null) || true
if [[ -z "$f03_stderr" ]]; then
  echo "  PASS: F03 stderr empty with WIP_SILENT_DEPRECATION=1"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F03 unexpected stderr: '$f03_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F04 ───────────────────────────────────────────────────────────────────────
# wip status item WORKING (canonical) → stderr empty
echo "--- F04: canonical WORKING emits nothing to stderr ---"
new_panop_dir
setup_item "f04item"
f04_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f04item WORKING 2>&1 >/dev/null) || true
if [[ -z "$f04_stderr" ]]; then
  echo "  PASS: F04 no stderr for canonical WORKING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F04 unexpected stderr: '$f04_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F05 ───────────────────────────────────────────────────────────────────────
# wip status item NOT_STARTED → stderr empty
echo "--- F05: canonical NOT_STARTED emits nothing to stderr ---"
new_panop_dir
setup_item "f05item"
f05_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f05item NOT_STARTED 2>&1 >/dev/null) || true
if [[ -z "$f05_stderr" ]]; then
  echo "  PASS: F05 no stderr for canonical NOT_STARTED"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F05 unexpected stderr: '$f05_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F06 ───────────────────────────────────────────────────────────────────────
# wip status item WAITING → stderr empty (WAITING is now canonical)
echo "--- F06: canonical WAITING emits nothing to stderr ---"
new_panop_dir
setup_item "f06item"
f06_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f06item WAITING 2>&1 >/dev/null) || true
if [[ -z "$f06_stderr" ]]; then
  echo "  PASS: F06 no stderr for canonical WAITING"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F06 unexpected stderr: '$f06_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F07 ───────────────────────────────────────────────────────────────────────
# wip status item DONE → stderr empty
echo "--- F07: canonical DONE emits nothing to stderr ---"
new_panop_dir
setup_item "f07item"
f07_stderr=$(PANOP_DIR="$PANOP_DIR" "$WIP" status f07item DONE 2>&1 >/dev/null) || true
if [[ -z "$f07_stderr" ]]; then
  echo "  PASS: F07 no stderr for canonical DONE"
  PASS=$((PASS + 1))
else
  echo "  FAIL: F07 unexpected stderr: '$f07_stderr'"
  FAIL=$((FAIL + 1))
fi
cleanup

# ── F08 ───────────────────────────────────────────────────────────────────────
# One on-stop.sh invocation against item with legacy on-disk status →
# exactly one "deprecated" stderr line, not two.
#
# Deduplication contract: deprecation is a write-path concern (wip status).
# The read path (wip get inside on-stop.sh) must NOT emit its own deprecation
# notice. If it does, the hook fires two lines: one from read-normalize, one
# from write-normalize (the wip status NEEDS_INPUT call). Total must be 1.
echo "--- F08: on-stop.sh on legacy-status item emits exactly 1 deprecated line ---"
new_panop_dir
f08_loc="/tmp/fake-f08-loc-$$"
mkdir -p "$PANOP_DIR/testrepo"
printf '{"name":"f08item","status":"ACTIVE","loc":"%s"}\n' "$f08_loc" \
  > "$PANOP_DIR/testrepo/work.txt"
# on-stop.sh hardcodes WIP="$HOME/panop/wip" — create a temp HOME with our wip.
f08_home=$(mktemp -d /tmp/wip-f08-home-XXXXXX)
mkdir -p "$f08_home/panop"
cp -r "$PANOP_DIR/testrepo" "$f08_home/panop/"
cp "$WIP" "$f08_home/panop/wip"
chmod +x "$f08_home/panop/wip"
f08_on_stop="/Users/reid/.claude/hooks/on-stop.sh"
if [[ -x "$f08_on_stop" ]]; then
  f08_hook_stderr=$(HOME="$f08_home" bash "$f08_on_stop" <<< "{\"cwd\":\"$f08_loc\"}" 2>&1 >/dev/null) || true
  f08_count=$(echo "$f08_hook_stderr" | grep -c "deprecated" 2>/dev/null) || f08_count=0
  if [[ "$f08_count" -eq 1 ]]; then
    echo "  PASS: F08 exactly 1 deprecated line from on-stop.sh"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: F08 expected 1 deprecated line, got $f08_count"
    echo "    hook stderr: '$f08_hook_stderr'"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  FAIL: F08 on-stop.sh not found at $f08_on_stop"
  FAIL=$((FAIL + 1))
fi
rm -rf "$f08_home"
cleanup

echo
summary_and_exit "test_deprecation.sh"
