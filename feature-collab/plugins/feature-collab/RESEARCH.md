The Core Insight First
The harness is now a first-order performance variable, not the model. A benchmark by Matt Maher's 100-feature PRD test found that changing the harness around a fixed model creates up to a 6x gap in output quality. Running multiple instances makes this even more consequential — the seams between phases are where most quality is lost. Everything below is about making those seams robust.

Plan Iteration
The biggest failure mode is under-specifying before any code runs. The best-practice pattern from multiple production systems is a two-pass planning gate:

Exploratory pass: Run a read-only "planner" agent against your codebase that asks clarifying questions and drafts a spec in normative SHALL/MUST statements — no implementation hints, no test scenarios. Iterate on this until it feels airtight.

Constraint pass: A separate checklist agent probes whether the spec references real file paths, existing libraries, and feasible architectures before handing off. The Spec Kit Agents paper (arXiv 2604.05278) calls these "pre-phase discovery hooks" and found +0.15 quality improvement on a 1–5 composite score by grounding each phase artifact against the actual repo before the next phase starts.

Write the plan to PLAN.md before any work runs, commit it to the branch, and make it the canonical input to every downstream agent. The plan becomes an immutable ground truth — not something the agent can silently revise as it works.

For your multi-instance setup: the GSD framework's orchestrator pattern keeps the plan as the shared ledger. Each instance gets its wave-scoped task slice; the plan doc stays untouched as the reference.

Disk Artifacts for Fresh Context Handoffs
This is the single most impactful architectural decision. The pattern that emerges across every high-quality harness is: agents communicate through markdown files on disk, not through conversation.

Three persistence layers to design explicitly:

Layer	What it stores	Failure mode if missing
AGENTS.md / CLAUDE.md	Team-wide conventions, repo structure, tech stack, decision rationale	Agent re-derives same architectural choices every session
Phase artifacts (PLAN.md, SPEC.md, TASKS.md, RESEARCH.md)	Living implementation intent per phase	Feature state is lost between sessions; agent contradicts itself
Decision log	Per-session architectural decisions with human curation	Same corrections needed session after session
The practical implementation: stage-scoped output folders where each phase reads from the prior phase's output directory and writes to its own. ICM (Interpretable Context Methodology, arXiv 2603.16021) formalizes this as "stage contracts" — each stage defines a CONTEXT.md with what it reads, what it does, and what it writes — and humans can inspect and edit at every boundary before the next stage runs.

For phase handoffs specifically, Anthropic's own harness research distinguishes between compaction (summarizing in-place, same agent continues) and context reset (fresh agent, structured handoff artifact). Compaction preserves continuity but doesn't eliminate context anxiety. A full reset provides a clean slate at the cost of needing a rich enough handoff artifact. For your use case (starting different phases of a PR with fresh context), structured resets are the right call: the handoff doc should include current branch state, what's been completed, what the next agent's precise scope is, and open decisions.

Locking Intent Before Implementation
The single biggest quality lever for PR alignment is: the test plan must be committed to the branch before a single line of implementation runs. This is the pattern from spec-kit:

Generate named WHEN/THEN scenarios from the spec → commit as test-plan.md

Agent implements against that locked test plan

Post-implementation: static analysis checks that every WHEN/THEN scenario has a real, non-trivially-passing test with a comment pointing back to it

This converts "did the agent follow my intent?" from a hope into a mechanically verifiable property. The /speckit.testplan and /speckit.testchecklist slash commands automate both steps. When you do your PR review, you're diffing test-plan.md against SPEC.md and checking the coverage report — not reading 95 changed files line by line.

The Spec Kit Agents paper adds pre-phase validation hooks that check intermediate artifacts (SPEC.md, PLAN.md, TASKS.md) for hallucinated APIs, invalid file paths, and architectural mismatches before code generation begins — front-loading error detection so compounding errors don't accumulate across phases.

Multi-Phase Workflow Patterns
The community has largely converged on the same phase structure, with variations on automation:

Phase structure
Specify → SPEC.md, normative requirements

Plan → PLAN.md, dependency-ordered task graph

Test plan (locked) → test-plan.md committed before impl

TDD Red → write failing tests, confirm they fail

Implement → green pass per test

Test gap analysis → coverage diff, WHEN/THEN mapping

Verify → spec vs impl alignment check (pre-PR)

Demo/QA → Playwright agent exercising the running application

TDD Red specifically: Telling an agent to "practice TDD" without pointing it at specific tests actually increases regressions. The TDAD paper (arXiv 2603.17973, 2026) found that agents given a graph-based test-impact map reduced regressions by 70% on SWE-bench Verified vs. a vanilla baseline. The practical implication: your TDD Red phase should generate specific test files the implementation phase is told to target, not just a general TDD instruction.

Test gap analysis: The MCP market TDD Guide skill and AI Hero's tdd skill both do static coverage analysis — assertion density, smell detection, WHEN/THEN trace-back — that you can run as a gate between red and impl phases.

Demo/QA phase: The strongest pattern here is a Playwright-evaluator agent that navigates the running application as a user would, exercising UI features and API endpoints, then grading against the sprint contract's acceptance criteria. This is distinct from test runners — it's behavioral verification of the actual running app. Anthropic's harness research shows this catches whole classes of bugs that pass unit tests (stubs that display but don't function, routing errors, missing wiring between layers).

Multi-Instance Coordination
For running multiple instances on the same repo without collisions, two complementary patterns:

Git worktrees + branch-encoded context: Each agent gets an isolated sibling directory via git worktree. Agents parse their branch name scheme (feature/phase2-impl-auth) to determine their role, phase, and task context without needing it injected. Handoffs use git notes rather than API calls — the maker agent leaves a prompt for the checker agent directly on the commit.

Wave-based dependency ordering: Independent tasks run in parallel waves; dependent tasks wait for the prior wave's completion. GSD implements this explicitly, grouping plans into a dependency DAG and running each wave with fresh 200k-token contexts. The orchestrator does ~10–15% of the context budget; each worker gets a fresh full window.

Writer/Reviewer pattern: Claude Code's docs recommend using a fresh context for the reviewing instance specifically — a separate session that never saw the code being written avoids confirmation bias and catches things the writer missed.

PR Verification Against Original Intent
The canonical architecture is a Verifier agent that runs before the PR is opened, not after. Code can be syntactically correct, pass type checks, pass all tests, and still diverge from the agreed spec. A diff-level reviewer sees the code compiles; a Verifier sees that the endpoint no longer enforces the validation contract you agreed to.

The practical gates for a harness:

Pre-implementation: test-plan.md locked on disk (spec → tests traceability)

Pre-commit hook: full test suite must pass (verifiable correctness)

Pre-PR Verifier agent: checks implementation against SPEC.md and test-plan.md, produces a spec-compliance report rather than a diff

PR review as intent diff: you read test-plan.md vs SPEC.md and coverage report vs test-plan.md — not the code

For your pi.dev setup using OpenRouter's Agent SDK, the --output-schema flag lets you run structured output validation on the Verifier's final response, failing with exit code 2 if the compliance report doesn't meet a defined schema. This makes the verification gate machine-checkable.

Other Levers Worth Adding
REVIEW.md (separate from CLAUDE.md): Claude Code's docs note that repo-specific PR rules are more reliably followed when in a REVIEW.md injected at highest priority — e.g., "new API routes must have an integration test" — rather than buried in a long CLAUDE.md

Andon stop conditions: The TDD Implementation skill on MCP Market adds "stop conditions" for architectural mismatches detected mid-phase — the agent halts and flags for human review rather than proceeding with a bad architectural assumption

Sprint contract negotiation: Before each impl phase, the generator and evaluator negotiate what "done" looks like — the generator proposes, the evaluator reviews, both iterate until they agree — bridging the gap between high-level spec and testable implementation without over-specifying upfront

Model routing by phase: The pattern that emerged with the Codex plugin for Claude Code is using different models for different workflow roles: Codex for adversarial review (/codex:adversarial-review), Opus for complex planning, fast models for mechanical verification
