#!/bin/bash
# H2: refuses Agent dispatch when feature-collab active and changed .ts/.tsx files lack fresh typecheck artifact.

set -e

event=$(cat)
tool=$(echo "$event" | jq -r '.tool_name // ""')
[[ "$tool" != "Agent" ]] && { echo '{"decision":"allow"}'; exit 0; }

# Scope: feature-collab active (SESSION_STATE.md in cwd/parent)
dir="$PWD"
found=0
for _ in 1 2 3 4 5; do
  if [[ -f "$dir/SESSION_STATE.md" ]]; then
    found=1
    break
  fi
  parent="$(dirname "$dir")"
  [[ "$parent" == "$dir" ]] && break
  dir="$parent"
done
[[ "$found" -eq 0 ]] && { echo '{"decision":"allow"}'; exit 0; }

# Find changed TS files
branch=$(git branch --show-current 2>/dev/null || echo "detached")
changed_ts=$(git diff --name-only --diff-filter=ACM HEAD 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
unstaged_ts=$(git diff --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx)$' || true)
all_ts="$changed_ts $unstaged_ts"

[[ -z "$(echo $all_ts | tr -d ' ')" ]] && { echo '{"decision":"allow"}'; exit 0; }

# Check typecheck artifact freshness
artifact="/tmp/fc-typecheck-${branch//\//-}"
if [[ ! -f "$artifact" ]]; then
  echo '{"decision":"block","reason":"PRE_COMMIT_TYPECHECK_SKIP: run npx tsc --noEmit on changed .ts/.tsx files and touch '"$artifact"' before dispatching."}' >&2
  exit 2
fi

# Artifact must be newer than the most-recently-modified changed ts file
artifact_mtime=$(stat -f %m "$artifact" 2>/dev/null || stat -c %Y "$artifact")
newest_ts_mtime=0
for f in $all_ts; do
  [[ ! -f "$f" ]] && continue
  ft=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
  (( ft > newest_ts_mtime )) && newest_ts_mtime=$ft
done

if (( artifact_mtime < newest_ts_mtime )); then
  echo '{"decision":"block","reason":"PRE_COMMIT_TYPECHECK_SKIP: typecheck artifact is older than changed files. Re-run tsc and touch '"$artifact"'."}' >&2
  exit 2
fi

echo '{"decision":"allow"}'
