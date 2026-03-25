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
| "We've answered the question, no need for a report" | The report IS the deliverable. No report = no spike. |

### Red Flags — STOP

- Writing code outside spike-scratch/
- Modifying production files
- Skipping the report
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
- **Findings + recommendations**: The PLAN.md report IS the deliverable
- **Time-boxed**: Spikes have a clear question and stop when answered
- **Main thread orchestrates only**: Never read code, run tests, or run commands directly. Delegate ALL substantive work to agents. Main thread updates PLAN.md, talks to the user, and dispatches agents.
- **WIP tracking**: Update `wip` status at every phase boundary and track all branches created

## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
  PLAN.md
```

**At skill start**, resolve the doc directory:
```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
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

## Metrics Tracking

The orchestrator tracks workflow efficiency metrics for this session. These feed into retro baselines and anomaly detection.

**Schema** — maintain this object in working memory throughout the session:

```json
{
  "workflow_type": "spike",
  "started_at": "<ISO timestamp — set at skill start>",
  "phases_executed": 0,
  "user_interventions": 0,
  "agent_dispatches": 0,
  "dark_factory_escalations": 0,
  "scope_guardian_flags": 0,
  "criteria_not_ready_count": 0,
  "completed_at": null
}
```

**Increment rules**:
- `phases_executed` — increment at each phase boundary (1→2)
- `user_interventions` — increment each time the orchestrator asks the user a question or waits for user input (direction changes, scope questions, and "say 'done'" prompts all count)
- `agent_dispatches` — increment each time an agent is launched (parallel agents = N increments)
- `dark_factory_escalations` — spikes have no dark factory; leave at 0
- `scope_guardian_flags` — spikes do not dispatch scope-guardian; leave at 0
- `criteria_not_ready_count` — spikes do not dispatch criteria-assessor; leave at 0

**Write metrics at workflow completion** (Phase 2 Report, before PR/merge):

```bash
mkdir -p ~/.feature-collab/metrics
BRANCH=$(git branch --show-current)
DATE=$(date +%Y-%m-%d)
cat > ~/.feature-collab/metrics/${DATE}-${BRANCH}.json << 'EOF'
{ <metrics object with completed_at set to current ISO timestamp> }
EOF
```

Individual agents do not need to know about metrics — this is orchestrator-only bookkeeping.

---

## Phase 1: Explore

**Goal**: Investigate the question using code-explorer agents and executable examples.

**Actions**:

1. Create PLAN.md in the doc directory (`$DOCS_DIR/PLAN.md`):

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
- **Produce**: Report with findings and recommendations
- **Do NOT**: Write production code, modify existing code

## Exit Criteria
- [ ] Question answered with evidence
- [ ] Recommendations documented with trade-offs
- [ ] No production code written (spike-scratch/ only)
```

2. Launch 2-3 `code-explorer` agents in parallel:
   - Each explores a different angle of the question
   - Focus on finding patterns, constraints, and trade-offs

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

3. If prototyping is needed, launch `code-architect` agent:
   - Work in a `spike-scratch/` directory, NOT in production code

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

2. Clean up scratch files:
   > "Spike scratch files are in `spike-scratch/`. Keep them for reference or delete with `rm -rf spike-scratch/`."

4. **WIP**: `wip note <item> "spike complete — ready for PR/merge"`

5. Prompt user:
   > "Spike complete. See PLAN.md for findings and recommendations. Run `mdannotate PLAN.md` to annotate and review, or say **'done'**."

6. Offer retrospective:
   > "For a session retrospective, `/clear` then `/retro` — this gives unbiased agents a clean read of the transcript."

### Hard Gate: Implementation Requires Skill Transition

If the user asks to implement findings mid-spike ("build it", "go implement", "kick it off", etc.), you MUST:

1. **Stop the spike.** Do not write production code under the spike skill.
2. **Commit spike artifacts** (PLAN.md, any spike-scratch/ files).
3. **Invoke the appropriate implementation skill**: `/feature-collab` for multi-component work (>200 lines), `/enhance` for small additions (<200 lines).
4. The spike's PLAN.md carries forward as Phase 1 context — no research duplication.

This is not optional. "The user told me to" does not override the spike's iron law (no production code). The correct response to "build it" is to transition skills, not to start editing source files.

## Transitioning to Implementation

Spikes often lead to implementation. When the user wants to act on spike findings:

1. **The spike's PLAN.md findings and recommendations become Phase 1 context** for `/feature-collab` or `/enhance`. The concept extraction and codebase research is already done — the next skill should consume it, not redo it.

2. Suggest the right next skill:
   > "This spike answered [question]. To implement, I'd suggest:
   > - `/enhance` if it's <200 lines and straightforward
   > - `/feature-collab` if it spans multiple components or is >200 lines
   >
   > The spike findings (PLAN.md) will carry forward as Phase 1 context — no research duplication."

3. When `/feature-collab` or `/enhance` starts after a spike, Phase 1 should:
   - Read the spike's PLAN.md findings and recommendations
   - Skip redundant exploration — the spike already traced concepts through the codebase
   - Focus Phase 1 on scope locking and contracts, not re-exploration
   - Reference spike findings in the new PLAN.md's Codebase Context section
