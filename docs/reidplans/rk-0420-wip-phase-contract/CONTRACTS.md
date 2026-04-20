# Contracts: wip 4-state + phase-string

Target file: `/Users/reid/dev/fun_claude/feature-collab/wip` (single bash script).
Companion hooks: `/Users/reid/.claude/hooks/on-prompt.sh`, `/Users/reid/.claude/hooks/on-stop.sh`.

---

## 1. State enum

### Canonical states (the only valid values emitted by `wip status` output, `wip list`, `wip get`)

```
NOT_STARTED
WORKING
NEEDS_INPUT
DONE
```

### Legacy alias map (accepted on input; never emitted)

| Legacy | → | Canonical | Phase side-effect |
|---|---|---|---|
| `NEW` | → | `NOT_STARTED` | none |
| `ACTIVE` | → | `WORKING` | none |
| `BLOCKED` | → | `NEEDS_INPUT` | none |
| `WAITING` | → | `NEEDS_INPUT` | none |
| `IN_REVIEW` | → | `WORKING` | sets `phase="Review"` if phase is unset; does not overwrite a set phase |
| `RETRO` | → | `WORKING` | sets `phase="Retro"` if phase is unset; does not overwrite a set phase |
| `CLOSED` | → | `DONE` | none |

Data-at-rest items with legacy `status` values must render as their canonical equivalent without modifying `work.txt`. (Persisted status stays as-written until the next `wip status` invocation, at which point normalization happens.)

### Rejection
Unknown status string → exit 2, stderr: `wip: unknown status '<X>'. Valid: NOT_STARTED, WORKING, NEEDS_INPUT, DONE`.

---

## 2. New subcommand: `wip phase`

```
wip phase <item> <text>     Set item phase display string (≤15 chars)
wip phase <item> ""         Clear phase
wip phase <item>            Print current phase to stdout (empty if unset)
```

### Validation
- `<text>` length > 15 → exit 2, stderr: `wip: phase must be ≤15 chars (got N)`
- Accept any printable characters including spaces; no shell metachar restrictions beyond what bash quoting already forces on the caller.

### Storage
Persists as top-level JSON key `phase` on the item object in `~/panop/<repo>/work.txt`. Absent when unset.

---

## 3. Modified subcommand: `wip status`

### Behavior changes
- Validator now accepts canonical + legacy set.
- On legacy input, write the canonical form to disk (normalization).
- On legacy input, emit one-line deprecation notice to stderr (single line, suppressible via `WIP_SILENT_DEPRECATION=1`):
  `wip: status '<LEGACY>' is deprecated; use '<CANONICAL>'`
- On `IN_REVIEW`/`RETRO` legacy input, apply phase side-effect per the table above.

### Exit codes
- `0` — status set (with or without deprecation notice)
- `2` — unknown status

---

## 4. `wip list` render format

Human-readable output (non-`--json`) adds phase after status when set:

```
WORKING [Phase 2: Impl]  rk-0420-wip-phase-contract  (repo: fun_claude)
NEEDS_INPUT              rk-0328-auth-fix            (repo: foo)
DONE                     rk-0329-nasqueron-app       (repo: fun_claude)
```

- If phase is empty/unset: render as before, no bracket section.
- Column alignment: `status + " [" + phase + "]"` is treated as the status column for width purposes (single-spaced; caller can pipe to `column -t` if needed).

`--json` output: unchanged (already includes arbitrary fields; `phase` appears naturally).

---

## 5. `wip get` — unchanged

Already dumps the full JSON object. `phase` field appears when set; nothing to change.

---

## 6. `wip --help` — text changes

- State section rewritten to list only the 4 canonical states and their purpose.
- Legacy aliases mentioned in a dedicated "DEPRECATED ALIASES" subsection with the migration mapping.
- `wip children` moved out of the main USAGE block into a new "ADVANCED" section with one-line description.
- `wip phase` added to main USAGE.
- `--parent` flag on `wip start` is retained but not shown in examples.

---

## 7. Hook contracts

### `on-prompt.sh`
- Continues to resolve item by cwd prefix / git branch.
- Context line injected into conversation must use canonical state names.
- Does not modify status.

### `on-stop.sh`
- Resolves item as today.
- **Unconditionally** sets status to `NEEDS_INPUT` (was: set to `WAITING` unless agent-managed).
- **Removes** the `_is_agent_managed_status` check (both in the hook and in `wip` itself).
- Does not touch `phase`.

### `_is_agent_managed_status` (in `wip` script)
- **Deleted.** No callers remain after `on-stop.sh` and `cmd_status` updates.

---

## 8. Environment variables

| Var | Effect | Default |
|---|---|---|
| `WIP_SILENT_DEPRECATION` | If `1`, suppress deprecation notice emitted by legacy-status writes | unset |

---

## 9. Invariants (MUST hold after migration)

1. `wip status <item> ACTIVE && wip get <item> \| jq -r .status` → `WORKING`
2. `wip status <item> IN_REVIEW && wip get <item> \| jq -r .phase` → `Review` (if phase was unset)
3. `wip phase <item> "x repeated 16 times"` → exit 2
4. `wip phase <item> "" && wip get <item> \| jq 'has("phase")'` → `false` (or `phase: null` — implementer's call, but must round-trip)
5. `wip --help` exit 0, contains `NOT_STARTED`, `WORKING`, `NEEDS_INPUT`, `DONE`, `wip phase`
6. An on-disk item with pre-migration `"status":"WAITING"` and no subsequent `wip status` call → `wip list` shows `NEEDS_INPUT`
7. `on-stop.sh` run against a WORKING item with `phase="Review"` → status becomes `NEEDS_INPUT` (no guard)
