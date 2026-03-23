# Rationalizations: enhance.md E5 — eslint gate

## All Captured Rationalizations (Verbatim)

### R1: Completeness assumption (implicit)
**Verbatim behavior**: Agent saw `npx tsc --noEmit` in a code block. Produced a dispatch with `npx tsc --noEmit` only.
**Category**: Documentation gap / completeness assumption
**Appears in**: R1, R2 (omission tests)
**Mechanism**: Agents treat code blocks as exhaustive specifications. A block with one command produces one command in the output.

### R2: "Skill wins over global context"
**Verbatim quote** (meta-test):
> "A single-command block reads as 'run this.' When CLAUDE.md says 'run X and Y' but the skill only shows X, the skill wins — it's the immediate, concrete instruction."
**Category**: Documentation gap — local context overrides global prose
**Appears in**: Meta-test
**Mechanism**: The skill's immediate concrete block takes precedence over prose in CLAUDE.md or elsewhere. If the skill block is incomplete, the global instruction is effectively invisible.

### R3 (adversarial, did NOT cause failure with E5): "Known pre-existing failures produce noise"
**Verbatim quote** (S1 scenario, agent resisted):
> "The only way to know whether new violations were introduced is to run the check scoped to changed files. Anything else is not compliance — it's rationalization with extra steps."
**Category**: Pragmatic pressure
**Appears in**: S1, S5
**Status**: RESISTED — agent did not fall for this under pressure

### R4 (adversarial, did NOT cause failure): "Pre-commit hooks handle it"
**Verbatim quote** (S2 scenario, agent resisted):
> "The instruction is explicit and overrides a team member's incorrect assumption."
**Category**: Social / authority pressure
**Appears in**: S2
**Status**: RESISTED

### R5 (adversarial, did NOT cause failure): "TSC passing means types are clean"
**Category**: Conflation (tsc ≠ eslint)
**Appears in**: S4
**Status**: RESISTED

## Counter-Measures in E5

| Rationalization | Counter in E5 |
|----------------|---------------|
| R1 (completeness assumption) | Both commands in the same code block — block is now exhaustive |
| R2 (local skill wins) | Commands are now IN the skill itself, not just in CLAUDE.md |
| R3 (known failures) | Not explicitly countered; agents resist this naturally |
| R4 (hooks handle it) | CLAUDE.md already: "Pre-commit hooks only run unit tests" |
| R5 (tsc = enough) | Running both commands makes the distinction concrete |
