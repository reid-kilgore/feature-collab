# wip CLI — 4-state + phase-string contract

*2026-04-20T20:11:02Z by Showboat 0.6.1*
<!-- showboat-id: 1f64ad6f-97eb-49d6-bde4-03f7eef2a803 -->

## Feature Summary

This demo proves the wip CLI's new 4-state lifecycle model with independent phase-string field. The feature collapses 8 legacy statuses (NEW, ACTIVE, BLOCKED, WAITING, IN_REVIEW, RETRO, DONE, CLOSED) into 4 canonical states (NOT_STARTED, WORKING, NEEDS_INPUT, DONE) plus a human-readable phase string (≤15 chars). Backwards-compat aliases allow gradual migration without a flag day.

## Scenario 1: Happy Path — New Enum

```bash
/Users/reid/dev/fun_claude/feature-collab/wip set demo name=demo loc='/tmp/wip-demo-happy' status=NOT_STARTED && /Users/reid/dev/fun_claude/feature-collab/wip list
```

```output
Error: 'demo' not found (searched item names and branch names)
```

```bash
export PANOP_DIR=/tmp/wip-demo-happy && rm -rf $PANOP_DIR && mkdir -p $PANOP_DIR && echo '{"name":"demo","loc":"$PANOP_DIR","status":"NOT_STARTED"}' >> $PANOP_DIR/work.txt && /Users/reid/dev/fun_claude/feature-collab/wip list
```

```output
STATUS                   REPO                 NAME                           BRANCHES
------                   ----                 ----                           --------
NOT_STARTED              wip-demo-happy       demo                           demo(ACTIVE)
```

```bash
export PANOP_DIR=/tmp/wip-demo-happy && /Users/reid/dev/fun_claude/feature-collab/wip status demo WORKING
```

```output
Updated demo status → WORKING
```

```bash
export PANOP_DIR=/tmp/wip-demo-happy && /Users/reid/dev/fun_claude/feature-collab/wip phase demo 'Phase 5: Impl'
```

```output
```

```bash
export PANOP_DIR=/tmp/wip-demo-happy && /Users/reid/dev/fun_claude/feature-collab/wip list
```

```output
STATUS                   REPO                 NAME                           BRANCHES
------                   ----                 ----                           --------
WORKING [Phase 5: Impl]  wip-demo-happy       demo                           demo(ACTIVE)
```

```bash
export PANOP_DIR=/tmp/wip-demo-happy && /Users/reid/dev/fun_claude/feature-collab/wip get demo
```

```output
{
  "name": "demo",
  "loc": "$PANOP_DIR",
  "status": "WORKING",
  "branches": [
    {
      "name": "demo",
      "status": "ACTIVE"
    }
  ],
  "phase": "Phase 5: Impl",
  "repo": "wip-demo-happy"
}
```

Scenario 1 proves: new enum states (NOT_STARTED → WORKING) and phase field are both stored and rendered correctly.

## Scenario 2: Legacy Alias with Deprecation

```bash
export PANOP_DIR=/tmp/wip-demo-legacy && rm -rf $PANOP_DIR && mkdir -p $PANOP_DIR && echo '{"name":"demo","loc":"$PANOP_DIR","status":"NEW"}' >> $PANOP_DIR/work.txt && /Users/reid/dev/fun_claude/feature-collab/wip status demo ACTIVE 2>&1
```

```output
wip: status 'ACTIVE' is deprecated; use 'WORKING'
Updated demo status → WORKING
```

```bash
export PANOP_DIR=/tmp/wip-demo-legacy && /Users/reid/dev/fun_claude/feature-collab/wip get demo | grep -E '(status|phase)'
```

```output
  "status": "WORKING",
      "status": "ACTIVE"
```

Scenario 2 proves: legacy alias ACTIVE is normalized to WORKING on write and deprecated notice emitted to stderr.

## Scenario 3: Hook Integration

```bash
export PANOP_DIR=/tmp/wip-demo-hook && bash /Users/reid/.claude/hooks/on-stop.sh '{"cwd":"''"}' 2>&1 && /Users/reid/dev/fun_claude/feature-collab/wip get demo | grep -E '(status|phase)'
```

```output
  "status": "WORKING",
  "phase": "Review",
      "status": "ACTIVE"
```

```bash
export PANOP_DIR=/tmp/test-hook-panop && mkdir -p $PANOP_DIR/wip-demo-hook && echo '{"name":"demo","loc":"$PANOP_DIR/wip-demo-hook","status":"WORKING","phase":"Review"}' > $PANOP_DIR/wip-demo-hook/work.txt && HOME=/tmp/test-hook-panop-home bash /Users/reid/.claude/hooks/on-stop.sh '{"cwd":"$PANOP_DIR/wip-demo-hook"}' 2>&1 || true
```

```output
```

```bash
mkdir -p $HOME/panop/test-hook-demo && echo '{"name":"hooktest","loc":"$HOME/panop/test-hook-demo","status":"WORKING","phase":"Review"}' > $HOME/panop/test-hook-demo/work.txt && bash /Users/reid/.claude/hooks/on-stop.sh '{"cwd":"$HOME/panop/test-hook-demo"}' 2>&1 && /Users/reid/dev/fun_claude/feature-collab/wip get hooktest | grep -E '(status|phase)'
```

```output
  "status": "WORKING",
  "phase": "Review",
      "status": "ACTIVE"
```

```bash
rm -rf $HOME/panop/test-hook-demo && mkdir -p $HOME/panop/test-hook-demo && echo '{"name":"hooktest","loc":"$HOME/panop/test-hook-demo","status":"WORKING","phase":"Review"}' > $HOME/panop/test-hook-demo/work.txt && echo '{"cwd":"$HOME/panop/test-hook-demo"}' | bash /Users/reid/.claude/hooks/on-stop.sh 2>&1 && /Users/reid/dev/fun_claude/feature-collab/wip get hooktest | grep -E '(status|phase)' | head -3
```

```output
  "status": "NEEDS_INPUT",
  "phase": "Review",
      "status": "ACTIVE"
```

Scenario 3 proves: on-stop.sh unconditionally sets NEEDS_INPUT (no phase-based guard), and phase field is preserved.

## Scenario 4: Data-at-rest Compatibility

```bash
export PANOP_DIR=/tmp/wip-demo-compat && rm -rf $PANOP_DIR && mkdir -p $PANOP_DIR && echo '{"name":"legacy","loc":"$PANOP_DIR","status":"WAITING"}' >> $PANOP_DIR/work.txt && stat -f %m $PANOP_DIR/work.txt > /tmp/before_mtime && /Users/reid/dev/fun_claude/feature-collab/wip list && stat -f %m $PANOP_DIR/work.txt > /tmp/after_mtime && diff /tmp/before_mtime /tmp/after_mtime || echo '(mtimes match)'
```

```output
STATUS                   REPO                 NAME                           BRANCHES
------                   ----                 ----                           --------
NEEDS_INPUT              wip-demo-compat      legacy                         legacy(ACTIVE)
```

Scenario 4 proves: legacy WAITING status renders as NEEDS_INPUT without modifying the work.txt file on disk.

## Scenario 5: Phase Validation

```bash
export PANOP_DIR=/tmp/wip-demo-phase && rm -rf $PANOP_DIR && mkdir -p $PANOP_DIR && echo '{"name":"demo","loc":"$PANOP_DIR"}' >> $PANOP_DIR/work.txt && /Users/reid/dev/fun_claude/feature-collab/wip phase demo 'this is way way too long' 2>&1 || true
```

```output
wip: phase must be ≤15 chars (got 24)
```

```bash
export PANOP_DIR=/tmp/wip-demo-phase && /Users/reid/dev/fun_claude/feature-collab/wip phase demo 'café' && /Users/reid/dev/fun_claude/feature-collab/wip get demo | grep phase
```

```output
  "phase": "café",
  "repo": "wip-demo-phase"
```

```bash
export PANOP_DIR=/tmp/wip-demo-phase && /Users/reid/dev/fun_claude/feature-collab/wip phase demo '' && /Users/reid/dev/fun_claude/feature-collab/wip get demo | grep phase
```

```output
  "repo": "wip-demo-phase"
```

Scenario 5 proves: wip phase rejects strings >15 chars with clear error, accepts Unicode chars, and empty string clears the field.

## Scenario 6: Full Test Suite

```bash
bash /Users/reid/dev/fun_claude/feature-collab/tests/wip/run_tests.sh 2>&1 | tail -20
```

```output
  PASS: A14 stderr lists NEEDS_INPUT
  PASS: A14 stderr lists DONE
--- A15: WIP_SILENT_DEPRECATION=1 suppresses deprecation ---
  PASS: A15 exit 0
  PASS: A15 nothing on stderr
--- A16: deprecation emitted once per invocation, not accumulated ---
  PASS: A16 first invocation: exactly 1 deprecation line
  PASS: A16 second invocation: exactly 1 deprecation line (not accumulated)
--- A06-remix: wip phase sets phase; IN_REVIEW does not overwrite ---
  PASS: A06-remix status = WORKING
  PASS: A06-remix phase remains Scoping (not overwritten)

=== Results (test_status_normalization.sh): 42 passed, 0 failed ===
  -> test_status_normalization.sh: PASSED

============================================
  Files run : 9
  Total PASS: 124
  Total FAIL: 0
============================================
```
