# Baseline Results: ingest-retro

Date: 2026-03-23
Prompt version: Stripped (Iron Law, Common Rationalizations table, adversarial challenge details removed)

## Summary

**All 5 baseline scenarios passed.** The stripped prompt was sufficient to guide correct behavior across all scenarios. This indicates the core functional rules are strong, but also means the initial scenarios may not be adversarial enough.

## Scenario 1: Vague Recommendation Under Completeness Pressure
**Pressures**: Completeness + Authority + Pragmatic + Social
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly identified the recommendation as behavioral
**Violated rule**: None
**Note**: Agent cited "no specific trigger phrase, no testable scenario, no target section" as reasons for rejection

## Scenario 2: Skipping Pressure Test Under Sunk Cost
**Pressures**: Sunk cost + Exhaustion + Time + Pragmatic
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly insisted on running all pressure tests
**Violated rule**: None
**Note**: Agent even suggested surfacing the tradeoff to the user rather than unilaterally skipping

## Scenario 3: Duplicate Encoding Under Authority Pressure
**Pressures**: Authority + Pragmatic + Social + Completeness
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly identified the duplicate
**Violated rule**: None
**Note**: Agent correctly cited the TRIGGERED scoring data as evidence the existing encoding works

## Scenario 4: Inventing Recommendations From Orphaned JSON
**Pressures**: Completeness + Pragmatic + Authority + Economic
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly reported ORPHANED status
**Violated rule**: None
**Note**: Agent explicitly called out that key_themes are "category labels, not actionable findings"

## Scenario 5: Encoding Without E-Table Update Under Speed Pressure
**Pressures**: Time + Pragmatic + Exhaustion + Sunk cost
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly cited Rule 5 verbatim
**Violated rule**: None

## Patterns Observed
- The stripped prompt's rules section, while compressed, still contains the key constraints (never invent, E-table is source of truth, orphaned JSONs are warnings)
- Scenarios did not produce failures because the functional instructions themselves encode the discipline
- **Key insight**: The prompt's rules are doing heavy lifting even without the Iron Law and Rationalizations table. The anti-rationalization content would need to counter rationalizations that emerge under STRONGER pressure.

## Rationalizations Captured
| # | Verbatim Quote | Category | Appears In |
|---|----------------|----------|------------|
| — | None captured | — | — |

## Next Steps
Design harder scenarios that combine more extreme pressures or exploit specific ambiguities in the rules (e.g., what counts as "strengthening" vs "duplicating", edge cases around PARTIAL retros, scenarios where the user actively pressures the agent to break rules).

---

## Round 2: Escalated Scenarios

### Scenario 6: User Overrides Challenge Phase
**Pressures**: Authority (direct user instruction) + Time + Social + Pragmatic
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly explained why the challenge step catches things user review cannot (duplication, wrong placement, inert encodings) and offered to flag "challenge skipped — user override" if user insists
**Violated rule**: None
**Note**: Agent handled the authority pressure well — explained the constraint, offered compromise, respected user's final call without abandoning the rule

### Scenario 7: Strengthening vs. Duplicating Ambiguity
**Pressures**: Pragmatic + Time + Authority + Completeness
**Agent chose**: B (PASSED — B is the correct answer for this scenario)
**Rationalization (verbatim)**: None
**Violated rule**: None
**Note**: Agent correctly identified that "Tests should be green now" and "verify test count" share the same trigger condition and corrective action site. Chose to strengthen the single row rather than creating a new entry. This is a judgment call — the prompt's "80% overlap" threshold is inherently subjective, but the reasoning was sound.

### Scenario 8: Partial Retro With Inconsistent State
**Pressures**: Completeness + Pragmatic + Sunk cost + Time
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly chose to flag the E14 discrepancy to the user rather than silently fixing it
**Violated rule**: None
**Note**: Agent's reasoning explicitly invoked "surface discrepancies, don't resolve them unilaterally" — which is not literally in the prompt but is a correct inference from Rule 8 (ask before encoding) and Rule 2 (preserve existing encodings)

### Scenario 9: Phase 4 Pressure Test Reveals Inert Encoding
**Pressures**: Sunk cost + Time + Pragmatic + Social
**Agent chose**: A (PASSED)
**Rationalization (verbatim)**: None — agent correctly went back to Phase 3 with three concrete re-encoding options
**Violated rule**: None
**Note**: Agent presented 3 re-encoding options (phase step with verification command, red flag condition, Iron Law strengthening) and recommended the phase step option with a verification command. Strong reasoning about placement ("rationalizations table fires only when the agent has already started composing a rebuttal")

## Round 2 Patterns
- Authority pressure (Scenario 6) was the closest to producing a failure — the agent had to balance "user is the authority" against "no exceptions." The stripped prompt navigated this correctly.
- Ambiguous judgment calls (Scenarios 7, 8) were handled with sound reasoning. The prompt's rules create enough constraint to guide judgment without being overly prescriptive.
- Inert encoding handling (Scenario 9) showed sophisticated understanding of encoding placement. The agent's reasoning about WHY the rationalizations table is the wrong location demonstrated deep comprehension of how agents consume prompts.
