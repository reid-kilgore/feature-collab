#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git branch --show-current)"
DATE="$(date +%Y-%m-%d)"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
METRICS_DIR="${HOME}/.feature-collab/metrics"
METRICS_PATH="${METRICS_DIR}/${DATE}-${BRANCH}-spike.json"

mkdir -p "${METRICS_DIR}"

cat > "${METRICS_PATH}" <<EOF
{
  "workflow_type": "spike",
  "branch": "${BRANCH}",
  "completed_at": "${NOW}",
  "adapter": "codex"
}
EOF

printf 'METRICS=%s\n' "${METRICS_PATH}"
