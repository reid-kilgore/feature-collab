# Subagent Harness Feedback

## Goal
Test the subagent spawning system by creating a child agent and having it report its model name/version.

---

## What Worked

- **`subagent` tool discovery** — `action: "list"` correctly enumerated all available agents (context-builder, delegate, oracle, planner, researcher, reviewer, scout, worker) and chains (none).
- **Agent spawning** — The basic subagent invocation works. Child agents execute and return results.
- **`delegate` agent** — Returned the most useful output: it attempted to introspect its model and reported what it found (or didn't find).

---

## Problems & Friction Points

### 1. No way to specify a model at spawn time without errors
When I tried `model: "anthropic/claude-haiku-4-20250514"` on agents that don't support it (like `delegate`), the call silently returned **no output** — no error, no result. Just nothing. This is extremely hard to debug because you can't tell if:
- The agent failed silently
- The model override was rejected
- The agent itself produced empty output

**Suggestion**: Return a clear error when `model` parameter is incompatible with the target agent, or at minimum return an error message instead of blank output.

### 2. Model introspection from within child sessions is broken/unavailable
The delegate agent reported: *"I cannot determine my own model name or version from within this session. No environment variables (MODEL, PI_MODEL) are set."*

This means there's no reliable way for a subagent to report what it's running as — which makes debugging model routing impossible. If you want to verify which model is being used for a given task, you currently can't do it from within the agent itself.

**Suggestion**: Inject `PI_MODEL` or similar env var into child sessions so agents can self-report their model. Or have the parent report it after spawn completes.

### 3. Boolean `output: false` creates a file literally named "false"
When I passed `output: false` (intending to disable file output), the subagent saved its result to a file called `false`. This happened with both `scout` and `delegate`. The boolean was coerced to the string `"false"` and used as a filename.

**Suggestion**: Either reject non-string values for `output`, or handle `false` explicitly by not writing any file. Currently it's a silent footgun that creates confusing artifacts.

### 4. Silent failures with no output
Multiple agents (`worker`, `delegate` with model override) returned empty results with zero indication of what went wrong. There's no stderr capture, no error message, nothing — just `(no output)`.

**Suggestion**: Even a minimal `"Agent returned no output"` or `"Spawn failed: reason"` would be infinitely more debuggable than silence.

### 5. `researcher` agent requires external API keys
The researcher agent failed with "No API key found for openai-codex" — it has hard dependencies on providers that may not be configured. This wasn't obvious from the agent list output which just showed the name and description.

**Suggestion**: The agent listing should indicate required provider dependencies, or agents should gracefully degrade/fail with a clear message about what's missing rather than crashing mid-invocation.

### 6. `planner` returned an image instead of text
When I asked for model info, the planner produced an image attachment rather than plain text output. This may be intentional behavior but was unexpected for a simple text question.

**Suggestion**: Not necessarily a bug — just noting that different agents have different default output formats (text vs image), which could surprise users expecting consistent behavior.

---

## Summary of Real Problems to Fix

| # | Problem | Severity |
|---|---------|----------|
| 1 | Model override silently fails with no output on incompatible agents | High — makes debugging impossible |
| 2 | No `PI_MODEL` env var in child sessions — can't introspect model | Medium-High — blocks verification workflows |
| 3 | `output: false` creates a file named "false" instead of disabling output | Medium — silent data corruption / confusion |
| 4 | Blank `(no output)` with no error message on failures | High — zero debuggability |
| 5 | Agent dependencies (API keys) not surfaced in listing | Low-Medium — discoverability issue |

---

## How to Do This Correctly (Given LM Studio Only)

**Context**: The parent agent only has access to **LM Studio with Qwen 3.6-35B-A3B**. It does NOT have Anthropic API keys or other providers configured.

### What you should do from the start:

1. **Do NOT specify a `model` parameter.** Since you don't have those models available, any model override will fail silently (see Problem #1). The child agent inherits whatever LM Studio/Qwen is set as default — or may inherit the parent's model entirely.

2. **Use `delegate` for simple text tasks.** It's designed to be lightweight and doesn't require external API keys. Other agents like `researcher` need configured providers (OpenAI, etc.) that aren't available here.

3. **Don't use `output: false`.** The boolean gets coerced to the string "false" and becomes a filename. Instead:
   - Omit the `output` parameter entirely (uses default)
   - Or specify an explicit path like `output: "/dev/null"` or just accept it writing to a file you can clean up

4. **Accept that model introspection from within is currently impossible.** The child agent has no way to know what model it's running as — there's no `PI_MODEL` env var injected into the session.

### Correct invocation pattern:
```json
{
  "agent": "delegate",
  "task": "Tell me your model name and version. Report whatever you can determine about your runtime environment, including any MODEL or PI_MODEL env vars, config files, etc."
}
```
- No `model` parameter (you don't have those models)
- No `output: false` (triggers the filename bug)
- Simple task that doesn't require external providers
- Use a lightweight agent like `delegate`, not one with hard dependencies like `researcher`

### What actually works:
- **Only `delegate` runs without external API dependencies.** It's lightweight and inherits whatever local provider is configured.
- Using this pattern with `delegate`, it successfully reported its environment — found no model env vars set, confirmed the introspection gap. Output was text (correct).

### What does NOT work:
- **`worker`** — requires OpenAI Codex API key despite not showing that dependency in agent listing
- **`scout`** — same: requires OpenAI Codex API key
- **`researcher`** — requires OpenAI Codex API key (same)
- Any model override with Anthropic models (`haiku`, `sonnet`, etc.) — silently fails with no output, because those providers aren't configured.

### Bottom line for LM Studio-only setup:
The only subagent you can reliably spawn is **`delegate`**. Everything else has hard dependencies on OpenAI Codex (or other cloud APIs) that aren't available. This severely limits what the harness can do in a local-only environment.

---

## Recommendations for Future Iteration

1. **Add `PI_MODEL` env var** to all child sessions so agents can self-report their model
2. **Validate `model` parameter** against agent capabilities before spawning; return clear error if incompatible
3. **Handle `output: false` explicitly** — don't coerce boolean to string filename
4. **Always return at least an error message** on spawn failure, even if the agent produced no output
5. **Surface provider dependencies** in agent listing so users know what's configured
