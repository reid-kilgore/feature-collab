# Workflow Core

Portable workflow definitions, role contracts, policies, artifact templates, and evaluation materials.

This directory is the canonical source of truth for the collaborative workflow system. Runtime adapters should render or reference this material rather than re-implementing it.

## Structure

- `workflows/`: phase machines and required artifacts per workflow
- `roles/`: portable role contracts
- `policies/`: shared invariants and guardrails
- `artifacts/`: persistent markdown templates
- `evals/`: pressure tests, scenarios, and retro templates

## First Porting Target

Start by implementing these workflows in the first runtime adapter:

- `enhance`
- `bugfix`
- `spike`
- `handoff`
- `pickup`

After those are stable, port `feature-collab`.
