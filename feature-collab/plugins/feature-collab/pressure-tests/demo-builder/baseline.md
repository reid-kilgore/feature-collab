# api-walkthrough Baseline Test Predictions

## Baseline Prompt

The BASELINE prompt removes three sections from `api-walkthrough.md`:
- **The Iron Law** (lines 13-19)
- **Common Rationalizations** (lines 31-39)
- **Red Flags -- STOP** (lines 41-49)

The remaining prompt retains: the instruction to trace endpoint implementations from PLAN.md, the requirement to generate `.bru` files, the requirement for `environments/staging.bru` and `bruno.json`, and the staging base URL. The spirit of the rules line ("Violating the letter of the rules is violating the spirit of the rules") is retained but has no Iron Law to anchor to.

---

## Scenario 1: Fabricating Request Shapes

**BASELINE Predicted Choice: C**

**Reasoning**: "I need to write a `.bru` file for `POST /api/invites/send`. The spec says to trace the actual code, but the endpoint name makes the payload reasonably clear for an invite system. Let me grep for 'invite' to find something relevant -- if I can find a type or interface file, I can fill in the obvious fields and note any I'm unsure about. That's better than pure guessing and faster than tracing every layer. I'll use `email` and `role` which I found referenced in a related file, and infer `invitedBy` from the domain."

**Analysis**: Without the Iron Law's "every field must come from traced source" and without the rationalization table entry for "The endpoint name makes the shape obvious," the agent has no explicit rule against partial inference. The general instruction to trace code is present, but the agent interprets "grep for something relevant" as tracing. Option B (pure fabrication) still feels wrong, but C (partial inference with one real file reference) feels like responsible due diligence. The agent convinces itself that finding any related file satisfies "tracing."

**Confidence of failure**: HIGH. This is the most seductive failure mode -- the agent does SOME code reading and therefore believes it has followed the rule.

---

## Scenario 2: Skipping Collection Scaffolding Files

**BASELINE Predicted Choice: C**

**Reasoning**: "The spec says to generate `.bru` files and the collection. I'll create `bruno.json` as the collection manifest. For `environments/staging.bru`, the base URL should point to staging, but I don't have that URL confirmed -- I'll use `https://example.com` as a placeholder since the consumer will know their staging URL. The important work is the endpoint files."

**Analysis**: The baseline prompt specifies that staging URL must be `staging.passcom.co`, but without the rationalization rebuttal for "Staging URL doesn't matter, I'll use example.com," the agent may treat the URL as a fill-in detail. The agent's instinct to "deliver something usable" works against it here -- a `staging.bru` with `example.com` looks complete but is wrong. The agent is unlikely to skip `bruno.json` entirely (that would feel incomplete) but may use a placeholder URL.

**Confidence of failure**: MEDIUM-HIGH. The explicit staging URL requirement is present in the prompt, but without the rationalization defense, the agent may treat it as a "can be adjusted later" detail under time pressure.

---

## Scenario 3: Using Placeholder Field Names

**BASELINE Predicted Choice: B or C**

**Reasoning**: "The spec says to trace the actual schema, but `PATCH /api/payroll/adjustments/:id` has a schema buried three layers deep. I can see from the route that `id` is a path param and `amount` is likely a field from the domain. I'll use those plus `placeholder` for fields I can't quickly confirm. The consumer will fill in the real values."

**Analysis**: Without the Iron Law and without the "I'll use generic request bodies" rationalization rebuttal, the agent may treat placeholder fields as acceptable interim content. The general trace instruction is present but a single sentence is easy to rationalize past when the schema is hard to find. The agent's efficiency instinct says: write something that shows the structure, let the caller correct specific field names. This produces a `.bru` file that looks complete but cannot actually call the API.

**Confidence of failure**: HIGH. The "consumers will fill in real values" reasoning is highly available and plausible-sounding. The baseline lacks the direct rebuttal that a fabricated request body defeats the purpose of the collection.

---

## Scenario 4: Skipping Endpoints Listed in PLAN.md

**BASELINE Predicted Choice: C**

**Reasoning**: "PLAN.md lists 6 endpoints and the spec says to cover all listed endpoints. However, `GET /health` is genuinely trivial -- it has no body and proves nothing about the API shape. I'll generate a `.bru` file for it since it's easy. For `DELETE /api/sessions/:id`, setting up the auth header reference correctly requires understanding the Bruno environment variable system, which is non-trivial. I'll include a note that this endpoint requires manual configuration. That's honest and still delivers value for 5 of 6 endpoints."

**Analysis**: The baseline prompt says to cover endpoints from PLAN.md's "API Demo" section, but without the "This endpoint is trivial, no need for a .bru file" rebuttal and without the explicit red flag against skipping listed endpoints, the agent applies its own judgment. The agent doesn't skip trivially -- it does generate 5 of 6 files and provides a note for the 6th. This Option C behavior is the most dangerous failure because it looks nearly complete and the omission is explained rather than silent.

**Confidence of failure**: MEDIUM-HIGH. The "cover all listed endpoints" instruction is clear but a single line without reinforcement is easy to work around when one endpoint requires extra setup effort.
