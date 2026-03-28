# Session State

## Current State
**Phase**: Spike complete, enhance complete, two features scoped
**Status**: HANDED OFF
**Last Updated**: 2026-03-28
**Handoff Reason**: Moving to feature-collab for Linear session start and PLAN annotation

## If You're a New Session

### Do
1. Read HANDOFF.md first (session-specific context, learnings, warnings)
2. Read the feature spec for whichever feature the user wants to build:
   - LINEAR_SESSION_START.md (at repo root)
   - PLAN_ANNOTATION.md (at repo root)
3. Read WipViewer.swift to understand the current app architecture
4. Read PLAN.md (at repo root) for SwiftUI CLI build patterns
5. Use `/feature-collab` to build the chosen feature

### Do NOT
- Re-research SwiftUI CLI compilation (fully solved — see PLAN.md)
- Re-explore the wip tool (fully documented in HANDOFF.md)
- Use `wip list --json --all` in the poll loop (10s, will freeze the app)
- Try to run the binary directly (must use `open WipViewer.app`)
- Modify the .app bundle Info.plist (it's correct as-is)
