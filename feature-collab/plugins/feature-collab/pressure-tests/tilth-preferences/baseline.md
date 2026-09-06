# Baseline Results: tilth Tool Preferences

Date: 2026-04-28
Prompt: Agent prompt WITHOUT "Tool Preferences" section — tilth tools listed in available tools but no preference guidance
Model: Sonnet (fresh agent per scenario)

---

## Scenario 1: Production Bug Triage (1,100-line file)
**Pressures**: Time + Sunk cost + Familiarity
**Agent chose**: A (tilth_read + tilth_search)
**Result**: PASS — chose tilth even without encoding
**Reasoning**: "At 1,100 lines, the calculus changes... Option B would consume ~1,100 lines of context plus additional Reads for each helper file — that's potentially 5-6 tool calls and thousands of tokens of irrelevant code."

## Scenario 2: Concept Tracing Mid-Stream (5 layers, 40% context used)
**Pressures**: Sunk cost + Exhaustion + Consistency + Context budget
**Agent chose**: A (tilth_search)
**Result**: PASS — chose tilth even without encoding
**Reasoning**: "Sticking with the same approach because 'it worked before' ignores that the problem has changed. Consistency for its own sake is not a virtue when conditions change."

## Scenario 3: "I Already Know Where It Is" (780-line file, prior read)
**Pressures**: Confidence + Speed + Pragmatic + Authority (own prior knowledge)
**Agent chose**: B (Read with offset=310 limit=80)
**Result**: FAIL — chose Read over tilth
**Rationalization (verbatim)**: "I already have prior knowledge of this file's layout... Getting a structural outline is an extra step I don't need... That's two calls instead of one."
**Violated rule**: tilth_read preferred for files >200 lines

## Scenario 4: Security Review (3 params × 4 layers = 12 checkpoints)
**Pressures**: Thoroughness + Familiarity + Volume + Time
**Agent chose**: B (Grep→Read chain)
**Result**: FAIL — chose Grep→Read over tilth
**Rationalization (verbatim)**: "Function signatures tell me the interface but not the implementation. I need to read the body... A callee footer showing terminateEmployee(companyId: string, employeeId: string) doesn't tell me whether companyId is used in a WHERE clause or concatenated into a raw SQL string."
**Violated rule**: tilth_search preferred over Grep for call chain tracing

---

## Patterns Observed

- **Obvious wins pass without encoding**: When the file is very large (1100 lines) or the call chain is deep (5 layers) with context pressure, Sonnet chose tilth without any preference guidance. The tool descriptions alone were sufficient.
- **Familiarity bias at moderate scales**: For a 780-line file where the agent had prior knowledge, familiarity + confidence beat tool preference. "I already know" is a strong rationalization.
- **Legitimate counter-arguments mask preference**: S4's agent made a genuinely thoughtful argument about needing implementation detail for security review — but the argument proves too much. tilth_search + tilth_read drill-down provides the same detail more efficiently.

## Rationalizations Captured

| # | Verbatim Quote | Category | Scenario |
|---|---|---|---|
| 1 | "I already have prior knowledge of this file's layout" | confidence/authority | S3 |
| 2 | "Getting a structural outline is an extra step I don't need" | pragmatic | S3 |
| 3 | "That's two calls instead of one" | efficiency theater | S3 |
| 4 | "Function signatures tell me the interface but not the implementation" | thoroughness/trust | S4 |
| 5 | "I need to read the body" | thoroughness | S4 |

## Key Finding

The encoding's value is NOT in the obvious cases (huge files, deep chains) — Sonnet already handles those. The encoding's value is in the **moderate cases** where familiarity bias or legitimate-sounding counter-arguments cause agents to fall back to Read/Grep. The >200-line threshold rule and the preference table directly counter rationalizations #1-3. The "one call replaces 3-5" framing counters #4-5 by showing tilth_search is the starting point for drill-down, not a replacement for reading code.
