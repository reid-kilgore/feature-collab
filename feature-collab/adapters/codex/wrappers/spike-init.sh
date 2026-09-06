#!/usr/bin/env bash
set -euo pipefail

QUESTION="${1:-Spike question}"
BRANCH="$(git branch --show-current)"
DOCS_DIR="docs/reidplans/${BRANCH}"
PLAN_PATH="${DOCS_DIR}/PLAN.md"
DEMO_PATH="${DOCS_DIR}/DEMO.md"

mkdir -p "${DOCS_DIR}"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ ! -f "${PLAN_PATH}" ]; then
  cat > "${PLAN_PATH}" <<EOF
# Spike: ${QUESTION}

## Status
**Current Phase**: Explore
**Waiting For**: Investigation in progress
**Last Updated**: ${NOW}

## Question
${QUESTION}

## Hypotheses
1. Hypothesis placeholder
2. Hypothesis placeholder

## Scope
- **Investigate**: Relevant code paths, patterns, and constraints
- **Produce**: A report with executable proof in \`DEMO.md\`
- **Do NOT**: Modify production files as part of the spike

## Exit Criteria
- [ ] Question answered with evidence
- [ ] Executable examples or proof captured in \`DEMO.md\`
- [ ] Recommendation documented with trade-offs
- [ ] No production code written outside \`spike-scratch/\`

## Findings
- Pending

## Recommendations
- Pending

## Trade-Offs
| Option | Pros | Cons |
|--------|------|------|
| Pending | Pending | Pending |
EOF
fi

if [ ! -f "${DEMO_PATH}" ]; then
  cat > "${DEMO_PATH}" <<EOF
# Demo

## Objective
Investigate: ${QUESTION}

## Commands
\`\`\`bash
# Add reproducible commands here
\`\`\`

## Observed Result
Pending

## Notes
- Add executable examples, traces, or prototype instructions here.
EOF
fi

printf 'DOCS_DIR=%s\nPLAN=%s\nDEMO=%s\n' "${DOCS_DIR}" "${PLAN_PATH}" "${DEMO_PATH}"
