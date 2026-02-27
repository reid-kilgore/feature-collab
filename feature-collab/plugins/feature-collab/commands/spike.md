---
description: Exploration / prototype / research spike with executable findings
argument-hint: What to explore or investigate
---

# Spike: Exploration & Research

You are helping a developer explore a technical question, prototype an approach, or investigate a codebase area. Spikes produce a REPORT — not production code.

## Model Usage
- Use Opus for the main thread (planning, user interaction, synthesis)
- When spawning agents, the agent frontmatter specifies the correct model
- Never use Opus for agents that just run commands or read files

## Core Principles

- **No production code**: Spikes produce knowledge, not features
- **Executable examples**: Findings should be demonstrated with runnable code
- **Time-boxed**: Spikes have a clear question and stop when answered
- **Showboat as deliverable**: The demo doc IS the deliverable
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting spike: [question]"
# At phase transitions: wip note <item> "Phase N: [status]"
# At completion: wip status <item> DONE
# If wip get fails, skip tracking silently
```

Initial request: $ARGUMENTS

---

## Phase 1: Explore

**Goal**: Investigate the question using code-explorer agents and executable examples.

**Actions**:

1. Create PLAN.md at git root:

```markdown
<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Spike: [Question/Topic]

## Status
**Current Phase**: Explore
**Waiting For**: Investigation in progress

## Question
[What we're trying to learn or decide]

## Hypotheses
1. [Hypothesis 1]
2. [Hypothesis 2]

## Scope
- **Investigate**: [what to look at]
- **Produce**: Report with executable examples
- **Do NOT**: Write production code, modify existing code
```

2. Launch `demo-builder` agent to initialize proof doc: `showboat init DEMO.md "Spike: [question]"`

3. Launch 2-3 `code-explorer` agents in parallel:
   - Each explores a different angle of the question
   - Focus on finding patterns, constraints, and trade-offs

4. For each finding, launch `demo-builder` agent to capture executable examples.

5. If prototyping is needed, launch `code-architect` agent:
   - Work in a `spike-scratch/` directory, NOT in production code
   - Then launch `demo-builder` to capture prototype outputs

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
- See DEMO.md section: [reference]

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

2. Launch `demo-builder` agent:
   - Verify DEMO.md (re-run all examples, confirm they still work)
   - DEMO.md IS the deliverable — it should be comprehensive

3. Clean up scratch files:
   > "Spike scratch files are in `spike-scratch/`. Keep them for reference or delete with `rm -rf spike-scratch/`."

4. **WIP**: `wip status <item> DONE && wip note <item> "spike complete"`

5. Prompt user:
   > "Spike complete. See DEMO.md for executable findings and PLAN.md for recommendations. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."
