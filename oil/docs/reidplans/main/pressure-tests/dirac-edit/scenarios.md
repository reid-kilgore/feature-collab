# Pressure Test: dirac-edit Contracts

## Target
- **Subject**: dirac-edit extension contracts (CONTRACTS.md)
- **Iron Law**: Anchor state must stay coherent between dirac_read and dirac_edit calls
- **Key discipline rules**:
  - Module-level anchorState Map persists within session
  - Staleness check on start_anchor line content before applying edits
  - Line-shift re-anchoring after edits (not Myers Diff)
  - Anchor pool cycles when file > pool size
  - Edits applied in-order, must not overlap
- **Incentives to break**:
  - Pool exhaustion handling is underspecified
  - Atomic write vs partial-apply on multi-edit failure is underspecified
  - Concurrent external file modification handling is implicit
  - tilth_edit removal may leave LLM confused without guidance

## Scenarios

### Scenario 1: Anchor Pool Exhaustion + Same Anchor Collision
A file has 90 lines. ANCHOR_POOL has ~80 unique words. Cycling from the top means line 81 gets "Moderator" again — same word as line 1.
- The LLM reads the file and sees two lines labeled "Moderator"
- LLM calls dirac_edit with start_anchor="Moderator" to edit line 81
- **Contract says**: "Edits must not overlap" — but doesn't specify how dirac_edit resolves ambiguous anchor names
- **Question**: Which "Moderator" does dirac_edit pick? First occurrence? Last? Throw?

### Scenario 2: External File Modification Mid-Session
1. LLM calls dirac_read on payments.py — anchors assigned, state stored
2. LLM (or user via bash) calls `tilth_edit` or `Write` to modify a different part of payments.py
3. LLM calls dirac_edit with anchors from the original read
- **Staleness check**: Only validates `start_anchor`'s content. But intervening lines may have shifted, making `end_anchor` point to the wrong line.
- **Question**: Does the contracts' staleness check catch shifted-but-unchanged `start_anchor` content?

### Scenario 3: Partial Multi-Edit Failure
LLM calls dirac_edit with 3 edits. Edit 1 and 2 succeed. Edit 3's start_anchor is stale.
- **Contract says**: "Edits applied in order" but doesn't specify atomicity
- **Question**: Does edit 1+2 get written to disk before edit 3 fails? File is now partially updated, anchor state is inconsistent.

### Scenario 4: tilth_edit Removal — No Escape Hatch
tilth_edit removed from directTools. LLM wants to make a trivial 1-line change (fix a typo).
- Must call dirac_read first to establish anchors — but contracts don't specify this in promptGuidelines
- **Question**: Does the LLM know to call dirac_read before dirac_edit? What happens if it tries dirac_edit cold (no prior read)?

### Scenario 5: Overlapping Edits Spanning Same Lines
LLM calls dirac_edit with:
- Edit 1: start=Moderator (line 5), end=Ripple (line 10)
- Edit 2: start=Qualifier (line 8), end=Corona (line 15)
- **Contract says**: "Edits must not overlap" — but overlap detection runs against ORIGINAL state, not post-edit state
- **Question**: Does the overlap check happen before or after anchors are resolved to line numbers? What's the algorithm?
