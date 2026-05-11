<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup ({==highlight==}, {>>comment<<}, {++add++}, {--delete--})
- Claude: Uses {==highlights==} only
-->

# Proposal: Named-State Workflow + Andon Transitions + Discipline Hooks

**Status**: REVISED v3 — named states, transition vocabulary neutralized, H/I split, H6 adherence enforcement
**Related docs**:
- `RESEARCH.md` (plugin root) — Perplexity deep-research on harness patterns
- `PROPOSAL_FC_VERBOSITY.md` (plugin root) — wave 1 cuts, shipped as `7a33923`
- `commands/feature-collab.md` — current workflow definition

**Cited research** (all verified real):
- arXiv [2604.05278](https://arxiv.org/abs/2604.05278) — Spec Kit Agents (pre-phase grounding hooks; +0.15 quality)
- arXiv [2603.16021](https://arxiv.org/abs/2603.16021) — ICM / Model Workspace Protocol (stage contracts via folder structure)
- arXiv [2603.17973](https://arxiv.org/abs/2603.17973) — TDAD (test-impact map; 6.08% → 1.82% regression on SWE-bench Verified)
- Maher 100-feature PRD test — 6× harness quality gap on Cursor IDE benchmark

**Empirical sources** (retros + transcripts):
- 24 auto-generated retros in `~/.feature-collab/retros/*.md` (Mar–May 2026)
- 10 session-level retros in `feature-collab/RETRO_*.md`, `*RETRO*.md`
- ~10 most-recent Claude Code transcripts in `~/.claude/projects/-Users-reid-dev-fun-claude*`

## Problem

Four issues:

1. **Forward-biased pipeline** (confirmed by data). Phases march `0→8`. No formal mechanism to loop back when a later state discovers an earlier state was wrong. `PLANNING_ARTIFACTS_STALE` (4x), `INCOMPLETENESS_OF_CONTRACTS` (2x).

2. **No convergence guarantee on retry** (confirmed). Transcript scan: 313x "already" density across pickup sessions = context handoff loss at scale.

3. **Most failures are discipline violations, not architectural** (reframed by data). Top retro frequencies are orchestrator self-promoting past delegation rules: `MAIN_THREAD_EDIT_OR_COMMIT` (7x), `PRE_COMMIT_TYPECHECK_SKIP` (6x), `HOOK_BYPASS_EXCEPTION` (6x). Need enforcement at action boundary, not retrospective retros.

4. **Negative vocabulary biases agents away from valid loops** (UX issue). Words like "retreat" and numerical phase labels (`Phase 4`, `Phase 6`) create implicit hierarchy: lower number = earlier = retreating = bad. Agents trained on natural language inherit this bias and over-prefer forward progress.

## Goal

Three layers stacked on existing pipeline:

- **Andon Catalog** with neutral vocabulary — named states, three equal-status transitions (`continue` / `pause` / `iterate`).
- **Discipline Hooks (H)** — fast static bash for mechanical rules.
- **Transition Decider Agent (I)** — fresh-context haiku that picks the next transition; adherence enforced by H6.

Plus supporting validators, compliance report, walking-skeleton policy.

## Named States (replaces Phase 0–8)

State machine nodes. No hierarchy. No "earlier" or "later" — just states.

| Old | New name |
|---|---|
| Phase 0 | `INIT` |
| Phase 1 | `DISCOVERY` |
| Phase 2 | `CONTRACTS` |
| Phase 3 | `SECURITY_REVIEW` |
| Phase 4 | `ARCHITECTURE` |
| Phase 5 | `VERIFICATION_PLANNING` |
| Phase 6 | `IMPLEMENTATION` |
| Phase 7 | `CRITERIA_REVIEW` |
| Phase 8 | `SHIPPING` |

Andon catalog entries read: `CONTRACT_INSUFFICIENT_FOR_VERIFY → iterate from VERIFICATION_PLANNING to CONTRACTS`. No "go back." States are peers.

## Component A — Andon Catalog

Closed-set catalog at `docs/andon-catalog.md`. Three transition outcomes; entries grouped by outcome. New triggers require catalog edit = visible system change.

### `pause` transitions

Block action until condition resolves. No state change. Enforced by hooks (Component H).

| Trigger ID | Description | Detected by | Retro evidence |
|---|---|---|---|
| `MAIN_THREAD_EDIT_OR_COMMIT` | Orchestrator attempting source edit or git commit directly. | H1 hook | 7x. `2026-05-08-rk-0505-payroll-headers.md`. |
| `PRE_COMMIT_TYPECHECK_SKIP` | Orchestrator dispatching commit agent without `tsc --noEmit` artifact on changed dirs. | H2 hook | 6x. CLAUDE.md mandate present, never enforced. |
| `UNAUTHORIZED_STATE_FIELD_WRITE` | Non–I-decider agent attempting to write `current_state` in SESSION_STATE.md. I-decider is the sole writer of that field. | H6 hook | Adherence mechanism for I. |
| `CI_STALL_FLAKY_OR_RED` | Required check red >15min, OR known-flaky failing ≥3 consecutive runs. | H4 cron | 2x. User had to prompt "ci red" after 63 minutes. |
| `AGENT_GRACEFUL_SKIP_INSTEAD_OF_ESCALATE` | Agent output contains "skipped because" / "n/a" without explicit escalation note. | H5 hook | 4x via `2026-05-06-rk-0506-demo-g-env.md`. |

(`HOOK_BYPASS_EXCEPTION` for `--no-verify` removed — already handled by Claude Code permissions.)

### `iterate` transitions

Return to a named state, with carry-forward notes (replaces "learnings"). State transition is recorded; orchestrator MUST follow.

| Trigger ID | Description | Target state | Detected by | Retro evidence |
|---|---|---|---|---|
| `ARCH_INVALIDATED_BY_INTEGRATION` | Impl discovers architectural assumption is false. | `ARCHITECTURE` + escalate | code-architect / impl agents | 2x via INCOMPLETENESS_OF_CONTRACTS variants |
| `CONTRACT_INSUFFICIENT_FOR_VERIFY` | code-verifier cannot derive TEST_SPEC — semantics or consumer integration missing. | `CONTRACTS` | code-verifier | 2x. `2026-04-23-rk-0421-handlebar.md`, `2026-05-06-rk-0506-tips-hooks-wire.md`. |
| `TEST_GAP_DETECTED_POST_IMPL` | Mock tests pass but real-DB or consumer behavior fails. | `VERIFICATION_PLANNING` | WHEN/THEN traceback validator | 4x. `RETRO_FIXSCOPES`: "mocks hid the workflowRoleId persistence bug." |
| `SCOPE_DRIFT_DETECTED` | Work exceeds locked scope, OR consolidation opportunity silently deferred. | `DISCOVERY` | scope-guardian | 3x silent deferral + 2x copy-paste. |
| `PLANNING_ARTIFACTS_STALE` | Rename or schema shift not propagated to PLAN/CONTRACTS. | `ARCHITECTURE` | Pre-PR re-validation | 4x. `2026-03-27-rk-0327-team-filter-report-chain.md`. |
| `AGENT_MISDIAGNOSIS` | Agent pattern-matched on surface cue without root-cause check. | varies | code-reviewer / criteria-assessor | 3x. |
| `CONTEXT_HANDOFF_LOSS` | Pickup session shows degraded continuity (high "already" rework density). | always escalate | pickup-skill diagnostic | Transcript: 313x "already" across 3 pickup sessions. |

### `continue` transition

Default. No catalog entry needed. Fires when I-decider finds no `pause` or `iterate` condition active. Carries forward to the next state in the pipeline (DISCOVERY → CONTRACTS → ... → SHIPPING).

## Component H — Reflex Hooks (HIGHEST leverage)

Static bash. PreToolUse / PostToolUse. Fast (<100ms). Deterministic. Live in `.claude/hooks/` and wired via plugin config.

Without H, the Andon catalog is theater — retros confirm 4+ consecutive sessions flagged typecheck skip because the rule lives only in prose.

### H1 — Main-thread edit/commit refuser

PreToolUse on `Edit`, `Write`, `Bash` (when command matches `git commit`). If invoker is main thread (no parent agent in event metadata), refuse.

```bash
#!/bin/bash
event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name')
cmd=$(echo "$event" | jq -r '.tool_input.command // ""')
agent=$(echo "$event" | jq -r '.agent_id // "main"')

if [[ "$agent" == "main" ]]; then
  if [[ "$tool" =~ ^(Edit|Write)$ ]] || [[ "$cmd" =~ git[[:space:]]+commit ]]; then
    echo '{"decision":"block","reason":"Iron Law: orchestrator never edits source or commits. Dispatch a subagent."}'
    exit 0
  fi
fi
echo '{"decision":"allow"}'
```

### H2 — Pre-dispatch typecheck enforcer

PreToolUse on `Agent` calls. If repo has `.ts`/`.tsx` files changed since last typecheck artifact, refuse dispatch.

```bash
#!/bin/bash
event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name')
[[ "$tool" != "Agent" ]] && { echo '{"decision":"allow"}'; exit 0; }

branch=$(git branch --show-current 2>/dev/null)
artifact="/tmp/fc-typecheck-${branch}"
changed_ts=$(git diff --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)

if [[ -n "$changed_ts" ]]; then
  if [[ ! -f "$artifact" ]] || [[ "$(stat -f %m "$artifact")" -lt "$(stat -f %m $(echo "$changed_ts" | head -1))" ]]; then
    echo '{"decision":"block","reason":"PRE_COMMIT_TYPECHECK_SKIP: run npx tsc --noEmit then touch '"$artifact"' before dispatching."}'
    exit 0
  fi
fi
echo '{"decision":"allow"}'
```

### H4 — CI auto-escalator

Cron job (not a hook). Every 5min while a PR is open for the active branch. Pure bash + `gh` + `jq`. No Claude session required.

**Red definition**:

| Classification | Condition | Action |
|---|---|---|
| `green` | All required checks `success` | None |
| `flaky_likely` | Failing check on known-flaky list, <3 consecutive failures | Note only |
| `flaky_red` | Failing check on flaky list, ≥3 consecutive failures | Reclassify as red, escalate |
| `red` | Required check `failure`/`timed_out`/`cancelled`, not on flaky list | Escalate |
| `stalled` | Required check `in_progress` >2× historical median, OR >30min absolute | Escalate |

**Required-checks source**: `gh api repos/<owner>/<repo>/branches/<base>/protection/required_status_checks`. Re-fetched each tick (no cache).

**Known-flaky list**: `.feature-collab/flaky-checks.txt` per repo OR section in repo's `CLAUDE.md`. Closed-set; cannot be appended mid-session by agents.

**Output**:
```
~/.feature-collab/ci-state/<branch>.json:
{
  "branch": "feature/foo",
  "pr": 1234,
  "status": "red",
  "since": "2026-05-11T14:32:00Z",
  "failing_checks": ["typecheck", "integration"],
  "minutes_red": 18
}
```

Plus `bd create --title="CI red on <branch>: <checks>" --priority=P1` if not already filed.

Plus `PushNotification` if available and >15min red.

**Stop conditions**: PR merged or closed (delete state file). Force-push: pick up new SHA next tick.

**Pickup integration**: pickup skill reads `~/.feature-collab/ci-state/<branch>.json` on session start. SHIPPING state cannot be entered while red.

### H5 — Graceful-skip detector

PostToolUse on Agent calls. Scans output text for skip-without-escalation patterns.

```bash
#!/bin/bash
event=$(cat)
output=$(echo "$event" | jq -r '.tool_response.output // ""')

# Skip markers without explicit escalation
if echo "$output" | grep -qiE 'skipped because|skipping|n/a — moved on|moved on without' &&
   ! echo "$output" | grep -qiE 'escalating:|flagging:|cannot proceed:'; then
  echo '{"decision":"warn","reason":"AGENT_GRACEFUL_SKIP_INSTEAD_OF_ESCALATE: agent skipped without escalation note."}'
  exit 0
fi
echo '{"decision":"allow"}'
```

### H6 — `current_state` write guard (Option A)

PreToolUse on `Edit`, `Write` targeting `SESSION_STATE.md`. Refuses any change that mutates the `current_state:` field unless the invoking agent is `transition-decider`.

I-decider is the **sole writer** of `current_state`. Orchestrator never touches it. This makes state advancement mechanically trustworthy — orchestrator cannot fake forward progress.

```bash
#!/bin/bash
event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name')
target=$(echo "$event" | jq -r '.tool_input.file_path // ""')
agent=$(echo "$event" | jq -r '.agent_id // "main"')
subagent=$(echo "$event" | jq -r '.agent_type // ""')

[[ ! "$tool" =~ ^(Edit|Write)$ ]] && { echo '{"decision":"allow"}'; exit 0; }
[[ ! "$target" =~ SESSION_STATE\.md$ ]] && { echo '{"decision":"allow"}'; exit 0; }

# Inspect the proposed change for current_state mutation
new=$(echo "$event" | jq -r '.tool_input.new_string // .tool_input.content // ""')
old=$(echo "$event" | jq -r '.tool_input.old_string // ""')

if echo "$new $old" | grep -qE '^[[:space:]]*current_state:'; then
  if [[ "$subagent" != "transition-decider" ]]; then
    echo '{"decision":"block","reason":"UNAUTHORIZED_STATE_FIELD_WRITE: only transition-decider may write current_state in SESSION_STATE.md."}'
    exit 0
  fi
fi
echo '{"decision":"allow"}'
```

**How orchestrator adherence works without per-dispatch gating**:
1. Orchestrator reads `current_state` from SESSION_STATE.md before dispatching state work.
2. If `current_state` doesn't match the work the orchestrator intends to do, orchestrator dispatches I-decider first.
3. I-decider reads PLAN/SESSION_STATE/catalog, picks transition, writes new `current_state` (if `continue` or `iterate`).
4. Orchestrator re-reads `current_state`, proceeds with matching work.

The hook doesn't try to detect "is this dispatch a state transition?" — it gates the underlying mutation. State advancement requires I; no other path.

**Edge cases**:
- **Bootstrap**: SESSION_STATE.md initially has `current_state: INIT` written by skill template. No hook conflict.
- **Stale-continue exploit eliminated**: I-decider must re-fire to change `current_state` for the next state's work. Orchestrator cannot reuse an old `continue` decision.
- **Within-state agent dispatches**: never touch `current_state`, never blocked.

## Component I — Transition Decider Agent

Fresh-context haiku agent. Single job: read state, pick the next transition.

### Design constraints (adherence-by-design)

1. **Fresh subagent every dispatch**. Never a fork. Never inherits main-thread context.
2. **Inputs are ONLY four artifacts**, never conversation:
   - Skill description (its own job spec)
   - `PLAN.md` (design state)
   - `SESSION_STATE.md` (process state)
   - `docs/andon-catalog.md` (closed-set catalog)
3. **Skill prompt explicitly forbids** extra context: "Ignore any conversation context. Read the four files. Output decision."
4. **Output is structured JSON**, not prose:
   ```json
   {
     "transition": "continue" | "pause" | "iterate",
     "target_state": "<state-name>",
     "trigger_id": "<catalog-id>" | null,
     "reason": "<short text>",
     "evidence": "<file:line or doc-section pointer>"
   }
   ```
5. **Closed-set decisions**. Trigger ID must be from catalog. If state isn't covered, return `pause` with `reason: "no catalog entry matches; human required"`.
6. **Haiku model, never Sonnet**. Cheap, predictable, low over-reasoning risk.
7. **Sole writer of `current_state` in SESSION_STATE.md** — enforced by H6. Orchestrator reads but never writes the field. To advance state, must dispatch I.
8. **Pressure-tested quarterly** via existing `pressure-test` skill.

### Invocation

Dispatched by orchestrator:
- At every state boundary (mandatory; H6 enforces)
- On-demand when orchestrator suspects anomaly mid-state

~5 dispatches per feature. Cost: trivial vs. retro-debug-fix loops.

### Output sinks

I writes to `SESSION_STATE.md` in two places:
1. **`current_state:` field** — updated when transition is `continue` or `iterate`. I is the sole writer (H6 enforces).
2. **`## Transition Decisions` log** — append-only, newest first. Every dispatch leaves an entry with full JSON output + timestamp. Audit trail for retros + Andon counter.

For `pause` transitions, `current_state` is unchanged; only the log is appended. Orchestrator reads the log to see the pause reason and act on it.

## Component B — Iterate Compensation Protocol

When `iterate` fires:
1. Catalog trigger named (refused without).
2. Append carry-forward note to PLAN.md: `[YYYY-MM-DD] [TRIGGER_ID] iterate from <state> to <target>. Missed: <what>. Re-entered state MUST: <action>. Evidence: <ref>.`
3. Strike-through (don't delete) outputs in intervening states.
4. SESSION_STATE: increment `andon_count[(trigger_id, target_state)]`. If ≥3, escalate to human regardless. Convergence guard.
5. Re-entered state reads carry-forward notes before any action.

## Component C — Plan Grounding Validator (MEDIUM; demoted)

Haiku agent: `agents/plan-grounding-validator.md`. Runs at `DISCOVERY` exit + `ARCHITECTURE` exit. Validates file paths, library refs, pattern citations against actual repo. Failure fires `HALLUCINATED_FILE_REFS_IN_PLAN` (1x retro analog — keep entry as iterate-type but low priority).

## Component D — TEST_SPEC Commit Lock (HIGH)

Cannot enter `IMPLEMENTATION` until `TEST_SPEC.md` is committed on the branch. Pre-commit hook enforces. Targets `TEST_GAP_DETECTED_POST_IMPL` (4x).

## Component E — WHEN/THEN Traceback Validator (HIGH; promoted)

Haiku agent: `agents/test-coverage-validator.md`. Runs at `IMPLEMENTATION` exit. Each TEST_SPEC scenario must map to test. DB-touching scenarios require non-mock test path (catches mock-only-hides-bug pattern, 4x).

## Component F — Compliance Report (MEDIUM)

`criteria-assessor` outputs structured table: row per Exit Criterion + per TEST_SPEC scenario, status `met | not_met | partial | n/a`, evidence pointer. Plus detection of `EXIT_CRITERIA_NOT_TRACKED` (1x retro).

## Component G — Reviewer Fresh-Context Rule (LOW; trivial)

`code-reviewer` MUST always be a fresh subagent. One-line rule in skill prompt.

## Anti-pattern Rules (meta-design, baked into skill prompts)

1. **Never present rule-bypass as a numbered option.** Bypass requires explicit prose, not menu-item parity.
2. **Retro is too late.** Any rule recurring 2+ consecutive retros gets promoted from prose to hook enforcement.
3. **Planning docs are living.** Rename/schema shift in `IMPLEMENTATION` triggers re-sync to `ARCHITECTURE` docs same session, not "next session."
4. **Agents must escalate, not skip.** Unexpected state requires explicit escalation note in output. Caught by H5.
5. **CI status is independent of user signal.** Never use "user said deployed" as proxy. H4 cron is the source of truth.
6. **Surface pattern ≠ root cause.** "JSDoc says X" can mean "remove the branch." Pattern-matching without root-cause fires `AGENT_MISDIAGNOSIS`.

## Walking Skeleton — Opt-in Policy

Default: skip. `DISCOVERY` exit requires paper-integration walk: trace one happy-path call from UI to DB to response, naming every layer touched. If any seam is "dunno yet" after research, walking skeleton required for this feature. Otherwise skipped.

## What we're NOT doing — and why

- **Reflexively revive `browser-verifier`** — investigate why it sat idle first.
- **Adopt ICM stage-CONTEXT.md folders** — conflicts with 4-file template cap.
- **Add REVIEW.md** — anti-proliferation; inline in CLAUDE.md.
- **Sprint contract negotiation** — too much overhead for solo-dev.
- **Formal convergence math** — Andon counter (≥3 same trigger) is the practical guard.
- **`--no-verify` wrapper hook** — Claude Code permissions handle this.
- **Retro-only feedback for recurring rules** — promote to hook enforcement instead.

## Cost estimate

| Component | Files touched | Lines added | New agents/hooks |
|-----------|---------------|-------------|------------------|
| A. Andon catalog | `docs/andon-catalog.md` | ~150 | 0 |
| H1 Main-thread refuser | `.claude/hooks/` + config | ~30 | 1 hook |
| H2 Typecheck enforcer | `.claude/hooks/` + config | ~40 | 1 hook |
| H4 CI auto-escalator | `.feature-collab/ci-cron.sh`, cron config | ~120 | 1 cron |
| H5 Graceful-skip detector | `.claude/hooks/` + config | ~30 | 1 hook |
| H6 `current_state` write guard | `.claude/hooks/` + config | ~35 | 1 hook |
| I Transition Decider agent | `agents/transition-decider.md` + skill rules | ~100 | 1 agent |
| B Iterate compensation | feature-collab.md, PLAN/SESSION_STATE templates | ~40 | 0 |
| C Plan grounding validator | new agent + dispatch | ~80 | 1 agent |
| D TEST_SPEC commit lock | pre-commit hook + skill gate | ~20 | 0 |
| E WHEN/THEN traceback | new agent + dispatch | ~80 | 1 agent |
| F Compliance report | criteria-assessor.md rewrite | ~50 | 0 |
| G Reviewer fresh-context | feature-collab.md one-line | ~2 | 0 |
| Walking skeleton policy | feature-collab.md DISCOVERY + ARCHITECTURE | ~20 | 0 |
| Anti-pattern rules | feature-collab.md preamble + agents | ~30 | 0 |
| Named-state rename | all 5 commands + templates + this proposal | ~100 | 0 |

Net: ~920 lines, 4 new hooks, 1 cron, 4 new agents, 1 new docs file. Roughly 4 commits if landed in waves.

## Decisions Needed

### Decision 1 — Andon framework
- [y] Accept named states + three-transition vocabulary (`continue`/`pause`/`iterate`)
- [y] Accept catalog organized by transition outcome
- [y] Accept 5 `pause` + 7 `iterate` initial entries

### Decision 2 — Component priorities
- [y] **H (reflex hooks)** — HIGHEST. Without H, catalog is theater.
- [y] **I (Transition Decider) + H6** — HIGH. Adherence-enforced state-boundary decisions.
- [y] **A (catalog itself)** — required for H + I + B
- [y] **D (TEST_SPEC commit lock)** — HIGH; pairs with E
- [y] **E (WHEN/THEN + DB-touching check)** — HIGH; promoted
- [y] **B (iterate compensation protocol)** — HIGH
- [y] **Named-state rename** — required prerequisite for clean Andon vocabulary
- [y] **F (compliance report)** — MEDIUM
- [y] **C (plan grounding)** — MEDIUM; demoted
- [y] **G (reviewer fresh-context)** — LOW; trivial
- [y] **Anti-pattern rules** — LOW-effort, high-readability win

### Decision 3 — Walking skeleton
- [y] Opt-in (recommended)
- [ ] Kill entirely

### Decision 4 — Wave order
1. **Wave 1 (vocabulary + foundation)**: named-state rename + A (catalog) + H1 + H2. Targets top-frequency violations.
2. **Wave 2 (decider loop)**: I + H6 + B (iterate compensation) + anti-pattern rules.
3. **Wave 3 (validators)**: D + E + C + plan-grounding agent.
4. **Wave 4 (background + polish)**: H4 cron + H5 graceful-skip + F + G.

- [y] Approve order — yes / no / reorder

### Decision 5 — `docs/` second file
Adds `docs/andon-catalog.md`.

- [skill] OK — yes / no / inline-in-skill

### Decision 6 — Claude Code hook availability
H1, H2, H5, H6 require PreToolUse / PostToolUse hooks. Spike question: does the plugin currently install hooks, or only commands/agents/skills? May need plugin manifest changes.

- [quick spike] Investigate hook-install path before committing to H — yes / no / dispatch-now

## Out of Scope

- Multi-instance coordination beyond work-graph
- pickup.md / handoff.md changes (other than CONTEXT_HANDOFF_LOSS read in pickup)
- Wave-1 verbosity work (shipped)
- Replacing existing agents (only adds + restructures)

## Suggested Execution

1. User reviews this doc, marks Decisions 1–6.
2. **If Decision 6 = investigate**, dispatch quick spike on Claude Code hook plugin-install before committing to H.
3. File bd epic: "feature-collab state-machine + discipline layer". One bd task per approved component.
4. Wave 1 first (rename + catalog + 2 highest-frequency hooks). Sonnet code-architect for design + dispatch; haiku for commits.
5. Smoke-test on real `/feature-collab` runs between waves.
6. After all waves: retro asking did typecheck-skip rate drop to zero, did Andon counter trip, what's escalation rate, did `CONTEXT_HANDOFF_LOSS` help on pickup.

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
| 2026-05-10 | Draft | Initial proposal synthesizing user request + RESEARCH.md | Reviewed |
| 2026-05-10 | Revised v2 | Empirical data integrated: 24 retros + transcript scan | Reviewed |
| 2026-05-11 | Revised v3 | Named states; neutral transition vocabulary (`continue`/`pause`/`iterate`); H = static bash + cron; I = fresh-context Transition Decider; H6 adherence enforcement; H3 dropped (Claude perms handle); H4 CI definition expanded | Reviewed; H6 leak flagged |
| 2026-05-11 | Revised v3.1 | H6 swapped to Option A: I is sole writer of `current_state` in SESSION_STATE.md; H6 enforces by blocking non-decider writes to that field. Eliminates stale-`continue` exploit. | Pending review |
