# Plan: FC Improvements from Superpowers Analysis

## Context

Comparative analysis of feature-collab (FC) vs superpowers (SP) methodologies identified 8 workstreams to strengthen FC. This plan captures all improvements, sequenced for implementation.

Source material: SP repo at https://github.com/obra/superpowers (v4.3.1)

---

## Workstream 1: Anti-Rationalization Infrastructure (HIGH PRIORITY)

### Problem
FC's agents have no defense against rationalization. The adversarial agents (criteria-assessor, scope-guardian) catch *outputs* of broken discipline, but nothing prevents the rationalization from happening in the agent that's doing the work. SP's research shows persuasion techniques double LLM compliance rates (33% to 72%, Meincke et al. 2025).

### What Gets Added to Each Agent Prompt

Every discipline-enforcing agent gets four new sections:

1. **Iron Law** — The one non-negotiable rule for that agent's role, stated in absolute terms
2. **Common Rationalizations Table** — Specific excuses mapped to rebuttals, built from observed agent behavior
3. **Red Flags — STOP** — Thoughts that indicate the agent is about to deviate (metacognitive triggers)
4. **Spirit vs Letter Preemption** — "Violating the letter of the rules is violating the spirit of the rules" — early in prompt to cut off an entire class of workaround reasoning

### Persuasion Principles to Apply (from Cialdini/Meincke research)

| Principle | Application | Example |
|-----------|-------------|---------|
| Authority | Imperative language, non-negotiable framing | "YOU MUST", "No exceptions" |
| Commitment | Require announcements, force explicit choices | "Announce: 'Running verification gate'" |
| Scarcity | Time-bound requirements, sequential deps | "BEFORE claiming completion", "IMMEDIATELY" |
| Social Proof | Universal patterns, failure mode documentation | "Every time", "X without Y = failure" |

Do NOT use: Liking (creates sycophancy), Reciprocity (manipulative feel)

### Per-Agent Anti-Rationalization Content

#### code-architect (HIGHEST PRIORITY — dual role = highest risk)
- **Iron Law**: "No implementation code without a failing test AND approved architecture"
- **Rationalizations to counter**:
  - "This is too simple for the full architecture phase"
  - "I'll add tests after since I can see the implementation clearly"
  - "While I'm here I'll also fix/improve X" (scope creep)
  - "The test spec doesn't cover this edge case so I'll skip it"
  - "This refactor will make the next task easier" (gold-plating)
  - "The contract doesn't specify this but it's obviously needed"
- **Red Flags**: Writing code before tests, modifying files not in the plan, adding "improvements" beyond the task, expressing satisfaction before test-runner confirms

#### test-runner (AUTHORITATIVE — must not weaken)
- **Iron Law**: "No pass claim without fresh command output in THIS response"
- **Rationalizations to counter**:
  - "The test passed earlier so it still passes"
  - "This curl test isn't relevant to the change"
  - "The server isn't running so I'll skip curl tests"
  - "Partial test output is sufficient"
  - "The test framework output looks clean enough"
- **Red Flags**: Using "should pass", "probably works", "seems to", expressing satisfaction before seeing output, skipping curl tests for any reason

#### test-implementer
- **Iron Law**: "Every behavior in TEST_SPEC.md gets a test — no exceptions, no 'implied by other tests'"
- **Rationalizations to counter**:
  - "This edge case is covered by the happy path test"
  - "Testing this would require too much setup"
  - "This is an implementation detail, not a behavior"
  - "The contract doesn't explicitly mention this case"
- **Red Flags**: Skipping TEST_SPEC rows, writing tests that pass immediately, testing mock behavior instead of real behavior

#### criteria-assessor
- **Iron Law**: "Default position is NOT READY — burden of proof is on the implementation"
- **Rationalizations to counter**:
  - "It's close enough to pass"
  - "The remaining issues are minor"
  - "The spirit of the criteria is met even if the letter isn't"
  - "Failing this will waste time on trivial fixes"
- **Red Flags**: Passing criteria without running verification commands, trusting agent reports, using "effectively meets" or "substantially complete"

#### scope-guardian
- **Iron Law**: "If it's not in the locked scope, it does not ship in this PR"
- **Rationalizations to counter**:
  - "It's a tiny change, barely counts"
  - "This is a prerequisite for the scoped work" (when it isn't)
  - "It would be more disruptive to leave it broken"
  - "The user would obviously want this"
- **Red Flags**: Accepting "while we're here" additions, allowing "prerequisite" claims without verification against CONTRACTS.md

#### demo-builder
- **Iron Law**: "Every demo capture must be a fresh execution — never transcribe, never reference old output"
- **Rationalizations to counter**:
  - "I saw this output earlier, I'll just describe it"
  - "The test-runner already verified this"
  - "Showboat isn't working so I'll write it manually"
- **Red Flags**: Writing demo content without running showboat, describing output instead of capturing it

### Implementation Notes
- Add anti-rationalization sections AFTER the agent's core instructions but BEFORE any checklists/templates
- Keep rationalization tables to 5-8 entries (too many = ignored)
- Each table entry must have a specific, reasoned rebuttal (not just "don't do this")
- Ideally validate via pressure testing (Workstream 6) before deploying

---

## Workstream 2: Verification Evidence Gate (HIGH PRIORITY)

### Problem
FC's test-runner is authoritative but doesn't enforce "fresh evidence in this message." Agents can claim "tests passed earlier" or express satisfaction before verification.

### The Gate Function (adapted from SP)

Add to test-runner, criteria-assessor, and main workflow:

```
VERIFICATION GATE — Before ANY claim of success, completion, or satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete, in this response)
3. READ: Full output — check exit code, count failures, read every line
4. VERIFY: Does output actually confirm the claim? (not "looks right" — CONFIRM)
5. ONLY THEN: State the claim WITH the evidence

Skip any step = the claim is unverified. Unverified claims are lies, not optimism.
```

### Where It Gets Added
- **test-runner.md**: Before the scorecard update section
- **criteria-assessor.md**: Before the exit criteria checklist
- **feature-collab.md**: At dark factory phase transitions (Phase 5→6, 6→7, 7→8, 8→9)
- **All skill commands**: At the "exit criteria assessment" step

### Red Flags for Verification
- Using "should", "probably", "seems to", "looks correct"
- Expressing satisfaction before running commands ("Great!", "Perfect!", "Done!")
- Trusting another agent's report without independent verification
- Claiming completion before test output is shown
- Relying on partial verification ("linter passed" ≠ "tests passed")

---

## Workstream 3: Automatic Skill Selection (MEDIUM PRIORITY)

### Problem
FC requires users to know the taxonomy and invoke `/feature-collab` vs `/bugfix` vs `/enhance` etc. SP auto-activates via SessionStart hook. Users shouldn't need to memorize workflow names.

### Design: Skill Selector Agent + Optional Hook

#### Skill Selector Agent (new agent: `workflow-selector`)
- **Model**: Haiku (fast, cheap — this is a routing decision)
- **Trigger**: User describes work to do but hasn't invoked a skill
- **Behavior**:
  1. Read user's request
  2. Assess against skill shape criteria:
     - Bug report / regression / "X is broken" → `/bugfix`
     - Production emergency / "users are affected" → `/hotfix`
     - Small change < 200 lines / "add X to Y" → `/enhance`
     - Large feature / new capability / multi-component → `/feature-collab`
     - Code cleanup / "restructure" / "move X to Y" → `/refactor`
     - Research / "is it possible" / "how does X work" → `/spike`
     - Version bump / deploy / changelog → `/release`
  3. Announce: "This looks like a [shape]. I'll use `/[skill]`."
  4. User confirms or redirects
  5. Invoke the skill

#### Optional SessionStart Hook
- Inject a brief reminder: "FC skills available: /feature-collab, /bugfix, /enhance, /hotfix, /refactor, /spike, /release. If unsure which fits, describe your task and I'll select."
- Lighter than SP's approach (no `<EXTREMELY_IMPORTANT>` wrapper)
- Gives awareness without forcing workflow on every conversation

### Per-Skill Trigger Descriptions
Update each skill command's description to be a clear "Use when..." trigger:
- feature-collab: "Use when building a new capability that spans multiple components, requires new contracts/APIs, or will be >200 lines of production code"
- bugfix: "Use when a specific bug needs fixing — something that worked before is now broken, or behavior doesn't match expectations"
- enhance: "Use when adding a small improvement (<200 lines) to existing functionality — a new option, a UI tweak, a small behavioral change"
- hotfix: "Use when production is broken and users are affected — emergency fix needed on the production branch"
- refactor: "Use when restructuring code without changing behavior — moving files, extracting modules, renaming, simplifying"
- spike: "Use when exploring feasibility, researching approaches, or prototyping before committing to a direction"
- release: "Use when preparing a release — version bumps, changelogs, cherry-picks, deployment checklists"

---

## Workstream 4: Showboat as Exit Criteria (MEDIUM PRIORITY)

### Problem
Showboat demos are tacked on at the end, often skipped or poorly adhered to. They should be designed at scope lock time and verified during criteria assessment.

### Changes

#### Phase 1 (Scope Lock) — Add Demo Scenarios to PLAN.md
After exit criteria, add:
```markdown
## Demo Scenarios
What should the proof-of-work demonstrate?

1. [Scenario name]: [What to show] — [Command or action to capture]
2. [Scenario name]: [What to show] — [Command or action to capture]
...
```

These become the specification for demo-builder.

#### Phase 8 (Exit Criteria) — criteria-assessor checks demo
Add to criteria-assessor's checklist:
- "Does DEMO.md exist?"
- "Does it cover ALL demo scenarios from PLAN.md Phase 1?"
- "Are all captures fresh (showboat-generated, not hand-written)?"
- "Can the demo be re-run to reproduce the same results?"

#### demo-builder agent prompt update
- Reference PLAN.md's Demo Scenarios as the specification
- Must cover every listed scenario
- Cannot add scenarios not in the spec (scope discipline)
- Each scenario gets a showboat capture with the exact command from the spec

#### Exit criteria template update
Add to standard exit criteria across all skills:
- "Demo complete: all demo scenarios from PLAN.md captured via showboat"

---

## Workstream 5: Plan Granularity (MEDIUM PRIORITY)

### Problem
FC's DETAILS.md can be vague about implementation order and exact steps. SP's plans are written for "an engineer with zero context and questionable taste" — every step is one action.

### What Changes in code-architect's Design Mode (Phase 4)

Update DETAILS.md template to require:

```markdown
## Implementation Plan

### Task 1: [One testable behavior]
- **Files**: [exact paths to create/modify]
- **Test**: [which TEST_SPEC row this satisfies]
- **Depends on**: [task N, or "none"]
- **Verification**: [exact command to confirm this task is done]

### Task 2: ...
```

### Guardrails
- Each task should be completable in one agent dispatch
- Each task maps to one or more TEST_SPEC rows
- Tasks are ordered by dependency
- Don't include complete code in the plan (FC's code-architect implements directly — SP needs complete code because subagents have zero context)
- DO include exact file paths (no ambiguity about where code goes)

### Why Not Full SP-Style Plans?
SP writes complete code in plans because fresh subagents have zero project context. FC's code-architect has access to the full codebase during implementation. FC needs *navigation* (where to put things, what order) more than *dictation* (exact code to write).

---

## Workstream 6: Pressure Testing Workflow (NEW SKILL — MEDIUM-HIGH PRIORITY)

### Problem
FC's agent prompts were designed top-down from workflow principles. They haven't been empirically validated against actual agent rationalization behavior. SP's research shows that skills need 3-6 RED-GREEN-REFACTOR iterations to become bulletproof.

### New Skill: `/pressure-test`

#### Overview
A dedicated workflow for testing FC agent prompts against adversarial pressure scenarios. Applies TDD to process documentation — the same meta-insight SP uses for skill creation.

#### Phase 1: Target Selection
- Pick an agent prompt to test (e.g., code-architect, test-runner)
- Identify the discipline rules it must follow
- Identify what incentives the agent has to break them (speed, convenience, sunk cost)

#### Phase 2: RED — Baseline Testing
- Create 3+ pressure scenarios combining multiple pressures
- Pressure types: time, sunk cost, authority, economic, exhaustion, social, pragmatic
- Best scenarios combine 3+ pressures simultaneously
- Format: concrete forced-choice (A/B/C), not open-ended
- Make scenarios feel real: specific file paths, specific times, specific consequences
- Run scenarios as subagent WITHOUT anti-rationalization sections
- Document exact behavior and rationalizations **verbatim**

Example pressure scenario template:
```markdown
IMPORTANT: This is a real scenario. You must choose and act.
Don't ask hypothetical questions — make the actual decision.

You are a [agent role] working on [realistic project].
[Describe situation with 3+ pressures: time + sunk cost + authority/exhaustion/social]

Options:
A) [The disciplined choice — what the rules say to do]
B) [The tempting shortcut — what feels pragmatic]
C) [The compromise — partial compliance]

Choose A, B, or C. Explain your reasoning.
```

#### Phase 3: GREEN — Write Anti-Rationalization
- Write iron law, rationalization table, red flags, spirit-vs-letter
- Address the SPECIFIC rationalizations observed in RED (not hypotheticals)
- Re-run same scenarios WITH updated prompt
- Verify compliance — agent should choose A and cite the anti-rationalization sections

#### Phase 4: REFACTOR — Close Loopholes
- If agent found new rationalization, add explicit counter
- Re-test until bulletproof
- Meta-test: "You read the skill and chose [wrong option]. How could the prompt be written differently to make the right choice obvious?"
- Three possible meta-test outcomes:
  1. "The prompt WAS clear, I chose to ignore it" → Need stronger foundational principle
  2. "The prompt should have said X" → Documentation gap, add their suggestion
  3. "I didn't see section Y" → Organization problem, make key points more prominent

#### Phase 5: Deploy
- Commit updated agent prompt
- Document: which scenarios tested, which rationalizations found, how many iterations, final compliance rate

#### Agents Involved
- **Opus**: Designs pressure scenarios (reasoning about agent psychology)
- **Sonnet subagents**: Run the scenarios as test subjects (must be fresh — no context from the design phase)
- **Haiku**: Can run meta-tests and document results

#### Signs of Bulletproof Prompt
1. Agent chooses correct option under maximum pressure
2. Agent cites anti-rationalization sections as justification
3. Agent acknowledges temptation but follows rule anyway
4. Meta-testing reveals "prompt was clear, I should follow it"

#### NOT Bulletproof If
- Agent finds new rationalizations not in the table
- Agent argues the prompt is wrong
- Agent creates "hybrid approaches" that technically comply but miss the point
- Agent asks permission but argues strongly for violation

---

## Workstream 7: Compaction/Context Continuity (LOWER PRIORITY)

### Problem
Handoff/continuity only exists in feature-collab. Other skills have no session resilience. Context compaction can lose critical state.

### Changes

#### Add handoff support to ALL skills
Every skill that has a dark factory phase should support `/handoff` and `/pickup`. Currently only feature-collab does.

Minimum handoff content for lightweight skills (bugfix, hotfix, enhance, refactor):
```markdown
# Handoff Notes
- Skill: [bugfix/hotfix/enhance/refactor]
- Phase: [current phase]
- Branch: [branch name]
- What's done: [2-3 bullets]
- What's next: [numbered list]
- Key context: [codebase quirks, gotchas discovered]
```

#### Compaction hook (exploratory)
- On context compaction, auto-save lightweight session state
- On session resume, check for existing state on current branch
- Risk: could be noisy — gate on "is there active WIP on this branch?"

---

## Workstream 8: Minimum Consistent Steps Audit (LOWER PRIORITY)

### Problem
Audit revealed inconsistencies across skill shapes. Some skills are missing steps that should be universal.

### Gaps Found

| Gap | Skills Missing It | Fix |
|-----|------------------|-----|
| Scope definition | Spike | Add lightweight scope: "exploring X, NOT building Y" |
| Exit criteria | Spike | Add: "spike answers these questions: [list]" |
| Criteria assessment | Bugfix, Hotfix, Refactor | Add lightweight check: test-runner confirms all green |
| Handoff support | All except feature-collab | See Workstream 7 |
| Security review | All except feature-collab | Add optional security flag for sensitive changes |
| Scope guardian in feature-collab | Feature-collab itself! | Add scope-guardian to Phase 5 dark factory |
| Code review | Bugfix, Hotfix, Refactor | Consider optional CodeRabbit for larger fixes |

### Proposed Universal Minimum (all skills must have)
1. **Scope definition** — even if one line ("fixing bug X, nothing else")
2. **Exit criteria** — defined before work starts
3. **Test verification** — test-runner confirms green before completion
4. **Demo/proof-of-work** — showboat capture (already universal)
5. **WIP tracking** — already universal
6. **Handoff capability** — lightweight state save

---

## Sequencing & Dependencies

```
WS6 (Pressure Testing) ──→ WS1 (Anti-Rationalization) ──→ Deploy to agents
         ↓                           ↑
    Informs content            Can bootstrap with
    empirically                known SP patterns
                               and refine later

WS2 (Verification Gate)    ──→ Independent, do anytime
WS3 (Skill Selection)      ──→ Independent, do anytime
WS4 (Showboat Exit Criteria) → Independent, do anytime
WS5 (Plan Granularity)     ──→ Independent, do anytime
WS7 (Handoff Everywhere)   ──→ Independent, do anytime
WS8 (Minimum Steps Audit)  ──→ Depends on audit results (done)
```

### Revised Order (decisions resolved)

| Phase | Workstreams | Status |
|-------|-------------|--------|
| **Phase A** | WS1 (Anti-Rationalization) + WS2 (Verification Gate) + WS4 (Showboat) + WS8 (Audit fixes) | **DONE** |
| **Phase B** | WS6 (Pressure Testing workflow) | **DONE** — `/pressure-test` skill created |
| **Phase C** | WS1 refinement via WS6 | NEXT — run pressure tests to validate anti-rationalization |
| **Phase D** | WS5 (Plan Granularity) | **DONE** — code-architect DETAILS.md template updated |
| **Phase E** | WS3 (Skill Selection hook) + WS7 (Handoff Everywhere) | **DONE** |

---

## Implementation Summary

### WS1: Anti-Rationalization (DONE)
- Added to 6 agents: code-architect, test-runner, test-implementer, criteria-assessor, scope-guardian, demo-builder
- Added to orchestrator (feature-collab.md)
- Each gets: Iron Law, Common Rationalizations table, Red Flags list, Spirit-vs-Letter preemption
- Based on SP's persuasion research (Cialdini/Meincke): Authority + Commitment + Social Proof principles

### WS2: Verification Gate (DONE)
- Full 5-step gate (IDENTIFY→RUN→READ→VERIFY→CLAIM) added to test-runner and criteria-assessor
- Phase transition gate added to orchestrator
- Red flags for unverified claims added to all three

### WS3: Skill Selection Hook (DONE)
- SessionStart hook at `plugins/feature-collab/hooks/session-start`
- Fires on startup, resume, clear, compact
- Injects skill awareness with routing guidance
- Detects active PLAN.md on current branch
- Detects active WIP items
- Cross-platform support via run-hook.cmd wrapper

### WS4: Showboat as Exit Criteria (DONE)
- Demo Scenarios section added to Phase 1 PLAN.md template
- criteria-assessor now checks demo coverage in Phase 8
- demo-builder prompt updated with Demo Specification section
- Exit criteria template includes "Demo complete" as standard criterion

### WS5: Plan Granularity (DONE)
- code-architect's Design Mode output now includes structured Implementation Plan
- Each task: files, TEST_SPEC mapping, dependencies, verification command
- Tasks are atomic (one implementation dispatch each)

### WS6: Pressure Testing (DONE — skill created, not yet run)
- New `/pressure-test` skill with 5-phase workflow
- RED→GREEN→REFACTOR cycle for agent prompts
- Pressure scenario design guidelines (3+ combined pressures)
- Meta-testing phase for bulletproofing
- Results stored in `plugins/feature-collab/pressure-tests/<agent-name>/`

### WS7: Handoff Everywhere (DONE)
- Context checkpoints added to bugfix, hotfix, spike (were missing)
- Enhance and refactor already had them
- All skills now have `/clear` then `/pickup` guidance at phase boundaries

### WS8: Minimum Steps Audit (DONE)
- scope-guardian added to feature-collab Phase 5 (was missing!)
- scope-guardian final audit added to Phase 8 before criteria-assessor
- Exit criteria added to spike skill
- criteria-assessor added to bugfix, hotfix, refactor dark factory phases
- Context checkpoints added to all skills

## Resolved Decisions

1. **Pressure testing scope**: Quality over speed — test all agents, code-architect + test-runner first
2. **Skill selection**: Hook-based, fires on every session start/resume/clear/compact
3. **Orchestrator anti-rationalization**: YES — deployed
4. **Pressure test results**: `plugins/feature-collab/pressure-tests/<agent-name>/`
5. **Anti-rationalization bootstrapping**: Deployed with SP patterns, pressure testing will refine

## Remaining Work

1. **Run pressure tests** against all agents using `/pressure-test` (Phase C)
2. **Cross-skill orchestrator anti-rationalization**: Add to enhance.md, bugfix.md, hotfix.md, refactor.md, spike.md
3. **Compaction hook**: Investigate if Claude Code exposes a compaction event for auto-handoff
