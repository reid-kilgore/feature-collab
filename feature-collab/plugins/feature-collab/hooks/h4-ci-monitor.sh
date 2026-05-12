#!/bin/bash
# H4: CI monitor. Run via cron every 5min. Polls required checks for active PR.
# Writes state to ~/.feature-collab/ci-state/<branch>.json + files bd issue on red.

set -e

cd "${1:-$PWD}"
branch=$(git branch --show-current 2>/dev/null || exit 0)
[[ "$branch" == "main" ]] && exit 0
[[ -z "$branch" ]] && exit 0

state_dir="$HOME/.feature-collab/ci-state"
mkdir -p "$state_dir"
state_file="$state_dir/${branch//\//-}.json"

# Find PR for branch
pr_data=$(gh pr view --json url,number,statusCheckRollup 2>/dev/null || echo "")
[[ -z "$pr_data" ]] && { rm -f "$state_file"; exit 0; }

pr_num=$(echo "$pr_data" | jq -r '.number')

# Get checks
checks=$(gh pr checks "$pr_num" --json name,state,conclusion,startedAt 2>/dev/null || echo "[]")

# Find required checks
owner_repo=$(gh repo view --json owner,name -q '.owner.login + "/" + .name' 2>/dev/null)
base=$(gh pr view "$pr_num" --json baseRefName -q .baseRefName)
required=$(gh api "repos/${owner_repo}/branches/${base}/protection/required_status_checks" --jq '.contexts[]' 2>/dev/null || echo "")

# Known-flaky list (per-repo)
flaky_file=".feature-collab/flaky-checks.txt"
[[ -f "$flaky_file" ]] && flaky=$(cat "$flaky_file") || flaky=""

# Classify
status="green"
failing=()
while IFS= read -r check; do
  name=$(echo "$check" | jq -r '.name')
  conclusion=$(echo "$check" | jq -r '.conclusion // "none"')
  state=$(echo "$check" | jq -r '.state // "none"')

  is_required=0
  [[ -z "$required" ]] || echo "$required" | grep -qFx "$name" && is_required=1
  [[ "$is_required" -eq 0 ]] && continue

  if [[ "$conclusion" =~ ^(failure|timed_out|cancelled)$ ]]; then
    is_flaky=0
    [[ -z "$flaky" ]] || echo "$flaky" | grep -qFx "$name" && is_flaky=1
    if [[ "$is_flaky" -eq 1 ]]; then
      status="flaky_likely"
    else
      status="red"
      failing+=("$name")
    fi
  fi
done < <(echo "$checks" | jq -c '.[]')

# Read prior state to compute minutes_red
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
minutes_red=0
if [[ -f "$state_file" ]]; then
  prior_status=$(jq -r '.status // ""' "$state_file" 2>/dev/null)
  prior_since=$(jq -r '.since // ""' "$state_file" 2>/dev/null)
  if [[ "$prior_status" == "red" ]] && [[ "$status" == "red" ]]; then
    since="$prior_since"
    now=$(date -u +%s)
    prior_epoch=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$prior_since" +%s 2>/dev/null || date -u -d "$prior_since" +%s 2>/dev/null || echo 0)
    minutes_red=$(( (now - prior_epoch) / 60 ))
  fi
fi

# Write state
jq -n --arg branch "$branch" --arg pr "$pr_num" --arg status "$status" --arg since "$since" \
      --argjson failing "$(printf '%s\n' "${failing[@]:-}" | jq -R . | jq -s .)" \
      --argjson minutes_red "$minutes_red" \
      '{branch: $branch, pr: $pr|tonumber, status: $status, since: $since, failing_checks: $failing, minutes_red: $minutes_red}' \
      > "$state_file"

# Escalate on red >15 min
if [[ "$status" == "red" ]] && [[ "$minutes_red" -ge 15 ]]; then
  title="CI red on $branch: ${failing[*]}"
  existing=$(bd list --status=open 2>/dev/null | grep -F "$title" || echo "")
  if [[ -z "$existing" ]]; then
    bd create --title="$title" --priority=1 --type=bug --description="Required checks failing >15min. State: $state_file" 2>/dev/null || true
  fi
fi
