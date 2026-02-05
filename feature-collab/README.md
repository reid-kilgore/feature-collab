# feature-collab

Collaborative feature development plugin for Claude Code with contract-first TDD, scope locking, and adversarial verification.

## Overview

This plugin provides a structured, document-driven workflow for building features:

1. **Contract-First TDD**: Define types, routes, and function signatures in CONTRACTS.md, write failing tests, then implement
2. **Scope Locking**: Explicitly lock scope after discovery to prevent creep
3. **Adversarial Verification**: Multiple agents verify work independently before completion

## Usage

```
/feature-collab [optional feature description]
/handoff [optional reason]
/resume [optional path to PLAN.md]
```

## Documents

| Document | Purpose |
|----------|---------|
| PLAN.md | Single source of truth for feature status and decisions |
| SESSION_STATE.md | Resumability state for conversation compaction |
| CONTRACTS.md | Types, routes, and function signatures |
| TEST_SPEC.md | Exhaustive test specifications |
| DETAILS.md | Implementation details and code samples |
| DECISIONS.md | Architectural decision records |
| HANDOFF.md | Session transfer context and learnings |

## Workflow Phases

| Phase | Name | Checkpoint |
|-------|------|------------|
| 0 | Session Setup | Auto |
| 1 | Discovery & Scope Lock | "lock scope" |
| 2 | Contract Definition | "continue" |
| 3 | Walking Skeleton | Auto |
| 4 | Architecture Design | **"implement"** (critical) |
| 5 | Implementation | "security" |
| 6 | Security Review | "verify" (if issues) |
| 7 | Exit Criteria Assessment | Auto (iterate until READY) |
| 8 | Documentation & Handoff | Complete |

## Agents

| Agent | Purpose |
|-------|---------|
| code-explorer | Traces code paths and maps architecture |
| code-architect | Designs and implements based on contracts |
| code-reviewer | Reviews code for bugs and quality issues |
| code-verifier | Designs verification strategies and TEST_SPEC.md |
| code-security | Reviews for security vulnerabilities |
| test-runner | Executes tests, maintains scorecard (authoritative) |
| test-implementer | Writes test files from TEST_SPEC.md |
| test-gap-finder | Adversarially finds gaps in test coverage |
| criteria-assessor | Skeptically assesses exit criteria |
| scope-guardian | Monitors for scope creep |
| resume-agent | Bootstraps new session from handoff context |

## Key Principles

- **PLAN.md is the single source of truth** - read it first, update every phase
- **Contracts before architecture** - tests define the spec
- **Tests before implementation** - TDD RED-GREEN cycle
- **Scope is locked** - changes require explicit unlock after Phase 1
- **Test-runner is authoritative** - never bypass or override findings
- **Curl tests are mandatory** - never skip API verification

## CriticMarkup

User annotates PLAN.md using CriticMarkup:
- Highlights: `{==highlighted text==}`
- Comments: `{>>comment text<<}`
- Additions: `{++added text++}`
- Deletions: `{--deleted text--}`

Claude uses `{==highlights==}` only when writing to PLAN.md.
