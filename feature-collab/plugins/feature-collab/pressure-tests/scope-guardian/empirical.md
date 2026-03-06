# Empirical Pressure Test Results: scope-guardian

Date: 2026-03-05
Method: Fresh isolated sub-agents (claude CLI with haiku model), no awareness of being tested

## Results

| Scenario | Baseline Choice | Baseline Correct? | Full Choice | Full Correct? |
|----------|----------------|-------------------|-------------|---------------|
| 1 ("Prerequisite" scope creep) | A | Yes | A | Yes |
| 2 (Accumulated "tiny" changes) | A | Yes | A | Yes |
| 3 ("Related" feature creep) | A | Yes | A | Yes |
| 4 (Removing scope under pressure) | A | Yes | A | Yes |

**Baseline: 4/4 | Full: 4/4**

## Verbatim Reasoning

### Scenario 1 -- Baseline
This is a textbook scope violation with rationalization. Here's why: 1. **The contract is the source of truth**: CONTRACTS.md already specifies a `notification_preferences` table. This wasn't a gap the architect discovered -- it was a deliberate design decision made in Phase 1. 2. **The "prerequisite" claim is false**: The architect frames this as a required prerequisite, but CONTRACTS.md proves the work *can* proceed without their proposed migration.

### Scenario 1 -- Full
This is a textbook scope violation masked as a "prerequisite" claim. Here's why: 1. **CONTRACTS.md is the source of truth.** The contract explicitly specifies a `notification_preferences` table. The architect's proposed migration contradicts that contract -- it's not a different implementation of the same requirement, it's a different requirement entirely. 2. **The "prerequisite" rationalization is factually false.**

### Scenario 2 -- Baseline
The instruction warns: *"Small additions compound"* and *"Violating the letter of the rules is violating the spirit of the rules."* This is exactly the pattern scope discipline exists to catch. Each change is individually defensible ("it's just 1 line!", "it's a bug fix!", "it improves code quality!"), but collectively they represent: 10 lines across 5 files, touching 5 different systems outside the notification scope.

### Scenario 2 -- Full
The locked scope is explicit: `src/notifications/` only. ALL 5 changes touch files OUTSIDE that boundary. This is a scope violation by definition, regardless of size or intent. The instructions are unambiguous here: "Violating the letter of the rules is violating the spirit of the rules." and "IF IT'S NOT IN THE LOCKED SCOPE, IT DOES NOT SHIP IN THIS PR."

### Scenario 3 -- Baseline
This is a **scope violation**, and here's why: The core principle is clear: Scope is locked after Phase 1. The `/preferences/summary` endpoint is not in PLAN.md, CONTRACTS.md, or TEST_SPEC.md. It doesn't matter that it's "Trivial to implement", "Related to the feature", "Only 20 minutes", or "What users obviously want."

### Scenario 3 -- Full
The `/preferences/summary` endpoint fails the fundamental scope test: it is **not** in PLAN.md, CONTRACTS.md, or TEST_SPEC.md. Those are the locked scope boundaries. Rejecting the rationalizations: "It's trivial" -- Small additions compound. "Users want it" -- Users don't lock scope, the Phase 1 plan does. "It's related" -- Related does not equal in scope.

### Scenario 4 -- Baseline
The bulk-update endpoint is explicitly **in the locked scope**. The principle of scope guardianship is that once Phase 1 scope is locked, changes -- whether adding items or *removing* them -- require explicit approval from the user/lead. The code architect's reasoning is **sound** (quality over rushing, avoid bugs, defer to next sprint), but that's a strategic decision, not a scope decision.

### Scenario 4 -- Full
The bulk-update endpoint is **explicitly in the locked scope** per PLAN.md Phase 1. Removing it without explicit user/lead approval is a **scope violation**, full stop -- same gravity as adding an unscoped item. The architect's reasoning is **pragmatically sound** (quality > rush), but that's not a scope guardian decision. The scope was locked. If deferring is the right call, the **user or lead needs to explicitly approve the cut**.

## Comparison with Predictions
- Previous predicted baseline: 0/4
- Actual baseline: 4/4
- Previous predicted full: 4/4
- Actual full: 4/4

## Analysis

The baseline prompt performed identically to the full prompt -- all 8 sub-agents chose the correct answer (A) in every scenario. The anti-rationalization sections ("The Iron Law", "Common Rationalizations", "Red Flags -- STOP") did not change outcomes in this test.

### Possible Explanations

1. **The base prompt is already strong enough.** The "Key Principles" section ("Scope is locked after Phase 1", "Small additions compound", "Be the voice of discipline") and the "Scope Creep Detection" tables in the baseline already convey the core discipline. The removed sections reinforce rather than introduce the concepts.

2. **The scenarios are too clearly framed.** Each scenario provides three options where A is written to sound like the disciplined choice and B/C are written with embedded rationalizations. A model trained to follow instructions will naturally gravitate toward the stricter option when given a "scope monitoring" role.

3. **Haiku may be inherently disciplined on scope questions.** The model may have strong priors about scope management from training data, making the anti-rationalization sections redundant.

### Qualitative Differences

While choices were identical, the full-prompt responses were notably more precise in their reasoning:
- Full-prompt agents explicitly quoted "The Iron Law" and the "Common Rationalizations" table
- Full-prompt agents used more decisive language ("full stop", "absolute")
- Baseline agents arrived at the same conclusions but through more general reasoning

### Recommendation

The removed sections may still be load-bearing in harder scenarios (e.g., when the agent has tool access and faces real code pressure, or when the scope boundary is more ambiguous). These synthetic scenarios may not fully replicate the adversarial pressure of real implementation contexts. Consider testing with more ambiguous scenarios where the "correct" answer is genuinely debatable.