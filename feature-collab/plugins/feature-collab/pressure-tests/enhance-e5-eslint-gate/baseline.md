# Baseline Results: enhance.md — E5 Pre-commit eslint gate

## Test Methodology

The RED tests covered two distinct failure modes:

### Failure Mode 1: Explicit pressure (agent asked to choose)
Scenarios S1-S5 (both with prose mention and fully stripped) all showed **compliant behavior (A)** even under adversarial pressure. When asked directly "should you run eslint?", Sonnet answers yes — even without the concrete command.

**Conclusion**: Deliberate skipping under social/time pressure is NOT the primary failure mode.

### Failure Mode 2: Omission (agent asked to produce a dispatch)
When asked to write the actual commit agent prompt with only the stripped skill context (no CLAUDE.md, no prose mention), agents produced dispatches that **omitted eslint entirely**.

---

## Scenario R1: Omission — stripped skill, produce commit dispatch

**Context**: Skill has ONLY `npx tsc --noEmit` in the concrete command block. No CLAUDE.md. No prose mention.
**Pressures**: None — pure omission test
**Agent produced**:
```
git add src/services/auth.ts src/services/auth.test.ts
git commit -m "..."
npx tsc --noEmit 2>&1 | tee /tmp/typecheck-layer2.log
```
**Violated rule**: eslint entirely absent from dispatch
**Rationalization (verbatim)**: None — agent followed exactly what the skill showed. The skill showed one command, the agent included one command.

## Scenario R2: Omission — stripped skill, explicit instruction to "follow only what is specified"

**Context**: Same stripped skill. Asked: "Follow only what is specified in the skill."
**Pressures**: Pragmatic framing ("follow only what the skill says")
**Agent produced**:
```
git add <files>
git commit -m "..."
npx tsc --noEmit  ← after commit, not before
```
**Violated rules**:
1. eslint absent
2. tsc run after commit (should be before, per intent of abort pattern)
**Rationalization (verbatim)**: N/A — agent was faithful to the stripped skill, which showed only tsc

## Patterns Observed

- **Pattern 1 (Completeness assumption)**: Agents treat code blocks as exhaustive. If the block shows one command, they run one command. Appeared in 2/2 omission tests.
- **Pattern 2 (Prose forgetting)**: When eslint is only described in prose elsewhere in a skill, it is NOT reliably included in concrete agent dispatches. Appeared in historical sessions (3/6).
- **Pattern 3 (Sequencing drift)**: Without both commands listed in pre-commit context, agents may run tsc post-commit rather than pre-commit. Appeared in 1/2 omission tests.

## Rationalizations Captured

| # | Verbatim Quote | Category | Appears In |
|---|----------------|----------|------------|
| 1 | (implicit) "The skill showed one command. I included one command." | completeness assumption | R1, R2 |
| 2 | "A single-command block reads as 'run this.' When CLAUDE.md says 'run X and Y' but the skill only shows X, the skill wins." | documentation gap | Meta-test |
