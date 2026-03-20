#!/usr/bin/env bash
# gen-skills.sh — Generate .md files from .md.tmpl templates by expanding {{FRAGMENT}} placeholders.
#
# Usage: ./scripts/gen-skills.sh [--dry-run] [--check]
#   --dry-run   Show what would change without writing
#   --check     Exit non-zero if any generated file differs from template output (for validation)
#
# Fragments live in templates/fragments/*.md
# Templates are any .md.tmpl file under commands/ or agents/
# Output goes to the same path minus the .tmpl extension

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
FRAGMENTS_DIR="$PLUGIN_DIR/templates/fragments"

DRY_RUN=false
CHECK=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --check) CHECK=true ;;
  esac
done

# Use Python for reliable multi-line placeholder replacement
process_template() {
  local tmpl="$1"
  local output="${tmpl%.tmpl}"

  local result
  result=$(python3 -c "
import os, sys

tmpl_path = sys.argv[1]
fragments_dir = sys.argv[2]

with open(tmpl_path, 'r') as f:
    content = f.read()

for frag_file in sorted(os.listdir(fragments_dir)):
    if not frag_file.endswith('.md'):
        continue
    name = frag_file[:-3].replace('-', '_').upper()
    placeholder = '{{' + name + '}}'
    if placeholder in content:
        frag_path = os.path.join(fragments_dir, frag_file)
        with open(frag_path, 'r') as f:
            replacement = f.read().rstrip('\n')
        content = content.replace(placeholder, replacement)

print(content, end='')
" "$tmpl" "$FRAGMENTS_DIR")

  if [ "$DRY_RUN" = true ]; then
    if [ -f "$output" ]; then
      if diff <(cat "$output") <(printf '%s\n' "$result") > /dev/null 2>&1; then
        echo "  $output: no changes"
      else
        echo "  $output: would update"
        diff <(cat "$output") <(printf '%s\n' "$result") | head -20 || true
      fi
    else
      echo "  $output: would create"
    fi
  elif [ "$CHECK" = true ]; then
    if [ -f "$output" ]; then
      if ! diff -q <(cat "$output") <(printf '%s\n' "$result") > /dev/null 2>&1; then
        echo "STALE: $output differs from template output"
        return 1
      fi
    else
      echo "MISSING: $output does not exist"
      return 1
    fi
  else
    printf '%s\n' "$result" > "$output"
    echo "  Generated: $output"
  fi
}

# Find and process all .tmpl files
STALE=0
TMPL_COUNT=$(find "$PLUGIN_DIR/commands" "$PLUGIN_DIR/agents" -name "*.md.tmpl" 2>/dev/null | wc -l | tr -d ' ')
echo "Fragments: $(ls "$FRAGMENTS_DIR"/*.md | wc -l | tr -d ' ') found"
echo "Templates: $TMPL_COUNT found"
echo ""

for tmpl in $(find "$PLUGIN_DIR/commands" "$PLUGIN_DIR/agents" -name "*.md.tmpl" 2>/dev/null | sort); do
  process_template "$tmpl" || STALE=$((STALE + 1))
done

if [ "$STALE" -gt 0 ]; then
  echo ""
  echo "ERROR: $STALE files are stale. Run ./scripts/gen-skills.sh to regenerate."
  exit 1
fi

if [ "$DRY_RUN" = false ] && [ "$CHECK" = false ]; then
  echo ""
  echo "Done. Run with --check to validate, --dry-run to preview."
fi
