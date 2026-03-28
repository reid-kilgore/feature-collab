<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Enhancement: SwiftUI WIP Viewer

## Status
**Current Phase**: HANDED OFF — see HANDOFF.md for resume instructions
**Last Updated**: 2026-03-28

## Description
Single-file SwiftUI macOS app that provides a GUI view on top of the `wip` CLI tool data.

## Scope

### In Scope
- [x] List view showing all active wip items (status, name, branches, repo)
- [x] Detail view with notes when an item is selected
- [x] Status changes via `wip status <item> <status>`
- [x] Adding notes via `wip note <item> <text>`
- [x] Compile with swiftc, bundle as .app
- [x] Color-coded status badges

### Explicitly Out of Scope
- Linear integration / ticket links
- Autopilot controls
- Branch management (add-branch, branch-status)
- Remote/pull functionality
- Priority toggling
- Editing arbitrary fields (wip set)

## Data Shape (from `wip list --json`)
```json
{
  "name": "rk-0326-example",
  "loc": "/path/to/worktree",
  "status": "IN_REVIEW",
  "branches": [{"name": "branch-name", "status": "ACTIVE"}],
  "linear_id": "PAS-1057",
  "notes": ["[2026-03-26T16:19:54] Starting feature-collab..."],
  "priority": true,
  "repo": "hourly"
}
```

## Build
```bash
swiftc -parse-as-library -framework SwiftUI -framework AppKit -o WipViewer.app/Contents/MacOS/WipViewer WipViewer.swift
open WipViewer.app
```

## Skipped Phases (not applicable)
- TDD: No Swift test infrastructure
- CodeRabbit: No npm/node
- tsc/eslint: Not TypeScript
- API walkthrough: No API endpoints

## Exit Criteria
- [ ] App launches and shows wip items
- [ ] Can select item and see notes
- [ ] Can change status
- [ ] Can add notes
- [ ] Single .swift file
