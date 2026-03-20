#!/usr/bin/env bash
# autopilot-poc.sh — single-ticket autopilot loop (SPIKE / proof-of-concept)
#
# What it does:
#   1. Poll Linear for issues labeled "autopilot" that are assigned to me
#      and not yet completed/canceled
#   2. Pick the highest-priority (lowest priority number), most-recently-updated
#      unstarted or in-progress ticket
#   3. Find an existing worktree or create a new one with deterministic naming:
#      rk-MMDD-autopilot-<ticket-slug>
#   4. Mark the ticket "In Progress" in Linear, add a claim comment
#   5. Run headless Claude (`claude -p`) with the ticket description as the prompt
#   6. On success: create a PR via `gh pr create`, comment the PR link on the
#      ticket, mark it Done
#   7. On failure/timeout: add a Linear comment with the error, leave the ticket
#      In Progress so a human can review
#   8. Sleep 60s and repeat
#
# Flags:
#   --once        Run one ticket then exit (good for testing)
#   --dry-run     Print what would happen without calling Linear/Claude/gh
#
# Environment variables:
#   DRY_RUN=1     Same effect as --dry-run (env var form for convenience)
#   AUTOPILOT_LABEL   Linear label to search for (default: "autopilot")
#   POLL_INTERVAL_SEC Sleep between iterations (default: 60)
#   CLAUDE_MAX_TURNS  Max turns for headless claude (default: 30)
#   CLAUDE_TIMEOUT_SEC  Wall-clock timeout per claude run in seconds (default: 900)
#   HOURLY_REPO   Path to the passcom/hourly repo (default: ~/dev/passcom/hourly)

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

LINEAR_TOKEN_FILE="${HOME}/.config/linear/token"
LINEAR_ENDPOINT="https://api.linear.app/graphql"
LINEAR_CACHE="${HOME}/panop/.wip-linear"

# State-ID cache — fetched once per run, stored in a temp file (bash 3 compat)
STATE_IDS_FILE="$(mktemp /tmp/wip-autopilot-states.XXXXXX)"
trap 'rm -f "$STATE_IDS_FILE"' EXIT

AUTOPILOT_LABEL="${AUTOPILOT_LABEL:-rk-auto}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-60}"
CLAUDE_MAX_TURNS="${CLAUDE_MAX_TURNS:-30}"
CLAUDE_TIMEOUT_SEC="${CLAUDE_TIMEOUT_SEC:-900}"
HOURLY_REPO="${HOURLY_REPO:-${HOME}/dev/passcom/hourly}"

# Dry-run can be set via env var OR --dry-run flag
DRY_RUN="${DRY_RUN:-0}"
RUN_ONCE=0

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --once)    RUN_ONCE=1; shift ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--dry-run] [--once]" >&2
      exit 1
      ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Logging helpers
# ─────────────────────────────────────────────────────────────────────────────

log()  { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*" >&2; }
warn() { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] WARN: $*" >&2; }
err()  { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] ERROR: $*" >&2; }

# ─────────────────────────────────────────────────────────────────────────────
# Linear API helpers
# ─────────────────────────────────────────────────────────────────────────────

# Read the bearer token from file.  Exits 1 if missing.
_linear_token() {
  if [[ ! -f "$LINEAR_TOKEN_FILE" ]]; then
    err "Linear token not found at $LINEAR_TOKEN_FILE"
    return 1
  fi
  cat "$LINEAR_TOKEN_FILE"
}

# linear_query <json-payload>
# Sends a GraphQL query/mutation to Linear.  Prints the raw JSON response.
# Returns 1 on curl failure; the caller decides whether to treat API errors
# as fatal.
linear_query() {
  local payload="$1"
  local token
  token=$(_linear_token)

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] linear_query: $(echo "$payload" | jq -r '.query' | head -1)..."
    echo '{"data":{}}'
    return 0
  fi

  curl -s --fail \
    -X POST "$LINEAR_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: $token" \
    -d "$payload"
}

# linear_mutate <json-payload>
# Alias for linear_query — mutations use the same HTTP call.
# Having a separate function makes call sites self-documenting.
linear_mutate() {
  linear_query "$1"
}

# ─────────────────────────────────────────────────────────────────────────────
# get_state_ids — fetch workflowState UUIDs and populate STATE_IDS[<name>]
#
# Linear workflow states are workspace-specific UUIDs we need for issueUpdate.
# We fetch them once at startup and cache them in the STATE_IDS associative
# array so the rest of the script can use human-readable names.
# ─────────────────────────────────────────────────────────────────────────────

get_state_ids() {
  log "Fetching workflow state IDs from Linear..."

  local payload
  # We query all teams' workflow states.  For a single-team workspace this
  # gives one set; for multi-team you get them all — fine, we just match by name.
  payload=$(cat <<'EOF'
{"query":"{ workflowStates(first: 100) { nodes { id name type } } }"}
EOF
)

  local response
  response=$(linear_query "$payload") || { warn "Could not fetch workflow states"; return 1; }

  if [[ "$DRY_RUN" == "1" ]]; then
    # Populate with placeholder UUIDs so the rest of the script can run
    echo "In Progress	dry-run-in-progress-uuid" > "$STATE_IDS_FILE"
    echo "Done	dry-run-done-uuid" >> "$STATE_IDS_FILE"
    echo "Todo	dry-run-todo-uuid" >> "$STATE_IDS_FILE"
    log "[dry-run] populated placeholder state IDs"
    return 0
  fi

  # Parse each state into the file cache (tab-separated name→id).
  # If the same name appears multiple times (multi-team) the last one wins.
  > "$STATE_IDS_FILE"
  while IFS= read -r row; do
    local name type id
    name=$(echo "$row" | jq -r '.name')
    type=$(echo "$row" | jq -r '.type')
    id=$(echo "$row"   | jq -r '.id')
    printf '%s\t%s\n' "$name" "$id" >> "$STATE_IDS_FILE"
    log "  state: $name ($type) → $id"
  done < <(echo "$response" | jq -c '.data.workflowStates.nodes[]' 2>/dev/null)

  log "Loaded $(wc -l < "$STATE_IDS_FILE" | tr -d ' ') workflow state(s)"
}

# ─────────────────────────────────────────────────────────────────────────────
# update_status <issue-id> <state-name>
#
# Calls issueUpdate to change a ticket's workflow state.
# <issue-id> is the Linear UUID (not the identifier like PAS-123).
# <state-name> must match a key we loaded in get_state_ids.
# ─────────────────────────────────────────────────────────────────────────────

update_status() {
  local issue_id="$1"
  local state_name="$2"

  local state_id
  state_id=$(grep "^${state_name}	" "$STATE_IDS_FILE" | tail -1 | cut -f2)
  if [[ -z "$state_id" ]]; then
    warn "No state ID found for '$state_name' — skipping status update"
    return 0
  fi

  log "Updating issue $issue_id → '$state_name' ($state_id)"

  # Build the mutation.  We escape the UUIDs via jq --arg so they can never
  # contain injection characters.
  local payload
  payload=$(jq -n \
    --arg issueId "$issue_id" \
    --arg stateId "$state_id" \
    '{"query":"mutation IssueUpdate($issueId: String!, $stateId: String!) { issueUpdate(id: $issueId, input: { stateId: $stateId }) { success issue { id identifier state { name } } } }","variables":{"issueId":$issueId,"stateId":$stateId}}')

  local response
  response=$(linear_mutate "$payload") || { warn "issueUpdate curl failed"; return 1; }

  local success
  success=$(echo "$response" | jq -r '.data.issueUpdate.success // false')
  if [[ "$success" != "true" ]]; then
    warn "issueUpdate returned success=false: $(echo "$response" | jq -c '.errors // .data')"
    return 1
  fi
  log "Status updated successfully"
}

# ─────────────────────────────────────────────────────────────────────────────
# add_comment <issue-id> <body-text>
#
# Calls commentCreate to post a comment on the ticket.
# ─────────────────────────────────────────────────────────────────────────────

add_comment() {
  local issue_id="$1"
  local body="$2"

  log "Adding comment to issue $issue_id"

  local payload
  payload=$(jq -n \
    --arg issueId "$issue_id" \
    --arg body "$body" \
    '{"query":"mutation CommentCreate($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } } }","variables":{"issueId":$issueId,"body":$body}}')

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] commentCreate on $issue_id: $body"
    return 0
  fi

  local response
  response=$(linear_mutate "$payload") || { warn "commentCreate curl failed"; return 1; }

  local success
  success=$(echo "$response" | jq -r '.data.commentCreate.success // false')
  if [[ "$success" != "true" ]]; then
    warn "commentCreate returned success=false: $(echo "$response" | jq -c '.errors // .data')"
    return 1
  fi
  log "Comment added successfully"
}

# ─────────────────────────────────────────────────────────────────────────────
# find_autopilot_tickets
#
# Queries Linear for issues that:
#   - Are assigned to me
#   - Have the autopilot label
#   - Are NOT completed or canceled
#
# Prints one JSON object per line (same schema as .wip-linear cache).
# Sorted: priority ASC (1=urgent first, 0=no priority last), then updatedAt DESC.
# ─────────────────────────────────────────────────────────────────────────────

find_autopilot_tickets() {
  log "Querying Linear for '$AUTOPILOT_LABEL' tickets..."

  # We embed the label name via jq to ensure proper JSON escaping.
  local payload
  payload=$(jq -n \
    --arg label "$AUTOPILOT_LABEL" \
    '{"query":"{ issues(filter: { assignee: { isMe: { eq: true } }, creator: { isMe: { eq: true } }, labels: { name: { in: [$label] } }, state: { type: { nin: [\"completed\", \"canceled\"] } } }, orderBy: updatedAt, first: 50) { nodes { id identifier title description priority url dueDate state { name type } assignee { email } project { name } labels { nodes { name } } updatedAt createdAt } } }","variables":{"label":$label}}')

  local response
  response=$(linear_query "$payload") || { warn "find_autopilot_tickets query failed"; return 1; }

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] returning empty ticket list"
    return 0
  fi

  # Normalise to the same flat format used in .wip-linear, then sort:
  #   priority: treat 0 (no priority) as 999 so real priorities sort first
  #   then by updatedAt descending
  echo "$response" | jq -c '
    .data.issues.nodes[]
    | {
        id: .id,
        identifier: .identifier,
        title: .title,
        description: (.description // ""),
        priority: .priority,
        url: .url,
        state_type: .state.type,
        status: .state.name,
        labels: [.labels.nodes[].name],
        updatedAt: .updatedAt
      }
  ' 2>/dev/null \
  | jq -s 'sort_by(
      (if .priority == 0 then 999 else .priority end),
      (.updatedAt | ascii_downcase)
    ) | reverse | sort_by(if .priority == 0 then 999 else .priority end) | .[]
  ' \
  | jq -c '.'
}

# ─────────────────────────────────────────────────────────────────────────────
# ticket_slug <title>
#
# Converts a ticket title to a slug suitable for a branch/dir name.
# e.g. "Fix login page" → "fix-login-page"
# Truncated to 40 chars to keep paths sane.
# ─────────────────────────────────────────────────────────────────────────────

ticket_slug() {
  local title="$1"
  echo "$title" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cs 'a-z0-9' '-' \
    | sed 's/^-//; s/-$//' \
    | cut -c1-40 \
    | sed 's/-$//'
}

# ─────────────────────────────────────────────────────────────────────────────
# find_or_create_worktree <identifier> <slug>
#
# identifier — Linear ticket ID like PAS-123
# slug       — derived from the ticket title
#
# Strategy:
#   1. Check all work.txt files for an entry whose linear_id matches.
#      If found and the loc directory exists, print that path and return.
#   2. Otherwise create a new worktree via git (mimicking the gwt shell function
#      but without sourcing it — we replicate the important parts inline).
#
# Prints the absolute path to the worktree on success.
# ─────────────────────────────────────────────────────────────────────────────

find_or_create_worktree() {
  local identifier="$1"
  local slug="$2"

  # ── Step 1: Check for an existing worktree linked to this Linear ticket ──

  local existing_loc
  existing_loc=$(
    grep -h "\"linear_id\":\"${identifier}\"" \
      "${HOME}/panop"/*/work.txt 2>/dev/null \
    | jq -r '.loc' \
    | head -1
  ) || true

  if [[ -n "$existing_loc" && -d "$existing_loc" ]]; then
    log "Found existing worktree for $identifier at $existing_loc"
    echo "$existing_loc"
    return 0
  fi

  # ── Step 2: Create a new worktree ──────────────────────────────────────────

  # Branch name follows the same pattern as gwt:
  #   rk-MMDD-autopilot-<slug>
  local mmdd
  mmdd=$(date '+%m%d')
  local branch="rk-${mmdd}-autopilot-${slug}"
  local worktree_dir="${HOURLY_REPO}/../${branch}"
  local abs_dir
  abs_dir=$(cd "$(dirname "$HOURLY_REPO")" && pwd)/"${branch}"

  log "Creating worktree: $branch → $abs_dir"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] (cd $HOURLY_REPO && git worktree add $worktree_dir -b $branch)"
    log "[dry-run] wip set $branch linear_id $identifier"
    echo "$abs_dir"
    return 0
  fi

  # Pull latest main before branching — same as gwt does
  (cd "$HOURLY_REPO" && git pull origin main --quiet) \
    || warn "git pull origin main failed — proceeding anyway"

  # Create the worktree (branch is created automatically from HEAD)
  (cd "$HOURLY_REPO" && git worktree add "$worktree_dir" -b "$branch") \
    || { err "git worktree add failed for $branch"; return 1; }

  # Record in wip with the linear_id
  wip set "$branch" linear_id "$identifier" \
    || warn "wip set linear_id failed — worktree still usable"

  log "Worktree created at $abs_dir"
  echo "$abs_dir"
}

# ─────────────────────────────────────────────────────────────────────────────
# run_claude <worktree-dir> <prompt>
#
# Runs headless Claude in the given directory.
# Wraps in `timeout` so a runaway session doesn't block the loop forever.
#
# Returns:
#   0   — success (exit 0 from claude)
#   1   — generic failure
#   124 — timeout (from the `timeout` command)
# ─────────────────────────────────────────────────────────────────────────────

run_claude() {
  local dir="$1"
  local prompt="$2"

  log "Running headless Claude in $dir (timeout ${CLAUDE_TIMEOUT_SEC}s, max-turns ${CLAUDE_MAX_TURNS})"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] timeout $CLAUDE_TIMEOUT_SEC claude -p <prompt> --dangerously-skip-permissions --max-turns $CLAUDE_MAX_TURNS --output-format json"
    log "[dry-run] (prompt first 200 chars): ${prompt:0:200}"
    return 0
  fi

  local rc=0
  # --output-format json makes it easier to parse results; we discard the
  # JSON for now but keep the flag for future structured use.
  (
    cd "$dir"
    timeout "$CLAUDE_TIMEOUT_SEC" \
      claude \
        -p "$prompt" \
        --dangerously-skip-permissions \
        --max-turns "$CLAUDE_MAX_TURNS" \
        --output-format json
  ) || rc=$?

  if [[ $rc -eq 124 ]]; then
    warn "Claude timed out after ${CLAUDE_TIMEOUT_SEC}s"
    return 124
  elif [[ $rc -ne 0 ]]; then
    warn "Claude exited with code $rc"
    return 1
  fi

  log "Claude finished successfully"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# create_pr <worktree-dir> <ticket-title> <ticket-url>
#
# Creates a GitHub PR from the current branch in the given worktree.
# Prints the PR URL on success.
# ─────────────────────────────────────────────────────────────────────────────

create_pr() {
  local dir="$1"
  local title="$2"
  local ticket_url="$3"

  log "Creating PR from $dir"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] gh pr create --title '$title' --body 'Fixes: $ticket_url'"
    echo "https://github.com/dry-run/pr/0"
    return 0
  fi

  local pr_url
  pr_url=$(
    cd "$dir"
    # Push the branch first — gh pr create requires the remote to exist
    git push -u origin HEAD --quiet

    gh pr create \
      --title "$title" \
      --body "$(cat <<EOF
## Summary

Automated via autopilot-poc.

Linear: $ticket_url

---
_Created by autopilot-poc.sh_
EOF
)" \
      --label "autopilot" 2>/dev/null || true
  ) || { warn "gh pr create failed"; return 1; }

  # gh pr create prints the PR URL to stdout
  pr_url=$(cd "$dir" && gh pr view --json url -q .url 2>/dev/null) \
    || { warn "Could not retrieve PR URL after creation"; return 1; }

  log "PR created: $pr_url"
  echo "$pr_url"
}

# ─────────────────────────────────────────────────────────────────────────────
# crash_recovery
#
# On startup, scan work.txt files for any in-progress autopilot worktrees
# and check whether they still need attention.
#
# Heuristic: look for items whose name matches rk-*-autopilot-* and whose
# wip status is ACTIVE (i.e. not DONE/CLOSED).  Then check the Linear ticket
# status — if it's still "In Progress" in Linear we treat it as needing a
# resume; if it's already Done/Canceled in Linear we skip it.
#
# Returns 0 in all cases — failures here are non-fatal.
# ─────────────────────────────────────────────────────────────────────────────

crash_recovery() {
  log "--- Crash recovery scan ---"

  # Collect all in-progress autopilot items
  local recovery_count=0

  while IFS= read -r workfile; do
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue

      local name status linear_id
      name=$(echo "$line"      | jq -r '.name      // empty')
      status=$(echo "$line"    | jq -r '.status    // empty')
      linear_id=$(echo "$line" | jq -r '.linear_id // empty')

      # Only care about autopilot worktrees that are still marked ACTIVE
      [[ "$name" =~ autopilot ]] || continue
      [[ "$status" == "ACTIVE" || "$status" == "NEW" ]] || continue
      [[ -n "$linear_id" ]] || continue

      log "Found potentially orphaned autopilot item: $name (linear: $linear_id)"

      # Check Linear status for this ticket
      local li_status
      li_status=$(
        grep -h "\"identifier\":\"${linear_id}\"" "$LINEAR_CACHE" 2>/dev/null \
        | jq -r '.state_type // empty' \
        | head -1
      ) || true

      if [[ "$li_status" == "completed" || "$li_status" == "canceled" ]]; then
        log "  Linear ticket $linear_id is $li_status — skipping (no resume needed)"
        continue
      fi

      log "  Linear ticket $linear_id is still '$li_status' — flagging for resume"
      recovery_count=$((recovery_count + 1))

      # We don't automatically resume here because we don't want to blindly
      # re-run Claude on something that might have partially succeeded.
      # Instead, add a comment and let the main loop pick it up naturally.
      if [[ "$DRY_RUN" != "1" ]]; then
        # Look up the Linear issue UUID (not the identifier) from the cache
        local issue_uuid
        issue_uuid=$(
          grep -h "\"identifier\":\"${linear_id}\"" "$LINEAR_CACHE" 2>/dev/null \
          | jq -r '.id // empty' \
          | head -1
        ) || true

        if [[ -n "$issue_uuid" ]]; then
          add_comment "$issue_uuid" \
            "Autopilot restarted — this ticket was in-progress when the last run stopped. It will be picked up in the next poll." \
            || true
        fi
      fi

    done < "$workfile"
  done < <(find "${HOME}/panop" -name "work.txt" 2>/dev/null)

  if [[ $recovery_count -eq 0 ]]; then
    log "No orphaned autopilot items found"
  else
    log "Found $recovery_count item(s) needing attention — main loop will handle them"
  fi
  log "--- Crash recovery complete ---"
}

# ─────────────────────────────────────────────────────────────────────────────
# process_ticket <ticket-json>
#
# Implements the full state machine for a single ticket:
#   Not Started → In Progress (claim)
#   Run Claude
#   Success → Done + PR
#   Failure → stays In Progress + error comment
#
# Returns 0 if the ticket was fully processed (success OR gracefully handled
# error).  Returns 1 only on internal errors (e.g., couldn't create worktree).
# The main loop continues regardless — we use `|| true` at the call site.
# ─────────────────────────────────────────────────────────────────────────────

process_ticket() {
  local ticket_json="$1"

  local issue_id identifier title description ticket_url state_type
  issue_id=$(echo "$ticket_json"    | jq -r '.id')
  identifier=$(echo "$ticket_json"  | jq -r '.identifier')
  title=$(echo "$ticket_json"       | jq -r '.title')
  description=$(echo "$ticket_json" | jq -r '.description // ""')
  ticket_url=$(echo "$ticket_json"  | jq -r '.url')
  state_type=$(echo "$ticket_json"  | jq -r '.state_type')

  log "=== Processing ticket: $identifier — $title ==="
  log "    State: $state_type | URL: $ticket_url"

  # Derive a branch slug from the ticket title
  local slug
  slug=$(ticket_slug "$title")
  log "    Slug: $slug"

  # ── 1. Find or create worktree ────────────────────────────────────────────

  local worktree_dir
  worktree_dir=$(find_or_create_worktree "$identifier" "$slug") \
    || { err "Could not get worktree for $identifier — skipping"; return 1; }

  # ── 2. Claim: mark In Progress + comment ──────────────────────────────────

  # Only transition from unstarted states (don't re-claim if already In Progress)
  if [[ "$state_type" != "started" ]]; then
    update_status "$issue_id" "In Progress" || true
  fi

  add_comment "$issue_id" \
    "Autopilot claimed this ticket.\n\nWorktree: \`$(basename "$worktree_dir")\`\nStarted: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    || true

  # ── 3. Build the prompt for headless Claude ───────────────────────────────
  #
  # We give Claude the ticket title and full description.  In a real system
  # you'd also inject a skill file via --append-system-prompt-file.

  local prompt
  prompt=$(cat <<EOF
You are an automated software agent working on a Linear ticket.

## Ticket: $identifier — $title

$description

---

Please implement the changes required to complete this ticket.
Follow the existing codebase patterns.  When you are done:
1. Run tests to verify your changes
2. Commit all changes with a descriptive message
Do NOT create the pull request — that will be handled automatically after you finish.
EOF
)

  # ── 4. Run headless Claude ────────────────────────────────────────────────

  local claude_rc=0
  run_claude "$worktree_dir" "$prompt" || claude_rc=$?

  # ── 5. Handle outcome ─────────────────────────────────────────────────────

  if [[ $claude_rc -eq 0 ]]; then
    # Success path ─────────────────────────────────────────────────────────
    log "Claude succeeded for $identifier — creating PR"

    local pr_url=""
    pr_url=$(create_pr "$worktree_dir" "$identifier: $title" "$ticket_url") || true

    if [[ -n "$pr_url" ]]; then
      add_comment "$issue_id" \
        "Autopilot completed this ticket.\n\nPR: $pr_url\nFinished: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        || true

      update_status "$issue_id" "Done" || true

      log "=== Ticket $identifier DONE: $pr_url ==="
    else
      # Claude succeeded but PR creation failed — leave In Progress for review
      add_comment "$issue_id" \
        "Autopilot: Claude finished successfully but PR creation failed. Please create the PR manually from worktree \`$(basename "$worktree_dir")\`.\nTime: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        || true
      warn "PR creation failed for $identifier — ticket stays In Progress"
    fi

  elif [[ $claude_rc -eq 124 ]]; then
    # Timeout path ────────────────────────────────────────────────────────
    add_comment "$issue_id" \
      "Autopilot: Claude timed out after ${CLAUDE_TIMEOUT_SEC}s.\n\nWorktree \`$(basename "$worktree_dir")\` may have partial work. Needs manual review.\nTime: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      || true
    warn "=== Ticket $identifier TIMED OUT — left In Progress ==="

  else
    # Error path ──────────────────────────────────────────────────────────
    add_comment "$issue_id" \
      "Autopilot: Claude exited with error code $claude_rc.\n\nWorktree: \`$(basename "$worktree_dir")\`\nNeeds manual review.\nTime: $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      || true
    warn "=== Ticket $identifier FAILED (claude exit $claude_rc) — left In Progress ==="
  fi

  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# main loop
# ─────────────────────────────────────────────────────────────────────────────

main() {
  log "autopilot-poc starting (dry_run=$DRY_RUN, once=$RUN_ONCE, label=$AUTOPILOT_LABEL)"

  # Pre-flight: verify prerequisites
  command -v jq    >/dev/null || { err "jq is required"; exit 1; }
  command -v curl  >/dev/null || { err "curl is required"; exit 1; }
  command -v claude >/dev/null || { err "claude is required"; exit 1; }
  command -v gh    >/dev/null || { err "gh (GitHub CLI) is required"; exit 1; }
  [[ -f "$LINEAR_TOKEN_FILE" ]] || { err "Linear token not found at $LINEAR_TOKEN_FILE"; exit 1; }
  [[ -d "$HOURLY_REPO" ]] || { err "hourly repo not found at $HOURLY_REPO"; exit 1; }

  # Fetch workflow state UUIDs once (needed for status transitions)
  get_state_ids || { err "Could not load workflow states from Linear"; exit 1; }

  # Check for orphaned runs from a previous crash
  crash_recovery || true

  # ── Main poll loop ─────────────────────────────────────────────────────────

  while true; do
    log "--- Poll cycle start ---"

    # Fetch current autopilot tickets (sorted by priority + recency)
    local tickets_raw
    tickets_raw=$(find_autopilot_tickets 2>/dev/null) || tickets_raw=""

    if [[ -z "$tickets_raw" ]]; then
      log "No autopilot tickets found — sleeping ${POLL_INTERVAL_SEC}s"
    else
      # Pick the first ticket (highest priority / most recently updated)
      local ticket
      ticket=$(echo "$tickets_raw" | head -1)

      local t_identifier t_title t_state_type
      t_identifier=$(echo "$ticket" | jq -r '.identifier')
      t_title=$(echo "$ticket"      | jq -r '.title')
      t_state_type=$(echo "$ticket" | jq -r '.state_type')

      log "Selected ticket: $t_identifier — $t_title (state: $t_state_type)"

      # Hand off to process_ticket; never let a single ticket crash the loop
      process_ticket "$ticket" || true
    fi

    if [[ "$RUN_ONCE" == "1" ]]; then
      log "-- once flag set, exiting after first cycle --"
      break
    fi

    log "Sleeping ${POLL_INTERVAL_SEC}s before next poll..."
    sleep "$POLL_INTERVAL_SEC"
  done

  log "autopilot-poc exiting"
}

main "$@"
