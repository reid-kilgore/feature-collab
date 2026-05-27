#!/usr/bin/env bash
# Install cc-perf: symlink to ~/.local/bin and register /perf slash command.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$REPO_DIR/perf.sh"
BIN_DIR="$HOME/.local/bin"
CMD_DIR="$HOME/.claude/commands"
LINK="$BIN_DIR/cc-perf"
SLASH="$CMD_DIR/perf.md"

[[ -x "$SCRIPT" ]] || { echo "perf.sh not executable at $SCRIPT" >&2; exit 1; }

mkdir -p "$BIN_DIR" "$CMD_DIR"

# Symlink to PATH
if [[ -L "$LINK" || -e "$LINK" ]]; then
  echo "replacing existing $LINK"
  rm -f "$LINK"
fi
ln -s "$SCRIPT" "$LINK"
echo "linked: $LINK -> $SCRIPT"

# Slash command
cat > "$SLASH" <<EOF
---
description: Latency report on current Claude Code session transcript
allowed-tools: Bash($SCRIPT:*)
---
Run cc-perf on current project transcripts. Reports hook tax per turn, top hook offenders, tool kind totals, MCP server rollup, warnings.

Default: latest transcript in current cwd. Pass arguments after \`/perf\` to forward to cc-perf:
- \`/perf --all\` — union all transcripts in this project
- \`/perf --since 24h\` — only transcripts modified in last 24h
- \`/perf --all-projects --since 7d\` — global sweep
- \`/perf --top 20\` — show top-20 instead of top-10

!bash $SCRIPT \$ARGUMENTS
EOF
echo "wrote slash command: $SLASH"

# PATH check
case ":$PATH:" in
  *":$BIN_DIR:"*) echo "$BIN_DIR already in PATH" ;;
  *) echo "WARN: $BIN_DIR not in PATH. Add to ~/.zshrc:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

echo
echo "Smoke test:"
"$LINK" --help | head -10
