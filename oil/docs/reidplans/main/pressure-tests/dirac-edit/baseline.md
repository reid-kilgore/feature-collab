# Baseline Results: dirac-edit Contracts

## Date: 2026-05-01

## Scenario 1: Anchor Pool Exhaustion + Collision
**Status**: WRONG
**Finding**: Pool cycling (file > pool size) directly contradicts the "unique within file" guarantee. Two lines get the same anchor word. dirac_edit has no tie-breaking rule → silently edits wrong line.
**Verbatim**: "Moderator will appear on both line 0 and line 80. The contracts contradict each other."
**Fix**: No cycling — cap at pool.length lines per read window, require offset pagination.

## Scenario 2: External File Modification (Shifted Lines)
**Status**: AMBIGUOUS / UNDERSPECIFIED
**Finding**: Staleness check says "validates start_anchor's line content" — doesn't specify whether lookup is by lineIndex or content-scan. Content-scan silently passes stale state. Also: only start_anchor checked, not end_anchor.
**Verbatim**: "The staleness check as written only detects one class of modification — content changes. It does not detect line shifts that leave anchor content unchanged."
**Fix**: Explicit lineIndex-based lookup, validate BOTH anchors, no content-scan fallback.

## Scenario 3: Partial Multi-Edit Failure
**Status**: WRONG (critical data loss)
**Finding**: No validate-all-first specified. A 3-edit batch where edit 3 is stale may silently apply edits 1+2 (or corrupt anchor state) before throwing. LLM gets error but file is half-edited.
**Verbatim**: "Without validate-all-first, a 3-edit call where edit 3 is stale will silently apply edits 1+2 while returning an error."
**Fix**: Validate ALL anchors and staleness BEFORE any modification. Batch write only after all pass. Error message must confirm "no changes written."

## Scenario 4: Cold dirac_edit (No Prior Read)
**Status**: UNDERSPECIFIED
**Finding**: No promptGuidelines specified for either tool. LLM may retry with code fragments after "Unknown anchor" error. Error message doesn't explain that anchors are opaque system-assigned words, not code text.
**Verbatim**: "The LLM used actual code fragments as anchor names because it hasn't seen the output of dirac_read yet."
**Fix**: Add promptGuidelines to both tools. Improve error message to explain anchor semantics.

## Scenario 5: Overlap Detection Algorithm
**Status**: UNDERSPECIFIED
**Finding**: "Edits must not overlap" with no algorithm. Pre-check vs during-application produce different errors for same scenario (overlap error vs "unknown anchor" error). Adjacent edits (A.end+1 == B.start) and single-line edits undefined.
**Verbatim**: "The two approaches produce different observable behavior... The LLM gets a structurally different error depending on which implementation is chosen."
**Fix**: Pre-check (resolve all ranges, sort, compare before applying). Adjacent = not overlap. Same-line = valid. Named error message.

## Patterns
- **Atomicity never specified** — appears in scenarios 3, 5
- **Only start_anchor checked** — appears in scenarios 2, 3
- **Uniqueness guarantee contradicted** — appears in scenario 1 (fundamental design flaw)
- **promptGuidelines blank** — appears in scenario 4 (highest-leverage prevention point)

## Rationalizations Captured
None — this was contract-design pressure testing, not agent prompt testing. All gaps are specification omissions, not rationalization failures.
