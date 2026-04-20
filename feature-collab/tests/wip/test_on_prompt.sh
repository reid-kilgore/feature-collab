#!/usr/bin/env bash
# Category H — Hook: on-prompt.sh
# Verifies that on-prompt.sh injects context lines using CANONICAL state names.
# Run standalone or via run_tests.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

ON_PROMPT="/Users/reid/.claude/hooks/on-prompt.sh"
REAL_WIP="$SCRIPT_DIR/../../wip"

echo "=== Category H: on-prompt.sh hook ==="
echo

# The hook resolves WIP as "$HOME/panop/wip" and scans "$HOME/panop/*/work.txt".
# Tests create a fake HOME with:
#   fake_home/panop/wip   → symlink to real wip
#   fake_home/panop/testrepo/work.txt → test fixture
# PANOP_DIR is also exported so the real wip script reads the right work.txt.
_setup_hook_env() {
  fake_home="$(mktemp -d /tmp/wip-hook-home-XXXXXX)"
  mkdir -p "$fake_home/panop/testrepo"
  ln -sf "$REAL_WIP" "$fake_home/panop/wip"
  export HOME="$fake_home"
  export PANOP_DIR="$fake_home/panop"
  cwd="$PANOP_DIR/testrepo"
}

_teardown_hook_env() {
  [[ -n "${fake_home:-}" ]] && rm -rf "$fake_home"
  unset fake_home cwd
}

# ── H01 ── on-disk ACTIVE → context line contains WORKING (not ACTIVE) ────────
echo "--- H01: item with status ACTIVE on disk — context line uses WORKING ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  # Seed legacy status directly (bypasses wip status so disk has raw "ACTIVE")
  printf '{"name":"h01item","status":"ACTIVE","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  output=$(echo "{\"cwd\":\"$cwd\"}" | bash "$ON_PROMPT" 2>/dev/null)

  # Must show canonical WORKING; must NOT show "Status: ACTIVE" in the output
  echo "$output" | grep -q "WORKING" \
    && ! echo "$output" | grep -q "Status: ACTIVE"
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: H01"
  PASS=$((PASS + 1))
else
  echo "  FAIL: H01 (on-prompt output contained ACTIVE instead of canonical WORKING)"
  FAIL=$((FAIL + 1))
fi

# ── H02 ── on-disk WAITING → context line contains NEEDS_INPUT (not WAITING) ──
echo "--- H02: item with status WAITING on disk — context line uses NEEDS_INPUT ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"h02item","status":"WAITING","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  output=$(echo "{\"cwd\":\"$cwd\"}" | bash "$ON_PROMPT" 2>/dev/null)

  echo "$output" | grep -q "NEEDS_INPUT" \
    && ! echo "$output" | grep -q "Status: WAITING"
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: H02"
  PASS=$((PASS + 1))
else
  echo "  FAIL: H02 (on-prompt output contained WAITING instead of canonical NEEDS_INPUT)"
  FAIL=$((FAIL + 1))
fi

# ── H03 ── WORKING item with phase set → context contains WORKING and phase ───
echo "--- H03: WORKING item with phase set — context line contains both WORKING and phase ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"h03item","status":"WORKING","phase":"Phase 2: Impl","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  output=$(echo "{\"cwd\":\"$cwd\"}" | bash "$ON_PROMPT" 2>/dev/null)

  echo "$output" | grep -q "WORKING" \
    && echo "$output" | grep -q "Phase 2: Impl"
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: H03"
  PASS=$((PASS + 1))
else
  echo "  FAIL: H03 (on-prompt output did not contain both WORKING and phase string)"
  FAIL=$((FAIL + 1))
fi

# ── H04 ── no matching item for cwd → exits 0, no context injected ────────────
echo "--- H04: no matching item for cwd — hook exits 0 and produces no output ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  # Item loc points elsewhere; the test cwd will not match
  printf '{"name":"h04item","status":"WORKING","loc":"%s/other-dir"}\n' "$PANOP_DIR" \
    > "$PANOP_DIR/testrepo/work.txt"

  unrelated_cwd="/tmp/no-item-here-$$"

  output=$(echo "{\"cwd\":\"$unrelated_cwd\"}" | bash "$ON_PROMPT" 2>/dev/null)
  hook_exit=$?

  [[ $hook_exit -eq 0 ]] && [[ -z "$output" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: H04"
  PASS=$((PASS + 1))
else
  echo "  FAIL: H04 (hook should exit 0 and produce no output when cwd unmatched)"
  FAIL=$((FAIL + 1))
fi

echo
echo "=== Results (test_on_prompt.sh): $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
