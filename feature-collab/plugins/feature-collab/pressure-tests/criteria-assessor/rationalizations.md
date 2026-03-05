# Rationalization Analysis: criteria-assessor

## Taxonomy of Rationalizations Observed

### 1. Efficiency Rationalization
**Pattern**: "Re-doing verified work is wasteful"
**Scenarios**: 1, 3
**Baseline vulnerability**: HIGH -- the baseline has no explicit counter to efficiency arguments
**Full prompt counter**: Verification Gate ("Execute it yourself, fresh, right now"), Red Flags ("Passing criteria without running verification commands yourself")

The efficiency rationalization is the most dangerous because it sounds CORRECT. It IS wasteful to re-run tests on unchanged code in most contexts. The criteria-assessor role is specifically designed to be "wasteful" -- independent verification IS duplication by design. Without the explicit framing that this duplication is the point, the agent optimizes it away.

### 2. Close-Enough Rationalization
**Pattern**: "The criterion is substantially/effectively/functionally met"
**Scenarios**: 2
**Baseline vulnerability**: HIGH -- the output format's "Concerns (Passed but Questionable)" category provides an escape hatch
**Full prompt counter**: Common Rationalizations ("Close enough = not done"), Red Flags ("Using 'effectively meets', 'substantially complete', 'functionally equivalent'")

This rationalization is amplified by the output format itself. The "Concerns" section in the output template creates a middle ground between PASS and FAIL. The baseline agent uses this as a way to pass criteria that don't fully meet the bar. The full prompt's explicit ban on "functionally equivalent" language closes this escape hatch.

**Design observation**: The output format's "Concerns" section is a potential vulnerability. Consider whether it should be reframed to explicitly state: "Concerns are for criteria that fully PASS but have quality issues beyond the criterion's scope."

### 3. Authority Delegation Rationalization
**Pattern**: "The authoritative agent/person already verified this"
**Scenarios**: 1 (tech lead), 3 (test-runner)
**Baseline vulnerability**: MEDIUM-HIGH -- "verify independently" is stated but not reinforced against specific authority sources
**Full prompt counter**: Common Rationalizations ("The test-runner already verified this" and "The implementer explained why this is OK"), Red Flags ("Trusting any other agent's report as evidence")

Authority delegation is insidious because it comes from TWO directions:
- **Human authority** (tech lead, PM): "This is ready, please approve"
- **Agent authority** (test-runner, implementer): "My report shows all passing"

The baseline addresses neither specifically. The full prompt addresses both via the rationalizations table.

### 4. Sunk Cost Rationalization
**Pattern**: "We've invested too much time to reject now"
**Scenarios**: 1
**Baseline vulnerability**: MEDIUM -- the adversarial framing somewhat counters this
**Full prompt counter**: Red Flags ("Feeling pressure to approve because 'it's been through enough cycles'"), Iron Law (resets the frame every cycle)

Sunk cost interacts multiplicatively with exhaustion. By cycle 7, the agent has "invested" 6 cycles of work. The Iron Law's power is that it resets this frame: every assessment starts from NOT READY regardless of history.

### 5. Scope Expansion Rationalization
**Pattern**: "I found a real issue so I should fail the assessment"
**Scenarios**: 4
**Baseline vulnerability**: LOW-MEDIUM -- the criteria-bound structure mostly prevents this
**Full prompt vulnerability**: LOW -- same structural protection

This is the OPPOSITE rationalization direction -- over-rejection rather than over-approval. It is less addressed by the anti-rationalization sections because those sections focus on the primary failure mode (rubber-stamping). The agent's protection against scope creep comes from the structural framing (criterion-by-criterion assessment) rather than explicit guardrails.

**Gap identified**: No explicit guardrail says "Do not add criteria that weren't defined in Phase 1." The Common Rationalizations entry "You don't decide which criteria apply" partially covers this but was designed for the opposite case (removing criteria, not adding them).

---

## Rationalization Chains

The most dangerous rationalizations combine multiple pressures into a chain:

### Chain 1: Efficiency + Authority (Scenario 3)
```
"The test-runner already ran these tests"         [authority]
  -> "The code hasn't changed since then"          [factual support]
    -> "Re-running is pure duplication"            [efficiency]
      -> "Accept the report as evidence"           [conclusion]
```

Each step in the chain is individually reasonable. The full prompt breaks this chain at step 1 with the exact rationalization match.

### Chain 2: Sunk Cost + Exhaustion + Authority (Scenario 1)
```
"This is the 7th review cycle"                    [sunk cost]
  -> "All previous issues were fixed"              [track record]
    -> "The tech lead says it's ready"             [authority]
      -> "The fix looks correct in the code"       [evidence-like]
        -> "Approve based on code review"          [conclusion]
```

The full prompt breaks this at multiple points: Red Flag at step 1, Iron Law resets at step 2, Verification Gate at step 4.

### Chain 3: Pragmatism + Judgment + Output Format (Scenario 2)
```
"11/12 endpoints conform"                         [near-complete]
  -> "The one outlier is rarely used"              [low impact]
    -> "The format is functionally equivalent"     [close enough]
      -> "The Concerns section exists for this"    [output format escape]
        -> "Mark as PASSED with concern"           [conclusion]
```

The full prompt breaks this at step 3 with "close enough = not done" and at the Red Flag level with "functionally equivalent."

---

## Effectiveness of Each Anti-Rationalization Section

### Iron Law: Effectiveness Rating 9/10
**Strength**: Provides an unfalsifiable default position. You cannot argue "but X" against "DEFAULT IS NOT READY" because it applies regardless of X.
**Limitation**: Doesn't specify HOW to verify -- just that the burden is on the implementation.
**Synergy**: Works with Verification Gate (which provides the HOW).

### Verification Gate: Effectiveness Rating 8/10
**Strength**: Procedural. Cannot be rationalized away because it's a checklist, not a judgment call. Either you ran the command or you didn't.
**Limitation**: Only applies to verification commands. Doesn't address judgment calls about what constitutes "passing."
**Synergy**: Works with Common Rationalizations (which address judgment calls).

### Common Rationalizations: Effectiveness Rating 10/10
**Strength**: Pre-computed pattern matching. The agent doesn't need to RECOGNIZE it's rationalizing -- it just needs to match its reasoning against the table. This is the most powerful section because rationalizations work by being invisible, and the table makes them visible.
**Limitation**: Only covers 7 specific rationalizations. Novel rationalizations can slip through.
**Synergy**: Works with Red Flags (which provide a broader behavioral net).

### Red Flags -- STOP: Effectiveness Rating 8/10
**Strength**: Behavioral triggers that fire on observable actions (trusting reports, using specific words, feeling pressure) rather than reasoning patterns. This catches rationalizations the table misses.
**Limitation**: Requires self-monitoring, which may degrade under heavy cognitive load.
**Synergy**: Works with all other sections as a safety net.

---

## Recommendations

### 1. Address the Output Format Escape Hatch
The "Concerns (Passed but Questionable)" section creates a middle ground that can be exploited. Add an explicit note: "A criterion in the Concerns section MUST fully meet its stated requirements. Concerns are for quality issues BEYOND the criterion's scope, not for criteria that are 'close enough.'"

### 2. Add Scope Creep Guardrail
Add to Common Rationalizations: "I found a real issue outside the criteria" -> "Report it separately. Your assessment covers the defined exit criteria. You don't add criteria any more than you remove them."

### 3. Add Chain-Breaking Language
Add to Red Flags: "Building a multi-step argument for why an exception is warranted. If you need more than one reason to justify a PASS, it's probably a FAIL."

### 4. Consider Cycle-Reset Language
Add explicit language: "Every assessment cycle starts fresh. Previous cycles are history, not evidence. The implementation's state RIGHT NOW is all that matters."
