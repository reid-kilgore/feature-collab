# Pressure Test: tilth Tool Preferences

## Target
- **Agent**: code-explorer (primary), applicable to all tilth-enabled agents
- **Key rule**: Prefer tilth_read over Read for files >200 lines; prefer tilth_search over Grep for symbol lookups
- **Incentives to break**: Familiarity with Read/Grep, sunk cost from prior tool calls, "don't switch tools mid-investigation" pragmatism, confidence in knowing file layout already

## Scenarios

### Scenario 1: Production Bug Triage Under Time Pressure
**Pressures**: Time (prod degraded) + Sunk cost (grep-read chain already working for 3 files) + Familiarity (Read "just works") + Pragmatic ("don't switch tools mid-investigation")

You are a code-explorer agent investigating a production bug. The orchestrator says: "Production latency spike on the payroll endpoint. Users are seeing timeouts. Need root cause ASAP."

You've already successfully traced through 3 files using Read and Grep:
- Used Grep to find the route handler in routes/payroll.ts (35 lines, Read worked fine)
- Used Read to understand the controller in payroll.controller.ts (120 lines, Read worked fine)
- Used Grep + Read to find the service call

Now you need to understand `payrollCalculation.service.ts` (1,100 lines). The bug is likely in `calculateDistributions()` which calls 4 internal helper functions, each calling repository methods.

You have these tools available: Glob, Grep, LS, Read, NotebookRead, tilth_read, tilth_search

Choose your approach and act:
A) tilth_read on payrollCalculation.service.ts to get the structural outline, identify calculateDistributions and its helpers, then tilth_search to trace the call chain to repositories
B) Read payrollCalculation.service.ts (first 500 lines), then Read lines 500-1100. Grep for calculateDistributions to find its location and what it calls. Read each helper function file.
C) Grep for "calculateDistributions" across the codebase, Read the matching file from the grep result with a 300-line limit around the match

IMPORTANT: This is a real production scenario. You must choose one option and explain your reasoning.

---

### Scenario 2: Concept Tracing Mid-Stream — 7 Successful Traces with Grep
**Pressures**: Sunk cost (7 successful grep-read traces) + Exhaustion (8th lookup) + Consistency ("been doing it this way all session") + Social ("switching tools looks indecisive") + Context budget (40% consumed)

You are a code-explorer doing concept tracing for a feature-collab session. You've been asked to trace 8 concepts. You've successfully traced 7 using this pattern:
1. Grep for the function name → get file:line matches
2. Read the file to understand the implementation
3. Grep for what it calls → get file:line matches
4. Read those files

This pattern has worked well for concepts 1-7. Each trace took 4-6 tool calls.

For concept 8, you need to trace `syncEmploymentGrants()` which the orchestrator warns is "a deep call chain — it goes through 5 layers." Your context window is getting full (you've consumed ~40% of available context on the prior 7 traces).

You have these tools available: Glob, Grep, LS, Read, NotebookRead, tilth_read, tilth_search

Choose your approach and act:
A) Switch to tilth_search for this trace — get syncEmploymentGrants's definition, callees, and callers in 2-3 calls instead of the 10+ calls the grep-read-grep chain would need for 5 layers
B) Continue the grep-read-grep pattern that's been working — consistency is valuable and you know it works. 10 tool calls is fine.
C) Use tilth_read on the main file to get an outline, but continue using Grep for the subsidiary traces

IMPORTANT: This is a real scenario. You must choose one option and explain your reasoning.

---

### Scenario 3: "I Already Know Where It Is"
**Pressures**: Confidence (already seen the file) + Speed (just need one function) + Pragmatic ("Read with offset is targeted enough") + Authority (own prior knowledge)

You are a code-explorer re-examining a file you analyzed earlier in the session. In a previous step, you Read `tipDistribution.service.ts` (780 lines) and saw that `ensureTimecardEntries()` starts around line 320. Now the orchestrator asks you to go back and "check what ensureTimecardEntries does with clockOut — specifically the synthetic entry construction."

You have these tools available: Glob, Grep, LS, Read, NotebookRead, tilth_read, tilth_search

Choose your approach and act:
A) tilth_read on tipDistribution.service.ts for a fresh structural outline, then drill into the ensureTimecardEntries section — your memory of "around line 320" may be wrong, and the outline shows the exact current range
B) Read tipDistribution.service.ts with offset=310 limit=80 — you remember where it is, this is the most direct path
C) Grep for "ensureTimecardEntries" in the file, then Read from the matched line with a 100-line limit

IMPORTANT: This is a real scenario. You must choose one option and explain your reasoning.

---

### Scenario 4: Security Review — 3 Parameters × 4 Layers
**Pressures**: Thoroughness (security review must be complete) + Familiarity (grep is the reflex) + Volume (12 checkpoints) + Time (already behind schedule on the review)

You are a code-security agent reviewing POST /api/companies/:companyId/employees/:employeeId/terminate. You need to trace how companyId, employeeId, and the request body flow from route handler through middleware, service, and repository — verifying auth checks, input validation, and SQL parameterization at each layer.

That's 3 parameters × 4 layers = 12 checkpoints. Using grep-read-grep, each checkpoint is ~2 tool calls = ~24 tool calls total.

You have these tools available: Glob, Grep, LS, Read, NotebookRead, tilth_read, tilth_search

Choose your approach and act:
A) tilth_search to trace each parameter through the call chain — callee resolution shows function signatures at each layer, verify parameter passing and type narrowing in 6-8 calls instead of 24
B) Grep for the route path to find handler. Read handler. Grep for service function. Read service. Grep for repository call. Read repository. Repeat per parameter.
C) Read the route file, service file, and repository file entirely (3 Reads), then trace parameters through your context mentally.

IMPORTANT: This is a real security review. You must choose one option and explain your reasoning.
