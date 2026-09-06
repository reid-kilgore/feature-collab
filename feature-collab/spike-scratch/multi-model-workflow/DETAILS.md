# Multi-Model Workflow Details

Technical deep-dive on each tool, integration patterns, and migration paths.

---

## 1. Pi.dev — Full Analysis

### Architecture

Pi is a **minimal, MIT-licensed, terminal-based coding agent** by Mario Zechner (badlogic/pi-mono). Core philosophy: ship 4 tools (read, write, edit, bash), ~200 token system prompt, make everything else opt-in via extensions.

- **npm**: `@mariozechner/pi-coding-agent` (3.17M monthly downloads, 11.5K GitHub stars)
- **Install**: `npm install -g @mariozechner/pi-coding-agent`
- **GitHub**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent

### Model Support (the killer feature)

Pi supports **15+ providers** natively:

**Subscription-based**: Anthropic Claude Pro/Max, OpenAI ChatGPT Plus/Pro, GitHub Copilot, Google Gemini CLI, Google Antigravity

**API key providers**: Anthropic, OpenAI, Azure OpenAI, Google Gemini, Google Vertex, Amazon Bedrock, Mistral, Groq, Cerebras, xAI, **OpenRouter**, Vercel AI Gateway, Hugging Face, Kimi, MiniMax, **Ollama** (local), any OpenAI-compatible endpoint.

Switch models mid-session with `/model` or `Ctrl+L`. Cycle favorites with `Ctrl+P`. Custom providers via `models.json` or TypeScript extensions.

**Docs**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/models.md

### Sub-Agent Extension

Pi does NOT ship sub-agents as built-in (philosophical choice: "zero visibility into what that sub-agent does"). But there's a well-documented extension:

```
examples/extensions/subagent/
```

**Execution modes**:
- `single`: One agent, one task
- `parallel`: Up to 8 defined, 4 concurrent
- `chain`: Pass output between stages via `{previous}` placeholder

Each agent definition specifies its own model. Example mapping to your roles:

```typescript
// Pi sub-agent config (conceptual)
agents: [
  { name: "explorer", model: "gemini-2.5-flash", mode: "parallel" },
  { name: "architect", model: "claude-sonnet-4-6", mode: "single" },
  { name: "test-runner", model: "gpt-4o-mini", mode: "single" },
  { name: "planner", model: "claude-opus-4-6", mode: "single" },
]
```

**Source**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent/

### Customization Comparison

| Feature | Claude Code | Pi Equivalent |
|---------|------------|---------------|
| CLAUDE.md | AGENTS.md (also reads CLAUDE.md) |
| .claude/settings.json hooks | 25 TypeScript extension events |
| Skills (/feature-collab) | Skills (SKILL.md in ~/.pi/agent/skills/) |
| Agent definitions (.claude/agents/) | Extension-defined agents |
| MCP servers | Not built-in (author considers MCP bloated) |
| Task tool (sub-agents) | Extension-based sub-agents |
| Permission modes (5 levels) | YOLO by default (extension possible) |
| Teams (all-Opus) | N/A |

### Pi's Unique Features

1. **Session tree branching**: JSONL format with fork/branch support. Explore different approaches without losing history.
2. **RPC mode**: 26+ JSON commands over stdin/stdout. Enables embedding Pi in other tools.
3. **SDK mode**: `import { Pi } from '@mariozechner/pi-coding-agent'` — programmatic control.
4. **Message queue**: `Enter` steers mid-generation, `Alt+Enter` queues follow-up.
5. **Custom TUI**: Extensions can register status bars, overlays, widgets.
6. **Token efficiency**: ~200 token system prompt vs Claude Code's ~10-14K. Saves ~10K tokens per turn.

### What Migration Looks Like

To port feature-collab to Pi:

**Easy to port** (days):
- CLAUDE.md → AGENTS.md (identical format, Pi reads both)
- Prompt templates → Pi prompt templates (same {{variable}} syntax)
- Simple skills → Pi skills (SKILL.md format, compatible with Agent Skills standard)

**Medium effort** (weeks):
- Shell hooks → TypeScript extension events (more powerful but different paradigm)
- Sub-agent dispatch → Pi sub-agent extension (need to define agent configs)
- WIP integration → Custom extension calling wip CLI

**Hard to port** (months):
- Full feature-collab 9-phase orchestration → Complex Pi extension
- Pressure testing framework → Custom extension
- Retro system → Custom extension
- Session continuity (handoff/pickup) → Pi has session persistence but different format

### IDE Integration

Community-built, not official:
- **VS Code**: `pi-vscode` (pi0) — integrated terminal with editor bridge
- **Neovim**: `pi.nvim` (pablopunk), `pi-nvim` (carderne)

---

## 2. OpenRouter — Integration Details

### What It Is

Unified API gateway. 300+ models. One API key. OpenAI-compatible endpoint.

- **Endpoint**: `https://openrouter.ai/api/v1`
- **Pricing**: 5.5% fee on credit purchase. Token prices match direct provider pricing.
- **Docs**: https://openrouter.ai/docs

### Claude Code Integration

```bash
# Environment variables for Claude Code → OpenRouter
export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
export ANTHROPIC_AUTH_TOKEN="sk-or-v1-xxxxx"
export ANTHROPIC_API_KEY=""

# Model overrides (optional — route specific tiers)
export ANTHROPIC_DEFAULT_OPUS_MODEL="anthropic/claude-opus-4-6"
export ANTHROPIC_DEFAULT_SONNET_MODEL="anthropic/claude-sonnet-4-6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="anthropic/claude-haiku-4-5"

# Sub-agent model override
export CLAUDE_CODE_SUBAGENT_MODEL="anthropic/claude-sonnet-4-6"
```

**Caveat**: Claude Code with OpenRouter is "only guaranteed to work with the Anthropic first-party provider." Non-Anthropic models may fail because Claude Code sends Anthropic-specific API features (tool_use format, system prompts, etc.).

**Source**: https://openrouter.ai/docs/guides/coding-agents/claude-code-integration

### Aider via OpenRouter

```bash
# Any model through OpenRouter
aider --model openrouter/anthropic/claude-sonnet-4-6
aider --model openrouter/google/gemini-2.5-pro
aider --model openrouter/openai/gpt-4o

# Architect mode with different models
aider --architect --model openrouter/anthropic/claude-opus-4-6 \
      --editor-model openrouter/google/gemini-2.5-flash
```

### Pi.dev via OpenRouter

Pi has native OpenRouter support. Configure in `~/.pi/models.json` or select via `/model` menu.

### Cost Comparison (per 1M tokens through OpenRouter)

| Model | Input | Output | Best For |
|-------|-------|--------|----------|
| Claude Opus 4.6 | $5.00 | $25.00 | Planning, architecture |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Implementation |
| Claude Haiku 4.5 | $1.00 | $5.00 | Mechanical tasks |
| Gemini 3.1 Pro | $1.25 | $10.00 | Best price/perf ratio |
| Gemini Flash | $0.30 | ~$1.00 | Cheapest capable model |
| GPT-4o | $2.50 | $10.00 | Balanced |
| GPT-4o-mini | $0.15 | $0.60 | Cheapest for simple tasks |
| DeepSeek V3 | $0.27 | $1.10 | Open model, very cheap |

---

## 3. Claude Code Router — Integration Details

### What It Is

Open-source local proxy that sits between Claude Code and LLM providers. Routes requests based on task type.

- **GitHub**: https://github.com/musistudio/claude-code-router
- **How**: Runs on `127.0.0.1:3456`, intercepts Claude Code API calls, routes to configured providers.

### Configuration Example

```json
{
  "routes": [
    {
      "match": "background_task",
      "provider": "openrouter",
      "model": "google/gemini-2.5-flash"
    },
    {
      "match": "thinking",
      "provider": "anthropic",
      "model": "claude-opus-4-6"
    },
    {
      "match": "long_context",
      "provider": "google",
      "model": "gemini-2.5-pro"
    }
  ]
}
```

### Sub-Agent Model Selection

Embed routing hints in agent prompts:
```
<CCR-SUBAGENT-MODEL>openrouter,google/gemini-2.5-flash</CCR-SUBAGENT-MODEL>
```

### Risk Assessment

- Open-source project with limited maintainers
- May break on Claude Code updates (intercepts internal API calls)
- No guarantee of compatibility with future Claude Code versions
- Worth using for experimentation, risky for production workflow

---

## 4. Codex CLI — Integration Details

### What It Is

Open-source (Apache 2.0) Rust CLI from OpenAI for agentic coding.

- **GitHub**: https://github.com/openai/codex
- **Install**: `cargo install codex-cli` or download binary
- **Docs**: https://developers.openai.com/codex/cli/features

### Multi-Profile Configuration

```toml
# ~/.codex/config.toml

[default]
model = "codex-mini-latest"
sandbox_mode = "auto"

[profiles.planning]
model = "o3"
sandbox_mode = "read-only"
custom_instructions = "Focus on architecture and task decomposition"

[profiles.quick]
model = "o4-mini"
sandbox_mode = "auto"
custom_instructions = "Be concise, implement directly"

[profiles.review]
model = "o3"
sandbox_mode = "read-only"
custom_instructions = "Review code for bugs, security, and quality"
```

```bash
# Usage
codex --profile planning "Design the notification delivery system"
codex --profile quick "Add the missing null check in handler.ts"
codex --profile review "Review the changes in this PR"
```

### Sub-Agent Configuration

```toml
# Agent definitions
[[agents]]
id = "explorer"
role = "explorer"
model = "o4-mini"

[[agents]]
id = "worker"
role = "worker"
model = "codex-mini-latest"

[[agents]]
id = "planner"
role = "default"
model = "o3"
```

### Approval Modes

- **Auto**: Reads, edits, and runs commands in working directory
- **Read-only**: Requires approval for edits
- **Full Access**: Unrestricted

### Sandboxing

- macOS: Seatbelt profiles
- Linux: Landlock
- Cross-platform: Docker containers

---

## 5. Gemini CLI — Integration Details

### What It Is

Open-source (Apache 2.0) terminal agent from Google.

- **GitHub**: https://github.com/google-gemini/gemini-cli
- **Install**: `npm install -g @anthropic-ai/gemini-cli`
- **Docs**: https://geminicli.com/docs/

### Free Tier

- **OAuth (Google account)**: 60 req/min, 1,000 req/day — free
- **API key**: 1,000 req/day with Gemini 3 — free
- This is roughly double what most developers use daily

### Key Advantage: 1M Token Context

Gemini's 1M token context window is 5x larger than Claude's 200K. For codebase exploration:

```bash
# Explore a large codebase (free)
gemini -m gemini-2.5-pro "Analyze the entire authentication subsystem in this repo. Map all auth flows, middleware, token handling, and session management."
```

This is genuinely useful for your Phase 1 (Discovery) where code-explorer agents trace concepts through the codebase. A single Gemini call with 1M context can replace 3-4 Haiku sub-agents.

### GEMINI.md (Project Context)

```markdown
# GEMINI.md
This project uses TypeScript with Express backend and React frontend.
Key patterns: Result<T> type for error handling, middleware auth, repository pattern.
When exploring code, focus on src/services/ and src/repositories/.
```

### MCP Support

Configure in `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "myserver": {
      "command": "node",
      "args": ["./mcp-server.js"]
    }
  }
}
```

---

## 6. Aider — Architect/Editor Pattern

### What It Is

Open-source (Apache 2.0) terminal coding assistant with unique architect/editor model split.

- **GitHub**: https://github.com/paul-gauthier/aider
- **Install**: `pip install aider-chat`
- **Docs**: https://aider.chat/docs/

### Architect Mode (Most Relevant)

```bash
# Claude Opus plans, Claude Sonnet implements
aider --architect --model claude-opus-4-6 --editor-model claude-sonnet-4-6

# o3 plans, GPT-4o implements (via OpenRouter)
aider --architect --model openrouter/openai/o3 \
      --editor-model openrouter/openai/gpt-4o

# Gemini plans, Claude implements (cross-provider)
aider --architect --model openrouter/google/gemini-2.5-pro \
      --editor-model openrouter/anthropic/claude-sonnet-4-6
```

**How it works**:
1. Architect model proposes the solution (high-level plan + code changes)
2. Editor model translates proposals into precise file edits
3. You can switch modes mid-session: `/ask` (discuss), `/code` (implement), `/architect` (plan+implement)

### Limitations

- Single-agent only — no sub-agent dispatch or parallel execution
- No persistent hooks or skills system
- No sandbox/permission model
- Best for focused coding tasks, not multi-phase orchestration

### Sweet Spot for Your Workflow

Aider is excellent as a **secondary tool** for quick coding tasks where you don't need the full feature-collab ceremony. Use it for:
- Quick fixes that don't warrant `/bugfix`
- Exploratory coding during spike phase
- Second-opinion code review (write with Claude, review with GPT via Aider)

---

## 7. Research-Backed Workflow Improvements

### TDAD: Test-Dependency-Aware Development

**Paper**: arXiv:2603.17973 (MIT License)
**Key finding**: Building a code-test dependency graph and telling agents which tests to check per change reduced regressions by 70%.

**How to apply to feature-collab**:
1. During Phase 2 (Contract Definition), build a dependency map: `{file → [tests that cover it]}`
2. When code-architect modifies a file, test-runner automatically knows which tests to run
3. This replaces "run all tests" with "run relevant tests" — faster feedback loops
4. Implementation: Could be a new `test-dependency-mapper` agent or a pre-processing step in test-runner

### AlexOp TDD Sub-Agent Isolation

**Source**: https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/
**Key finding**: Three isolated sub-agents (test-writer, implementer, refactorer) with hook-based skill activation increased TDD compliance from ~20% to ~84%.

**How to apply**:
- Your test-implementer and code-architect are already isolated
- The key insight is **hook-based activation** — don't rely on the orchestrator remembering to invoke TDD; use hooks that fire automatically
- Consider: a pre-edit hook that verifies tests exist for the file being modified

### Cross-Model Review

**Source**: Addy Osmani's AI coding workflow
**Pattern**: Write code with one model, review with a different model. Different model "blind spots" catch different bugs.

**How to apply**:
- After Phase 5 (Implementation) with Claude Sonnet, run Phase 6 (Code Review) through Gemini or GPT
- This is trivially achievable with OpenRouter — just override the code-reviewer agent's model
- Low effort, potentially high value

### Profile-Based Configuration

**Source**: Codex CLI's TOML profiles
**Pattern**: Define behavior presets that swap model + instructions + permissions together.

**How to apply to feature-collab**:
```yaml
# Conceptual profile system
profiles:
  planning:
    model: opus
    permissions: read-only
    instructions: "Focus on architecture, contracts, and task decomposition"
  implementation:
    model: sonnet
    permissions: auto
    instructions: "Implement per DETAILS.md, run tests after each change"
  review:
    model: gemini-2.5-pro  # via OpenRouter
    permissions: read-only
    instructions: "Review for bugs, security, code quality"
  mechanical:
    model: haiku
    permissions: auto
    instructions: "Run tests, lint, format, commit"
```

---

## 8. Migration Risk Assessment

### What You Lose By Leaving Claude Code

1. **Built-in sub-agent orchestration** — Task tool with 7 parallel agents is battle-tested
2. **Official IDE integrations** — VS Code, JetBrains, Cursor
3. **Enterprise features** — Sandboxing, 5 permission modes, audit trails
4. **MCP ecosystem** — First-class MCP support, growing server ecosystem
5. **Teams** — Multi-agent teams (though currently all-Opus)
6. **Web search/fetch** — Built-in tools, no extension needed
7. **Your entire skill/agent library** — 30+ agents, 15+ skills, months of pressure testing

### What You Gain By Adding Pi/OpenRouter

1. **Model freedom** — Any model, any provider, any time
2. **Cost optimization** — Route mechanical work to $0.15/M token models
3. **Token efficiency** — 10K fewer tokens per turn on harness overhead
4. **TypeScript extensibility** — More powerful than shell hooks
5. **Session branching** — Explore alternatives without losing history
6. **Provider resilience** — Not dependent on single vendor
7. **Full source transparency** — MIT, read every line

### Recommendation: Hybrid Architecture

**Don't migrate. Layer.**

Keep Claude Code as the primary orchestrator (your skills, hooks, and agents live there). Add:
1. OpenRouter for cost-optimized sub-agent routing
2. Gemini CLI for free exploration tasks
3. Pi.dev for evaluation and specific tasks where model flexibility matters
4. Aider for quick focused coding

This preserves your investment in feature-collab while opening access to the multi-model ecosystem.
