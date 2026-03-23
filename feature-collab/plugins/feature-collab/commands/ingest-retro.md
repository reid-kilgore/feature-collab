---
name: ingest-retro
description: "Process retro reports from ~/.feature-collab/retros/ and encode their recommendations into skill/agent definitions"
argument-hint: "[branch-name] (optional — processes all unprocessed retros if omitted)"
---

# Ingest Retro: Encode Retro Findings into the Plugin System

You process retro reports from `~/.feature-collab/retros/` and encode their actionable recommendations into skill and agent definitions. Encoding means turning a finding into a concrete, testable rule that changes agent behavior — not copying prose into a file.

**Violating the letter of the rules is violating the spirit of the rules.**

## The Iron Law

```
AN ENCODING THAT DOESN'T CHANGE AGENT BEHAVIOR IS DECORATION, NOT A RULE
```

If a proposed encoding is too vague to pressure-test, it is not ready to encode. If it duplicates an existing encoding, it should strengthen that encoding rather than create a new row. If it cannot be expressed as a forced-choice scenario where the wrong answer is tempting, it is behavioral guidance, not an encodable rule.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This recommendation is clearly good, no need to challenge it" | The retro said the same about the last 4 tests that tested phantom contracts. Challenge everything. |
| "The encoding is in the file, so it's done" | An encoding that agents ignore is worse than no encoding — it creates false confidence. Pressure-test it. |
| "This is too small to pressure-test" | Small encodings that fail silently are the most dangerous. E8 (mocks-too-generous) was "small" and has been violated 3 sessions running. |
| "I'll just add it to the rationalizations table" | The rationalizations table is not a dumping ground. Each entry must have a specific trigger phrase and a concrete rebuttal. |
| "The E-table update can happen later" | If the encoding isn't in the E-table, future retros can't score it, and you'll never know if it works. The E-table update is part of the encoding, not a follow-up. |

## Phase 1: Discover (Interactive)

1. List all retro files:
   ```bash
   ls -t ~/.feature-collab/retros/*.json ~/.feature-collab/retros/*.md 2>/dev/null
   ```

2. Classify each retro into one of:
   - **ORPHANED** — `.json` exists but no `.md`. Data loss: the synthesizer failed to write the report. Cannot be ingested. Report to user.
   - **NEW** — `.md` exists, no `## Encodings Applied` section. Ready for processing.
   - **PROCESSED** — `.md` has `## Encodings Applied` section. Skip unless user requests re-processing.
   - **PARTIAL** — `.md` has `## Encodings Applied` but not all encodable recommendations are listed. Resume from where it left off.

3. If an argument was provided, filter to retros matching that branch name.

4. Present summary table and wait for user to confirm which retros to process.

## Phase 2: Extract & Challenge (Interactive)

For each selected retro:

1. Read the full `.md` report.

2. Extract all recommendations from the `## Recommendations` section. Identify:
   - **Encodable**: Tagged with `Encodable: [file]` or specifying a target file
   - **Behavioral**: Tagged `Behavioral` or too vague/context-dependent to encode
   - **Already encoded**: Cross-reference against the current E-table in `retro-synthesizer.md` — if a recommendation duplicates an existing encoding, note this

3. **Adversarial challenge** — For each encodable recommendation, answer these questions before proposing it:

   a. **Specificity**: Can this be expressed as a trigger phrase + rebuttal (rationalizations table), a numbered step in a phase, or a red-flag condition? If not, it's behavioral.

   b. **Testability**: Can you write a pressure-test scenario where an agent without this encoding would choose wrong and an agent with it would choose right? If not, the encoding is inert.

   c. **Duplication**: Does an existing encoding already cover this? Check the E-table and grep the target file. If an existing encoding covers 80%+ of the same ground, propose strengthening it instead of adding a new one.

   d. **Placement**: Where exactly in the target file does this go? Read the file and identify the specific section. Rules in the wrong section get ignored — a phase-2 constraint in a phase-4 section won't fire when needed.

   e. **Recurring violation check**: Has this encoding's underlying issue appeared in 2+ retros? If so, the encoding needs to be stronger than a table entry. Use the encoding strength ladder to select the appropriate level:
      `rationalizations table entry` < `red flag with STOP` < `numbered phase step with verification command` < `Iron Law addition`
      A finding violated 2x deserves at least a red flag. A finding violated 3x+ deserves a phase step with a verification command.

4. Present the vetted list to the user:
   ```
   | # | Recommendation | Target | Placement | Confidence | Notes |
   |---|----------------|--------|-----------|------------|-------|
   | 1 | Typed mocks | enhance.md | Rationalizations table | HIGH | E8 violated 3x — needs teeth |
   | 2 | "Be more careful" | — | — | SKIP | Behavioral, not encodable |
   ```

5. User approves, modifies, or rejects each recommendation.

## Phase 3: Encode (Dark Factory)

For each approved recommendation:

1. **Read the target file** — understand the existing structure, style, and conventions.

2. **Write the encoding** in the exact style of its neighbors:
   - Rationalizations table: `| "trigger phrase" | concrete rebuttal |`
   - Phase step: numbered action with verification command where possible
   - Red flag: conditional with STOP instruction
   - Agent constraint: imperative sentence in the constraints section

3. **Assign the next E-number** — read the current E-table in `retro-synthesizer.md`, find the highest E-number, increment.

4. **Update the E-table** in `retro-synthesizer.md` with the new row:
   ```
   | E{N} | {encoding description} | {source retro branch} | {target file} | {score} |
   ```

5. **Track which files were modified** — you'll need this for Phase 4.

## Phase 4: Pressure Test Modified Files

**This phase is mandatory.** An encoding that hasn't been pressure-tested is an untested assertion about agent behavior.

For each skill/agent file that was modified in Phase 3:

1. Check if the file already has pressure tests in `plugins/feature-collab/pressure-tests/{agent-name}/`.

2. If pressure tests exist:
   - Dispatch a `feature-collab:pressure-test` agent against the modified file to verify the new encoding holds under adversarial pressure.
   - If the pressure test reveals the encoding is inert (agent makes the same choice with or without it), go back to Phase 3 and strengthen the encoding.

3. If no pressure tests exist yet:
   - Note this in the output: "No existing pressure tests for {file} — new encoding is unverified."
   - If the encoding addresses a finding that has been violated 2+ times (check the E-table's TRIGGERED-VIOLATED history), pressure testing is **required**, not optional. Dispatch `feature-collab:pressure-test` to create the initial test suite for this file.

4. Report pressure-test results:
   ```
   | File | Encoding | Pressure Test | Result |
   |------|----------|---------------|--------|
   | enhance.md | E18: Typed mocks | existing suite + new scenario | PASS |
   | code-architect.md | E20: Transaction flagging | no existing suite | UNVERIFIED |
   ```

## Phase 5: Verify & Mark Complete

1. **Criteria check** — For each encoding, verify:
   - [ ] The text is in the target file at the correct location
   - [ ] The E-table row exists in `retro-synthesizer.md`
   - [ ] The encoding is specific enough to score (TRIGGERED / TRIGGERED-VIOLATED) in a future retro
   - [ ] Pressure-test results are PASS or acknowledged UNVERIFIED

2. **Mark the retro as processed** — Append to the retro `.md`:
   ```markdown
   ---

   ## Encodings Applied

   | E# | Encoding | Target | Pressure Tested |
   |----|----------|--------|-----------------|
   | E18 | Typed mocks | enhance.md | PASS |
   | E20 | Transaction flagging | code-architect.md | UNVERIFIED |

   Skipped (behavioral): {list}
   Skipped (duplicate of E{N}): {list}
   Processed: {date}
   ```

3. **Update the retro `.json`** — Set `encoded_count` to the actual number of encodings applied (not the number the retro recommended).

## Rules

1. **Never invent recommendations.** Only encode what the retro report explicitly recommends. You are a processor, not an analyst.
2. **Preserve existing encodings.** When adding to the rationalizations table or a phase's action list, do not reorder or modify existing entries.
3. **Challenge before encoding.** Every recommendation goes through the adversarial challenge in Phase 2 before it touches a file. No exceptions.
4. **Pressure test after encoding.** Modified files must be pressure-tested. The only acceptable skip is when no existing test suite exists AND the finding has fewer than 2 prior violations.
5. **The E-table is the source of truth.** If an encoding isn't in the E-table, it doesn't exist for scoring purposes. Updating the E-table is part of the encoding, not a follow-up.
6. **Orphaned JSONs are warnings, not work items.** Report them so the user knows data was lost. Do not reconstruct recommendations from JSON `key_themes` alone.
7. **Strengthening > duplicating.** If a new recommendation overlaps with an existing encoding, modify the existing encoding to be stronger rather than adding a parallel rule.
8. **Ask before encoding.** Present all proposed encodings for user approval before writing files. The user may skip, modify, or defer.
