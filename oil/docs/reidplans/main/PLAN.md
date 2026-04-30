<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Spike: Pi Coding Harness — Local Setup & Claude Code Drop-in

## Status
**Current Phase**: Report
**Waiting For**: User review

---

## Question

1. **Thread A — What is Pi?** What can it do, what knobs exist, how does it extend?
2. **Thread B — Drop-in**: How do you replicate the existing Claude Code setup (feature-collab skills, beads hooks, etc.) in Pi — and can they coexist?

---

## What Pi Is

Pi (`@mariozechner/pi-coding-agent`) is an MIT-licensed open-source terminal coding harness by Mario Zechner (badlogic). It is intentionally minimal at the core — 4 built-in tools (read, write, edit, bash) — and everything else is an extension. 25+ AI providers. 1,919+ community packages.

**Install:**
```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=sk-ant-...
pi   # run in any project directory
```

Or authenticate via `/login` to use an existing Anthropic subscription.

---

## Claude Code ↔ Pi: Side-by-Side Map

| Concept | Claude Code | Pi |
|---------|-------------|-----|
| **Install** | Bundled CLI | `npm install -g @mariozechner/pi-coding-agent` |
| **Run** | `claude` | `pi` |
| **Global config dir** | `~/.claude/` | `~/.pi/agent/` |
| **Project config dir** | `.claude/` | `.pi/` |
| **Global settings** | `~/.claude/settings.json` | `~/.pi/agent/settings.json` |
| **Project settings** | `.claude/settings.json` | `.pi/settings.json` |
| **Global instructions** | `~/.claude/CLAUDE.md` | `AGENTS.md` or `SYSTEM.md` per project |
| **Skills (global)** | `~/.claude/skills/<name>/SKILL.md` | `~/.pi/agent/skills/<name>/SKILL.md` |
| **Skills (project)** | `.claude/skills/<name>/SKILL.md` | `.pi/skills/<name>/SKILL.md` |
| **Hooks/lifecycle** | Shell scripts (28 events, settings.json) | TypeScript Extensions (lifecycle events) |
| **Subagents** | `~/.claude/agents/<name>.md` | TypeScript Extensions (sub-agent API) |
| **MCP** | `.mcp.json` + `claude mcp add` | Extensions (user builds their own) |
| **Plugins/packages** | `.claude-plugin/plugin.json`, marketplace | npm package with `"pi"` key, `pi install` |
| **Marketplace** | claude-plugins-official + local | `pi.dev/packages` (npm, 1,919+ packages) |
| **Install package** | `/plugin install name@marketplace` | `pi install npm:package-name` |
| **Local package** | `extraKnownMarketplaces` directory | `pi install /absolute/path/to/package` |

---

## Findings

### Skills: Directly Compatible

**{==This is the most important finding: Pi and Claude Code share the same Agent Skills standard (SKILL.md format).==}**

The pi-skills repo (`github.com/badlogic/pi-skills`) confirms skills work across Pi, Claude Code, Codex CLI, and Amp. The SKILL.md frontmatter is identical. This means:

- `~/.claude/skills/beads-workflow/SKILL.md` — can be symlinked to `~/.pi/agent/skills/beads-workflow/SKILL.md`
- Feature-collab skills (SKILL.md files) — can be installed directly in Pi as a package
- Claude Code-specific frontmatter fields (`context: fork`, `agent:`, skill-level `hooks:`) will be silently ignored by Pi

**Claude Code note for skills**: CC requires skills in `~/.claude/skills/` because it only searches one directory level deep. Pi discovers skills recursively, so packages can nest them.

### Extensions: Pi's Replacement for Hooks + MCPs + Subagents

Pi deliberately omits built-in hooks, MCP support, and sub-agents — these are all done via TypeScript extensions.

**Discovery paths:**
- `~/.pi/agent/extensions/` (global)
- `.pi/extensions/` (project-local)
- `-e /path/to/extension.ts` (one-off, for testing)

**What extensions can do:**
- Register custom LLM-callable tools
- Intercept lifecycle events (block, modify, or observe tool calls)
- Add slash commands
- Prompt the user interactively (select, confirm, input)
- Persist state across sessions
- Render custom TUI components

**Hot-reloading:** `/reload` picks up edits to existing extension files instantly. New top-level extension files require restart.

**Your existing CC hooks → Pi extension equivalents:**

| CC Hook | Pi Extension |
|---------|-------------|
| `UserPromptSubmit` → inject wip context | `on("prompt:before", ...)` — inject context before LLM call |
| `Stop` → set wip WAITING | `on("response:after", ...)` |
| `SessionStart` → `bd prime` | `on("session:start", ...)` |
| `PreToolUse` → intercept Bash | `on("tool:before", ...)` with `tool.name === "bash"` |

### Packages: Pi's Plugin System

Pi packages are **npm packages** with a `"pi"` key in `package.json` plus a `"pi-package"` keyword. They bundle extensions + skills + prompts + themes.

**Package structure:**
```
my-pi-package/
  package.json           # "pi": {"extensions": ["./extensions"], "skills": ["./skills"]}
  extensions/
    main.ts              # TypeScript extension
  skills/
    my-skill/
      SKILL.md
  prompts/
    my-prompt.md
  themes/
    my-theme.json
```

**Install from local directory:**
```bash
pi install /Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab
```

No copy is made — the path is referenced directly. This means editing the source updates the installed package immediately.

**Install from npm:**
```bash
pi install npm:pi-subagents         # sub-agent delegation
pi install npm:pi-web-access        # web search + URL fetching
pi install npm:pi-lens              # LSP + linters
pi install npm:context-mode         # 98% context savings via code execution + knowledge base
pi install npm:pi-crew              # coordinated AI teams
```

**Project-local install (shared with team via `.pi/`):**
```bash
pi install -l npm:pi-web-access
```

### Settings: Simpler Than Claude Code

```json
// ~/.pi/agent/settings.json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "defaultThinkingLevel": "medium",
  "theme": "dark",
  "compaction.enabled": true,
  "retry.enabled": true
}
```

No 80-key surface. The extension system handles what Claude Code does via settings. Project `.pi/settings.json` overrides global with smart merge.

---

## Replication Strategy: feature-collab in Pi

### Option A: Symlink Skills, Write Extensions (Full Drop-in)

**Step 1 — Install Pi:**
```bash
npm install -g @mariozechner/pi-coding-agent
```

**Step 2 — Symlink skills:**
```bash
mkdir -p ~/.pi/agent/skills
# Symlink each skill from the CC skills dir:
for skill in ~/.claude/skills/*/; do
  ln -s "$skill" ~/.pi/agent/skills/$(basename "$skill")
done
```

Or symlink the feature-collab plugin's skills directory as a Pi package:
```bash
# Add package.json to the feature-collab plugin directory (see Step 3)
pi install /Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab
```

**Step 3 — Add `package.json` to feature-collab plugin:**
```json
{
  "name": "feature-collab-pi",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"]
  }
}
```
Drop this in `/Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab/`. Then `pi install /path/to/plugin` and skills are available.

**Step 4 — Write beads extension:**
```typescript
// ~/.pi/agent/extensions/beads.ts
import { extension, on, exec } from "@mariozechner/pi-coding-agent";

export default extension({
  name: "beads",
  description: "Beads task tracking integration"
});

on("session:start", async () => {
  const result = await exec("bd prime");
  // inject result as context — exact API TBD from extension docs
});

on("response:after", async () => {
  await exec("wip status WAITING 2>/dev/null || true");
});
```

**Step 5 — Verify skills appear:**
```bash
pi
# Type / to see available slash commands
```

### Option B: Lightweight — Pi Alongside CC, Shared Skills Only

Just symlink the skills directory and run Pi with Anthropic as provider. No extension rewrites. Use Pi for multi-model experiments; use Claude Code for the full harness.

```bash
# Symlink entire skills dir (read-only from Pi's perspective)
ln -s ~/.claude/skills ~/.pi/agent/skills
```

Pi's recursive skill discovery means it finds all subdirectories. Skills work identically. You lose beads/wip integration but gain multi-provider access.

---

## What's in the Pi Marketplace Worth Installing

| Package | What it does | Equivalent in CC |
|---------|-------------|-----------------|
| `pi-subagents` | Spawn isolated subagents within a session | Subagents / Agent tool |
| `pi-web-access` | Web search, URL fetch, GitHub clone, PDF | WebFetch + WebSearch tools |
| `pi-lens` | LSP integration + linters | (no direct CC equivalent) |
| `context-mode` | Knowledge bases + smart context shrinking | CC auto-memory |
| `pi-crew` | Coordinated AI teams | Agent teams (CC) |
| `pi-board` | AI-first task/sprint manager | Beads (your current setup) |
| `pi-multiagent` | Parallel execution via same-session delegation | Agent tool parallel dispatches |

---

## Recommendations

### Priority 1: Install Pi and verify skills work

```bash
npm install -g @mariozechner/pi-coding-agent
export ANTHROPIC_API_KEY=...   # or pi /login
ln -s ~/.claude/skills ~/.pi/agent/skills  # share skills immediately
cd /Users/reid/dev/fun_claude && pi
# Test: /beads-workflow, /feature-collab:* (if package installed)
```

Skills are the easiest win — zero rewriting, same format.

### Priority 2: Add package.json to feature-collab plugin, install in Pi

Add a 5-line `package.json` to the feature-collab plugin directory, then `pi install /path`. This gives Pi access to all `feature-collab:*` skills immediately, and since it's a live path reference, edits to skills are instantly reflected in both tools.

### Priority 3: Write a minimal beads extension (Phase 2)

The beads session-start context injection (`bd prime`) is the most valuable CC hook to replicate. It's ~20 lines of TypeScript. Do this after verifying skills work.

### Priority 4: Explore Pi marketplace packages

After the basics work, `pi install npm:pi-subagents` and `pi install npm:pi-web-access` give Pi capabilities closer to CC's built-in Agent tool and WebFetch.

---

## Trade-offs: Pi vs Claude Code

| Dimension | Claude Code | Pi |
|-----------|-------------|-----|
| **Model choice** | Claude only | 25+ providers, swap mid-session |
| **Extension model** | Shell scripts (hooks) | TypeScript (more powerful, steeper) |
| **Skills** | Same format (SKILL.md) | Same format (SKILL.md) |
| **Package ecosystem** | ~50 official + local marketplace | 1,919+ npm packages |
| **Subagents** | Built-in (`.claude/agents/`) | Extension (TypeScript) |
| **MCP** | Built-in (`.mcp.json`) | Extension (user builds) |
| **Context management** | Auto-compaction built-in | Extension or `context-mode` package |
| **Openness** | Anthropic-controlled | MIT, fork-friendly |
| **Stability** | More opinionated, more stable | More flexible, more volatile |

**Bottom line**: Pi and Claude Code are complementary, not competing. The skills layer is shared. Use Pi for multi-provider experiments and extension-building; use CC for the full harness (hooks, subagents, MCP) that's already wired up.

---

## Open Gaps

1. **Exact Pi extension event API** — the TypeScript API for `on("session:start", ...)` needs verification against actual extension docs (URL 404'd; need raw GitHub source)
2. **CC-specific SKILL.md frontmatter in Pi** — `context: fork`, `agent:`, skill-level `hooks:` will be ignored; need to verify no errors are thrown
3. **Slash command namespace in Pi** — does Pi support `feature-collab:bugfix` slash command format, or just `featurecollab-bugfix`? The package name in `package.json` may determine this
4. **Beads extension API** — exact TypeScript API for injecting context into a Pi session (vs just running a shell command)
5. **`pi config` vs `settings.json`** — whether `pi config` is a separate config file or just edits `settings.json`

## Status
**Current Phase**: Complete
**Completed**: 2026-04-30
