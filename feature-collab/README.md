# feature-collab

Collaborative feature development plugin for Claude Code with iterative PLAN.md planning and concrete verification requirements.

## Overview

This plugin extends the standard feature development workflow with two key enhancements:

1. **Collaborative Planning**: All planning happens in a `PLAN.md` file at your git root. You annotate it with CriticMarkup, Claude addresses your feedback, and you iterate until satisfied.

2. **Verification Requirements**: Before implementation begins, you must have a concrete plan to verify the changes work—curl commands, Playwright tests, or manual verification steps.

## Usage

```
/feature-collab [optional feature description]
```

## Workflow Phases

| Phase | Description |
|-------|-------------|
| 1. Discovery | Understand what needs to be built |
| 2. Codebase Exploration | Analyze existing patterns and architecture |
| 3. Clarifying Questions | Resolve ambiguities before design |
| 4. Architecture Design | Design implementation approach |
| **5. Collaborative Planning** | Write and iterate on PLAN.md with CriticMarkup |
| **6. Verification Planning** | Define concrete verification steps |
| 7. Implementation | Build the feature |
| 8. Quality Review | Review code for issues |
| 9. Verification & Summary | Execute verification and document results |

## PLAN.md Format

The plan uses CriticMarkup for annotations:
- Highlights: `{==highlighted text==}`
- Comments: `{>>comment text<<}`
- Combined: `{==highlight==}{>>comment<<}`

Tasks use GitHub-style checkboxes for easy extraction:
```markdown
- [ ] Task description
  - Subtask or context
  - More details
```

## Agents

- **code-explorer** (yellow): Traces code paths and maps architecture
- **code-architect** (green): Designs implementation blueprints
- **code-reviewer** (red): Reviews code for bugs and quality issues
- **code-verifier** (blue): Designs verification strategies beyond unit tests

## Key Differences from feature-dev

1. **PLAN.md as source of truth**: All planning lands in a file you can annotate and review
2. **Iterative planning loop**: Expect multiple rounds of feedback before proceeding
3. **Verification gate**: Must have concrete verification plan approved before implementation
4. **Task extraction**: GitHub checkbox format lets you extract todos for personal tracking
