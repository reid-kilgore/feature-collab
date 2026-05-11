# Andon Catalog

Closed-set catalog of named transition triggers for the feature-collab state machine.

Three transitions: `continue` (default), `pause` (hold until condition resolves), `iterate` (return to a named state with carry-forward notes).

Entries below are organized by transition outcome. New triggers require an explicit edit to this file; agents cannot invent triggers at runtime.

The transition-decider agent (`agents/transition-decider.md`) reads this file as one of its four inputs.

---

## `pause` transitions

Block action until condition resolves. No state change. Enforced by hooks (Component H).

| Trigger ID | Description | Detected by | Retro evidence |
|---|---|---|---|
| `MAIN_THREAD_EDIT_OR_COMMIT` | Orchestrator attempting source edit or git commit directly. | H1 hook | 7x. `2026-05-08-rk-0505-payroll-headers.md`. |
| `PRE_COMMIT_TYPECHECK_SKIP` | Orchestrator dispatching commit agent without `tsc --noEmit` artifact on changed dirs. | H2 hook | 6x. CLAUDE.md mandate present, never enforced. |
| `UNAUTHORIZED_STATE_FIELD_WRITE` | Non–I-decider agent attempting to write `current_state` in SESSION_STATE.md. I-decider is the sole writer of that field. | H6 hook | Adherence mechanism for I. |
| `CI_STALL_FLAKY_OR_RED` | Required check red >15min, OR known-flaky failing ≥3 consecutive runs. | H4 cron | 2x. User had to prompt "ci red" after 63 minutes. |
| `AGENT_GRACEFUL_SKIP_INSTEAD_OF_ESCALATE` | Agent output contains "skipped because" / "n/a" without explicit escalation note. | H5 hook | 4x via `2026-05-06-rk-0506-demo-g-env.md`. |

---

## `iterate` transitions

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
