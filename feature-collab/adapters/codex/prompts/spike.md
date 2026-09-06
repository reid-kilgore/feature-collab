# Codex Spike Workflow

Use this workflow when the user genuinely does not yet know what to build and needs research, investigation, or prototyping rather than production changes.

Read these sources before running:

- `workflow-core/workflows/spike.yaml`
- `workflow-core/roles/orchestrator.md`
- `workflow-core/roles/code-explorer.md`
- `workflow-core/roles/code-architect.md`
- `workflow-core/roles/demo-builder.md`
- `workflow-core/policies/evidence-rules.md`
- `workflow-core/policies/anti-rationalization.md`
- `workflow-core/policies/resumability.md`

## Runtime Intent

Codex is the orchestrator. It should:

- keep the main thread focused on coordination and synthesis
- use explorers for codebase tracing
- use worker-style implementation only for prototypes in `spike-scratch/`
- write durable artifacts in `docs/reidplans/<branch>/`

## Iron Law

No production code. A spike produces understanding, not a production feature branch change.

## Flow

### Phase 1: Explore

1. Run `adapters/codex/wrappers/spike-init.sh "<question>"`.
2. Read the generated `PLAN.md` and `DEMO.md`.
3. Decompose the research question into 2-3 investigation angles.
4. Dispatch explorers for those angles when delegation is useful.
5. Update `PLAN.md` with findings, constraints, and trade-offs.
6. If prototyping is necessary, keep it inside `spike-scratch/`.
7. Add executable proof, commands, or walkthrough notes to `DEMO.md`.

### Phase 2: Report

1. Synthesize findings into a recommendation.
2. Record trade-offs and follow-up options in `PLAN.md`.
3. Ensure `DEMO.md` contains enough proof for another engineer to inspect the result.
4. Run `adapters/codex/wrappers/spike-complete.sh`.
5. Tell the user which next workflow should follow: `enhance`, `bugfix`, or `feature-collab`.

## Codex-Specific Dispatch Guidance

- Use explorers for parallel code tracing and comparison.
- Keep prototype work isolated from production files.
- Do not spawn agents just to restate obvious instructions.
- If the question can be answered locally and quickly, stay local.

## Artifact Expectations

`PLAN.md` should contain:

- the question
- hypotheses
- scope boundaries
- findings
- recommendations
- trade-offs

`DEMO.md` should contain:

- commands run
- outputs observed
- file paths examined
- prototype notes if any

## Completion Standard

A spike is complete only when:

- the question is answered with evidence
- the report recommends a next path
- the deliverable artifacts are on disk
- no production code was smuggled in as a "temporary prototype"
