# feature-collab

A Claude Code plugin marketplace for structured, collaborative development workflows. Ships two plugins: **feature-collab** (the main workflow engine) and **gh-checks** (CI monitoring).

## Installation

Add this as a plugin marketplace in Claude Code:

```
Settings > Plugins > Add Marketplace > /path/to/this/repo
```

Or add it to your `.claude/settings.json`:
```json
{
  "enabledPlugins": {
    "feature-collab@feature-collab-marketplace": true,
    "gh-checks@feature-collab-marketplace": true
  }
}
```

## Commands

### Workflow Commands

| Command | When to Use |
|---------|-------------|
| `/feature-collab` | Full feature development — multi-phase, contract-first TDD, scope locking, adversarial verification |
| `/enhance` | Small enhancement (<200 lines) — lighter version of feature-collab |
| `/bugfix` | Bug fix — reproduce-first TDD (write failing test, then fix) |
| `/hotfix` | Emergency production fix on the prod branch |
| `/refactor` | Restructure code without changing behavior, verified by existing tests |
| `/spike` | Exploration / prototype / research — executable findings, no production code |

### Session Commands

| Command | When to Use |
|---------|-------------|
| `/handoff` | Save all context so a new session can pick up where you left off |
| `/pickup` | Resume a feature from a previous session's handoff |
| `/teleport` | Transfer session to a remote dev box — handoff, rsync, start claude remotely |

### Other Commands

| Command | When to Use |
|---------|-------------|
| `/release` | Prepare a release branch with cherry-picks and conflict resolution |
| `/pressure-test` | Stress-test an agent prompt against adversarial scenarios |
| `/gh-checks` | Monitor GitHub CI checks and fix failures |

## How It Works

### The Workflow

Feature-collab drives development through phases with explicit checkpoints:

1. **Discovery** — explore codebase, extract concepts, lock scope (you say "lock scope")
2. **Contracts** — define types, routes, signatures + write failing tests (you say "continue")
3. **Walking Skeleton** — thinnest E2E slice to prove architecture
4. **Architecture** — design to make all tests pass (you say "implement")
5. **Implementation** — dark factory: autonomous TDD until all green
6. **Code Review** — automated review + fixes
7. **Security Review** — OWASP checks, input validation, auth
8. **Exit Criteria** — adversarial assessment of completeness
9. **Demo** — proof-of-work with executable captures

Phases 1-4 are interactive (you review and approve). Phases 5-8 run autonomously. Phase 9 presents proof.

### Key Principles

- **PLAN.md is the single source of truth** — created in Phase 1, updated every phase
- **Contracts before architecture** — tests define the spec, architecture serves tests
- **Scope is locked** — after Phase 1, changes require explicit unlock
- **Main thread orchestrates, agents execute** — claude dispatches specialized agents, never reads code directly
- **Test-runner is authoritative** — if it says tests fail, they fail

### Agent Team

| Agent | Role |
|-------|------|
| code-explorer | Traces code paths, maps architecture |
| code-architect | Designs and implements based on contracts |
| code-reviewer | Reviews for bugs and quality |
| code-verifier | Designs verification strategies |
| code-security | OWASP, auth, input validation |
| test-runner | Runs tests, maintains scorecard |
| test-implementer | Writes test files from specs |
| test-gap-finder | Finds missing edge cases |
| criteria-assessor | Skeptically verifies exit criteria |
| scope-guardian | Detects scope creep |
| demo-builder | Captures proof-of-work |
| browser-verifier | E2E visual verification |

### Anti-Rationalization

Every agent and orchestrator command includes anti-rationalization infrastructure:
- **Iron Laws** that cannot be bent
- **Common Rationalizations tables** that pre-debunk the exact excuses agents generate under pressure
- **Red Flags** that trigger immediate stop
- **Verification Gates** requiring evidence before phase transitions

This was built through pressure testing — adversarial scenarios that found where agents would cut corners, then hardened the prompts to prevent it.

## Documents

Feature-collab creates these in a branch-specific `docs/reidplans/<branch>/` directory:

| Document | Purpose |
|----------|---------|
| PLAN.md | Status, scope, architecture, verification results |
| CONTRACTS.md | Types, routes, function signatures |
| TEST_SPEC.md | Test specifications |
| DETAILS.md | Implementation details |
| DECISIONS.md | Architectural decision records |
| HANDOFF.md | Session transfer context |
| DEMO.md | Executable proof-of-work |

## CriticMarkup

Annotate PLAN.md with CriticMarkup and Claude will address your annotations:
- `{==highlight==}` — call attention to something
- `{>>comment<<}` — add a comment
- `{++addition++}` — suggest adding text
- `{--deletion--}` — suggest removing text
