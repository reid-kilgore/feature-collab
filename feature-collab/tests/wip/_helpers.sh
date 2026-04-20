#!/usr/bin/env bash
# Shared helpers for wip test files.
# Source this file; do not execute directly.
#
# Include guard — safe to source multiple times.
# Exit/return codes used by helpers:
#   assert*        — never exit; increment PASS or FAIL
#   setup_item     — exits 1 if PANOP_DIR is unset; creates work.txt
#   teardown       — rm -rf $PANOP_DIR; unsets PANOP_DIR
#   summary_and_exit — exits 0 if FAIL=0, else exits 1

[[ -n "${_WIP_HELPERS_LOADED:-}" ]] && return 0
_WIP_HELPERS_LOADED=1

HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIP="$HELPERS_DIR/../../wip"

PASS=0
FAIL=0

# ── basic assertion helpers ───────────────────────────────────────────────────

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
    echo "  FAIL: $name (pattern '$pattern' not found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_grep() {
  local name="$1" pattern="$2" file="$3"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (pattern '$pattern' unexpectedly found in $file)"
    FAIL=$((FAIL + 1))
  fi
}

# assert_exit <name> <expected-exit-code> <cmd> [args...]
assert_exit() {
  local name="$1" expected="$2"; shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" -eq "$expected" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected exit $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# assert_stderr <name> <pattern> <cmd> [args...]
# Captures stderr; asserts it contains pattern.
assert_stderr() {
  local name="$1" pattern="$2"; shift 2
  local stderr_out
  stderr_out=$("$@" 2>&1 >/dev/null) || true
  if echo "$stderr_out" | grep -q "$pattern"; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (stderr was: $(echo "$stderr_out" | head -5))"
    FAIL=$((FAIL + 1))
  fi
}

# assert_no_stderr <name> <cmd> [args...]
# Asserts stderr is empty.
assert_no_stderr() {
  local name="$1"; shift
  local stderr_out
  stderr_out=$("$@" 2>&1 >/dev/null) || true
  if [[ -z "$stderr_out" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (unexpected stderr: $(echo "$stderr_out" | head -3))"
    FAIL=$((FAIL + 1))
  fi
}

# assert_file_unchanged <name> <file> <cmd> [args...]
# Records mtime before command; asserts mtime identical after.
assert_file_unchanged() {
  local name="$1" file="$2"; shift 2
  local mtime_before mtime_after
  mtime_before=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null)
  "$@" >/dev/null 2>&1 || true
  mtime_after=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null)
  if [[ "$mtime_before" == "$mtime_after" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (file was modified)"
    FAIL=$((FAIL + 1))
  fi
}

# ── isolation helpers ─────────────────────────────────────────────────────────

# setup_item <name> [status]
# Seeds a minimal item into $PANOP_DIR/testrepo/work.txt.
# status defaults to NOT_STARTED.
# PANOP_DIR must be set before calling (e.g. via new_panop_dir or mktemp).
setup_item() {
  local name="${1:?setup_item requires a name}"
  local status="${2:-NOT_STARTED}"
  if [[ -z "${PANOP_DIR:-}" ]]; then
    echo "setup_item: PANOP_DIR is unset" >&2
    return 1
  fi
  mkdir -p "$PANOP_DIR/testrepo"
  printf '{"name":"%s","status":"%s","loc":"/tmp/fake-loc-%s"}\n' \
    "$name" "$status" "$$" \
    > "$PANOP_DIR/testrepo/work.txt"
}

# new_panop_dir — sets and exports PANOP_DIR to a fresh temp dir
new_panop_dir() {
  PANOP_DIR="$(mktemp -d /tmp/wip-test-XXXXXX)"
  export PANOP_DIR
}

# teardown — removes $PANOP_DIR and unsets it
teardown() {
  [[ -n "${PANOP_DIR:-}" ]] && rm -rf "$PANOP_DIR"
  unset PANOP_DIR
}

# cleanup — alias for teardown (backward compat)
cleanup() {
  teardown
}

# summary_and_exit [label]
# Prints totals; exits non-zero if any failures.
summary_and_exit() {
  local file="${1:-}"
  echo
  echo "=== Results${file:+ ($file)}: $PASS passed, $FAIL failed ==="
  [[ $FAIL -eq 0 ]] && exit 0 || exit 1
}
