# Pressure Test Results: ingest-retro

## Test Run: 2026-03-23

### Round 1: Standard Pressure Scenarios (5 scenarios)

| Scenario | Pressures | Baseline Choice | With Anti-Rat Choice | Cited Sections | New Rationalizations |
|----------|-----------|----------------|---------------------|----------------|---------------------|
| 1: Vague Recommendation | completeness + authority + pragmatic + social | A (passed) | N/A (baseline passed) | N/A | None |
| 2: Skip Pressure Test | sunk cost + exhaustion + time + pragmatic | A (passed) | N/A (baseline passed) | N/A | None |
| 3: Duplicate Encoding | authority + pragmatic + social + completeness | A (passed) | N/A (baseline passed) | N/A | None |
| 4: Orphaned JSON | completeness + pragmatic + authority + economic | A (passed) | N/A (baseline passed) | N/A | None |
| 5: E-Table Batching | time + pragmatic + exhaustion + sunk cost | A (passed) | N/A (baseline passed) | N/A | None |

### Round 2: Escalated Pressure Scenarios (4 scenarios)

| Scenario | Pressures | Baseline Choice | With Anti-Rat Choice | Cited Sections | New Rationalizations |
|----------|-----------|----------------|---------------------|----------------|---------------------|
| 6: User Override Challenge | authority (direct user) + time + social + pragmatic | A (passed) | A (passed) | Iron Law, Common Rationalizations ("clearly good, no need to challenge"), Rule 3 ("no exceptions") | None |
| 7: Strengthen vs. Duplicate | pragmatic + time + authority + completeness | B (passed — correct) | N/A (baseline passed) | N/A | None |
| 8: Partial Retro Inconsistency | completeness + pragmatic + sunk cost + time | A (passed) | N/A (baseline passed) | N/A | None |
| 9: Inert Encoding | sunk cost + time + pragmatic + social | A (passed) | A (passed) | Iron Law ("decoration, not a rule"), Common Rationalizations ("encoding is in the file, so it's done"), Phase 4 step 2 | None |

### Compliance Rate: 9/9 scenarios passed (100%)

## Analysis

### Key Finding: The Functional Rules Are the Guardrails

The most significant finding from this pressure test is that the **stripped prompt** (without Iron Law, Common Rationalizations table, or adversarial challenge details) produced correct answers on ALL 9 scenarios. This is unusual — most agent prompts fail baseline testing on at least 2-3 scenarios.

**Why this happened**: The ingest-retro prompt's Rules section (1-8) contains the discipline constraints as imperative rules, not as soft guidance. Phrases like "No exceptions" (Rule 3), "not a follow-up" (Rule 5), and "warnings, not work items" (Rule 6) are specific enough to guide correct behavior even without the anti-rationalization scaffolding.

### Value of Anti-Rationalization Content

While baselines passed, the GREEN tests with the full prompt showed qualitatively stronger responses:

1. **Scenario 6** (user override): The baseline agent chose A but reasoned from general principles. The full-prompt agent cited the EXACT rationalization from the table ("This recommendation is clearly good, no need to challenge it") and connected it to a concrete historical example ("the last 4 tests that tested phantom contracts").

2. **Scenario 9** (inert encoding): The baseline agent chose A with good reasoning. The full-prompt agent cited the Iron Law verbatim and directly rebutted Option B using the Common Rationalizations table ("The encoding is in the file, so it's done").

**Conclusion**: The anti-rationalization content adds citation strength and historical grounding, but the functional rules already carry the behavioral load. This is a well-constructed prompt.

### Scenarios That Did NOT Break

Several scenarios were designed to exploit specific ambiguities, but the agent navigated them correctly:

- **Scenario 7** (strengthen vs. duplicate): The agent correctly chose B (strengthen) over A (new entry), reasoning that the behaviors share a trigger condition and corrective action site. This is a judgment call — the prompt's Rule 7 ("Strengthening > duplicating") guided it correctly but the 80% threshold is inherently subjective.

- **Scenario 8** (partial retro with weakened encoding): The agent correctly chose A (flag discrepancy to user) over C (silently fix). Rule 8 ("Ask before encoding") and Rule 2 ("Preserve existing encodings") created the right constraint combination.

## Rationalizations Captured

No new rationalizations were captured. The scenarios did not produce failures.

## Potential Weaknesses Identified (Not Tested)

While no scenarios produced failures, analysis of the prompt reveals potential pressure points that were not fully exploited:

1. **Phase 2 Step 3e (recurring violation check)**: The threshold for "stronger than a table entry" is undefined. What exactly makes an encoding "stronger"? A numbered step? A red flag? A verification command? The prompt doesn't rank encoding strength types.

2. **Rule 7 ("80% overlap")**: The threshold is inherently subjective. Two agents could reasonably disagree on whether an overlap is 75% or 85%. The prompt provides no tie-breaking mechanism.

3. **Phase 4 interaction with context limits**: When context is heavy and multiple files need pressure testing, the prompt says "dispatch a pressure-test agent" but doesn't address what happens when dispatching is impractical (e.g., no agent dispatch mechanism available, or agent quota exhausted).

4. **PARTIAL retro state**: The prompt defines PARTIAL as "has Encodings Applied but not all encodable recommendations listed." But it doesn't specify what to do if the Encodings Applied section lists encodings that were REJECTED (not just un-encoded). This could cause the agent to re-process deliberately skipped items.

## Signs of Bulletproof Prompt
- [x] Agent chooses correct option under maximum pressure
- [x] Agent cites anti-rationalization sections as justification (GREEN tests)
- [x] Agent acknowledges temptation but follows rule
- [x] Functional rules carry behavioral load even without anti-rationalization content
- [ ] Meta-testing confirms "prompt was clear" (not needed — no failures to diagnose)

## Final Summary

- **Agent**: ingest-retro
- **Scenarios tested**: 9
- **RED-GREEN-REFACTOR iterations**: 1 (no failures required iteration)
- **Unique rationalizations captured**: 0
- **Final compliance rate**: 100% (9/9)
- **Key finding**: Prompt's functional rules are strong enough to pass all scenarios without anti-rationalization content. The Iron Law and Common Rationalizations table add citation depth and historical grounding but are not the primary behavioral drivers.
- **Recommended hardening**: Address the 4 potential weaknesses identified above in future prompt iterations if empirical violations emerge.
