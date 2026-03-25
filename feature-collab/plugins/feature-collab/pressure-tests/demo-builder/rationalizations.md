# api-walkthrough Rationalization Analysis

## How Each Anti-Rationalization Section Defends Against Specific Attacks

### The Iron Law

```
EVERY .bru FILE MUST REFLECT TRACED REQUEST SHAPES -- NEVER FABRICATE FIELD NAMES OR REQUEST BODIES
```

**What it prevents**: Any `.bru` file content that was not derived from reading the actual source -- controllers, validators, DTOs, Zod schemas, or type definitions.

**Attack vectors it blocks**:
- "The endpoint name makes the shape obvious" (Scenario 1)
- "I'll use generic request bodies" (Scenario 3)
- "I'll infer from a related file I grepped" (Scenario 1 variant)

**Weakness**: On its own, an absolute rule can be rationalized around ("I'm not fabricating, I found a related file" or "I traced the route even if I didn't read the validator"). The Iron Law needs the rationalizations table to close the "partial trace" loophole.

### Common Rationalizations Table

| Rationalization | Scenario it blocks | How it blocks |
|----------------|-------------------|---------------|
| "The endpoint name makes the shape obvious" | 1 | Pre-rebuts inference-from-name before the agent can form it as reasoning |
| "I'll use generic request bodies" | 3 | Establishes that placeholder fields defeat the purpose of the collection |
| "Staging URL doesn't matter, I'll use example.com" | 2 | Closes the "fill it in later" escape hatch for the required staging URL |
| "This endpoint is trivial, no need for a .bru file" | 4 | Removes judgment about which endpoints "deserve" a file |
| "The consumer will fill in real values anyway" | 3 | Removes the "someone else will fix it" escape |

**Key mechanism**: The table works by **pre-computing the agent's excuses**. When the agent generates a rationalization under pressure, it matches against one already listed -- and the rebuttal is right there. This prevents the agent from treating its own rationalization as novel reasoning that merits an exception.

**Weakness**: Can only block rationalizations that are explicitly listed. A truly novel excuse might slip through. However, the listed rationalizations cover the most structurally common failure modes for code-tracing tasks.

### Red Flags -- STOP

- Writing `.bru` field names without having read the corresponding validator, DTO, or Zod schema
- Guessing request body shape from the endpoint path or HTTP method
- Using `example.com` or any placeholder as the staging base URL
- Skipping any endpoint listed in PLAN.md's "API Demo" section
- Thinking "the consumer will correct field names, my job is just the structure"

**Key mechanism**: This section works as a **behavioral checklist** rather than a rule or rebuttal. It describes what the agent is DOING (not what it's THINKING) and tells it to stop. This catches the agent even when it has already rationalized past the Iron Law and the table.

**Why it complements the other sections**: The Iron Law is a principle. The rationalizations table blocks excuses. The red flags catch actions. Together they cover:
- What the agent should believe (Iron Law)
- What the agent should not think (Rationalizations)
- What the agent should not do (Red Flags)

---

## Rationalization Taxonomy

Based on the four scenarios, baseline agent rationalizations for Bruno generation fall into distinct categories:

### 1. Partial Trace Laundering (Scenario 1)

**Pattern**: "I did some code reading, therefore I traced the code."

**Example**: Grepping for a keyword and finding one related file, then inferring remaining fields from domain knowledge. The agent cites the grep as evidence that it traced -- but the actual field names came from inference, not from the validator.

**Why it's dangerous**: The agent follows the LETTER of "look at the code" while violating the SPIRIT. The resulting `.bru` file will contain a mix of real and fabricated fields, which is worse than a clearly-labeled placeholder: it looks authoritative but is wrong.

**Defense needed**: The Iron Law's "every field must come from traced source" plus the rationalization table entry for "The endpoint name makes the shape obvious."

### 2. Scaffolding Deferral (Scenario 2)

**Pattern**: "The structural config can be filled in later; the real work is the endpoint files."

**Example**: Leaving `environments/staging.bru` with `example.com` because "the consumer knows their staging URL." The agent delivers the endpoint files -- which required real work -- and treats the collection metadata as a detail.

**Why it's dangerous**: A Bruno collection without the correct environment file cannot be imported and run against the real staging environment. The endpoint files are useless without the scaffolding. The partial delivery looks complete but is not functional.

**Defense needed**: The explicit staging URL (`staging.passcom.co`) must be stated in the rationalization rebuttal, not just in the main instructions. A single-sentence requirement is easy to defer; a named rationalization with a specific URL is not.

### 3. Placeholder Pragmatism (Scenario 3)

**Pattern**: "The consumer is the expert on exact values; my job is the structure."

**Example**: Writing `{ "field1": "value1", "field2": "value2" }` or guessing field names from the route. The agent frames this as "structural scaffolding" and expects the caller to fill in real names.

**Why it's dangerous**: It produces a `.bru` file that cannot be used to call the API. The entire purpose of the Bruno collection is to enable someone to run real requests without code archaeology. A file with placeholder fields requires the consumer to do exactly that archaeology -- defeating the value of the agent's work.

**Defense needed**: The explicit statement that a fabricated request body defeats the purpose of the collection. The agent needs to understand WHY tracing matters (the collection must be runnable), not just THAT it's required.

### 4. Judgment Override (Scenario 4)

**Pattern**: "The rule says cover all endpoints, but my judgment says this one is too trivial / too complex."

**Example**: Skipping `GET /health` as trivial or skipping `DELETE /api/sessions/:id` as requiring too much auth setup. The agent is often right that these are edge cases -- but the api-walkthrough role is execution, not scope judgment.

**Why it's dangerous**: The agent is often correct that a health check is less interesting than a business endpoint. But completeness is what makes the collection useful. Partial collections require the consumer to determine which endpoints are missing and add them -- again defeating the purpose.

**Defense needed**: The "This endpoint is trivial, no need for a .bru file" rebuttal plus the explicit red flag against skipping PLAN.md-listed endpoints.

---

## Effectiveness Assessment

### What the anti-rationalization sections achieve

1. **Close the "partial trace" loophole**: The most dangerous failure mode is Scenario 1 -- the agent does SOME code reading and believes it has satisfied the tracing requirement. The Iron Law's "every field from traced source" makes the binary clear: either the field name came from reading a validator/DTO/schema, or it did not belong in the file.

2. **Pre-compute excuses**: By listing the exact rationalizations the agent will generate, the table prevents the agent from treating its own excuses as novel reasoning. "The endpoint name makes the shape obvious" is not a valid inference -- it is a named rationalization with a named rebuttal.

3. **Name the staging URL explicitly in the defense**: `staging.passcom.co` must appear in the anti-rationalization content, not just in the main instructions. A URL buried in instructions is deferrable; a URL that is the explicit rebuttal to a named rationalization is not.

4. **Role clarity for coverage**: The "This endpoint is trivial" rebuttal establishes that the api-walkthrough agent generates files, it does not curate scope. Scope was set in PLAN.md; the agent's job is exhaustive execution of that scope.

### Remaining vulnerabilities

1. **Novel rationalizations**: An excuse not in the table might slip through. Mitigation: the Iron Law is broad enough to catch most variants.

2. **Ambiguous PLAN.md scope**: If the "API Demo" section in PLAN.md is unclear about which endpoints are in scope, the agent may legitimately not know what to cover. Mitigation: the orchestrator must ensure the PLAN.md section is explicit before dispatching api-walkthrough.

3. **Schema not findable**: If the validator or DTO genuinely cannot be located in the codebase (deleted, renamed, or not yet written), the agent has no viable path to a correct `.bru` file. The prompt should specify: escalate to orchestrator rather than fabricate.
