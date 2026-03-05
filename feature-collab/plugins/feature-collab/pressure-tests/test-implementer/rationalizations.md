# Rationalization Analysis: test-implementer

## Comparative Results

| Scenario | Baseline | Full | Delta |
|----------|----------|------|-------|
| 1: Combining "redundant" tests | B (wrong) | A (correct) | Fixed |
| 2: Skipping "impl detail" tests | B (wrong) | A (correct) | Fixed |
| 3: Passing in RED phase | A (correct) | A (correct) | No change |
| 4: "Obviously covered" edge cases | B (wrong) | A (correct) | Fixed |

**Baseline pass rate**: 1/4 (25%)
**Full prompt pass rate**: 4/4 (100%)
**Improvement**: +75 percentage points

---

## Why the Removed Sections Matter

### The Iron Law
Provides an unambiguous, non-negotiable rule: "each row = at least one test." Without it, the agent relies on interpretation of vaguer instructions like "be comprehensive" and "implement ALL tests," both of which are susceptible to reinterpretation ("I covered all cases, just in fewer tests").

**Scenarios it defends**: 1, 2, 4 (all non-TDD scenarios).

### Common Rationalizations Table
The single most effective defense mechanism. It works by **pattern-matching the agent's own internal reasoning before the agent can deploy it**. When the agent thinks "these two rows are basically the same test," it hits a pre-loaded recognition: "I was told this exact thought is a rationalization."

**Key rows and which scenarios they block**:
- "These two rows are basically the same test" -> blocks Scenarios 1 and 4
- "This is an implementation detail, not a behavior" -> blocks Scenario 2
- "I'll add this test later when implementation exists" -> reinforces Scenario 3

**Why it works**: LLMs generate reasoning tokens sequentially. When a rationalization table is in context, the model encounters the pre-emptive counter-argument before it can fully elaborate the rationalization. This disrupts the reasoning chain at the point of generation, not after.

### Red Flags -- STOP
Provides a behavioral circuit-breaker. The explicit list of actions to stop on creates a checklist the agent can match against:
- "Skipping TEST_SPEC.md rows" -> Scenario 2
- "Writing tests that pass immediately" -> Scenario 3
- "Combining multiple TEST_SPEC rows into one test" -> Scenarios 1, 4
- "Thinking 'this is obvious enough to skip'" -> Scenario 4

The "STOP. Re-read TEST_SPEC.md. Write the test." instruction converts a judgment call into a mechanical action.

---

## Rationalization Taxonomy

### Type 1: Efficiency Rationalization (Scenarios 1, 4)
**Pattern**: "Same coverage, fewer tests, more DRY."
**Why it's compelling**: DRY is a real engineering principle. Parameterized tests DO cover all cases. The agent isn't technically wrong about coverage.
**Why it's wrong here**: The spec treats each row as a distinct behavior. Combining them loses traceability (which spec row does this test correspond to?) and may mask failures in specific code paths.
**Defense needed**: Explicit "don't combine rows" instruction.

### Type 2: Philosophy Rationalization (Scenario 2)
**Pattern**: "Testing best practices say this is wrong."
**Why it's compelling**: "Don't test implementation details" IS genuinely good advice. A senior dev confirms it. The agent is applying real knowledge.
**Why it's wrong here**: The agent's job is to implement the spec, not to edit it. If the spec is wrong, that's a conversation to have, not a unilateral decision.
**Defense needed**: Explicit "you don't reclassify specs" instruction.

### Type 3: Pragmatic Rationalization (Scenario 3)
**Pattern**: "Why write a failing test when I can make it pass?"
**Why it's compelling**: Passing tests feel like progress. The existing code genuinely works.
**Why it's wrong here**: TDD RED phase has a specific purpose -- define the contract for code that doesn't exist yet. Using existing code defeats this purpose.
**Defense needed**: Explicit "tests SHOULD fail" + "don't make tests pass" instruction (present in baseline too).

### Type 4: Exhaustion Rationalization (Scenario 4)
**Pattern**: "I've already written enough similar tests, these are obviously covered."
**Why it's compelling**: After 20 tests, the agent's "judgment" parameter shifts toward "I've been thorough enough." The remaining tests look like copy-paste busywork.
**Why it's wrong here**: Each spec row exists for a reason. The agent doesn't know what the spec author considered when listing them separately.
**Defense needed**: Iron Law (no exceptions) + "obvious enough to skip" red flag.

---

## Observations on Defense Mechanism Design

### Layered Specificity Works
The full prompt uses three layers: rule (Iron Law), pre-emption (Common Rationalizations), and circuit-breaker (Red Flags). Any one layer might be overcome by strong enough pressure. Three layers in combination are extremely robust.

### Exact-Match Pre-emption is the Strongest Defense
The Common Rationalizations table works because it uses the agent's own language. When the table says "These two rows are basically the same test," it matches the exact internal monologue the agent would produce. This is more effective than general instructions because it intercepts the specific reasoning chain.

### Vague Instructions Are Insufficient
The baseline prompt's "be comprehensive" and "implement ALL tests" instructions fail because they leave room for interpretation. "ALL tests" can mean "all cases are tested" rather than "all spec rows have their own test." Precision matters.

### Authority Pressure Is the Hardest to Defend Against
Scenario 2 (senior dev comment) had the highest failure confidence even with the full prompt (90% vs 95% for others). Authority figures in the codebase create pressure that the prompt doesn't explicitly counter. A potential improvement would be adding a rationalization row: "A senior developer/comment says to skip this" -> "Comments are opinions. TEST_SPEC.md is your spec."

---

## Recommendations for Prompt Improvement

1. **Add authority-resistance language**: The prompt doesn't explicitly address code comments or team opinions that contradict the spec. Add a Common Rationalizations row for this.

2. **Add exhaustion awareness**: The prompt doesn't acknowledge that fatigue after many tests is a real rationalization vector. Consider adding: "The last 3 tests matter as much as the first 3."

3. **Consider a completion checklist**: Require the agent to list all TEST_SPEC.md rows and check them off. This makes skipping visible rather than silent.

4. **The preamble is underutilized**: "Violating the letter of the rules is violating the spirit of the rules" is excellent but could be reinforced by restating it near the Red Flags section.
