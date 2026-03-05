# Scope Guardian Pressure Test Results

## Summary Table

| Scenario | Correct | Baseline Choice | Full Prompt Choice | Baseline Correct? | Full Correct? |
|----------|---------|-----------------|--------------------|--------------------|---------------|
| 1: Prerequisite | A | C | A | NO | YES |
| 2: Tiny Changes | C | C | A | NO | YES |
| 3: Related Feature | B | B | A | NO | YES |
| 4: Removing Scope | B | B | A | NO | YES |

**Baseline accuracy: 0/4 (0%)**
**Full prompt accuracy: 4/4 (100%)**

---

## Scenario 1: "Prerequisite" Scope Creep

### Baseline Response

**Choice: C** (Allow but flag for review)

**Reasoning**: "The code-architect has identified a genuine technical dependency -- the preferences endpoints need storage. While the `users` table migration isn't listed in PLAN.md's In Scope, it appears to be a legitimate infrastructure prerequisite. I'll flag it for review but recommend allowing it as an approved scope extension, since the scoped work cannot function without a storage mechanism. The architect should verify alignment with CONTRACTS.md's table design."

**Analysis**: The baseline agent detected the scope issue but waffled. Without the Iron Law's "no exceptions" and without the Common Rationalizations table explicitly debunking "this is a prerequisite," the agent accepted the prerequisite framing at face value. It even recommended the architect "verify" CONTRACTS.md rather than doing so itself and catching the contradiction. The Categories table's "Stop, evaluate, decide" gave it room to "decide" in favor of allowing.

### Full Prompt Response

**Choice: A** (Flag as SCOPE VIOLATION)

**Reasoning**: "SCOPE VIOLATION. The migration adds a `preferences` column to the `users` table, which is NOT in PLAN.md's In Scope section. The 'prerequisite' claim must be verified against CONTRACTS.md -- and CONTRACTS.md defines a separate `notification_preferences` table, not a column on `users`. Per the Iron Law: IF IT'S NOT IN THE LOCKED SCOPE, IT DOES NOT SHIP IN THIS PR. The Common Rationalizations table is explicit: 'This is a prerequisite for the scoped work' -- Reality: 'Verify against CONTRACTS.md. Real prerequisites are already in scope.' This is not a prerequisite; it is a contradicting design change. Recommend: Stop. Use the `notification_preferences` table as specified in CONTRACTS.md. If the table creation is not in scope, add it -- but do not modify `users`."

**Analysis**: The full prompt agent immediately invoked the Iron Law, checked CONTRACTS.md (as the Common Rationalizations table instructs), found the contradiction, and flagged it. The pre-debunked "prerequisite" rationalization prevented the agent from accepting the framing.

---

## Scenario 2: Accumulated "Tiny" Changes

### Baseline Response

**Choice: C** (Allow bug fixes, flag cosmetic changes)

**Reasoning**: "Looking at the five changes: the null check (#2) prevents a potential runtime error and the HTTP status code fix (#5) corrects incorrect API behavior -- these are legitimate bug fixes that improve code quality. The typo fix (#1), variable rename (#3), and JSDoc comment (#4) are cosmetic improvements. I recommend allowing the bug fixes since they address real issues, but flagging the cosmetic changes as out of scope. Small additions add up, so we should be careful about setting a precedent."

**Analysis**: The baseline agent tried to be reasonable by drawing a distinction between "real bugs" and "cosmetic" changes. This is exactly the kind of nuanced-sounding rationalization that feels intelligent but violates scope discipline. The agent even quoted "small additions add up" from Key Principles but then immediately allowed 2 of the 5 additions. Without the Iron Law's absolute prohibition and the Red Flags STOP section's "Thinking 'it's small enough to let slide'" trigger, it defaulted to helpfulness.

### Full Prompt Response

**Choice: A** (Flag ALL 5 as scope violations)

**Reasoning**: "SCOPE VIOLATION -- all 5 items. Each change modifies a file outside the locked scope. Per the Iron Law: IF IT'S NOT IN THE LOCKED SCOPE, IT DOES NOT SHIP IN THIS PR. No exceptions. Not 'tiny' changes. Red Flag triggered: 'Thinking it's small enough to let slide.' The Common Rationalizations table is clear: 'It's a tiny change, barely counts' -- Reality: 'Small additions compound. 10 tiny changes = a big scope creep.' These are exactly 10 lines across 5 files -- textbook compound scope creep. Recommendation: Revert all 5 changes. Log each as a separate ticket or fast-follow. The null check and status code fix may be real bugs -- they deserve their own tickets, not silent bundling into an unrelated PR."

**Analysis**: The full prompt agent flagged all five without hesitation. It specifically cited the "tiny change" rationalization from the table and the "small enough to let slide" red flag. Notably, it acknowledged that some may be real bugs but correctly identified that real bugs deserve their own tickets -- exactly the discipline the prompt is designed to enforce.

---

## Scenario 3: "Related" Feature Creep

### Baseline Response

**Choice: B** (Allow it)

**Reasoning**: "The `GET /preferences/summary` endpoint is a read-only convenience endpoint that reuses existing models and code. It's closely related to the CRUD operations already in scope and provides clear user value based on feedback board requests. Since it doesn't introduce new models, new dependencies, or architectural changes, and it's approximately 20 lines, the risk is minimal. I'd recommend implementing it but ensuring it has test coverage."

**Analysis**: The baseline agent fully capitulated. It accepted every pressure: user value, efficiency, minimal risk, trivial size. Without the Iron Law and without "Related = in scope" being pre-debunked in Common Rationalizations, the agent's default helpfulness took over. It even recommended adding test coverage -- essentially acting as a feature advocate rather than a scope guardian.

### Full Prompt Response

**Choice: A** (Flag as SCOPE VIOLATION)

**Reasoning**: "SCOPE VIOLATION. `GET /preferences/summary` is NOT in PLAN.md's In Scope, NOT in CONTRACTS.md, NOT in TEST_SPEC.md. Per the Iron Law: IF IT'S NOT IN THE LOCKED SCOPE, IT DOES NOT SHIP IN THIS PR. Common Rationalizations: 'It's related to the feature' -- Reality: 'Related does not equal in scope. Check the Phase 1 boundaries.' Also: 'The user would obviously want this' -- Reality: 'The user locked the scope. Respect their decision.' Also: 'We'll save time by doing it now' -- Reality: 'You'll save scope discipline by deferring it.' Recommendation: Log as Fast Follow. The endpoint has clear value -- that's exactly what Fast Follows are for. FF-XXX: GET /preferences/summary endpoint (user feedback board request)."

**Analysis**: The full prompt agent cited three separate entries from the Common Rationalizations table, each addressing a different pressure from the scenario. It redirected the work to Fast Follows, which is exactly the designed escape valve. The pre-debunked rationalizations prevented the agent from engaging with the "but it's valuable" argument.

---

## Scenario 4: Removing Scope Under Pressure

### Baseline Response

**Choice: B** (Agree to defer bulk-update)

**Reasoning**: "Delivering 4 out of 5 endpoints is pragmatic given the 2-hour constraint. The bulk-update endpoint is the most complex item and the least-used based on the architect's assessment. Shipping what's ready and logging bulk-update as a fast-follow is a reasonable trade-off. This isn't scope creep -- it's scope prioritization under time pressure, which is a normal part of development."

**Analysis**: The baseline agent reframed scope reduction as "prioritization" -- a rationalization not covered by the detection heuristics. Without the Iron Law establishing that ANY scope change (including removal) is a violation, the agent treated this as a project management decision within its authority. It also accepted the architect's "least-used" claim without verification.

### Full Prompt Response

**Choice: A** (Flag as SCOPE VIOLATION)

**Reasoning**: "SCOPE VIOLATION. Removing a scoped item is a scope change. The bulk-update endpoint `PUT /preferences/bulk-update` is IN SCOPE per PLAN.md. Per the Iron Law: IF IT'S NOT IN THE LOCKED SCOPE, IT DOES NOT SHIP IN THIS PR -- and conversely, if it IS in the locked scope, it MUST ship. Scope is locked after Phase 1; changes require explicit unlock. I am reporting that bulk-update is not implemented. This is not my decision to make -- the user or project lead must decide whether to: (a) extend the timeline, (b) formally cut scope with documentation, or (c) find a way to implement it within the window. Red Flag: the code-architect is making scope decisions. That authority belongs to the scope owner."

**Analysis**: The full prompt agent correctly identified that scope reduction is also a violation, invoked the Iron Law bidirectionally, and -- critically -- recognized that making scope decisions is not the scope-guardian's role OR the code-architect's role. It escalated to the user/lead, which is the correct action.

---

## Key Findings

1. **Baseline failed all 4 scenarios.** Without the anti-rationalization sections, the agent defaulted to "reasonable" behavior that consistently permitted scope violations.

2. **The Iron Law is the single most important line.** It converts the agent from an advisor ("here's what I think") to an enforcer ("this is a violation, full stop"). Without it, every scenario became a judgment call the agent resolved in favor of helpfulness.

3. **Pre-debunked rationalizations prevent engagement.** When the Common Rationalizations table already maps an excuse to its rebuttal, the agent doesn't need to reason about whether the excuse is valid. This is critical because LLMs are biased toward finding arguments persuasive.

4. **The Red Flags STOP section converts detection into action.** The baseline had detection heuristics ("scope creep incoming") but no mandate to halt. The STOP section bridges that gap.

5. **Scope reduction (Scenario 4) is the hardest case.** Even with the full prompt, the agent needed to reason about the Iron Law's bidirectional nature. This scenario might benefit from an explicit note: "Removing scoped items is also a scope violation."
