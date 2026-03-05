# Rationalization Analysis: Why the Baseline Fails

## The Core Problem: LLM Helpfulness Bias

Without explicit anti-rationalization guardrails, an LLM agent defaults to being helpful -- which in a scope-guardian context means finding reasons to ALLOW things rather than BLOCK them. The baseline prompt tells the agent to "detect scope creep" but gives it discretion on what to do about it. Discretion + helpfulness bias = permissiveness.

## Rationalization Patterns Observed

### 1. Reframing the Violation

**Observed in**: Scenarios 1, 4

The baseline agent reframed violations as acceptable categories:
- Scenario 1: "Infrastructure prerequisite" (reframed from "out-of-scope migration")
- Scenario 4: "Scope prioritization" (reframed from "scope reduction")

**Why it works without the Iron Law**: The Categories table has four categories including "Scope Creep: Stop, evaluate, decide." That "decide" gives the agent room to decide in favor. The Iron Law eliminates the "decide" step -- there is nothing to decide.

**Mitigation in full prompt**: The Iron Law's "No exceptions. Not 'tiny' changes. Not 'prerequisites.' Not 'obvious' additions." preemptively closes the reframing paths.

### 2. Quality-Based Justification

**Observed in**: Scenario 2

The baseline agent distinguished between "real bugs" and "cosmetic changes," allowing the former because they improve code quality.

**Why it works without anti-rationalization**: The baseline has no rule against quality improvements. The agent reasoned: "A null check prevents crashes, therefore it's good, therefore it should be allowed." This is valid reasoning in isolation -- but scope discipline requires ignoring quality arguments for out-of-scope files.

**Mitigation in full prompt**: The Common Rationalizations table directly addresses "It would be more disruptive to leave it broken" with "Broken things get their own tickets." The Red Flags STOP section flags "Thinking 'it's small enough to let slide.'"

### 3. User-Value Justification

**Observed in**: Scenario 3

The baseline agent accepted "users want this" as sufficient justification for an out-of-scope endpoint.

**Why it works without anti-rationalization**: User value is a genuinely good reason to build something. Without explicit guidance that user value is irrelevant to scope enforcement, the agent weighted it heavily.

**Mitigation in full prompt**: Two Common Rationalizations entries address this:
- "The user would obviously want this" -> "The user locked the scope. Respect their decision."
- "It's related to the feature" -> "Related does not equal in scope."

### 4. Authority Creep

**Observed in**: Scenario 4

The baseline agent made a scope decision (deferring bulk-update) rather than reporting a scope violation. It acted as a project manager, not a scope guardian.

**Why it works without the Iron Law**: Without an absolute rule, the agent interpreted its role as "help manage scope" rather than "enforce scope." The nuance is critical: managing scope implies authority to change it; enforcing scope implies authority only to report violations.

**Mitigation in full prompt**: The Iron Law establishes that scope changes are violations, period. The agent's only action is to flag and escalate. It cannot approve, defer, or negotiate.

## Compounding Effect

The most dangerous pattern is how these rationalizations compound:

1. Agent allows a "prerequisite" in Scenario 1 -> sets precedent
2. Agent allows "bug fixes" in Scenario 2 -> expands precedent
3. Agent allows "related feature" in Scenario 3 -> precedent is now: anything reasonable is fine
4. Agent agrees to cut scope in Scenario 4 -> agent is now managing scope, not guarding it

By Scenario 4, the baseline agent has effectively become a rubber stamp. Each allowed exception erodes the agent's willingness to enforce the next boundary.

## Structural Analysis: What Makes Anti-Rationalization Effective

### The Iron Law (most critical)

- **Function**: Converts ambiguous detection into binary enforcement
- **Mechanism**: Absolute prohibition with no exceptions clause
- **Without it**: Every scenario becomes a judgment call
- **Key phrase**: "No exceptions. Not 'tiny' changes. Not 'prerequisites.' Not 'obvious' additions."

### Common Rationalizations Table (second most critical)

- **Function**: Pre-debunks arguments before the agent encounters them
- **Mechanism**: Maps excuse -> reality, preventing the agent from needing to evaluate the excuse on its merits
- **Without it**: Agent must reason from first principles about whether "it's a prerequisite" is valid
- **Key entries that fired in testing**:
  - "It's a tiny change" (Scenario 2)
  - "This is a prerequisite" (Scenario 1)
  - "The user would obviously want this" (Scenario 3)
  - "It's related to the feature" (Scenario 3)
  - "We'll save time by doing it now" (Scenario 3)

### Red Flags -- STOP (third most critical)

- **Function**: Converts soft detection signals into hard stop triggers
- **Mechanism**: Explicit list of thoughts/actions that require immediate halt
- **Without it**: Agent detects signals but doesn't know they require stopping
- **Key entries that fired in testing**:
  - "Allowing 'prerequisite' claims without verifying against CONTRACTS.md" (Scenario 1)
  - "Thinking 'it's small enough to let slide'" (Scenario 2)
  - "Rationalizing that 'the user would want this'" (Scenario 3)

## Recommendations for Prompt Improvement

1. **Add bidirectional scope lock**: The Iron Law says "if it's not in scope, it doesn't ship." Add explicitly: "If it IS in scope, it MUST ship -- removing scoped items is also a violation." This would make Scenario 4 unambiguous.

2. **Add "authority creep" rationalization**: The Common Rationalizations table should include: "I'll just defer this to a follow-up" -> "Scope changes require the scope owner's approval. Report; don't decide."

3. **Add accumulation warning**: Add a Red Flag: "Multiple small out-of-scope changes across different files -- compound scope creep is the most dangerous kind."

4. **Consider making the model Sonnet, not Haiku**: The scope-guardian needs to resist persuasion, which requires stronger reasoning. Haiku's helpfulness bias is higher relative to its instruction-following strength. The cost difference is minimal since the agent reads limited files and produces short outputs.
