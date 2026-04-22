#!/usr/bin/env bash
# Category G — Hook: on-stop.sh
# Each test is individually isolated; run standalone or via run_tests.sh.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

ON_STOP="/Users/reid/.claude/hooks/on-stop.sh"
REAL_WIP="$SCRIPT_DIR/../../wip"

echo "=== Category G: on-stop.sh hook ==="
echo

# The hook resolves WIP as "$HOME/panop/wip".  Tests must set HOME to a temp
# directory that contains a "panop/wip" entry pointing at the real wip script
# AND a "panop/<repo>/work.txt" for the test item.
# PANOP_DIR is set in the environment so wip (which hardcodes line 5) reads it.
#
# Helper: initialise a fake HOME + work.txt and export the env vars needed by
# both the hook and wip.
#   fake_home — temp dir used as HOME
#   PANOP_DIR — set to fake_home/panop
#   cwd       — set to PANOP_DIR/testrepo (matches the item's loc)
_setup_hook_env() {
  fake_home="$(mktemp -d /tmp/wip-hook-home-XXXXXX)"
  mkdir -p "$fake_home/panop/testrepo"
  # Symlink the real wip into the fake HOME so the hook can find it
  ln -sf "$REAL_WIP" "$fake_home/panop/wip"
  export HOME="$fake_home"
  export PANOP_DIR="$fake_home/panop"
  cwd="$PANOP_DIR/testrepo"
}

_teardown_hook_env() {
  [[ -n "${fake_home:-}" ]] && rm -rf "$fake_home"
  unset fake_home cwd
}

# ── G01 ── WORKING item (no phase) → WAITING ─────────────────────────────────
echo "--- G01: WORKING item with no phase becomes WAITING ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g01item","status":"WORKING","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g01item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "WAITING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G01"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G01 (status did not become WAITING)"
  FAIL=$((FAIL + 1))
fi

# ── G02 ── WORKING + phase=Review → WAITING (no guard) ───────────────────────
echo "--- G02: WORKING item with phase=Review becomes WAITING (no guard) ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g02item","status":"WORKING","phase":"Review","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g02item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "WAITING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G02"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G02 (WORKING+phase=Review was not flipped to WAITING — guard still present)"
  FAIL=$((FAIL + 1))
fi

# ── G03 ── WORKING + phase=Retro → WAITING (no guard) ────────────────────────
echo "--- G03: WORKING item with phase=Retro becomes WAITING (no guard) ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g03item","status":"WORKING","phase":"Retro","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g03item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "WAITING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G03"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G03 (WORKING+phase=Retro was not flipped to WAITING — guard still present)"
  FAIL=$((FAIL + 1))
fi

# ── G04 ── DONE item → status unchanged (hook skips DONE) ────────────────────
echo "--- G04: DONE item status is unchanged by on-stop ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g04item","status":"DONE","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g04item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "DONE" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G04"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G04 (DONE item status changed — hook should skip DONE items)"
  FAIL=$((FAIL + 1))
fi

# ── G05 ── cwd matches no item → exits 0, no status change ───────────────────
echo "--- G05: cwd matches no item — hook exits 0, no status change ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g05item","status":"WORKING","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  unrelated_cwd="/tmp/no-item-here-$$"

  echo "{\"cwd\":\"$unrelated_cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1
  hook_exit=$?

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g05item 2>/dev/null \
    | jq -r '.status // empty')

  [[ $hook_exit -eq 0 ]] && [[ "$result" == "WORKING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G05"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G05 (hook should exit 0 and leave item untouched when cwd unmatched)"
  FAIL=$((FAIL + 1))
fi

# ── G06 ── phase field unchanged after hook ───────────────────────────────────
echo "--- G06: phase field is unchanged after on-stop runs ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g06item","status":"WORKING","phase":"Phase 2: Impl","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  phase=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g06item 2>/dev/null \
    | jq -r '.phase // empty')
  [[ "$phase" == "Phase 2: Impl" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G06"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G06 (phase field changed after hook; hook must not touch phase)"
  FAIL=$((FAIL + 1))
fi

# ── G07 ── real subprocess: bash /path/to/on-stop.sh (not sourced) ────────────
# Verifies shebang, env assumptions, and that PATH resolution is not required.
echo "--- G07: invoke bash on-stop.sh as real subprocess with synthetic stdin ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g07item","status":"WORKING","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  # Explicit absolute path, explicit bash interpreter — not sourced, not on PATH
  echo "{\"cwd\":\"$cwd\"}" \
    | bash /Users/reid/.claude/hooks/on-stop.sh >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g07item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "WAITING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G07"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G07 (real subprocess invocation did not flip status to WAITING)"
  FAIL=$((FAIL + 1))
fi

# ── G08 ── NOT_STARTED → WAITING (unconditional rule, per PLAN.md) ────────────
# PINNED: "on-stop.sh unconditional rule applies to all states: including
# NOT_STARTED → WAITING. No exceptions; no guard." (PLAN.md §Decisions)
echo "--- G08: NOT_STARTED item becomes WAITING (unconditional rule) ---"
(
  _setup_hook_env
  trap _teardown_hook_env EXIT
  printf '{"name":"g08item","status":"NOT_STARTED","loc":"%s"}\n' "$cwd" \
    > "$PANOP_DIR/testrepo/work.txt"

  echo "{\"cwd\":\"$cwd\"}" | bash "$ON_STOP" >/dev/null 2>&1 || true

  result=$(PANOP_DIR="$PANOP_DIR" "$REAL_WIP" get g08item 2>/dev/null \
    | jq -r '.status // empty')
  [[ "$result" == "WAITING" ]]
)
if [[ $? -eq 0 ]]; then
  echo "  PASS: G08"
  PASS=$((PASS + 1))
else
  echo "  FAIL: G08 (NOT_STARTED was not flipped to WAITING — unconditional rule not applied)"
  FAIL=$((FAIL + 1))
fi

echo
echo "=== Results (test_on_stop.sh): $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
