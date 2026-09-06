# Multi-Model Workflow Migration Plan

**Status**: HANDED OFF — see docs/reidplans/rk-swiftui-cli-spike/HANDOFF.md for resume instructions
**Date**: 2026-04-10
**Branch**: rk-swiftui-cli-spike (spike output, no production code)
**Next Spike**: Replicate workflows in Codex CLI and/or Gemini CLI

---

## Problem Statement

The current feature-collab workflow is deeply coupled to Claude Code + Anthropic models. This limits:
1. **Model selection** — Can't use Gemini for cheap exploration, o3 for certain reasoning tasks, or open models for cost-sensitive sub-agents
2. **Provider resilience** — Single-vendor dependency on Anthropic
3. **Cost optimization** — No ability to route sub-agents to cheaper providers for mechanical tasks
4. **Evaluation** — No way to A/B test whether Gemini/GPT outperforms Claude for specific workflow phases

## Goal

Design a workflow architecture that **preserves the feature-collab structure** (planning gates, TDD, scope guardians, WIP tracking, handoff/pickup) while enabling:
- Easy model/provider switching per workflow role
- Side-by-side evaluation of different tools
- Gradual migration without full rebuild
- Multi-provider sub-agent dispatch

---

## Tool Landscape (April 2026)

### Tier 1: Primary Candidates

| Tool | Model Support | Sub-Agents | Customization | Maturity | Cost |
|------|-------------|------------|---------------|----------|------|
| **Claude Code** (current) | Claude family only | Built-in Task tool, 7 parallel | CLAUDE.md, hooks, skills, agents | Production | Max $100-200/mo |
| **Pi.dev** | 300+ models, 20+ providers | Extension-based (not built-in) | AGENTS.md, TypeScript hooks/extensions, skills | Growing (11.5K stars) | Free (BYO API keys) |
| **Codex CLI** | o3, o4-mini, GPT-5.x | TOML-configured sub-agents | config.toml profiles, custom instructions | Early | BYO API keys |

### Tier 2: Complementary Tools

| Tool | Best For | Integration Path |
|------|----------|-----------------|
| **OpenRouter** | Provider gateway — route any tool to any model | API key + base URL swap |
| **Gemini CLI** | Free exploration, 1M context research tasks | Standalone, GEMINI.md |
| **Aider** | Focused coding with architect/editor model split | Standalone, OpenRouter-compatible |
| **Claude Code Router** | Multi-model routing within Claude Code itself | Local proxy (127.0.0.1:3456) |

### Tier 3: Monitor / Not Yet Ready

| Tool | Why Monitor | Gap |
|------|-----------|-----|
| **Kiro** (AWS) | Spec-driven dev philosophy aligns with feature-collab | Locked ecosystem |
| **Roo Code** | Open-source multi-model IDE agent | IDE-only, no CLI workflow |
| **LangGraph** | Production-grade model-agnostic orchestration | Over-engineering for current needs |

---

## Recommended Architecture: Layered Approach

Rather than migrating wholesale to Pi or Codex, **layer providers into the existing workflow**.

### Layer 1: OpenRouter as Universal Provider (Low effort, high value)

**What**: Route Claude Code sub-agents and standalone tools through OpenRouter.
**Why**: Single billing, 300+ models, 5.5% fee is negligible.
**How**: Set `ANTHROPIC_BASE_URL`, configure sub-agent model overrides.
**Risk**: Claude Code "only guaranteed to work with Anthropic provider" on OpenRouter. Non-Claude models may break internal assumptions.

### Layer 2: Claude Code Router for Sub-Agent Model Routing (Medium effort)

**What**: Local proxy between Claude Code and LLM providers. Routes sub-agents to different models/providers based on task type.
**Why**: Keep Claude Code as orchestrator (where your skills/hooks live) but send Haiku-tier work to Gemini Flash or GPT-4o-mini for cost savings.
**How**: Install claude-code-router, configure routing rules, use `<CCR-SUBAGENT-MODEL>` tags in agent prompts.
**Risk**: Open-source project, may break on Claude Code updates.

### Layer 3: Pi.dev as Parallel Evaluation Harness (Medium effort)

**What**: Port a subset of skills to Pi extensions. Run the same task through both Claude Code and Pi to evaluate.
**Why**: Pi's model-agnostic design makes it the best A/B testing platform. TypeScript extensions are more powerful than shell hooks.
**How**: Start with `/spike` and `/enhance` (simplest skills). Pi's AGENTS.md reads CLAUDE.md too.
**Risk**: Significant rebuild for complex skills like `/feature-collab`.

### Layer 4: Gemini CLI for Free Research Tasks (Low effort, immediate value)

**What**: Use Gemini CLI for codebase exploration, research, and "second opinion" reviews.
**Why**: Free tier (1000 req/day), 1M token context window (5x Claude), zero cost.
**How**: `npm install -g @anthropic-ai/gemini-cli`, create GEMINI.md with project conventions.
**Risk**: No sub-agent orchestration, weaker on SWE-bench than Claude.

### Layer 5: Codex CLI for Specific Reasoning Tasks (Low effort, experimental)

**What**: Use Codex CLI with o3 for tasks where OpenAI's reasoning excels.
**Why**: o3 leads Terminal-Bench 2.0 for agentic execution. Multi-profile config is clean.
**How**: Install, configure profiles (planning=o3, quick=o4-mini), use for targeted tasks.
**Risk**: Ecosystem less mature, no equivalent to feature-collab skills.

---

## Implementation Phases

### Phase 1: Provider Layer (Week 1)
- Set up OpenRouter account + fund credits
- Install Claude Code Router, configure basic routing
- Install Gemini CLI, create GEMINI.md
- Test: Run same coding task through Claude Code, Gemini CLI, and Aider+OpenRouter
- **Deliverable**: Working multi-provider setup, cost comparison data

### Phase 2: Sub-Agent Model Routing (Week 2)
- Configure Claude Code Router rules for sub-agent dispatch
- Test Gemini Flash as code-explorer replacement (1M context advantage)
- Test GPT-4o-mini as Haiku replacement for mechanical tasks
- Benchmark: quality, speed, cost per sub-agent role
- **Deliverable**: Routing config, benchmark data, decision on which roles to reroute

### Phase 3: Pi.dev Evaluation (Week 3-4)
- Install Pi, port `/spike` skill as Pi extension
- Port sub-agent extension with model-per-role config
- Run 3 real tasks through Pi, compare experience to Claude Code
- Evaluate: Is Pi's extension model worth the migration cost?
- **Deliverable**: Pi spike extension, comparative evaluation doc

### Phase 4: Workflow Portability Layer (Week 5+, if Phase 3 is positive)
- Define abstract workflow spec (YAML/TOML) that both Claude Code and Pi can consume
- Port planning phase, TDD gates, scope guardian as portable components
- Build shared artifact format (PLAN.md, CONTRACTS.md already portable)
- **Deliverable**: Portable workflow spec, dual-runtime proof of concept

---

## Key Research Findings

### What Your Workflow Already Does Right

1. **Model tiering** (Opus/Sonnet/Haiku per task) matches industry best practice — documented as "OpusPlan hybrid" yielding ~68% cost savings
2. **TDD-first with sub-agents** aligns with TDFlow (CMU/UCSD) and TDAD research — isolated test-writer/implementer agents prevent context bleeding
3. **Scope guardian** pattern appears in enterprise governance research as "pre-execution guardian models"
4. **Pressure testing** agent prompts is novel — no other tool ecosystem does this systematically
5. **Session continuity** via HANDOFF.md/PLAN.md is more robust than most alternatives

### What Other Tools Do Better

1. **Pi.dev**: TypeScript hooks (25 events vs 14 shell hooks), session tree branching, 10K fewer tokens per turn on harness overhead
2. **Gemini CLI**: 1M token context for exploration, genuinely free tier
3. **Aider**: Architect/Editor mode is a clean abstraction for plan-then-implement
4. **Codex CLI**: Multi-profile config (switch entire behavior presets, not just models)
5. **TDAD research**: Build code-test dependency graphs so agents know which tests to check — reduced regressions 70%

### Improvements to Adopt Regardless of Tool Choice

1. **TDAD-style dependency graph**: Before implementation, build a map of which tests cover which code paths. Feed this to test-runner so it knows exactly what to verify per change.
2. **Cross-model review**: Write code with Claude, review with Gemini (or vice versa). Different model "blind spots" catch different bugs.
3. **Profile-based configuration**: Like Codex CLI's TOML profiles — define `planning`, `implementation`, `review`, `quick` presets that swap model + behavior together.
4. **Cost tracking per workflow phase**: Measure token spend by phase to identify optimization targets.
5. **Hook-enforced TDD activation**: AlexOp's research shows hook-based skill activation increased TDD compliance from ~20% to ~84%.

---

## Decision Matrix

| If you want... | Do this |
|----------------|---------|
| Cheapest path to multi-model | OpenRouter + Claude Code Router (Layer 1+2) |
| Best evaluation of alternatives | Pi.dev parallel harness (Layer 3) |
| Free exploration tool now | Gemini CLI (Layer 4) |
| Maximum workflow portability | Portable spec + dual runtime (Layer 5) |
| Least disruption | Stay on Claude Code, add OpenRouter for cost optimization |
| Most disruption (but most flexibility) | Full Pi.dev migration with custom extensions |

---

## Exit Criteria for This Spike

- [x] Online research on Pi.dev, OpenRouter, Codex, Gemini capabilities
- [x] Analysis of current workflow patterns and portability constraints
- [x] Research on multi-model orchestration patterns and benchmarks
- [x] PLAN.md with phased implementation approach
- [x] DETAILS.md with deep technical specifications per tool
- [ ] User decision on which layers to pursue

---

## See Also

- [DETAILS.md](./DETAILS.md) — Deep technical specs per tool, API examples, extension patterns
- [DETAILS_BENCHMARKS.md](./DETAILS_BENCHMARKS.md) — Model benchmarks, pricing, and cost projections
- [DETAILS_PORTABILITY.md](./DETAILS_PORTABILITY.md) — Portable workflow spec design and migration patterns
