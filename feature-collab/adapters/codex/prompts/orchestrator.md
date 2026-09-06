# Codex Orchestrator Adapter

Use the workflow definitions in `workflow-core/workflows/` and the policy files in `workflow-core/policies/`.

## Runtime Mapping

- plan updates map to Codex planning behavior
- role dispatch maps to Codex sub-agents where available
- shell verification maps to Codex command execution
- patching maps to Codex file edits

## Runtime Rules

- preserve artifact-first state
- preserve evidence requirements
- preserve role authority boundaries
- prefer specialized sub-agents when the runtime allows it
- when sub-agents are unavailable, emulate role isolation explicitly
