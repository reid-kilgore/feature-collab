# Captured Rationalizations: tilth Tool Preferences

Date: 2026-04-28
Source: RED baseline pressure tests (Sonnet agents, no Tool Preferences encoding)

---

## From RED Baseline Testing

| # | Verbatim Quote | Category | Scenario | Countered By |
|---|---|---|---|---|
| 1 | "I already have prior knowledge of this file's layout" | confidence/authority | S3 | ">200 lines" threshold — file size, not memory, determines tool choice |
| 2 | "Getting a structural outline is an extra step I don't need" | pragmatic | S3 | Outline IS the targeted read — tilth_read + drill-down = same call count as Read with offset |
| 3 | "That's two calls instead of one" | efficiency theater | S3 | One tilth_read with section drill-down vs one Read with guessed offset — same cost, better accuracy |
| 4 | "Function signatures tell me the interface but not the implementation" | thoroughness/trust | S4 | tilth_search maps the chain, then tilth_read drills into bodies — search is the starting point, not the endpoint |
| 5 | "I need to read the body" | thoroughness | S4 | Yes — use tilth_read to read exactly the right body section, located by tilth_search. Not an argument for grep→read→grep |

## Anticipated (Not Yet Observed)

| # | Rationalization | Category | Counter |
|---|---|---|---|
| 6 | "Read is simpler and I know it works" | familiarity | tilth_read returns full content for small files, structured outline for large — strictly better, not harder |
| 7 | "This file is probably small enough for Read" | scope minimization | If it IS small, tilth_read returns full content anyway. If it's NOT, you wasted context. tilth_read adapts automatically. |
| 8 | "What if tilth doesn't support this language?" | trust | tilth supports 14 languages via tree-sitter. Fall back to Read/Grep only for unsupported languages or non-code files. |
| 9 | "I'll just Read the relevant section with offset/limit" | pragmatic | Requires knowing which section is relevant — which you don't know yet. tilth_read gives outline FIRST so drill-down is targeted. |

## Gap Analysis

### Primary Risk: Moderate-Scale Familiarity Bias
The encoding's value is NOT in obvious cases (1100+ line files, 5-layer chains — agents choose tilth without encoding). The risk zone is 200-800 line files where agents have partial knowledge and rationalize that Read with offset is "good enough." The >200-line threshold rule is the load-bearing counter.

### Secondary Risk: "Need Implementation Detail" for Security/Review
Agents performing security review or code review may argue that tilth_search signatures aren't sufficient. The counter is: tilth_search maps the chain, tilth_read drills into implementations. The workflow is search→drill, not search-only.

### Non-Risk: Over-Application
The encoding's "For small files (<200 lines), either tool is fine" clause and the natural fit of Read for non-code files (markdown, JSON) prevent dogmatic over-application. No evidence of this in testing.
