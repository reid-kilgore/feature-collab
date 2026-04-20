# TEST_SPEC.md — wip 4-state + phase-string contract

## 1. Test Harness

**Framework**: Plain bash runner, same pattern as `tests/autopilot/run_tests.sh` (no external test framework required). New file: `tests/wip/run_tests.sh`.

**Helpers** (`assert`, `assert_grep`, `assert_not_grep`) copied directly from the autopilot runner. Add:
- `assert_exit` — runs command, asserts specific exit code
- `assert_stderr` — captures stderr, asserts it contains/matches a pattern
- `assert_no_stderr` — asserts stderr is empty
- `assert_file_unchanged` — records mtime before command, asserts mtime identical after

**Isolation per test**: Each test that touches `work.txt` does:
```bash
export PANOP_DIR="$(mktemp -d /tmp/wip-test-XXXXXX)"
mkdir -p "$PANOP_DIR/testrepo"
# create fixture work.txt inline with echo/printf
# run wip invocations
# assert, then rm -rf "$PANOP_DIR"
```
`wip` reads `PANOP_DIR` from line 5 of the script (`PANOP_DIR="$HOME/panop"`). The override works because the variable is set at script load time, so tests must invoke `wip` in a subprocess that inherits the env var. Verify this works with `PANOP_DIR=$tmpdir ./wip list`.

**Hook test stubs**: `on-stop.sh` uses `git -C "$cwd" branch --show-current` (line 31). Tests stub this by creating a temporary git repo (`git init`) in `$tmpdir/repo` so the branch lookup returns a known value. Alternatively, tests that pre-seed item `loc` matching `$cwd` skip the git branch fallback entirely — use this simpler approach for most hook tests.

**Claude stdin/stdout for on-prompt.sh**: on-prompt.sh reads from the hook's stdin (JSON `{"cwd":...}`). Tests pipe synthetic JSON directly: `echo '{"cwd":"'$tmpdir'/repo"}' | PANOP_DIR=$tmpdir on-prompt.sh`.

**WIP_SILENT_DEPRECATION**: Only truthy on exact value `1`; values like `0`, `true`, `yes` do NOT suppress deprecation warnings.

---

## 2. Test Categories

### Category A — Unit: Status Normalization

File: `tests/wip/test_status_normalization.sh` (1 file)

| Test ID | Input | Expected output / behavior |
|---------|-------|---------------------------|
| A01 | `wip status item NEW` | status on disk = `NOT_STARTED`; deprecation to stderr |
| A02 | `wip status item ACTIVE` | status on disk = `WORKING`; deprecation to stderr |
| A03 | `wip status item BLOCKED` | status on disk = `NEEDS_INPUT`; deprecation to stderr |
| A04 | `wip status item WAITING` | status on disk = `NEEDS_INPUT`; deprecation to stderr |
| A05 | `wip status item IN_REVIEW` (phase unset) | status = `WORKING`, phase = `Review`; deprecation to stderr |
| A06 | `wip status item IN_REVIEW` (phase already set) | status = `WORKING`, phase unchanged; deprecation to stderr |
| A07 | `wip status item RETRO` (phase unset) | status = `WORKING`, phase = `Retro`; deprecation to stderr |
| A08 | `wip status item RETRO` (phase already set) | status = `WORKING`, phase unchanged; deprecation to stderr |
| A09 | `wip status item CLOSED` | status = `DONE`; deprecation to stderr |
| A10 | `wip status item NOT_STARTED` | status = `NOT_STARTED`; no deprecation to stderr |
| A11 | `wip status item WORKING` | status = `WORKING`; no deprecation |
| A12 | `wip status item NEEDS_INPUT` | status = `NEEDS_INPUT`; no deprecation |
| A13 | `wip status item DONE` | status = `DONE`; no deprecation |
| A14 | `wip status item BOGUS` | exit 2; stderr contains `unknown status 'BOGUS'`; stderr lists all 4 canonical states |
| A15 | `WIP_SILENT_DEPRECATION=1 wip status item ACTIVE` | exit 0; nothing on stderr |
| A16 | `wip status item WAITING` twice | deprecation emitted once per invocation (not accumulated) |
| A06-remix | seed item with `phase="Scoping"` via `wip phase`; call `wip status <item> IN_REVIEW` | status becomes `WORKING`; phase remains `"Scoping"` (does not overwrite) |

### Category B — Unit: Phase Validation

File: `tests/wip/test_phase_validation.sh` (1 file)

| Test ID | Input | Expected |
|---------|-------|----------|
| B01 | `wip phase item "abc"` (3 chars) | exit 0; `wip get item \| jq -r .phase` = `abc` |
| B02 | `wip phase item "123456789012345"` (exactly 15 chars) | exit 0; phase stored |
| B03 | `wip phase item "1234567890123456"` (16 chars) | exit 2; stderr `phase must be ≤15 chars (got 16)` |
| B04 | `wip phase item ""` | exit 0; `wip get item \| jq 'has("phase")'` = `false` (or phase absent/null) |
| B05 | `wip phase item` (no text arg) | exit 0; prints current phase to stdout (empty string when unset) |
| B06 | `wip phase item "Phase 2: Impl"` then `wip phase item` | stdout = `Phase 2: Impl` |
| B07 | `wip phase item "café"` (4 Unicode chars, 5 bytes) | exit 0 — length counted as characters not bytes |
| B08 | `wip phase item "Phase 1: Scoping"` (16 chars) | exit 2 — common real-world mistake |
| B09 | `wip phase item "Review"` then `wip phase item ""` | key absent from JSON after clear |
| B10 | `wip phase item '$HOME'` | phase stored and read back as literal `$HOME`, NOT expanded; shell-metachar safety |
| B11 | `wip phase item "  Review  "` | round-trip: either trimmed to `Review` everywhere OR preserve whitespace exactly (implementer's choice, test pins one) |
| B12 | `wip phase nonexistent-item "x"` | exit non-zero with clear "item not found" stderr; must NOT create orphan phase entry |
| B13 | `wip phase item "🎉🎊🎨🎭🎪🎬🎮🎯🎲🎰🎱🎳🎴🎸"` (15 emoji) | exit 0; must accept; protects against byte-vs-char miscount on bash 3.2/zsh |

### Category C — Unit: Help Output

File: `tests/wip/test_help_output.sh` (1 file)

| Test ID | Check |
|---------|-------|
| C01 | `wip --help` exits 0 |
| C02 | stdout contains `NOT_STARTED` |
| C03 | stdout contains `WORKING` |
| C04 | stdout contains `NEEDS_INPUT` |
| C05 | stdout contains `DONE` |
| C06 | stdout contains `wip phase` in a USAGE-style context |
| C07 | stdout does NOT contain `wip children` in the main USAGE block (may appear in ADVANCED section) |
| C08 | stdout contains `DEPRECATED` or `deprecated` — the aliases are documented |
| C09 | `wip help` (no dashes) also exits 0 and produces the same output |

### Category D — Integration: End-to-End CLI Flows (all 7 invariants)

File: `tests/wip/test_e2e_flows.sh` (1 file)

| Test ID | Scenario | Invariant # |
|---------|----------|-------------|
| D01 | `wip status item ACTIVE && wip get item \| jq -r .status` = `WORKING` | §9.1 |
| D02 | `wip status item IN_REVIEW && wip get item \| jq -r .phase` = `Review` (phase was unset) | §9.2 |
| D03 | `wip phase item "xxxxxxxxxxxxxxxxx"` (17 chars) → exit 2 | §9.3 |
| D04 | `wip phase item "" && wip get item \| jq 'has("phase")'` = `false` | §9.4 |
| D05 | `wip --help` exit 0, output contains all four canonical states and `wip phase` | §9.5 |
| D06 | Pre-seed `{"name":"x","status":"WAITING"}` in work.txt; `wip list` shows `NEEDS_INPUT`; file mtime unchanged | §9.6 |
| D07 | on-stop.sh run against WORKING item with `phase="Review"` → status becomes `NEEDS_INPUT` | §9.7 |
| D08 | `wip list` human output: item with phase shows `WORKING [Review]` format |  |
| D09 | `wip list` human output: item without phase shows no bracket section |  |
| D10 | `wip list --json` output: item with phase includes `"phase"` key |  |
| D11 | `wip list --json` output: item without phase has no `"phase"` key (or null) |  |
| D12 | `wip get item` includes `"phase"` field when set |  |
| D13 | `wip children <item>` where item has no children | exits 0, produces valid (possibly empty) output; de-emphasis ≠ removal |
| D14 | `wip list --json` on item with only `name`, `status`, `loc` | pipe through `jq 'keys \| sort'` and diff against fixture key set; any added/removed key = fail; protects downstream consumers (Nasqueron, skills) |
| D15 | `wip status <item> BOGUS` | unknown status stderr is exactly: `wip: unknown status 'BOGUS'. Valid: NOT_STARTED, WORKING, NEEDS_INPUT, DONE` |

### Category E — Integration: Data-at-Rest Compatibility

File: `tests/wip/test_compat_read.sh` (1 file)

Each test writes a raw JSON line directly to a temp `work.txt` without invoking `wip status`, then asserts render output — confirming the read path maps legacy values without writing.

| Test ID | Pre-seeded status | `wip list` renders | File modified? |
|---------|------------------|--------------------|---------------|
| E01 | `"ACTIVE"` | `WORKING` | no (mtime check) |
| E02 | `"WAITING"` | `NEEDS_INPUT` | no |
| E03 | `"BLOCKED"` | `NEEDS_INPUT` | no |
| E04 | `"NEW"` | `NOT_STARTED` | no |
| E05 | `"CLOSED"` | item not shown (filtered) OR shown as `DONE` | no |
| E06 | `"IN_REVIEW"` | `WORKING` | no |
| E07 | `"RETRO"` | `WORKING` | no |
| E08 | `"NOT_STARTED"` (already canonical) | `NOT_STARTED` | no |
| E09 | two items: one `status:"ACTIVE"`, one `status:"WORKING"` | `wip list` renders both as `WORKING`; catches renderer-loop bugs | no |
| E10 | seed `{"name":"x","loc":"..."}` with NO status key at all | `wip get x` exits 0; `wip list` renders without crashing; render default: `NOT_STARTED` | no |

### Category F — Integration: Deprecation Notice

File: `tests/wip/test_deprecation.sh` (1 file)

| Test ID | Scenario | Expected |
|---------|----------|----------|
| F01 | `wip status item ACTIVE` | exactly 1 line to stderr matching `deprecated` |
| F02 | `wip status item ACTIVE` stderr line | contains both `ACTIVE` and `WORKING` |
| F03 | `WIP_SILENT_DEPRECATION=1 wip status item ACTIVE` | stderr empty |
| F04 | `wip status item WORKING` (canonical) | stderr empty |
| F05 | `wip status item NOT_STARTED` | stderr empty |
| F06 | `wip status item NEEDS_INPUT` | stderr empty |
| F07 | `wip status item DONE` | stderr empty |
| F08 | one `on-stop.sh` invocation against item with legacy on-disk status | exactly one `deprecated` stderr line, not two, even if both read-normalize and write-normalize paths fire |

### Category G — Hook: on-stop.sh

File: `tests/wip/test_hook_on_stop.sh` (1 file)

Tests pipe synthetic JSON to the hook: `echo '{"cwd":"$loc"}' | on-stop.sh`

| Test ID | Setup | Expected |
|---------|-------|----------|
| G01 | Item in WORKING, no phase | status becomes `NEEDS_INPUT` |
| G02 | Item in WORKING, phase = `Review` | status becomes `NEEDS_INPUT` (no guard) |
| G03 | Item in WORKING, phase = `Retro` | status becomes `NEEDS_INPUT` (no guard) |
| G04 | Item in DONE state | status unchanged (hook skips DONE items) |
| G05 | cwd does not match any item loc | hook exits 0 without error, no status change |
| G06 | Phase field value after hook | phase is unchanged from pre-hook value |
| G07 | invoke `bash /Users/reid/.claude/hooks/on-stop.sh` as actual subprocess with synthetic stdin `{"cwd":"..."}` | verifies shebang/env assumptions; not by sourcing |
| G08 | run on-stop.sh against item in `NOT_STARTED` | pin behavior: proposal = flips to `NEEDS_INPUT` (consistent with unconditional-set rule); document explicitly |

### Category H — Hook: on-prompt.sh

File: `tests/wip/test_hook_on_prompt.sh` (1 file)

| Test ID | Setup | Expected |
|---------|-------|----------|
| H01 | Item on disk with `"status":"ACTIVE"` | injected context line contains `WORKING`, not `ACTIVE` |
| H02 | Item on disk with `"status":"WAITING"` | injected context line contains `NEEDS_INPUT`, not `WAITING` |
| H03 | Item on disk with `"status":"WORKING"` and phase set | context line contains `WORKING` and phase string |
| H04 | No matching item for cwd | hook exits 0, no context injected |

### Category I — Hook: Removed Guard

File: `tests/wip/test_guard_removed.sh` (1 file)

These are static analysis tests (no subprocess needed):

| Test ID | Check | Method |
|---------|-------|--------|
| I01 | `_is_agent_managed_status` is absent from `wip` script | `grep -c '_is_agent_managed_status' wip` = 0 |
| I02 | `on-stop.sh` has no `IN_REVIEW` conditional logic | `grep -c 'IN_REVIEW' on-stop.sh` = 0 |
| I03 | `on-stop.sh` has no `RETRO` conditional logic | `grep -c 'RETRO' on-stop.sh` = 0 |
| I04 | `on-stop.sh` sets `NEEDS_INPUT` (not `WAITING`) | `grep -q 'NEEDS_INPUT' on-stop.sh` passes |
| I05 | `wip` script has no call to `_is_agent_managed_status` | grep confirms 0 call sites |
| I06 | `tests/wip/run_tests.sh` counts test files per category and exits non-zero if any category is empty | mechanically enforces "0 files = FAIL" gate |

---

## 3. Curl-Equivalent: Shell Invocation Tests

`wip` has no HTTP surface. Each new or modified subcommand has at least one end-to-end shell invocation test in Category D. Summary:

| Subcommand | End-to-end test(s) |
|------------|-------------------|
| `wip phase <item> <text>` | D-B01, B02, B03, B05, B06 |
| `wip phase <item> ""` | B04, B09, D04 |
| `wip status <item> <canonical>` | A10–A13, D01 |
| `wip status <item> <legacy>` | A01–A09, D02 |
| `wip list` (human) | D08, D09, E01–E08 |
| `wip list --json` | D10, D11 |
| `wip get <item>` | D12 |
| `wip --help` | C01–C09, D05 |

---

## 4. Per-Category File Count

| Category | File | Test Count | Phase 2 Gate: 0 files = FAIL |
|----------|------|-----------|-------------------------------|
| A — Status normalization | `tests/wip/test_status_normalization.sh` | 17 | yes |
| B — Phase validation | `tests/wip/test_phase_validation.sh` | 13 | yes |
| C — Help output | `tests/wip/test_help_output.sh` | 9 | yes |
| D — E2E CLI flows | `tests/wip/test_e2e_flows.sh` | 15 | yes |
| E — Data-at-rest compat | `tests/wip/test_compat_read.sh` | 10 | yes |
| F — Deprecation notice | `tests/wip/test_deprecation.sh` | 8 | yes |
| G — Hook: on-stop | `tests/wip/test_hook_on_stop.sh` | 8 | yes |
| H — Hook: on-prompt | `tests/wip/test_hook_on_prompt.sh` | 4 | yes |
| I — Removed guard | `tests/wip/test_guard_removed.sh` | 6 | yes |
| **Total** | 9 files | **90** | |

Entry point: `tests/wip/run_tests.sh` sources all category files and reports aggregate PASS/FAIL in the same format as `tests/autopilot/run_tests.sh`.

---

## 5. TDD RED Plan

These tests should be written **before implementation** and must fail against the current codebase, proving the old behavior does not satisfy the new contract.

**Write in this order:**

1. **I01–I05 (guard removed)** — `grep -c '_is_agent_managed_status' wip` currently returns non-zero (function exists at `wip:496–501`). All 5 pass once the guard is deleted, so writing them first gives the clearest red/green gate.

2. **A14 (unknown status exit code)** — `wip:291–292` currently exits 1 (`return 1`) for unknown status; contract requires exit 2. This fails immediately on the current code.

3. **A10–A13 (canonical states rejected)** — `wip:290` valid set is `NEW ACTIVE BLOCKED WAITING IN_REVIEW RETRO DONE CLOSED`; `NOT_STARTED`, `WORKING`, `NEEDS_INPUT` are not in it. All three canonical-input tests fail on current code.

4. **B01–B09 (wip phase)** — `cmd_phase` does not exist yet (`wip phase` dispatches to unknown command). All 9 fail on current code.

5. **F01–F07 (deprecation)** — current code emits no deprecation notice on legacy status writes. F01, F02 fail; F03–F07 pass coincidentally (no stderr). Write all 7 together so F03–F07 remain green after implementation as a regression guard.

6. **G02, G03 (on-stop no guard)** — `on-stop.sh:47–49` currently exits 0 without writing for `IN_REVIEW`/`RETRO`. Both fail on current code.

7. **A05–A08 (IN_REVIEW/RETRO phase side-effect)** — depend on `wip phase` existing; write after B tests but before implementation of the phase side-effect in `cmd_status`.

8. **D06, E01–E07 (read-path render)** — current `cmd_list` renderer at `wip:270–275` does no normalization on output; legacy values print as-is. These fail on current code for the affected legacy names.
