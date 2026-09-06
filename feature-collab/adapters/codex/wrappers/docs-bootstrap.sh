#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git branch --show-current)"
DOCS_DIR="docs/reidplans/${BRANCH}"
mkdir -p "${DOCS_DIR}"
printf '%s\n' "${DOCS_DIR}"
