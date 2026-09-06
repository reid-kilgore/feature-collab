# Workflow Portability Plan

## Purpose

This repo contains a strong collaborative development workflow, but the current implementation is tightly shaped around Claude Code plugin primitives. The goal of our version is to preserve the workflow's useful structure while making the system portable across runtimes such as Codex CLI, Claude Code, Gemini CLI, Pi, or future agent shells.

This document defines:

- the portable core
- the runtime-specific adapter layer
- the primary flows
- the migration order
- the learnings we should encode from existing retros and pressure tests

## Executive Summary

The right duplication strategy is **not** to copy the plugin tree as-is.

The right strategy is to separate the system into:

1. **Core workflow spec**
   Phase definitions, artifact contracts, agent role definitions, evidence rules, scope controls, and resumability rules.
2. **Prompt/render layer**
   Runtime-specific prompt outputs for Claude, Codex, Gemini, Pi, etc.
3. **Adapter layer**
   Startup context injection, agent dispatch, file writing helpers, hook integration, status sync, and remote execution.
4. **Evaluation layer**
   Pressure tests, retros, benchmark scenarios, and prompt-hardening feedback loops.

The core value in this repo is the process discipline:

- docs as state
- role-based orchestration
- explicit verification gates
- anti-rationalization rules
- resumability across sessions
- empirical hardening through retros and pressure tests

That is what we should port first.

## Design Goals

Our version should:

- preserve the existing high-signal workflow structure
- avoid coupling the workflow definition to any one agent product
- support different runtimes without rewriting the logic each time
- keep markdown artifacts as the source of truth
- preserve agent specialization without assuming a specific sub-agent API
- encode lessons from observed failures, not just ideal behavior
- make evaluation and iteration a first-class part of the system

## Non-Goals

Our version should not:

- try to perfectly emulate every Claude Code feature
- depend on one provider's model naming or permissions model
- port every command on day one
- preserve historical file layout if a cleaner portable layout is better

## What Exists Today

The current repo already contains four different kinds of assets:

### 1. Portable Core Material

These are conceptually reusable with minor edits:

- workflow definitions in `plugins/feature-collab/commands/*.md`
- role definitions in `plugins/feature-collab/agents/*.md`
- policy fragments in `plugins/feature-collab/templates/fragments/*.md`
- session docs conventions described in `README.md`
- handoff and pickup semantics

### 2. Runtime Glue

These are Claude/plugin-specific and should become adapters:

- `.claude-plugin/marketplace.json`
- `plugins/feature-collab/hooks/*`
- `plugins/gh-checks/*`
- assumptions about skill prefixes and hook injection
- assumptions about Claude's agent tool and startup lifecycle

### 3. Operational Helpers

These may remain as shell tools but should not define workflow logic:

- `plugins/feature-collab/scripts/gen-skills.sh`
- `plugins/feature-collab/scripts/teleport.sh`
- `wip`

### 4. Evaluation / Historical Evidence

These are critical input for the new design:

- `plugins/feature-collab/pressure-tests/*`
- `RETRO*.md`
- `STATUS_SYNC_GAPS.md`
- `spike-scratch/multi-model-workflow/*`

## Proposed Target Architecture

## Layer 1: Portable Workflow Core

This layer should be runtime-agnostic and authoritative.

Suggested layout:

```text
workflow-core/
  workflows/
    feature-collab.yaml
    enhance.yaml
    bugfix.yaml
    spike.yaml
    handoff.yaml
    pickup.yaml
  roles/
    orchestrator.md
    code-explorer.md
    code-architect.md
    test-runner.md
    code-reviewer.md
    code-verifier.md
    scope-guardian.md
    criteria-assessor.md
    demo-builder.md
    systematic-debug.md
  policies/
    evidence-rules.md
    anti-rationalization.md
    scope-control.md
    phase-gates.md
    resumability.md
    model-tiering.md
  artifacts/
    PLAN.md.tmpl
    CONTRACTS.md.tmpl
    TEST_SPEC.md.tmpl
    DETAILS.md.tmpl
    DECISIONS.md.tmpl
    DEMO.md.tmpl
    HANDOFF.md.tmpl
    SESSION_STATE.md.tmpl
  evals/
    pressure-tests/
    scenarios/
    retro-template.md
```

### Why this split

- `workflows/` defines the phase machine
- `roles/` defines role responsibilities and boundaries
- `policies/` defines invariant rules reused across workflows
- `artifacts/` defines persistent state and deliverables
- `evals/` keeps hardening coupled to the system instead of drifting into notes

## Layer 2: Runtime Prompt Adapters

Each runtime gets rendered outputs from the same core.

Suggested layout:

```text
adapters/
  claude/
    commands/
    agents/
    hooks/
  codex/
    prompts/
    roles/
    wrappers/
  gemini/
    prompts/
  pi/
    skills/
    extensions/
```

The adapter's job is to translate core concepts into runtime-specific mechanics:

- how startup context is injected
- how sub-agents are launched
- how prompts are discovered
- how resumability is invoked
- how tool permissions are represented

The adapter should not redefine the workflow itself.

## Layer 3: Runtime Services

These are optional helpers shared by multiple adapters:

```text
runtime/
  docs-bootstrap.sh
  handoff.sh
  pickup.sh
  metrics.sh
  status-sync.sh
  teleport.sh
```

Examples:

- create branch-scoped docs directories
- write metrics files
- query/update `wip`
- standardize handoff state transitions

## Layer 4: Evaluation Harness

This should survive every port.

Suggested layout:

```text
evals/
  pressure-tests/
    code-architect/
    test-runner/
    scope-guardian/
    orchestrator/
  retros/
  benchmark-tasks/
  findings/
```

Without this layer, prompt quality will decay quickly after migration.

## Our Core Workflow Model

The core system should be defined in terms of a few stable concepts.

### 1. Orchestrator

The orchestrator owns:

- selecting the right workflow
- maintaining artifact state
- dispatching specialized workers
- synthesizing outputs
- enforcing gates
- communicating with the user

The orchestrator should **not**:

- silently claim test status
- blur role boundaries
- make unverified assertions
- treat missing artifacts as acceptable

### 2. Specialized Roles

Each role exists to reduce context mixing and make verification explicit.

Minimum portable role set:

- `code-explorer`
- `code-architect`
- `test-runner`
- `code-reviewer`
- `code-verifier`
- `scope-guardian`
- `criteria-assessor`
- `demo-builder`
- `systematic-debug`

These roles are portable even if a runtime does not have "real agents." In a weaker runtime, the orchestrator can simulate dispatch by rendering the role prompt into a fresh session or isolated instruction block.

### 3. Artifacts As State

The durable system state should live on disk, not in session memory.

Core artifact set:

- `PLAN.md`: status, scope, gates, verification scorecard
- `CONTRACTS.md`: types, routes, interfaces
- `TEST_SPEC.md`: categories, commands, curls, expected behavior
- `DETAILS.md`: architecture and implementation notes
- `DECISIONS.md`: ADR-style decisions
- `DEMO.md`: executable proof
- `HANDOFF.md`: session-transfer context
- `SESSION_STATE.md`: resumability metadata

This is one of the strongest parts of the current system and should remain unchanged in principle.

### 4. Verification As A First-Class Mechanism

Verification is not a final step. It is part of every phase transition.

Portable invariants:

- no claim without evidence
- no phase transition without a named proof artifact or agent output
- no "tests pass" claim without fresh command evidence
- no scope-complete claim without explicit review against scope
- no "done" without demo/proof artifacts

### 5. Anti-Rationalization As Policy

A major learning from this repo is that prompt quality improves dramatically when likely shortcuts are explicitly pre-debunked.

Portable anti-rationalization categories:

- "I'll just check the code myself"
- "This tiny edit doesn't need role dispatch"
- "Tests should be green"
- "This phase is obvious, I can skip it"
- "The user probably doesn't need a demo"
- "This adjacent change is basically in scope"
- "The docs already imply this, I don't need to write it down"

These should live in reusable policy files, not be rewritten ad hoc inside every runtime.

## Primary Flows To Preserve

We should port these flows first because they define the operating model.

### Flow 1: Feature-Collab

Use for multi-component, high-change, contract-first work.

Core phases:

1. Session setup
2. Discovery and scope lock
3. Contracts and test spec
4. Walking skeleton
5. Architecture
6. Implementation
7. Review
8. Security / exit criteria
9. Demo and handoff

This is the flagship flow and should remain the most opinionated.

### Flow 2: Enhance

Use for small changes under a defined complexity threshold.

Must preserve:

- contract-first behavior
- explicit test categories
- line-budget / scope pressure
- promotion path to feature-collab when the task grows

### Flow 3: Bugfix

Use for regressions and targeted defects.

Must preserve:

- reproduce-first discipline
- failing test before fix
- explicit out-of-scope guard against opportunistic refactors
- targeted verification and demo of the repaired behavior

### Flow 4: Spike

Use for uncertainty reduction and research.

Must preserve:

- no production code by default
- report as the deliverable
- executable examples in `DEMO.md`
- promotion path into feature-collab or enhance after the spike

### Flow 5: Handoff / Pickup

This is not optional glue. It is part of the system design.

Must preserve:

- writing all next-session facts to disk
- explicit "current phase / waiting for / next actions"
- a deterministic resume path
- protection against relying on compacted or lossy summaries

## How Our Version Would Work

## User Experience

At a high level:

1. User describes work.
2. Orchestrator chooses the workflow.
3. Workflow initializes branch-scoped artifacts.
4. Orchestrator dispatches role-specific work.
5. Artifacts are updated at each phase boundary.
6. Verification gates prevent silent advancement.
7. Demo/proof artifacts are captured.
8. Handoff/pickup supports long-running work across sessions or machines.

## Runtime Behavior

Each runtime adapter should implement the same high-level lifecycle:

1. **Session start context**
   Detect active docs and active work item, then suggest resume or relevant workflow.
2. **Workflow invocation**
   Load the workflow spec and associated policies.
3. **Role dispatch**
   Launch isolated role executions or emulate them.
4. **Artifact sync**
   Persist decisions immediately.
5. **Gate enforcement**
   Require evidence before moving forward.
6. **Completion / handoff**
   Write the durable state, demo proof, and next steps.

## Recommended First Runtime: Codex

Codex is the best first adapter target because it already supports:

- orchestration
- shell/tool execution
- patching
- planning
- sub-agents

So the first serious port should be:

- portable core definitions
- a Codex orchestrator prompt
- role prompts for Codex workers/explorers
- wrapper scripts for docs bootstrap, handoff, metrics, and status sync

Claude can then become just another adapter instead of the canonical implementation.

## Extraction Map

This is the recommended reclassification of the current repo.

### Move into portable core

- `plugins/feature-collab/commands/feature-collab.md`
- `plugins/feature-collab/commands/enhance.md`
- `plugins/feature-collab/commands/bugfix.md`
- `plugins/feature-collab/commands/spike.md`
- `plugins/feature-collab/commands/handoff.md`
- `plugins/feature-collab/commands/pickup.md`
- `plugins/feature-collab/agents/*.md`
- `plugins/feature-collab/templates/fragments/*.md`

### Keep as adapter-specific

- `.claude-plugin/marketplace.json`
- `plugins/feature-collab/hooks/*`
- `plugins/gh-checks/*`
- Claude-specific command frontmatter and discovery semantics

### Keep as shared runtime helpers

- `plugins/feature-collab/scripts/teleport.sh`
- parts of `plugins/feature-collab/scripts/gen-skills.sh` as a generic renderer
- selected `wip` integrations

### Keep as evaluation sources

- `plugins/feature-collab/pressure-tests/*`
- `RETRO*.md`
- `STATUS_SYNC_GAPS.md`
- `spike-scratch/multi-model-workflow/*`

## Key Learnings To Encode

These are the most important lessons from the existing repo.

### 1. Docs-as-state is the main architectural win

The current system is unusually strong at session continuity because it writes real state to disk. This should remain the foundation of the new version.

### 2. Role boundaries matter

The orchestrator-only rule exists for a reason. Systems degrade when the top-level thread starts reading code, editing source, and informally verifying its own work.

### 3. Pressure-tested prompts are better than elegant prompts

The anti-rationalization material was earned through failure. We should preserve that mindset and continue treating prompt hardening as an empirical exercise.

### 4. Shared worktree coordination is a real failure mode

Retros show repeated coordination overhead and branch collisions when multiple agents operate in one checkout. The portable version should encode one of these strategies:

- isolated worktrees for concurrent code-modifying workers
- explicit serialized ownership of mutable files
- a file-lock or branch-lock convention

### 5. Verification authority must be explicit

`test-runner`, `criteria-assessor`, and `scope-guardian` are valuable because they create authority boundaries. That pattern should stay.

### 6. Handoff is part of the workflow, not an afterthought

The repo is correct to treat handoff/pickup as first-class capabilities. We should keep that stance.

### 7. Metrics and retros should not be optional

If we want the system to improve, every runtime needs:

- workflow metrics
- retro capture
- pressure-test revalidation after prompt changes

### 8. Runtime status sync is always leakier than it looks

`STATUS_SYNC_GAPS.md` is a warning. External status systems like `wip`, Linear, PR state, and session state drift unless there is an explicit reconciliation strategy.

Our version should treat status sync as best-effort operational glue, not the canonical source of truth. The canonical source of truth remains the branch-scoped docs.

## Migration Plan

## Phase 1: Extract The Core

Deliverables:

- `workflow-core/` structure created
- portable policies extracted
- portable role library extracted
- artifact templates created
- workflow specs written for `feature-collab`, `enhance`, `bugfix`, `spike`, `handoff`, `pickup`

Success criteria:

- workflow logic is readable without any Claude-specific files
- docs templates are defined once
- anti-rationalization and evidence rules are centralized

## Phase 2: Build The Codex Adapter

Deliverables:

- Codex orchestrator prompt
- Codex role prompts
- runtime wrappers for docs bootstrap, handoff, metrics
- initial mapping from workflow spec to Codex execution behavior

Success criteria:

- a real task can run through `enhance` or `bugfix` in Codex
- branch docs are created and updated consistently
- role dispatch happens with bounded ownership

## Phase 3: Revalidate With Pressure Tests

Deliverables:

- a minimum pressure-test suite ported for orchestrator, code-architect, test-runner, and scope-guardian
- benchmark scenarios runnable against the Codex adapter

Success criteria:

- core rationalizations are still blocked
- no silent phase skipping
- no unverifiable pass claims

## Phase 4: Expand Coverage

Deliverables:

- port `feature-collab`
- port `handoff/pickup`
- add optional adapters for Claude, Gemini, Pi

Success criteria:

- the same artifacts and gate semantics work across more than one runtime

## Phase 5: Add Operational Extras

Deliverables:

- status sync improvements
- teleport/remote-session support
- CI/review helper flows

These should come after the portable core is stable.

## Recommended Initial Scope

Do first:

- `enhance`
- `bugfix`
- `spike`
- `handoff/pickup`
- shared policies
- shared artifacts
- Codex adapter

Do second:

- full `feature-collab`
- pressure-test workflow itself
- remote teleportation
- CI-specialized flows

Do later:

- multi-runtime parity
- advanced status synchronization
- provider-routing abstractions

## Risks

### Risk: Over-preserving Claude-specific behavior

Mitigation:
Define runtime-neutral concepts first and only then render them into adapter outputs.

### Risk: Rebuilding too much before validating

Mitigation:
Port `enhance` and `bugfix` first, then pressure-test them.

### Risk: Losing the hard-earned prompt hardening

Mitigation:
Port the anti-rationalization and pressure-test corpus before polishing any prompt language.

### Risk: Artifact sprawl

Mitigation:
Define a minimal canonical artifact set and make every workflow justify any extras.

### Risk: Agent collisions in code-modifying flows

Mitigation:
Encode isolation rules up front for mutable work.

## Final Recommendation

Our version should be a **portable workflow engine for collaborative software development**, not a clone of a Claude plugin.

The architecture should treat:

- workflow specs as product logic
- artifacts as durable state
- role prompts as reusable modules
- runtime adapters as replaceable shells
- pressure tests and retros as part of the product, not side documentation

If we do this correctly, the system will be able to run in Codex first, then Claude, then other runtimes, while preserving the parts of this repo that are actually valuable.

## Immediate Next Step

Create the `workflow-core/` and `adapters/codex/` skeletons, then port `enhance`, `bugfix`, and `handoff/pickup` into the new structure before attempting full `feature-collab`.
