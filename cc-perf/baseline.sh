#!/usr/bin/env bash
# cc-perf baseline save|diff
# Snapshots a perf report + config hashes so future runs can detect regressions.
#
# Usage:
#   cc-perf baseline save [perf-args]       # snapshot current state
#   cc-perf baseline list                   # list saved baselines (this cwd)
#   cc-perf diff [perf-args]                # diff current vs last baseline for this cwd
#
# Storage: ~/.claude/perf/baselines.jsonl  (append-only)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PERF="$DIR/perf.sh"
BASELINE_DIR="$HOME/.claude/perf"
BASELINE_FILE="$BASELINE_DIR/baselines.jsonl"

# Hash a file or return "absent" if missing.
hash_file() {
  if [[ -f "$1" ]]; then
    shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
  else
    echo "absent"
  fi
}

# Hash every hook script path referenced by the given settings.json (if it exists).
# Returns sha256 of the concatenated <path>=<sha> lines.
_hash_hooks_from() {
  local settings_path="$1"
  [[ -f "$settings_path" ]] || { echo "absent"; return; }
  local rows
  rows=$(jq -r '
    [.hooks // {} | to_entries[] | .value[]?.hooks[]?.command]
    | map(capture("(?<p>(/|\\$HOME|\\$\\{HOME\\}|~)[^ \"]+\\.(sh|js|py))")? | .p // empty)
    | unique[]
  ' "$settings_path" 2>/dev/null | while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    p="${p/#\~/$HOME}"
    p="${p//\$HOME/$HOME}"
    p="${p//\$\{HOME\}/$HOME}"
    [[ -f "$p" ]] && shasum -a 256 "$p" 2>/dev/null | awk -v path="$p" '{print path "=" $1}'
  done)
  if [[ -z "$rows" ]]; then echo "empty"; else echo "$rows" | shasum -a 256 | awk '{print $1}'; fi
}

# Snapshot config hashes — global + project-level settings, plugin set, MCP project
# config, and per-hook-script content hashes (catches in-place edits to referenced
# .sh / .js / .py hook scripts from either scope).
snapshot_config() {
  jq -n \
    --arg settings              "$(hash_file "$HOME/.claude/settings.json")" \
    --arg settings_local        "$(hash_file "$HOME/.claude/settings.local.json")" \
    --arg project_settings      "$(hash_file "$PWD/.claude/settings.json")" \
    --arg project_settings_local "$(hash_file "$PWD/.claude/settings.local.json")" \
    --arg plugins               "$(hash_file "$HOME/.claude/plugins/installed_plugins.json")" \
    --arg mcp_project           "$(hash_file "$PWD/.mcp.json")" \
    --arg hooks_content_global  "$(_hash_hooks_from "$HOME/.claude/settings.json")" \
    --arg hooks_content_project "$(_hash_hooks_from "$PWD/.claude/settings.json")" \
    --arg cc_version            "$(claude --version 2>/dev/null | awk '{print $1}' || echo unknown)" \
    '{
      settings: $settings,
      settings_local: $settings_local,
      project_settings: $project_settings,
      project_settings_local: $project_settings_local,
      plugins: $plugins,
      mcp_project: $mcp_project,
      hooks_content_global: $hooks_content_global,
      hooks_content_project: $hooks_content_project,
      cc_version: $cc_version
    }'
}

# Find last baseline for current cwd, or empty.
last_baseline_for_cwd() {
  local cwd="$1"
  [[ -f "$BASELINE_FILE" ]] || return 1
  # tail -r is macOS; use awk fallback for portability.
  if tail -r "$BASELINE_FILE" 2>/dev/null | head -100 > /tmp/cc-perf-rev.$$; then
    grep -m1 "\"cwd\":\"$cwd\"" /tmp/cc-perf-rev.$$ 2>/dev/null || true
    rm -f /tmp/cc-perf-rev.$$
  else
    awk '{a[NR]=$0} END{for(i=NR;i>0;i--) print a[i]}' "$BASELINE_FILE" \
      | grep -m1 "\"cwd\":\"$cwd\"" 2>/dev/null || true
  fi
}

cmd_save() {
  mkdir -p "$BASELINE_DIR"
  local ts cwd report config entry
  ts=$(date -u +%FT%TZ)
  cwd="$PWD"
  report=$("$PERF" --json "$@") || { echo "perf.sh failed" >&2; exit 1; }
  config=$(snapshot_config)
  entry=$(jq -cn --arg ts "$ts" --arg cwd "$cwd" \
    --argjson report "$report" --argjson config "$config" \
    '{ts: $ts, cwd: $cwd, config: $config, report: $report}')
  echo "$entry" >> "$BASELINE_FILE"
  echo "saved baseline"
  echo "  ts:   $ts"
  echo "  cwd:  $cwd"
  echo "  turns:        $(echo "$report" | jq '.turns.count')"
  echo "  hook_tax_ms:  $(echo "$report" | jq '.hook_tax_per_turn_ms')"
  echo "  warnings:     $(echo "$report" | jq '.warnings | length')"
  echo "  -> $BASELINE_FILE"
}

cmd_list() {
  [[ -f "$BASELINE_FILE" ]] || { echo "no baselines"; return; }
  local cwd="$PWD"
  echo "Baselines for cwd=$cwd:"
  awk -v cwd="$cwd" '
    {
      # crude grep on cwd field
      if (index($0, "\"cwd\":\""cwd"\"") > 0) print $0
    }' "$BASELINE_FILE" | jq -r '"\(.ts)   turns=\(.report.turns.count)  hook_tax=\(.report.hook_tax_per_turn_ms)ms  warnings=\(.report.warnings | length)"'
}

cmd_diff() {
  local cwd="$PWD"
  local last
  last=$(last_baseline_for_cwd "$cwd")
  if [[ -z "$last" ]]; then
    echo "no baseline saved for cwd=$cwd" >&2
    echo "run:  cc-perf baseline save" >&2
    exit 2
  fi

  local current_report current_config
  current_report=$("$PERF" --json "$@") || { echo "perf.sh failed" >&2; exit 1; }
  current_config=$(snapshot_config)

  jq -n \
    --argjson b "$last" \
    --argjson r "$current_report" \
    --argjson c "$current_config" '
    def fmt_delta(before; after):
      if before == null or after == null then "n/a"
      elif before == 0 then "+\(after)"
      else
        ((after - before) / before * 100 | round) as $pct
        | "\(before) → \(after) (\(if $pct >= 0 then "+" else "" end)\($pct)%)"
      end;

    def diff_field(name; before; after):
      if before == after then null
      else "  \(name): \(before) → \(after)" end;

    {
      baseline_ts:  $b.ts,
      baseline_cwd: $b.cwd,
      turns:        "\($b.report.turns.count) → \($r.turns.count)",
      hook_tax_ms:  fmt_delta($b.report.hook_tax_per_turn_ms; $r.hook_tax_per_turn_ms),
      turn_p95_ms:  fmt_delta($b.report.turns.p95; $r.turns.p95),
      config_changed: ([
        diff_field("~/.claude/settings.json";        $b.config.settings;               $c.settings),
        diff_field("~/.claude/settings.local.json";  $b.config.settings_local;         $c.settings_local),
        diff_field("project .claude/settings.json";  $b.config.project_settings;       $c.project_settings),
        diff_field("project .claude/settings.local"; $b.config.project_settings_local; $c.project_settings_local),
        diff_field("plugins";                        $b.config.plugins;                $c.plugins),
        diff_field("global hook-script content";     $b.config.hooks_content_global;   $c.hooks_content_global),
        diff_field("project hook-script content";    $b.config.hooks_content_project;  $c.hooks_content_project),
        diff_field("project .mcp.json";              $b.config.mcp_project;            $c.mcp_project),
        diff_field("cc_version";                     $b.config.cc_version;             $c.cc_version)
      ] | map(select(. != null))),
      warnings_new:  ($r.warnings - ($b.report.warnings // [])),
      warnings_gone: (($b.report.warnings // []) - $r.warnings)
    }
    | "Baseline: \(.baseline_ts)   cwd: \(.baseline_cwd)\n" +
      "\n" +
      "Turns:        \(.turns)\n" +
      "Hook tax:     \(.hook_tax_ms)\n" +
      "Turn p95:     \(.turn_p95_ms)\n" +
      "\n" +
      (if (.config_changed | length) == 0 then "Config: unchanged"
       else "Config changes:\n" + (.config_changed | join("\n")) end) +
      "\n\n" +
      (if (.warnings_new | length) == 0 then "Warnings new:  none"
       else "Warnings new:\n" + (.warnings_new | map("  \(.sev)  \(.msg)") | join("\n")) end) +
      "\n" +
      (if (.warnings_gone | length) == 0 then "Warnings gone: none"
       else "Warnings gone:\n" + (.warnings_gone | map("  \(.sev)  \(.msg)") | join("\n")) end)
  ' -r
}

case "${1:-help}" in
  save)    shift; cmd_save "$@" ;;
  list)    shift; cmd_list "$@" ;;
  diff)    shift; cmd_diff "$@" ;;
  -h|--help|help)
    sed -n '2,12p' "$0"
    exit 0 ;;
  *)
    echo "usage: cc-perf baseline {save|list|diff} [perf-args]" >&2
    exit 2 ;;
esac
