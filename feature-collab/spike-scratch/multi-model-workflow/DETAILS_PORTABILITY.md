# Workflow Portability & Migration Patterns

---

## Current Portability Assessment

### What's Already Portable

Your feature-collab workflow produces **file-based artifacts** that are inherently tool-agnostic:

| Artifact | Format | Portable? | Notes |
|----------|--------|-----------|-------|
| PLAN.md | Markdown | Yes | Any tool can read/write markdown |
| CONTRACTS.md | Markdown + TypeScript | Yes | Language-specific, not tool-specific |
| TEST_SPEC.md | Markdown tables | Yes | Behavioral specs are universal |
| DETAILS.md | Markdown | Yes | Implementation guidance is prose |
| HANDOFF.md | Markdown | Yes | Session context is text |
| DEMO.md | Markdown | Yes | Proof artifacts are text |
| WIP items | CLI tool (custom) | Yes | wip is an independent CLI, not Claude-specific |
| Git branches | Git | Yes | Universal |
| Bruno collections | .bru files | Yes | Tool-specific but not AI-specific |

### What's Coupled to Claude Code

| Component | Coupling | Migration Effort |
|-----------|---------|-----------------|
| Skill prompts (commands/*.md) | Claude Code plugin format | Medium — rewrite as Pi skills or Codex instructions |
| Agent definitions (agents/*.md) | Claude Code agent format | Medium — rewrite as Pi extensions or Codex agents |
| Shell hooks (.claude/settings.json) | Claude Code hook events | Medium — rewrite as Pi TypeScript events |
| Sub-agent dispatch (Task tool) | Claude Code API | High — Pi/Codex have different dispatch patterns |
| Permission modes | Claude Code built-in | Low — Pi YOLO by default, extension needed |
| MCP servers | Claude Code native | Medium — Pi doesn't support MCP, Codex does |
| Teams | Claude Code Teams feature | High — no equivalent elsewhere |
| CLAUDE.md model routing | Claude Code convention | Low — Pi reads CLAUDE.md, Codex uses config.toml |

---

## Portable Workflow Spec Design

### The Abstraction: Workflow-as-YAML

Instead of encoding workflow logic in tool-specific formats, define an abstract workflow spec:

```yaml
# workflow.yaml — Portable feature development workflow
name: feature-collab
version: 1.0

phases:
  - id: discovery
    name: "Discovery & Scope Lock"
    interactive: true
    agents:
      - role: explorer
        model_tier: cheap      # Resolved per-tool: haiku, gemini-flash, gpt-4o-mini
        count: "1-per-concept"
        task: "Trace {concept} through codebase, report patterns and dependencies"
      - role: planner
        model_tier: reasoning   # Resolved: opus, o3, gemini-pro
        task: "Synthesize findings into PLAN.md"
    artifacts:
      - PLAN.md
    gate:
      type: user-approval
      prompt: "Review PLAN.md and say 'lock scope' to proceed"
    
  - id: contracts
    name: "Contract Definition"
    interactive: true
    agents:
      - role: verifier
        model_tier: balanced    # Resolved: sonnet, gemini-pro, gpt-4o
        task: "Generate TEST_SPEC.md from CONTRACTS.md"
      - role: test-writer
        model_tier: balanced
        per: "test-category"    # One agent per TEST_SPEC category
        task: "Write failing tests per TEST_SPEC.md category {category}"
    artifacts:
      - CONTRACTS.md
      - TEST_SPEC.md
    gate:
      type: coverage-check
      rule: "Every TEST_SPEC category has corresponding test file(s)"

  - id: implementation
    name: "Implementation (Dark Factory)"
    interactive: false
    loop:
      max_cycles: 5
      agents:
        - role: implementer
          model_tier: balanced
          task: "Implement per DETAILS.md"
        - role: test-runner
          model_tier: cheap
          task: "Run all tests, report results"
        - role: scope-guardian
          model_tier: cheap
          checkpoint: [50%, 90%]
          task: "Check for scope drift"
      exit_when: "all tests green AND scope clean"
      escalation: systematic-debug

  - id: review
    name: "Code Review"
    interactive: false
    agents:
      - role: reviewer
        model_tier: balanced
        cross_model: true       # Use different provider than implementer
        task: "Review for bugs, quality, security"
    gate:
      type: findings-resolved
      
  - id: exit-criteria
    name: "Exit Criteria Assessment"
    interactive: false
    agents:
      - role: assessor
        model_tier: reasoning
        default_verdict: NOT_READY
        task: "Skeptically assess every exit criterion in PLAN.md"
    gate:
      type: verdict
      required: READY
      loop_to: implementation   # If NOT_READY, loop back

model_tiers:
  cheap:
    claude: haiku
    openai: gpt-4o-mini
    google: gemini-flash
    openrouter: google/gemini-2.5-flash
  balanced:
    claude: sonnet
    openai: gpt-4o
    google: gemini-2.5-pro
    openrouter: anthropic/claude-sonnet-4-6
  reasoning:
    claude: opus
    openai: o3
    google: gemini-2.5-pro
    openrouter: anthropic/claude-opus-4-6
```

### How Each Tool Consumes This

**Claude Code**: A skill reads `workflow.yaml`, maps `model_tier` to Claude models, dispatches agents via Task tool, enforces gates via hooks.

**Pi.dev**: A TypeScript extension reads `workflow.yaml`, maps `model_tier` to configured providers, dispatches sub-agents via Pi's sub-agent extension, enforces gates via event hooks.

**Codex CLI**: A custom instruction file reads `workflow.yaml`, maps `model_tier` to Codex profiles, dispatches sub-agents via Codex's agent config.

### What This Buys You

1. **Single source of truth** for workflow structure
2. **Tool-specific adapters** are thin — just model resolution and dispatch
3. **A/B testing** becomes: run the same workflow.yaml through two different tools
4. **New tools** require only a new adapter, not workflow redesign
5. **Workflow evolution** happens in one place, propagates to all tools

### What This Costs

1. **Adapter development** for each tool (weeks of work each)
2. **Abstraction tax** — some tool-specific features can't be expressed in YAML
3. **Prompt tuning** — each model needs different prompt styles for the same task
4. **Testing overhead** — need to verify workflow works on each tool
5. **Maintenance burden** — adapter breaks when tools update

---

## Practical Migration Strategies

### Strategy A: "Claude Code + Sidecar" (Recommended)

Keep Claude Code as primary. Add tools for specific phases.

```
Feature Request
    ↓
[Claude Code] Phase 0-1: Setup + Discovery
    ↓ (dispatch Gemini CLI for free exploration)
[Gemini CLI] Explore codebase (1M context, free)
    ↓ (findings back to Claude Code)
[Claude Code] Phase 1-4: Planning + Contracts + Architecture
    ↓ (dispatch via Claude Code Router to multiple providers)
[Mixed Models] Phase 5: Implementation
    ↓ (cross-model review)
[GPT-4o via OpenRouter] Phase 6: Code Review
    ↓
[Claude Code] Phase 7-9: Security + Criteria + Demo
    ↓
PR Ready
```

**Effort**: Low (weeks). **Risk**: Low. **Benefit**: Multi-model without workflow rebuild.

### Strategy B: "Dual Runtime Evaluation"

Run the same task through both Claude Code and Pi, compare.

```
Feature Request
    ↓
[Claude Code] Full feature-collab workflow → PR A
[Pi.dev]      Ported workflow (subset) → PR B
    ↓
Compare: quality, cost, speed, developer experience
    ↓
Decision: migrate more skills to Pi, or stay hybrid
```

**Effort**: Medium (months). **Risk**: Medium. **Benefit**: Data-driven tool selection.

### Strategy C: "Portable Spec + Multi-Tool"

Build the workflow.yaml abstraction layer. Run on any tool.

```
workflow.yaml (abstract spec)
    ↓
[Adapter: Claude Code] → Full workflow execution
[Adapter: Pi.dev]      → Full workflow execution
[Adapter: Codex CLI]   → Full workflow execution
    ↓
Benchmark all three on same task
```

**Effort**: High (months). **Risk**: High (abstraction tax). **Benefit**: True tool independence.

---

## AGENTS.md / Agent Skills Standard

Both Claude Code and Pi.dev are converging on the **Agent Skills** open standard (backed by AAIF — Agentic AI Foundation, launched Dec 2025 by Anthropic, OpenAI, and Block):

- Skills defined as markdown files with frontmatter
- Tools defined via MCP or extension APIs
- Context files (CLAUDE.md / AGENTS.md) for project-specific instructions

This convergence means:
1. Skills written for Claude Code can likely be read by Pi (AGENTS.md format)
2. The **prompt content** (Iron Laws, anti-rationalization tables, phase gates) is already portable — it's markdown
3. The **dispatch mechanism** (Task tool vs Pi extension) is the non-portable part

### What to Port First

**Easiest** (just prompt content):
- Iron Laws, Common Rationalizations tables
- Phase definitions and gate criteria
- PLAN.md / CONTRACTS.md / TEST_SPEC.md templates

**Medium** (skill structure):
- /spike (2 phases, minimal orchestration)
- /enhance (5 phases, lightweight)
- /bugfix (3 phases, focused)

**Hardest** (complex orchestration):
- /feature-collab (9 phases, dark factory loops, 30+ agents)
- /pressure-test (meta-testing framework)
- /retro (3 independent assessment agents)

---

## Key Research References

- **TDAD** (Test-Dependency-Aware Development): arXiv:2603.17973 — Build dependency graphs to reduce regressions 70%
- **TDFlow** (Test-Driven Flow): arXiv:2510.23761 — 4 sub-agents, 94.3% on reproduced tests
- **RouteLLM**: github.com/lm-sys/RouteLLM — Train routers on preference data, 85% cost reduction
- **PerfOrch**: arXiv:2510.01379 — Multi-stage orchestration, 96.22% on HumanEval-X
- **AlexOp TDD**: alexop.dev — Hook-enforced TDD, compliance 20% → 84%
- **Addy Osmani Workflow**: addyosmani.com — Spec-first, chunked implementation, cross-model review
- **AAIF Standards**: Anthropic/OpenAI/Block — MCP + AGENTS.md convergence
- **Claude Code Router**: github.com/musistudio/claude-code-router — Local proxy for multi-model routing
