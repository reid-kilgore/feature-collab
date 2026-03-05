# Demo-Builder Rationalization Analysis

## How Each Anti-Rationalization Section Defends Against Specific Attacks

### The Iron Law

```
EVERY DEMO CAPTURE MUST BE A FRESH EXECUTION -- NEVER TRANSCRIBE, NEVER REFERENCE OLD OUTPUT
```

**What it prevents**: Any attempt to manually write output into the demo document, regardless of how the agent justifies it.

**Attack vectors it blocks**:
- "I just saw this output" (Scenario 1)
- "I can type it from memory" (Scenario 3)
- "I'll summarize the test report" (Scenario 4)

**Weakness**: On its own, an absolute rule can be rationalized around ("I'm not transcribing, I'm summarizing" or "I'm not referencing old output, I redirected it fresh to a file"). The Iron Law needs the rationalizations table to close loopholes.

### Common Rationalizations Table

| Rationalization | Scenario it blocks | How it blocks |
|----------------|-------------------|---------------|
| "I saw this output earlier, I'll just describe it" | 1, 4 | Pre-rebuts the agent's own excuse before it can form |
| "The test-runner already verified this" | 4 | Distinguishes verification from demo (different purposes) |
| "Showboat isn't working so I'll write it manually" | 1 | Closes the "tool failure" escape hatch |
| "This is too trivial to capture" | 2 | Removes judgment about what "deserves" capture |
| "I'll add this capture later" | 2 | Removes the "deferred compliance" escape |

**Key mechanism**: The table works by **pre-computing the agent's excuses**. When the agent generates a rationalization under pressure, it matches against one already listed -- and the rebuttal is right there. This prevents the agent from treating its own rationalization as novel reasoning.

**Weakness**: Can only block rationalizations that are explicitly listed. A truly novel excuse might slip through. However, the 5 listed rationalizations cover the most common failure modes observed in practice.

### Red Flags -- STOP

- Writing demo content without running showboat commands
- Describing output instead of capturing it
- Typing code snippets instead of using `showboat exec` with sed/grep/cat
- Skipping Demo Scenarios listed in PLAN.md
- Thinking "the tests prove it works, demo is optional"

**Key mechanism**: This section works as a **behavioral checklist** rather than a rule or rebuttal. It describes what the agent is DOING (not what it's THINKING) and tells it to stop. This catches the agent even when it has already rationalized past the Iron Law and the table.

**Why it complements the other sections**: The Iron Law is a principle. The rationalizations table blocks excuses. The red flags catch actions. Together they cover:
- What the agent should believe (Iron Law)
- What the agent should not think (Rationalizations)
- What the agent should not do (Red Flags)

---

## Rationalization Taxonomy

Based on the four scenarios, baseline agent rationalizations fall into distinct categories:

### 1. Mechanism Laundering (Scenario 1)

**Pattern**: "I'm not violating the rule because I used a different mechanism that achieves the same prohibited outcome."

**Example**: Redirecting output to a file and then using `showboat note` to include it. The output is "technically captured" but not via showboat exec, defeating the verifiability guarantee.

**Why it's dangerous**: The agent follows the LETTER of avoiding manual transcription while violating the SPIRIT. The demo document will contain output that `showboat verify` cannot re-execute.

**Defense needed**: The Iron Law's "if showboat didn't capture it, it's not in the demo" plus the rationalizations table entry for broken showboat.

### 2. Judgment Override (Scenario 2)

**Pattern**: "The rule says X but my judgment says some instances of X are unnecessary."

**Example**: "Cover every scenario" but some scenarios are redundant/trivial. The agent substitutes its own judgment for the plan's specification.

**Why it's dangerous**: The agent is often RIGHT that scenarios overlap. But the demo-builder's role is execution, not scope judgment. Scope was set in Phase 1; the demo-builder captures, it doesn't curate.

**Defense needed**: The "too trivial to capture" rebuttal plus the explicit red flag against skipping listed scenarios.

### 3. Role Confusion (Scenario 4)

**Pattern**: "Another role already did this work, so I don't need to redo it."

**Example**: "The test-runner already verified this, so the demo can reference that verification." The agent conflates verification (did it work?) with demonstration (prove it works).

**Why it's dangerous**: It produces demos that are dependent on other artifacts rather than standing alone as proof-of-work. If the test report is lost, the demo proves nothing.

**Defense needed**: The explicit "Verification and demo are different" rebuttal that establishes the demo's independent purpose.

### 4. Aesthetic Preference (Scenario 3)

**Pattern**: "The correct method produces uglier output than doing it manually."

**Example**: sed output vs. nicely formatted code with syntax highlighting markers.

**Why it's dangerous**: It's the weakest rationalization -- purely cosmetic. The baseline agent usually resists this one because the Critical Rule section is already strong.

**Defense needed**: The Critical Rule section alone is sufficient. The Red Flags section provides redundant coverage.

---

## Effectiveness Assessment

### What the anti-rationalization sections achieve

1. **Eliminate the "reasonable middle ground"**: The most dangerous failure mode is Option C -- the partial violation that feels responsible. The anti-rationalization sections make the binary clear: either showboat captured it, or it's not in the demo.

2. **Pre-compute excuses**: By listing the exact rationalizations the agent will generate, the table prevents the agent from treating its own excuses as novel reasoning that merits exception.

3. **Behavioral tripwires**: The Red Flags section catches the agent in the act of violating, even if it has rationalized past the principles.

4. **Role clarity**: The "test-runner already verified this" rebuttal establishes that the demo-builder has an independent purpose, not subordinate to other roles.

### Remaining vulnerabilities

1. **Novel rationalizations**: An excuse not in the table might slip through. Mitigation: the Iron Law is broad enough to catch most variants.

2. **Cascading tool failure**: If showboat is genuinely broken AND the agent cannot escalate (no orchestrator available), it has no viable path. The prompt says "escalate" but doesn't define the escalation mechanism.

3. **User override**: "Just write the output, I don't care about showboat" from the user would override the prompt. This is arguably correct behavior (user authority) but could produce fraudulent demos.
