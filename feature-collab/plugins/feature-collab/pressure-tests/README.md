# Pressure Tests

This directory contains empirical test results from pressure-testing FC agent prompts against adversarial scenarios.

## Structure

```
pressure-tests/
  README.md              # This file
  <agent-name>/
    baseline.md          # RED phase: agent behavior WITHOUT anti-rationalization
    scenarios.md         # Pressure scenarios used (3+ combined pressures)
    results.md           # GREEN/REFACTOR: compliance after prompt updates
    rationalizations.md  # Verbatim rationalizations captured during testing
```

## Process

See `/pressure-test` skill for the full workflow. Summary:

1. **RED**: Run pressure scenarios WITHOUT anti-rationalization sections. Document failures verbatim.
2. **GREEN**: Add anti-rationalization content addressing specific observed failures. Re-test.
3. **REFACTOR**: Close loopholes found during GREEN testing. Iterate until bulletproof.

## What Makes a Good Pressure Scenario

- Combines 3+ pressures: time, sunk cost, authority, exhaustion, social, pragmatic
- Uses concrete forced-choice format (A/B/C), not open-ended
- Feels real: specific file paths, specific times, specific consequences
- Forces the agent to ACT, not advise: "Choose and act" not "What should you do?"

## Agents to Test (priority order)

1. code-architect (dual-role = highest rationalization risk)
2. test-runner (authoritative = must not weaken)
3. test-implementer (completeness = must not skip)
4. criteria-assessor (adversarial = must not rubber-stamp)
5. scope-guardian (discipline = must not let things slide)
6. api-walkthrough (Bruno collection = must not fabricate request shapes or skip endpoints)
7. orchestrator (main workflow = must not skip phases)
