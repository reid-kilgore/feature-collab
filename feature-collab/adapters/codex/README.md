# Codex Adapter

This directory contains the first runtime adapter for the portable workflow core.

## Adapter Responsibilities

- map portable workflow definitions onto Codex behavior
- provide orchestrator and role prompts for Codex agents
- define wrapper conventions for docs bootstrap, handoff, and metrics
- keep runtime-specific behavior out of `workflow-core/`

## First Porting Order

1. `spike`
2. `enhance`
3. `bugfix`
4. `handoff`
5. `pickup`
6. `feature-collab`

## Current Status

`spike` now has the first runnable Codex path:

- prompt: `prompts/spike.md`
- init wrapper: `wrappers/spike-init.sh`
- completion wrapper: `wrappers/spike-complete.sh`
- role overlay: `roles/demo-builder.md`

Recommended session flow:

1. read `prompts/spike.md`
2. run `wrappers/spike-init.sh "<question>"`
3. perform the exploration and keep artifacts updated
4. run `wrappers/spike-complete.sh` when the spike is done
