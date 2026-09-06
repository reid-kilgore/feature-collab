# Claude Code Performance Observability

## Why

Caught a 21s per-prompt regression in `panop-wip` hooks (10.8s on-prompt + 10.6s session-state) — found by accident. Need standing instrumentation so future degradations surface within a day instead of being silently tolerated.

## Baseline incident (2026-05-26)

| Hook | Before | After (single-jq pass) | Speedup |
|---|---|---|---|
| `on-prompt.sh` | 10.8s | 22ms | 490× |
| `session-state.sh` | 10.6s | 32ms | 330× |

Root cause: per-line `jq` subprocess spawn over 604 jsonl lines + `wip get` shell-script binary calls.
Fix: single `jq -s` over all `work.txt` files; folded branch lookup into same pass; reused `old_status` instead of re-shelling `wip get`.

Files edited:
- `/Users/reid/dev/meta-agent-repo/canonical-bundle/content/hooks/panop-wip/on-prompt.sh`
- `/Users/reid/dev/meta-agent-repo/canonical-bundle/content/hooks/panop-wip/session-state.sh`

Also: `alwaysThinkingEnabled: true` removed from `~/.claude/settings.json` — extended thinking every turn added 10-60s.

## Three Layers of Signal

### Layer 1 — Per-hook timing (jsonl)

Wrap each hook in stopwatch shim. Append exec time to `~/.claude/hook-timing.jsonl`.

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/_timed.sh — wrapper
# usage: invoke from settings.json: bash ~/.claude/hooks/_timed.sh <hook_name> <real_script>
set -eo pipefail
HOOK_NAME="$1"; shift
REAL="$1"; shift
input=$(cat)
start=$(date +%s%N)
echo "$input" | bash "$REAL" "$@"
rc=$?
ms=$(( ($(date +%s%N) - start) / 1000000 ))
printf '{"ts":"%s","hook":"%s","ms":%d,"rc":%d}\n' \
  "$(date -u +%FT%TZ)" "$HOOK_NAME" "$ms" "$rc" \
  >> ~/.claude/hook-timing.jsonl
exit $rc
```

`settings.json` change:
```json
{
  "type": "command",
  "command": "bash ~/.claude/hooks/_timed.sh on-prompt ~/.claude/hooks/on-prompt.sh"
}
```

Watch:
```bash
tail -n 1000 ~/.claude/hook-timing.jsonl | jq -s '
  group_by(.hook) | map({
    hook: .[0].hook,
    n: length,
    p50: (sort_by(.ms) | .[length/2 | floor].ms),
    p95: (sort_by(.ms) | .[length*0.95 | floor].ms),
    max: (max_by(.ms).ms)
  })'
```

Threshold: any hook p95 > 500ms = investigate.

### Layer 2 — Session metrics extractor

`~/.claude.json` already captures per-session: `lastAPIDuration`, `lastAPIDurationWithoutRetries`, `lastToolDuration`, `lastDuration`, `lastTotalCacheReadInputTokens`, `lastTotalCacheCreationInputTokens`, `lastTotalInputTokens`, `lastTotalOutputTokens`, `lastCost`, `lastModelUsage`, `lastSessionId`, `lastSessionModified`.

Extract on Stop hook → append to `~/.claude/session-stats.jsonl`.

```bash
#!/usr/bin/env bash
# ~/.claude/hooks/session-stats-extract.sh
set -eo pipefail
input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd // empty')
[ -z "$cwd" ] && exit 0
jq -c --arg cwd "$cwd" '
  .projects[$cwd] // empty
  | {
      ts: .lastSessionModified,
      cwd: $cwd,
      sid: .lastSessionId,
      api_ms: .lastAPIDuration,
      api_no_retry_ms: .lastAPIDurationWithoutRetries,
      tool_ms: .lastToolDuration,
      wall_ms: .lastDuration,
      ctx_cache_read: .lastTotalCacheReadInputTokens,
      ctx_cache_create: .lastTotalCacheCreationInputTokens,
      in_tok: .lastTotalInputTokens,
      out_tok: .lastTotalOutputTokens,
      cost: .lastCost,
      models: (.lastModelUsage | keys)
    }
' ~/.claude.json >> ~/.claude/session-stats.jsonl
```

Wire to Stop hook in `settings.json`.

Trend query:
```bash
tail -n 50 ~/.claude/session-stats.jsonl | jq -s '
  map(select(.api_ms))
  | { p50_api: (sort_by(.api_ms) | .[length/2 | floor].api_ms),
      p95_api: (sort_by(.api_ms) | .[length*0.95 | floor].api_ms),
      mean_ctx: (map(.ctx_cache_read) | add / length),
      total_cost: (map(.cost) | add) }'
```

### Layer 3 — OTEL (already configured, verify collector)

`settings.json` has:
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Claude Code emits spans for API calls + tool invocations. If no collector at :4318, spans drop silently.

Verify:
```bash
lsof -i :4318    # collector running?
curl -sf http://127.0.0.1:4318/v1/traces -X POST -d '{}' || echo "no collector"
```

If absent: spin local Jaeger.
```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest
# UI: http://localhost:16686
```

## `/perf` slash command

Read N most recent `session-stats.jsonl` + `hook-timing.jsonl`. Print summary table. Exits non-zero if any threshold breached → can chain into pre-flight.

Skeleton: `~/.claude/commands/perf.md` (slash command source).

Thresholds (initial):
- hook p95 > 500ms
- API p95 > 60s (excluding extended thinking / large refactors)
- ctx_cache_read > 1.5M for sessions < 30 turns
- cost/session > $5

## Build Order

1. **Hook wrapper + jsonl** — 10 min. Catches per-hook regressions same-day.
2. **Session-stats extractor on Stop** — 10 min. Tail-able trend file.
3. **`/perf` command** — 15 min. On-demand health check.
4. **Verify OTEL collector** — 5 min. If missing, local Jaeger for spans.
5. **Daily summary cron** — append yesterday's p95 to a stable file. Drift visible across weeks.

## Future regressions this would catch

- Hook script gets accidentally O(N²) over a growing data file (this incident).
- New MCP server inflates tool-def prompt → ctx_cache_read jumps.
- A skill or plugin auto-loads heavy context on every prompt → ctx_cache_create jumps.
- Model switch (e.g. defaulting Opus where Sonnet sufficed) → cost + api_ms jump together.
- Subagent fan-out blocking main thread → tool_ms ≫ api_ms.
