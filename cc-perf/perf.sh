#!/usr/bin/env bash
# cc-perf: read Claude Code transcript JSONL, print latency report.
#
# Usage:
#   cc-perf                                # latest transcript in cwd's project dir
#   cc-perf <path/to/transcript.jsonl>     # specific transcript
#   cc-perf --all                          # all transcripts in cwd's project dir
#   cc-perf --all-projects                 # all transcripts across all projects
#   cc-perf --since 24h                    # filter to transcripts modified within window
#                                          # (units: s/m/h/d, e.g. 90m, 7d)
#   cc-perf --json                         # JSON output (schema below)
#   cc-perf --top N                        # top-N hook/tool rows (default 10)
#
# Signals consumed (from transcript JSONL):
#   system.subtype=turn_duration      -> per-turn wall time
#   system.subtype=stop_hook_summary  -> per-Stop-hook durations
#   attachment (.attachment.durationMs, .hookEvent, .exitCode, .type)
#                                     -> per-hook duration + event + status
#   assistant.message.content[]=tool_use + user.message.content[]=tool_result
#                                     -> tool duration via timestamp delta
#   assistant.message.usage           -> tokens / cache
#
# Thresholds:
#   hook p95 > 5000ms          critical
#   hook p95 > 3000ms          high
#   hook p50 > 1000ms          warn
#   hook exit == 127           critical (broken config, missing command)
#   non-blocking errors outside PreToolUse/PostToolUse: high
#   tool individual call > 1hr: critical (stalled subagent / abandoned session)
#
# JSON schema (--json):
#   {
#     "turns":              {count, p50, p95, max},          # ms
#     "hook_tax_per_turn_ms": int,                            # sum hook ms / turn count
#     "by_kind":            [{kind, n, sum}],                 # kind in {compute, idle, subagent, mcp}
#     "by_mcp_server":      [{server, stats:{n,p50,p95,max,sum}, errors}],
#     "top_hooks":          [{event, cmd, stats, errors, missing_cmd, blocking_decision_event}],
#     "top_tools":          [{name, kind, stats, errors, stalls}],
#     "tokens":             {in_tok_sum, out_tok_sum, cache_read_sum, cache_create_sum, n_assistant},
#     "warnings":           [{sev, msg}]                      # sev in {CRITICAL, HIGH, WARN}
#   }
set -euo pipefail

JSON_OUT=0
TOP=10
TARGET=""
ALL=0
ALL_PROJECTS=0
SINCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_OUT=1; shift ;;
    --top) TOP="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --all-projects) ALL_PROJECTS=1; shift ;;
    --since) SINCE="$2"; shift 2 ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

encode_cwd() {
  # Claude encodes cwd by replacing / and _ with -.
  echo "$1" | sed -e 's|/|-|g' -e 's|_|-|g'
}

# Parse --since to "find -mtime" / "find -mmin" args. Accept e.g. 30s, 90m, 24h, 7d.
since_find_args() {
  local s="$1"
  [[ -z "$s" ]] && return 0
  local n="${s%[smhd]}"
  local unit="${s##*[0-9]}"
  if [[ -z "$unit" ]]; then unit="h"; fi  # default hours
  case "$unit" in
    s) echo "-mmin -$(( (n + 59) / 60 ))" ;;
    m) echo "-mmin -$n" ;;
    h) echo "-mmin -$(( n * 60 ))" ;;
    d) echo "-mtime -$n" ;;
    *) echo "bad --since unit: $unit (use s/m/h/d)" >&2; exit 2 ;;
  esac
}

collect_files() {
  local dir="$1"
  local since_args
  since_args=$(since_find_args "$SINCE")
  # shellcheck disable=SC2086
  find "$dir" -name "*.jsonl" $since_args -print0 2>/dev/null \
    | xargs -0 stat -f "%m %N" 2>/dev/null \
    | sort -rn | awk '{print $2}'
}

FILES=()
if [[ -n "$TARGET" ]]; then
  FILES=("$TARGET")
elif [[ "$ALL_PROJECTS" == "1" ]]; then
  while IFS= read -r f; do FILES+=("$f"); done < <(collect_files "$HOME/.claude/projects")
elif [[ "$ALL" == "1" ]]; then
  proj_dir="$HOME/.claude/projects/$(encode_cwd "$PWD")"
  [[ -d "$proj_dir" ]] || { echo "no transcript dir for cwd: $proj_dir" >&2; exit 2; }
  while IFS= read -r f; do FILES+=("$f"); done < <(collect_files "$proj_dir")
else
  proj_dir="$HOME/.claude/projects/$(encode_cwd "$PWD")"
  [[ -d "$proj_dir" ]] || { echo "no transcript dir for cwd: $proj_dir" >&2; exit 2; }
  while IFS= read -r f; do FILES+=("$f"); break; done < <(collect_files "$proj_dir")
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "no transcripts matched (cwd=$PWD all=$ALL all_projects=$ALL_PROJECTS since='$SINCE')" >&2
  exit 2
fi

[[ "$JSON_OUT" == "0" ]] && echo "Scanned ${#FILES[@]} transcript(s)${SINCE:+ within $SINCE}" >&2

# Stream all entries into one combined jsonl on stdin to jq.
printf '%s\n' "${FILES[@]}" | xargs cat | jq -s --argjson top "$TOP" --argjson jsonout "$JSON_OUT" '
def percentile(p):
  if length == 0 then null
  else sort_by(.) | .[((length - 1) * p) | floor]
  end;

def stats(arr):
  {
    n: (arr | length),
    p50: (arr | percentile(0.50)),
    p95: (arr | percentile(0.95)),
    max: (arr | max // 0),
    sum: (arr | add // 0)
  };

def ts_ms: if type != "string" then null else
  (sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601 * 1000)
  + ( (capture("\\.(?<f>[0-9]+)Z$") // {f:"0"}) | .f | "0.\(.)" | tonumber * 1000 | floor )
  end;

# --- turn durations ---
( [ .[] | select(.type=="system" and .subtype=="turn_duration") | .durationMs ] ) as $turns
|
# --- tool calls: pair assistant.tool_use.id with user.tool_result.tool_use_id ---
( [ .[]
    | select(.type=="assistant")
    | (.timestamp | ts_ms) as $t
    | (.message.content // [])[]?
    | select(.type=="tool_use")
    | {id:.id, name:.name, t_start:$t} ] ) as $tool_starts
|
( [ .[]
    | select(.type=="user")
    | (.timestamp | ts_ms) as $t
    | (.message.content // [])[]?
    | select(.type=="tool_result")
    | {id:.tool_use_id, t_end:$t, is_error:(.is_error // false)} ] ) as $tool_ends
|
( [ $tool_starts[] as $s
    | ($tool_ends[] | select(.id == $s.id)) as $e
    | select($s.t_start != null and $e.t_end != null)
    | {name:$s.name, ms:($e.t_end - $s.t_start), error:$e.is_error,
        kind: ( if ($s.name == "AskUserQuestion") then "idle"
                elif ($s.name == "Agent") then "subagent"
                elif ($s.name | startswith("mcp__")) then "mcp"
                else "compute" end ) } ] ) as $tools
|
( $tools
  | group_by(.name)
  | map(. as $g | {
      name: $g[0].name,
      kind: $g[0].kind,
      stats: ($g | map(.ms) | { n: length, p50: percentile(0.50), p95: percentile(0.95), max: (max // 0), sum: (add // 0) }),
      errors: ([ $g[] | select(.error == true) ] | length),
      stalls: ([ $g[] | select(.ms > 3600000) ] | length)
    })
  | sort_by(-.stats.sum)
) as $by_tool
|
# MCP server roll-up (group by server name extracted from mcp__<server>__<tool>)
( [ $tools[] | select(.kind == "mcp") | . + {server: (.name | capture("^mcp__(?<s>[^_]+(?:_[^_]+)*?)__") | .s // "?")} ]
  | group_by(.server)
  | map(. as $g | {
      server: $g[0].server,
      stats: ($g | map(.ms) | { n: length, p50: percentile(0.50), p95: percentile(0.95), max: (max // 0), sum: (add // 0) }),
      errors: ([ $g[] | select(.error == true) ] | length)
    })
  | sort_by(-.stats.sum)
) as $by_mcp_server
|
# --- model token usage from assistant entries ---
( [ .[] | select(.type=="assistant" and .message.usage != null) | .message.usage ] ) as $usages
|
( {
    in_tok_sum: ($usages | map(.input_tokens // 0) | add // 0),
    out_tok_sum: ($usages | map(.output_tokens // 0) | add // 0),
    cache_read_sum: ($usages | map(.cache_read_input_tokens // 0) | add // 0),
    cache_create_sum: ($usages | map(.cache_creation_input_tokens // 0) | add // 0),
    n_assistant: ($usages | length)
  }
) as $tokens
|
# --- stop hook summaries: flatten hookInfos ---
( [ .[] | select(.type=="system" and .subtype=="stop_hook_summary") | .hookInfos[]? | {cmd:.command, ms:(.durationMs // 0), event:"Stop"} ] ) as $stop_hooks
|
# --- attachment hook events (everything else: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact) ---
( [ .[]
    | select(.type=="attachment" and .attachment.durationMs != null)
    | {
        cmd: (.attachment.command // .attachment.hookName // "?"),
        ms: .attachment.durationMs,
        event: (.attachment.hookEvent // "?"),
        exit: (.attachment.exitCode // 0),
        atype: .attachment.type
      } ] ) as $att_hooks
|
($stop_hooks + $att_hooks) as $all_hooks
|
# Group by (event, cmd) so the same hook firing across N turns is aggregated.
( $all_hooks
  | group_by(.event + "::" + .cmd)
  | map(. as $g | {
      event: $g[0].event,
      cmd: $g[0].cmd,
      stats: ($g | map(.ms) | { n: length, p50: percentile(0.50), p95: percentile(0.95), max: (max // 0), sum: (add // 0) }),
      errors: ([ $g[] | select(((.atype // "") | tostring) == "hook_non_blocking_error") ] | length),
      missing_cmd: ([ $g[] | select(((.atype // "") | tostring) == "hook_non_blocking_error" and (.exit // 0) == 127) ] | length),
      blocking_decision_event: (([ "PreToolUse","PostToolUse" ] | index($g[0].event)) != null)
    })
  | sort_by(-(.stats.p95 // 0))
) as $by_hook
|
# Warnings
( [ $by_hook[] | select(.stats.p95 > 5000) | {sev:"CRITICAL", msg:("hook \(.event) `\(.cmd | tostring | .[0:80])` p95 \(.stats.p95)ms > 5000ms")} ]
+ [ $by_hook[] | select(.stats.p95 > 3000 and .stats.p95 <= 5000) | {sev:"HIGH", msg:("hook \(.event) `\(.cmd | tostring | .[0:80])` p95 \(.stats.p95)ms > 3000ms")} ]
+ [ $by_hook[] | select(.stats.p50 > 1000 and .stats.p95 <= 3000) | {sev:"WARN", msg:("hook \(.event) `\(.cmd | tostring | .[0:80])` p50 \(.stats.p50)ms > 1000ms")} ]
+ [ $by_hook[] | select(.missing_cmd > 0) | {sev:"CRITICAL", msg:("hook \(.event) `\(.cmd | tostring | .[0:80])` missing command (exit 127) x\(.missing_cmd) — broken config")} ]
+ [ $by_hook[] | select(.errors > 0 and .missing_cmd == 0 and (.blocking_decision_event | not)) | {sev:"HIGH", msg:("hook \(.event) `\(.cmd | tostring | .[0:80])` had \(.errors) non-blocking errors")} ]
+ [ $by_tool[] | select(.stalls > 0) | {sev:"CRITICAL", msg:("tool \(.name) stalled \(.stalls)x (>1hr); max \(.stats.max)ms — likely hung subagent or abandoned session")} ]
) as $warns
|
# Hook tax per turn: total hook ms divided by turn count.
( ($all_hooks | map(.ms) | add // 0) ) as $hook_total_ms
|
# Fallback turn count for headless `claude -p` transcripts that lack system.turn_duration:
# count user-message entries (each = 1 prompt-submit cycle).
( [ .[] | select(.type=="user" and ((.message.content // []) | type == "string" or (any(.type == "text" or (. | type == "string"))))) ] | length ) as $user_msgs
|
( if ($turns | length) > 0 then ($turns | length)
  elif $user_msgs > 0 then $user_msgs
  else 1 end ) as $turn_denom
|
( if $turn_denom > 0 then ($hook_total_ms / $turn_denom | floor) else 0 end ) as $hook_tax_per_turn
|
# Tool kind aggregates
( $tools | group_by(.kind) | map(. as $g | {kind:$g[0].kind, sum:($g|map(.ms)|add//0), n:($g|length)}) ) as $by_kind
|
# Output
if $jsonout == 1 then
  {
    turns: { count: ($turns|length), p50: ($turns|percentile(0.50)), p95: ($turns|percentile(0.95)), max: ($turns|max // 0) },
    hook_tax_per_turn_ms: $hook_tax_per_turn,
    by_kind: $by_kind,
    by_mcp_server: $by_mcp_server,
    top_hooks: ($by_hook[0:$top]),
    top_tools: ($by_tool[0:$top]),
    tokens: $tokens,
    warnings: $warns
  }
else
  # Human report
  "Claude Code Latency Report"
  , "  (transcript-derived; passive; no instrumentation)"
  , ""
  , "Turns observed: \($turns|length)   p50 \(($turns|percentile(0.50))//0)ms   p95 \(($turns|percentile(0.95))//0)ms   max \(($turns|max//0))ms"
  , "Hook tax per turn: \($hook_tax_per_turn)ms"
  , ""
  , "Tool kind totals (compute = real latency; idle/subagent often inflated by user-wait):"
  , ($by_kind | sort_by(-.sum) | map("  \(.kind): n=\(.n)  sum \(.sum)ms") | join("\n"))
  , ""
  , (if ($by_mcp_server | length) > 0 then
      "MCP server rollup:\n" +
      ($by_mcp_server | map("  \(.server)  p50 \(.stats.p50)ms  p95 \(.stats.p95)ms  n=\(.stats.n)  sum \(.stats.sum)ms  err=\(.errors)") | join("\n")) + "\n"
    else "" end)
  , "Top hook offenders (sorted by p95):"
  , ($by_hook[0:$top]
      | to_entries
      | map("  \(.key+1). \(.value.event)  p50 \(.value.stats.p50)ms  p95 \(.value.stats.p95)ms  max \(.value.stats.max)ms  n=\(.value.stats.n)  err=\(.value.errors)\n      cmd: \(.value.cmd | tostring | .[0:120])")
      | join("\n"))
  , ""
  , "Top tool calls (sorted by total time):"
  , ($by_tool[0:$top]
      | to_entries
      | map("  \(.key+1). \(.value.name)  p50 \(.value.stats.p50)ms  p95 \(.value.stats.p95)ms  max \(.value.stats.max)ms  n=\(.value.stats.n)  sum \(.value.stats.sum)ms  err=\(.value.errors)")
      | join("\n"))
  , ""
  , "Token usage (\($tokens.n_assistant) assistant turns):"
  , "  input \($tokens.in_tok_sum)  output \($tokens.out_tok_sum)  cache_read \($tokens.cache_read_sum)  cache_create \($tokens.cache_create_sum)"
  , ""
  , "Warnings (\($warns|length)):"
  , (if ($warns|length) == 0 then "  none" else ($warns | map("  \(.sev)  \(.msg)") | join("\n")) end)
end
' | if [[ "$JSON_OUT" == "1" ]]; then cat; else jq -r '.'; fi
