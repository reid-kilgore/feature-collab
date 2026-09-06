# Claude Code Performance Diagnostics

## Goal

Build a diagnostics layer that makes Claude Code latency attributable. The output should answer:

- Is the delay model/API time, hook time, MCP startup/tool time, local tool time, context/cache behavior, or repo/environment overhead?
- Did performance degrade relative to the last known good baseline?
- Which config or code change likely caused the degradation?

The system should avoid becoming another latency source. Expensive checks should run on demand or on a low-frequency schedule, not on every prompt.

## Signals To Capture

### Turn-Level Metrics

- `turn.total_ms`: user prompt submit to assistant stop.
- `turn.first_response_ms`: user prompt submit to first assistant content/tool call, when recoverable.
- `turn.model_ms`: model/API wall time, when present in transcript metadata.
- `turn.stop_hook_ms`: total post-turn hook time.
- `turn.prompt_hook_ms`: total pre-turn hook time, if available from transcript or active probe.
- `turn.tool_ms`: total local tool execution time.
- `turn.mcp_tool_ms`: total MCP tool execution time.

### Hook Metrics

Measure each hook separately by event and command:

- `hook.SessionStart.<command>.duration_ms`
- `hook.UserPromptSubmit.<command>.duration_ms`
- `hook.PreToolUse.<command>.duration_ms`
- `hook.PostToolUse.<command>.duration_ms`
- `hook.Stop.<command>.duration_ms`
- `hook.PreCompact.<command>.duration_ms`

Also capture:

- hook exit code
- hook stderr summary
- invalid hook JSON/schema errors
- whether hook output injected context
- hash of hook command/config at time of run

### Model And Context Metrics

From assistant usage entries:

- `input_tokens`
- `output_tokens`
- `cache_read_input_tokens`
- `cache_creation_input_tokens`
- `cache_hit_ratio`
- `service_tier`
- model id
- thinking/reasoning setting if visible

### Tool Metrics

For every tool call:

- tool name
- duration
- exit code or error status
- output size
- whether output was truncated
- whether command was interactive or stalled

For Bash specifically:

- command prefix
- cwd
- wall/user/sys time when available
- timeout/interruption status

### MCP Metrics

Capture:

- enabled global MCP servers
- enabled project MCP servers
- MCP startup duration
- MCP auth failures
- MCP tool-call duration
- unavailable or missing MCP command errors

### Config Snapshot

Record a lightweight snapshot whenever diagnostics run:

- `~/.claude/settings.json` hash and selected fields
- `~/.claude/settings.local.json` hash and selected fields
- project `.claude/settings.json` hash and selected fields
- `.mcp.json` hash, if present
- enabled plugins
- enabled MCP servers
- model setting
- thinking/reasoning setting
- statusline command
- hook commands

### Workspace Snapshot

Capture repo/environment facts that often explain local slowness:

- cwd
- git branch
- dirty tracked file count
- untracked file count
- repo size
- largest directories
- `.git` size
- active shell
- Claude Code version from transcript

## Data Sources

### Transcript Data

Primary source:

```bash
~/.claude/projects/<encoded-project-path>/*.jsonl
```

Useful entry types:

- `attachment`: hook events and durations.
- `system` with `subtype == "turn_duration"`: turn wall time.
- `system` with `subtype == "stop_hook_summary"`: stop-hook duration breakdown.
- `assistant`: model id and token/cache usage.
- `user` tool results: command output and tool context.

The transcript gives observed behavior. This is the most important source because it reflects what actually happened during real turns.

### Active Probes

Use active probes for current-state diagnosis, especially where transcripts do not expose duration for prompt hooks.

Example probe payloads should look like real Claude hook JSON, not empty stdin:

```json
{
  "cwd": "/Users/reid/dev/fun_claude",
  "session_id": "diagnostic",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "diagnostic probe"
}
```

Probe examples:

```bash
/usr/bin/time -p bash ~/.claude/hooks/on-prompt.sh < sample-user-prompt-submit.json
/usr/bin/time -p bash ~/.claude/hooks/session-state.sh < sample-user-prompt-submit.json
/usr/bin/time -p bash ~/.claude/hooks/on-stop.sh < sample-stop.json
/usr/bin/time -p bash ~/.claude/statusline-command.sh < sample-statusline.json
```

Empty stdin is not a valid benchmark for Claude hooks because many hooks exit early when no `cwd`, `session_id`, or `hook_event_name` is present.

## Report Shape

The CLI should support human and JSON output:

```bash
cc-perf report --project /Users/reid/dev/fun_claude --since 24h
cc-perf report --project /Users/reid/dev/fun_claude --since 24h --json
cc-perf probe --project /Users/reid/dev/fun_claude
cc-perf baseline save --project /Users/reid/dev/fun_claude
cc-perf diff --project /Users/reid/dev/fun_claude --against last-good
```

Example human output:

```text
Claude Code Latency Report

Project: /Users/reid/dev/fun_claude
Window: last 24h
Turns: 8

Turn latency:
  p50: 23.8s
  p95: 64.4s

Top latency sources:
  1. Stop hook on-stop.sh           p50 11.9s  p95 12.4s
  2. Stop hook session-state.sh     p50 11.9s  p95 12.3s
  3. Prompt hook on-prompt.sh       probe 12.2s
  4. Prompt hook session-state.sh   probe 12.2s
  5. Model/API                      p50 4.8s

Warnings:
  CRITICAL hook.Stop.on-stop.sh exceeds 5000ms threshold.
  CRITICAL hook.Stop.session-state.sh exceeds 5000ms threshold.
  CRITICAL feature-collab PreToolUse hook emits invalid JSON schema.
  INFO alwaysThinkingEnabled changed from true to unset.
```

## Thresholds

Initial warning thresholds:

- Any hook p50 > `1000ms`: warning.
- Any hook p95 > `3000ms`: high.
- Any hook p95 > `5000ms`: critical.
- Total prompt hook time > `3000ms`: critical.
- Total stop hook time > `3000ms`: critical.
- Invalid hook JSON/schema: critical.
- MCP startup > `3000ms`: warning.
- MCP startup > `10000ms`: critical.
- Tool call p95 regression > `50%` from baseline: warning.
- Turn p95 regression > `50%` from baseline: warning.
- Cache read ratio below `50%` for repeated turns in same session: warning.
- Config hash changed since last baseline: annotate report.

## Baselines And Regression Detection

Store baselines in a small local JSON file:

```bash
~/.claude/perf/baselines.json
```

Baseline fields:

- timestamp
- project path
- Claude Code version
- model setting
- hook command hashes
- plugin list
- MCP list
- p50/p95 for turn duration
- p50/p95 for hook durations
- p50/p95 for tool durations
- repo snapshot summary

Regression detection should compare the current report to:

- last saved good baseline
- rolling 7-day median
- previous session in same cwd

Config changes should be shown next to latency changes so the likely cause is visible.

## Implementation Plan

### Phase 1: Transcript Reporter

Build a standalone parser that reads JSONL transcripts and emits:

- turn durations
- stop-hook summaries
- hook attachment durations
- invalid hook JSON errors
- assistant model/token/cache usage
- tool-call summaries

This phase should require no Claude settings changes.

### Phase 2: Active Probe Runner

Add synthetic probes for:

- configured hooks
- statusline command
- MCP availability/startup, if accessible

Probe payloads must be realistic. Never benchmark with empty stdin unless explicitly testing early-exit behavior.

### Phase 3: Config And Workspace Snapshots

Add snapshot collection for:

- Claude settings
- project settings
- MCP config
- plugin list
- git/repo size facts

Hash raw config files, but redact secrets before writing report JSON.

### Phase 4: Baselines And Alerts

Add:

- `baseline save`
- `diff`
- threshold warnings
- rolling historical summaries

Keep alerting local and explicit first. Avoid adding prompt-time hooks until the diagnostic overhead is proven tiny.

## Current Case Study

In `/Users/reid/dev/fun_claude`, observed transcript data showed:

- newer session still had slow `Stop` hooks enabled
- `on-stop.sh` took about `11.8s` to `12.3s`
- `session-state.sh` took about `11.8s` to `12.3s`
- total post-turn hook overhead was about `24s`

Active probing with realistic hook JSON showed:

- `on-prompt.sh` took about `12.2s`
- `session-state.sh` took about `12.2s`
- `caveman-mode-tracker.js` took about `0.07s`
- statusline took about `0.25s`

Root cause was the `panop-wip` shell hooks scanning `~/panop/*/work.txt` and spawning many `jq` processes per line. `~/panop/hourly/work.txt` had about 600 lines, which turned each prompt/stop hook into thousands of subprocesses.

The important diagnostic lesson: observed transcript data and active probes must be kept separate. The other Claude session had an invalid benchmark using empty stdin, which made hooks look fast because they exited before doing real work.

## Design Constraints

- Diagnostics must be safe to run in dirty working trees.
- Reports should not require editing Claude settings.
- Expensive probes should be opt-in or scheduled, not per prompt.
- JSON output should be stable enough for trend tracking.
- Human output should lead with top latency sources and critical warnings.
- Secrets from settings, env, MCP config, and command output must be redacted.

## Open Questions

- Can Claude Code expose UserPromptSubmit hook durations directly in transcripts, the way it exposes Stop hook summaries?
- Is there a supported command for MCP startup/status timing, or do we need to infer from transcript events?
- Should diagnostics live as a standalone CLI, a Claude plugin command, or both?
- What is the best storage format for long-term local trend data: JSONL, SQLite, or both?
