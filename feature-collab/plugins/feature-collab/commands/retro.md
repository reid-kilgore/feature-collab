---
name: retro
description: "Run a retrospective on a coding session — delegates entirely to the canonical retro skill"
argument-hint: "[session-id] (optional — defaults to most recent session for this project)"
---

# Retro

This command has no behavior of its own. Invoke the canonical `retro` skill and follow it.

Source of truth: `canonical-bundle/content/skills/retro/SKILL.md` in the meta-agent repository, installed at `~/.claude/skills/retro`.

Pass through any session identifier the user supplied. Do not re-specify reviewer roles, output locations, or report format here — a second copy of those rules drifts from the canonical one and the drift is silent.
