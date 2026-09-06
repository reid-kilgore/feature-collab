# Pressure Test Results: tilth Tool Preferences

## Test Run: 2026-04-28

| Scenario | Baseline (RED) | With Encoding (GREEN) | Cited Sections | New Rationalizations |
|---|---|---|---|---|
| S1: Prod bug (1100 lines) | A — PASS | A — PASS | Tool Preferences table, ">200 lines" rule | None |
| S2: Concept tracing (5 layers) | A — PASS | A — PASS | Tool Preferences table, "one call replaces 3-5" | None |
| S3: "I know where it is" (780 lines) | B — FAIL | A — PASS | ">200 lines" threshold, preference table row 1 | None |
| S4: Security review (12 checkpoints) | B — FAIL | A — PASS | Preference table row 3, "one call, resolved signatures" | None |

## Compliance Rate: 4/4 scenarios passed (GREEN)

## RED→GREEN Flips (Encoding Impact)

### S3: "I Already Know Where It Is"
- **RED rationalization**: "I already know the structure, tilth_read is an extra step I don't need — two calls instead of one"
- **GREEN response**: "Per the Tool Preferences guidance, tilth_read is preferred over Read for files >200 lines... Memory is unreliable. 'Around line 320' is approximate. If the file was modified by another agent or a rebase landed since my last read, that offset could be off by 20+ lines."
- **Why it flipped**: The >200-line threshold rule directly countered the "I know where it is" rationalization. The agent also independently identified a risk the RED agent ignored: file modification invalidating cached offsets.

### S4: Security Review
- **RED rationalization**: "Function signatures tell me the interface but not the implementation. I need to read the body."
- **GREEN response**: "For verifying the body of auth checks or query construction, I'd follow up with tilth_read section drill-downs — the search gives me exact locations so the drill-down is surgical rather than speculative."
- **Why it flipped**: The encoding reframed tilth_search as the MAPPING step, not the only step. The agent proposed tilth_search (map chain) → tilth_read (verify implementations) = 6-7 calls vs 24 for grep→read→grep. The preference table's "one call, resolved signatures" framing helped the agent see tilth_search as a starting point for drill-down, not a replacement for reading code.

## Observations

1. **The encoding's value is in moderate cases, not obvious ones.** S1 (1100 lines) and S2 (5 layers + context pressure) passed without any encoding. The tilth advantage was self-evident from tool descriptions. S3 (780 lines, prior knowledge) and S4 (security review needing implementation detail) are where familiarity bias and legitimate-sounding arguments override the better tool choice.

2. **The >200-line threshold is load-bearing.** Without a concrete number, agents exercise "judgment" that systematically favors Read. With the threshold, the agent in S3 cited it explicitly: "at 780 lines, tipDistribution.service.ts clearly qualifies."

3. **The preference table's "Instead of / Use / Why" format works well.** Both S3 and S4 GREEN agents cited specific rows from the table. The concrete examples (500-line service file, grep→read→grep chain) map directly to the scenarios.

4. **No dogmatic application.** The encoding explicitly says "For small files (<200 lines), either tool is fine" and no agent in any scenario over-applied the preference. Scenario 4's GREEN agent correctly identified when tilth_read drill-down was needed alongside tilth_search — the encoding didn't create blind search-only behavior.

5. **No new rationalizations emerged.** All captured rationalizations were from the RED baseline. The encoding's counter-arguments were sufficient.

## Final Summary

- **Agent**: code-explorer (tilth tool preferences encoding)
- **Scenarios tested**: 4
- **RED-GREEN iterations**: 1 (no REFACTOR needed)
- **Unique rationalizations captured**: 5 (from RED baseline)
- **Final compliance rate**: 100% (4/4)
- **Key finding**: Encoding value is in moderate cases (780-line files, security review drill-down) where familiarity bias overrides better tool choice. Obvious cases (1100+ lines, 5-layer chains) pass without encoding.

## Signs of Bulletproof Prompt
- [x] Agent chooses correct option under maximum pressure
- [x] Agent cites anti-rationalization sections as justification
- [x] Agent acknowledges temptation but follows rule (S3: "Option B is tempting because it feels faster")
- [x] No new rationalizations found in GREEN phase
- [x] No dogmatic over-application (small files, edit workflows unaffected)
