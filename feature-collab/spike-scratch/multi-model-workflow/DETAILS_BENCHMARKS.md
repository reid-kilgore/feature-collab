# Model Benchmarks & Cost Projections

---

## SWE-bench Verified Leaderboard (April 2026)

| Model | Score | Agentic? | Notes |
|-------|-------|----------|-------|
| Claude Code (Opus 4.6) | 80.9% | Yes | Full scaffold |
| Claude Opus 4.6 | 80.8% | No | Raw model |
| Gemini 3.1 Pro | 80.6% | No | Tops 13/16 major benchmarks |
| MiniMax M2.5 | 80.2% | No | Fraction of cost |
| Claude Sonnet 4.6 | 79.6% | No | Near-Opus at Sonnet pricing |
| GLM-5 (open) | 77.8% | No | Best open-weight |

**Caveat**: OpenAI stopped reporting SWE-bench Verified after data contamination concerns. SWE-bench Pro is considered more reliable now.

**Terminal-Bench 2.0** (agentic execution): GPT-5.4 leads at 75.1%.

**ARC-AGI-2** (abstract reasoning): Gemini 3.1 Pro leads at 77.1%.

**WebDevArena** (web development): Gemini 2.5 Pro leads.

**LiveCodeBench v5**: Gemini 2.5 Pro at 70.4%.

---

## Task-Specific Model Recommendations

| Workflow Phase | Current Model | Best Alternative | Why Switch? |
|---------------|--------------|-----------------|-------------|
| Phase 1: Discovery | Haiku (code-explorer) | Gemini 2.5 Flash | 1M context, free tier, single-call vs 3-4 sub-agents |
| Phase 1: Planning | Opus (orchestrator) | Keep Opus | Still best for deep reasoning |
| Phase 2: Contracts | Opus (orchestrator) | Keep Opus | Needs architectural judgment |
| Phase 2: Test writing | Sonnet (test-implementer) | Keep Sonnet | Well-calibrated for test generation |
| Phase 5: Implementation | Sonnet (code-architect) | Gemini 3.1 Pro | $1.25/$10 vs $3/$15, competitive quality |
| Phase 5: Test running | Haiku (test-runner) | GPT-4o-mini | $0.15/$0.60, adequate for test execution |
| Phase 6: Code review | Sonnet (code-reviewer) | Cross-model (GPT-4o or Gemini) | Different blind spots catch more bugs |
| Phase 7: Security | Sonnet (code-security) | Keep Sonnet | Security requires precision |
| Phase 8: Exit criteria | Sonnet (criteria-assessor) | Keep Sonnet or Opus | Needs skeptical reasoning |
| Commits, linting | Haiku | GPT-4o-mini | Cheapest option at $0.15/M input |

---

## Pricing Per Million Tokens (April 2026, via OpenRouter)

| Model | Input | Output | Input (cached) | Notes |
|-------|-------|--------|----------------|-------|
| Claude Opus 4.6 | $5.00 | $25.00 | $0.50 | 90% cache savings |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 | |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 | |
| Gemini 3.1 Pro | $1.25 | $10.00 | ~$0.13 | Best price/perf |
| Gemini Flash | $0.30 | ~$1.00 | ~$0.03 | Cheapest capable |
| GPT-4o | $2.50 | $10.00 | $0.25 | |
| GPT-4o-mini | $0.15 | $0.60 | $0.015 | Cheapest overall |
| DeepSeek V3 | $0.27 | $1.10 | ~$0.03 | Open, very cheap |
| o3 | ~$10.00 | ~$40.00 | — | Premium reasoning |

**Year-over-year**: Prices dropped 40-80% while performance improved. Prompt caching (90% savings) + batch API (50% off) can reduce costs by up to 95%.

---

## Cost Projection: Feature-Collab Workflow

### Current Cost (All Anthropic)

Estimated token usage per feature-collab run (based on typical 9-phase workflow):

| Phase | Agent Dispatches | Model | Est. Tokens (in/out) | Est. Cost |
|-------|-----------------|-------|---------------------|-----------|
| Phase 0: Setup | 1 | Opus | 50K/5K | $0.38 |
| Phase 1: Discovery | 3-5 explorers | Haiku | 500K/50K | $0.75 |
| Phase 1: Planning | 1 (orchestrator) | Opus | 200K/20K | $1.50 |
| Phase 2: Contracts | 2-3 agents | Sonnet | 300K/30K | $1.35 |
| Phase 3: Skeleton | 1-2 agents | Sonnet | 200K/20K | $0.90 |
| Phase 4: Architecture | 1-2 agents | Sonnet | 300K/30K | $1.35 |
| Phase 5: Implementation | 5-10 cycles | Sonnet | 1M/100K | $4.50 |
| Phase 6: Review | 2-3 agents | Sonnet | 300K/30K | $1.35 |
| Phase 7: Security | 1-2 agents | Sonnet | 200K/20K | $0.90 |
| Phase 8: Criteria | 1-2 agents | Sonnet | 200K/20K | $0.90 |
| Phase 9: Demo | 2-3 agents | Sonnet | 300K/30K | $1.35 |
| **Total** | **~25-40 dispatches** | | **~3.5M/355K** | **~$15.23** |

*Note: This is API cost only. Claude Max subscription ($100-200/mo) covers this differently.*

### Optimized Cost (Multi-Provider via OpenRouter)

| Phase | Model Switch | Est. Cost | Savings |
|-------|-------------|-----------|---------|
| Phase 0: Setup | Opus (keep) | $0.38 | — |
| Phase 1: Discovery | Gemini Flash (free tier) | $0.00 | -$0.75 |
| Phase 1: Planning | Opus (keep) | $1.50 | — |
| Phase 2: Contracts | Opus (keep) | $1.35 | — |
| Phase 2: Test writing | Sonnet (keep) | — | — |
| Phase 3: Skeleton | Sonnet (keep) | $0.90 | — |
| Phase 4: Architecture | Sonnet (keep) | $1.35 | — |
| Phase 5: Implementation | Gemini 3.1 Pro | $2.25 | -$2.25 |
| Phase 5: Test running | GPT-4o-mini | $0.15 | -$0.75* |
| Phase 6: Review | GPT-4o (cross-model) | $1.00 | -$0.35 |
| Phase 7: Security | Sonnet (keep) | $0.90 | — |
| Phase 8: Criteria | Sonnet (keep) | $0.90 | — |
| Phase 9: Demo | Haiku (keep) | $1.35 | — |
| **Total** | | **~$12.03** | **~$3.20 saved (~21%)** |

*The cost savings are modest because the expensive phases (planning, architecture) should stay on Opus/Sonnet. The savings come from routing mechanical/exploration work to cheaper models.*

### Real Savings: Subscription vs API

The bigger cost question is **Claude Max ($100-200/mo) vs BYO API keys**:
- If you run ~15 feature-collab workflows per month: ~$228/mo on API = Max subscription wins
- If you run ~5 per month: ~$76/mo on API = API keys win
- The hybrid play: Use Max subscription for Claude models, OpenRouter for non-Claude models

---

## Quality Risk Assessment

| Model Swap | Quality Risk | Mitigation |
|------------|-------------|------------|
| Haiku → GPT-4o-mini (test-runner) | Low — both adequate for test execution | Verify test output parsing works |
| Haiku → Gemini Flash (code-explorer) | Low-Medium — Flash is fast but may miss nuance | Use for initial exploration, escalate to Sonnet if needed |
| Sonnet → Gemini 3.1 Pro (implementation) | Medium — different prompt sensitivities | Needs prompt tuning, run parallel comparison first |
| Sonnet → GPT-4o (code-review) | Low — cross-model review is the *point* | Different blind spots are a feature |
| Any → DeepSeek V3 | Medium — good benchmarks but less tested in agentic | Evaluate on non-critical tasks first |
