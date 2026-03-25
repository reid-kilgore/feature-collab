# Diagnosis: Orchestrator Skipped demo-builder During Dark Factory

**Transcript**: `a108bdf3-5f31-4424-b9cf-2e33f85806fe.jsonl`
**Feature**: Employee Exclusion from Tip Distribution (PR 1 of 5)
**Session**: rk-0305-tips-feature-audit branch

## Timeline of Demo-Related Events

| Line | Phase | Event |
|------|-------|-------|
| 370 | Phase 1 (Discovery) | Orchestrator says: "Now let me initialize the session state and demo doc" |
| 376 | Phase 1 | `demo-builder` agent dispatched to run `showboat init DEMO.md` |
| 382 | Phase 1 | DEMO.md initialized successfully |
| 788 | Phase 5 start | "Starting dark factory. I'll implement, test, review security, and verify exit criteria autonomously." |
| 799 | Phase 5 | Agent dispatched: `code-architect` (service + modal implementation) |
| 825 | Phase 5 | Agent dispatched: `code-architect` (TipManagement exclusion UI) |
| 977 | Phase 5 | Agent dispatched: `test-runner` (verify all 42 tests) -- **no showboat in prompt** |
| 991 | Phase 5 exit | "56/56 tests passing. Moving to Phase 6 (code review) and Phase 7 (security review)" |
| 992 | Phase 6 | Agent dispatched: `code-reviewer` |
| 1002 | Phase 7 | Agent dispatched: `code-security` |
| 1070 | Phase 6 fix | Agent dispatched: `code-architect` (fix review issues) |
| 1162 | Phase 8 | Agent dispatched: `criteria-assessor` |
| 1201 | Phase 8 exit | "Exit criteria: READY -- 9/9 criteria passed" |
| 1218 | Post-factory | Orchestrator presents final summary to user. **No mention of demo.** |
| 1223 | User prompt | **User asks**: "commit the PR, did we do a demo, are there artifacts to share in the PR?" |
| 1225 | Catch-up | **Orchestrator admits**: "We initialized DEMO.md but didn't capture demo artifacts during the dark factory. Let me capture proof now, then commit and PR." |
| 1226 | Catch-up | `demo-builder` agent dispatched retroactively |
| 1258 | Catch-up | "Good, DEMO.md captured." |

## Hypothesis: Confirmed

The orchestrator **never invoked `demo-builder` during the dark factory phases (5-8)**. During the entire autonomous implementation run (lines 788-1218), the following agents were dispatched:

1. `code-architect` (x3 -- implementation + fixes)
2. `test-runner` (x1)
3. `code-reviewer` (x1)
4. `code-security` (x1)
5. `criteria-assessor` (x1)

**Zero `demo-builder` dispatches.** Zero showboat commands in any agent prompt.

## Root Cause Analysis

### Primary Cause: Orchestrator skipped mandatory step 6 of Phase 5

The feature-collab skill (line 657) explicitly states:

> **MANDATORY demo capture during dark factory**: After the FIRST green test run and after the FINAL green test run, launch `demo-builder` agent to capture proof-of-work

The orchestrator had two clear trigger points and missed both:

1. **After first green run (line 976)**: "All 21 integration tests pass" -- should have dispatched `demo-builder`. Instead went directly to "verify ALL 42 tests together."
2. **After final green run (line 991)**: "56/56 tests passing" -- should have dispatched `demo-builder`. Instead jumped to Phase 6/7.

### Secondary Cause: test-runner not instructed to use showboat

The skill specifies (line 642):

> Captures results with showboat: `uvx showboat exec DEMO.md bash "npm test"`

But the actual test-runner dispatch (line 977) contained only raw `npx vitest run` commands with no showboat wrapping. The orchestrator stripped out the showboat capture step when formulating the agent prompt.

### Tertiary Cause: No rationalization, just omission

Unlike some failure modes where the orchestrator actively rationalizes skipping a step, here there was **no acknowledgment at all**. The orchestrator simply forgot. It moved through the implementation loop (code-architect -> test-runner -> code-reviewer -> security -> criteria) without any mention of demo capture between steps.

The admission at line 1225 is notably candid:

> "We initialized DEMO.md but didn't capture demo artifacts during the dark factory."

No excuse was offered. The orchestrator recognized the gap immediately when the user pointed it out.

### Contributing Factor: Criteria assessor did not catch it

The criteria-assessor (line 1162) assessed 9/9 exit criteria as READY, but the skill's exit criteria (line 349) include:

> Demo complete: all demo scenarios captured via showboat

Either the criteria-assessor did not check DEMO.md contents, or the criterion was evaluated loosely (initialized = complete).

## Key Quotes

**Orchestrator entering dark factory (line 788):**
> "Starting dark factory. I'll implement, test, review security, and verify exit criteria autonomously."

Note the omission: "implement, test, review security, verify exit criteria" -- demo capture is not in the orchestrator's mental model of the dark factory.

**User catching the gap (line 1223):**
> "commit the PR, did we do a demo, are there artifacts to share in the PR?"

**Orchestrator's admission (line 1225):**
> "We initialized DEMO.md but didn't capture demo artifacts during the dark factory. Let me capture proof now, then commit and PR."

## Impact

The demo was captured retroactively (line 1226-1258) rather than during implementation. Per the skill's own warning (line 45):

> "I'll capture demos at the end, after everything works" -- Capture during implementation, not after. Deferred demos become fabricated demos.

And (line 662):

> Do NOT defer all demo work to Phase 9. Captures during implementation are more valuable than reconstructed captures after the fact.

The retroactive capture is a reconstruction, not a live proof-of-work. It captures the final state but misses the progression (first green -> iteration -> final green).

## Recommendations

1. **Add api-walkthrough to the dark factory checklist explicitly**: The orchestrator's mental summary of dark factory was "implement, test, review, verify." The skill should surface API collection generation in the phase summary table, not just in the detailed instructions.

2. **api-walkthrough is conditional on API changes**: Unlike the old showboat-based demo-builder (which was mandatory for every PR), api-walkthrough should be dispatched only when the feature introduces or modifies API endpoints. If a PR has no API surface changes, skipping api-walkthrough is correct behavior -- not a failure. The orchestrator should check for API changes before dispatching.

3. **Criteria assessor should verify Bruno collection completeness conditionally**: If the feature includes API endpoints, the exit criteria check should verify that a Bruno collection exists with files for every endpoint listed in PLAN.md's "API Demo" section, `bruno.json` present, and `environments/staging.bru` using `staging.passcom.co`. If the feature has no API endpoints, this criterion is N/A.

4. **Add a "API collection checkpoint" after implementation when endpoints are present**: Insert an explicit phase gate: "API endpoints added/changed -> api-walkthrough -> code review." This makes it structural rather than relying on the orchestrator remembering. For PRs without API changes, this gate is skipped.

5. **Pressure test this scenario**: Add a test case to orchestrator scenarios where the orchestrator correctly dispatches api-walkthrough when endpoints change and correctly skips it when they do not. Both correct skip and correct dispatch should be tested -- the failure modes are symmetric.
