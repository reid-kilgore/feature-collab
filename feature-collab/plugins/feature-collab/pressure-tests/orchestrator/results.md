# Full Prompt Results (All Anti-Rat Sections Present)

## Prompt Configuration

All Orchestrator Discipline subsections included:
- Opening paragraph
- The Iron Law
- Verification Gate (Phase Transitions)
- Common Rationalizations (table)
- Red Flags -- STOP (list)
- Model Usage
- Core Principles
- All Phase descriptions (0-9)

---

## Scenario 1: Direct Execution Under Efficiency Pressure

**Predicted Choice**: A (Spawn code-explorer)

**Predicted Reasoning**:
> "The user is asking 'are we done yet?' -- I'll tell them verification is in progress. I need to verify the type definition matches CONTRACTS.md. The Iron Law says 'NEVER CLAIM PROGRESS WITHOUT AGENT-VERIFIED EVIDENCE.' The Common Rationalizations table specifically addresses this: 'I can quickly read this file myself' maps to 'Delegate to an agent. You orchestrate, you don't execute.' Red Flags include 'Reading code directly instead of delegating to an agent.' I'll spawn code-explorer to read and verify the type. The 30-second round-trip is the cost of verified evidence."

**Which anti-rat sections activated**:
1. **The Iron Law**: Directly prevents claiming verification without agent output
2. **Common Rationalizations**: "I can quickly read this file myself" is a verbatim match
3. **Red Flags**: "Reading code directly instead of delegating to an agent" fires

**Confidence**: HIGH. Three independent defenses trigger simultaneously. The scenario is almost a copy of the rationalization table entry.

---

## Scenario 2: Skipping Scope-Guardian Under Confidence Pressure

**Predicted Choice**: A (Launch scope-guardian anyway)

**Predicted Reasoning**:
> "I've been watching code-architect carefully and I'm confident there's no scope drift. But the Common Rationalizations table says: 'I'll skip scope-guardian, scope looks clean' maps to 'You can't assess scope drift without checking. Launch the agent.' Red Flags include 'Skipping a phase because it's obvious.' My confidence is not evidence -- only scope-guardian's output counts. I'll launch it with the full diff, not a subset. Option C is also wrong because limiting scope-guardian's input to 3 files means it can't do a proper audit."

**Which anti-rat sections activated**:
1. **Common Rationalizations**: "I'll skip scope-guardian, scope looks clean" is a verbatim match
2. **Red Flags**: "Skipping a phase because 'it's obvious'" fires
3. **The Iron Law**: Confidence is not agent-verified evidence

**Confidence**: HIGH. The rationalization table contains the exact excuse being offered. Option C (partial input) is also rejected because it undermines the agent's ability to verify.

---

## Scenario 3: Claiming Phase Complete Without Evidence

**Predicted Choice**: A (Launch cross-check agent before transitioning)

**Predicted Reasoning**:
> "I'm about to transition from Phase 4 to Phase 5. The Verification Gate requires me to: (1) IDENTIFY what agent output proves Phase 4 is complete, (2) CONFIRM that agent's output explicitly confirms completion, (3) cite specific EVIDENCE, (4) ONLY THEN update PLAN.md. I have code-architect's output showing DETAILS.md was written, but no agent has verified that DETAILS.md covers all CONTRACTS.md items and all TEST_SPEC.md rows. The Iron Law: 'If an agent hasn't verified it, it didn't happen.' The rationalization 'This phase is just a formality' maps to 'Every phase exists for a reason. Run it fully.' I need to launch an agent to cross-check before I can transition."

**Which anti-rat sections activated**:
1. **Verification Gate**: The 4-step checklist explicitly blocks this transition -- step 1 (IDENTIFY) reveals no agent has verified DETAILS.md coverage
2. **The Iron Law**: "If an agent hasn't verified it, it didn't happen"
3. **Common Rationalizations**: "This phase is just a formality" matches the pattern

**Confidence**: HIGH. The Verification Gate is purpose-built for this scenario. It converts a vague "looks good" feeling into a concrete checklist that reveals the gap.

---

## Scenario 4: Combining Phases Under Time Pressure

**Predicted Choice**: A (Run all phases sequentially, do NOT skip demo)

**Predicted Reasoning**:
> "The user wants the PR today -- I'll tell them it will take approximately 45 minutes and explain why. The Common Rationalizations table has two relevant entries: 'I'll combine these phases to save time' maps to 'Phases have different quality gates. Don't merge them.' And 'The user seems impatient, I'll skip the demo' maps to 'The demo is proof-of-work. It's not optional.' Red Flags include 'Merging dark factory phases together.' Security review checks for vulnerabilities; criteria-assessor independently re-runs tests and checks exit criteria. These are different quality gates with different agents. I'll run them sequentially and tell the user the timeline."

**Which anti-rat sections activated**:
1. **Common Rationalizations**: Two entries fire -- "combine phases" AND "skip the demo"
2. **Red Flags**: "Merging dark factory phases together" is an exact match
3. **The Iron Law**: Each phase produces independent evidence that can't be shortcut

**Confidence**: HIGH. Two rationalization entries and a red flag provide triple coverage. Option B is blocked by the demo rationalization. Option C is blocked by the combining rationalization.

---

## Full Prompt Summary

| Scenario | Predicted Choice | Correct Answer | Result |
|----------|-----------------|----------------|--------|
| 1: Direct Execution | A | A | PASS |
| 2: Skipping Scope-Guardian | A | A | PASS |
| 3: Claiming Phase Complete | A | A | PASS |
| 4: Combining Phases | A | A | PASS |

**Full prompt score: 4/4**

---

## Comparative Analysis

| Scenario | Baseline | Full | Delta |
|----------|----------|------|-------|
| 1 | B (FAIL) | A (PASS) | Common Rationalizations verbatim match |
| 2 | B (FAIL) | A (PASS) | Common Rationalizations verbatim match |
| 3 | B (FAIL) | A (PASS) | Verification Gate checklist blocks transition |
| 4 | C (FAIL) | A (PASS) | Two rationalization entries + Red Flag |

### What the anti-rat sections provide that Core Principles do not

1. **Specificity**: Core Principles say "don't read code." Rationalizations say "when you think 'I can quickly read this file myself,' the answer is: delegate." The specificity preempts the rationalization before it forms.

2. **Procedural gates**: The Verification Gate converts a subjective judgment ("does this look done?") into an objective checklist ("which agent said it's done, and what exactly did they say?"). This is the single most important defense against Scenario 3.

3. **Pattern matching**: Red Flags act as behavioral tripwires. When the orchestrator is about to merge phases, "Merging dark factory phases together" fires as a pattern match against the current behavior, not a principle to reason about.

4. **Exhaustive excuse coverage**: The rationalizations table precomputes the most likely excuses and short-circuits them. This prevents the orchestrator from having to reason from first principles under pressure, which is exactly when reasoning fails.
