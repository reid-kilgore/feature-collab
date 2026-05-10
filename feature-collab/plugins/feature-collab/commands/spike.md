---
name: spike
description: "Use when you genuinely do not know what to build yet — pure research, prototyping, or exploration whose findings feed into feature-collab or enhance"
argument-hint: What to explore or investigate
---

# Spike: Exploration & Research

You are helping a developer explore a technical question, prototype an approach, or investigate a codebase area. Spikes produce a REPORT — not production code.

**Violating the letter of the rules is violating the spirit of the rules.**

## Orchestrator Discipline

You are the ORCHESTRATOR. You do not read code, run tests, or implement. You dispatch agents, synthesize their outputs, update PLAN.md, and talk to the user.

### The Iron Law

```
NO PRODUCTION CODE — SPIKES PRODUCE KNOWLEDGE, NOT FEATURES
```

### Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just make this small fix while I'm exploring" | That's a bugfix, not a spike. Use /bugfix. |
| "The prototype is clean enough to keep" | Prototypes go in spike-scratch/. Production code goes through /feature-collab. |
| "I can quickly check the code myself" | Delegate to code-explorer. You orchestrate. |
| "We've answered the question, no need for a report" | The Findings section in PLAN.md IS the deliverable. No findings = no spike. |
| "I'll write up findings later" | Findings go in PLAN.md as you discover them, not reconstructed at the end. |

### Red Flags — STOP

- Writing code outside spike-scratch/
- Modifying production files
- Skipping the Findings section in PLAN.md
- Turning a spike into an implementation without switching skills

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

**Agent model table** — match the task, not the agent name:

| Task | Model | Examples |
|------|-------|----------|
| Read/find/trace/list code | Haiku | code-explorer (concept tracing), test-runner |
| Analyze/design/recommend | Sonnet | code-architect (prototyping in spike-scratch/) |
| Plan/synthesize/assess | Opus | retro-synthesizer, spike synthesis |
| CI monitoring | Haiku | gh-checks agent (single agent with poll loop, NOT sleep+check background tasks) |

## Core Principles

- **No production code**: Spikes produce knowledge, not features
- **Executable examples**: Findings should be demonstrated with runnable code in spike-scratch/
- **Time-boxed**: Spikes have a clear question and stop when answered
- **PLAN.md Findings is the deliverable**: All evidence and conclusions live there
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
```

Code prototypes live in:
```
spike-scratch/<spike-name>/
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
SPIKE_NAME="$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
mkdir -p "spike-scratch/$SPIKE_NAME"
```

All references to PLAN.md throughout this skill mean `$DOCS_DIR/PLAN.md`.

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting spike: [question]"
# At phase transitions: wip note <item> "Phase N: [status]"
# At completion: wip note <item> "spike complete — ready for PR/merge"
# DONE status is set only after branch is merged (not by this skill)
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Phase 1: Explore

**Goal**: Investigate the question using code-explorer agents and executable examples.

**Actions**:

1. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`): See `templates/PLAN.skeleton.md`. Copy and fill.

2. Launch 2-3 `code-explorer` agents in parallel:
   - Each explores a different angle of the question
   - Focus on finding patterns, constraints, and trade-offs

3. As each agent reports back, populate the **Findings** section of PLAN.md immediately. Don't batch findings — write them as they arrive so state is always on disk.

### Commit Planning Artifacts

Dispatch a haiku agent to commit planning documents. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```

### Context Checkpoint

All state saved to disk:
- PLAN.md: Question, hypotheses, scope, findings so far

**If your context feels heavy, `/clear` then `/pickup` to continue.**

4. If prototyping is needed, launch `code-architect` agent:
   - Work in `spike-scratch/<spike-name>/`, NOT in production code
   - Output goes to that directory — agent should write runnable files there
   - Reference the prototype path in the PLAN.md Findings section

---

## Phase 2: Report

**Goal**: Compile findings into a readable, actionable report.

**Actions**:

1. Update PLAN.md:

```markdown
## Status
**Current Phase**: Report
**Waiting For**: User review

## Findings

### [Finding 1 Title]
[Description with evidence]
- Prototype: `spike-scratch/<spike-name>/[file]` (if applicable)

### [Finding 2 Title]
[Description with evidence]

## Recommendations
1. [Recommended next step]
2. [Alternative approach]

## Trade-offs
| Option | Pros | Cons |
|--------|------|------|
| A | ... | ... |
| B | ... | ... |

## Follow-up Actions
- [ ] [If we choose option A, do X]
- [ ] [If we choose option B, do Y]

## Status
**Current Phase**: Complete
**Completed**: [date]
```

2. Clean up scratch files note:
   > "Spike prototypes are in `spike-scratch/<spike-name>/`. Keep them for reference or delete with `rm -rf spike-scratch/<spike-name>/`."

3. **WIP**: `wip note <item> "spike complete — ready for PR/merge"`

4. Prompt user:
   > "Spike complete. See PLAN.md Findings section for conclusions and recommendations. Prototypes (if any) are in `spike-scratch/<spike-name>/`. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

5. Offer retrospective:
   > "For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Hard Gate: Implementation Requires Skill Transition

If the user asks to implement findings mid-spike ("build it", "go implement", "kick it off", etc.), you MUST:

1. **Stop the spike.** Do not write production code under the spike skill.
2. **Commit spike artifacts** (PLAN.md, any spike-scratch/ files).
3. **Invoke the appropriate implementation skill**: `/feature-collab` for multi-component work (>200 lines), `/enhance` for small additions (<200 lines).
4. The spike's PLAN.md Findings carry forward as Phase 1 context — no research duplication.

This is not optional. "The user told me to" does not override the spike's iron law (no production code). The correct response to "build it" is to transition skills, not to start editing source files.

## Transitioning to Implementation

Spikes often lead to implementation. When the user wants to act on spike findings:

1. **The spike's PLAN.md Findings and any spike-scratch/ prototypes become Phase 1 context** for `/feature-collab` or `/enhance`. The concept extraction and codebase research is already done — the next skill should consume it, not redo it.

2. Suggest the right next skill:
   > "This spike answered [question]. To implement, I'd suggest:
   > - `/enhance` if it's <200 lines and straightforward
   > - `/feature-collab` if it spans multiple components or is >200 lines
   >
   > The spike findings (PLAN.md) will carry forward as Phase 1 context — no research duplication."

3. When `/feature-collab` or `/enhance` starts after a spike, Phase 1 should:
   - Read the spike's PLAN.md Findings and any spike-scratch/ prototypes
   - Skip redundant exploration — the spike already traced concepts through the codebase
   - Focus Phase 1 on scope locking and contracts, not re-exploration
   - Reference spike findings in the new PLAN.md's Codebase Context section
