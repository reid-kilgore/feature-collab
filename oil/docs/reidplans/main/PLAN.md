<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Spike: Dirac Improvements → Oil

## Status
**Current Phase**: Implement
**Waiting For**: In progress (dark factory)

## Enhancement: dirac-edit + tilth integration for oil

### Description
Add a `dirac-edit` Pi extension to oil that provides word-anchor range editing, complementing tilth's existing symbol search and read tools. The agent says "edit from anchor Moderator to anchor Corona" rather than quoting old code verbatim. Removes `tilth_edit` from directTools to route all edits through the anchor layer.

### In Scope
- [ ] `~/.oil/extensions/dirac-edit.ts` — Pi extension with `dirac_read` and `dirac_edit` tools
- [ ] `~/.oil/mcp.json` — remove `tilth_edit` from directTools

### Explicitly Out of Scope
- tree-sitter skeleton reads (tilth already handles outlines)
- Opportunistic context prefetching
- Publishing as npm package
- Myers Diff re-anchoring (MVP uses line-shift math after edits)

### Exit Criteria
- [ ] `dirac_read` reads a file and returns content with word-anchor labels per line
- [ ] Anchor state persists in module scope between `dirac_read` and `dirac_edit` calls
- [ ] `dirac_edit` accepts `{start_anchor, end_anchor, replacement}[]` and applies range edits
- [ ] After edit, anchor state is updated (line-shift for unchanged lines, fresh anchors for new lines)
- [ ] `tilth_edit` removed from `~/.oil/mcp.json` directTools
- [ ] Extension loads in oil without errors (`/reload` succeeds)
- [ ] < 200 lines of production code added

### Concepts Traced
- **Pi registerTool API**: `pi.registerTool({ name, description, parameters: Type.Object({...}), execute(id, params, signal) {} })` — typebox for schema, module-level vars for cross-call state, `node:fs/promises` available
- **tilth_edit**: hash-anchored (`N:hash│ content`) — already provides staleness detection; removed from directTools so agent uses dirac_edit instead
- **tilth_read**: returns `N │ content` (full) or outline (large files) — dirac_read reads via fs independently to inject word anchors cleanly
- **Re-anchoring**: after edit replacing lines [s, e] with N new lines, shift all anchors after line e by `N - (e - s + 1)`; assign fresh anchors to the N replacement lines

### Files Changing
- `~/.oil/extensions/dirac-edit.ts` — new (~120 lines)
- `~/.oil/mcp.json` — remove `tilth_edit` from directTools array (1 line)

---

## Question (from spike)
What techniques does Dirac (https://github.com/dirac-run/dirac) use — particularly batch edits, hashlines, and other context/diff innovations — and which are worth porting into oil (Pi-based)?

## Hypotheses
1. Dirac's "hashlines" reduce context usage by referencing stable line hashes rather than repeating full file content on each edit.
2. Batch edit strategies let models express multi-file changes atomically, reducing round trips and edit-apply errors.
3. Some of these improvements may already exist in Pi or can be layered via Pi extensions without forking Pi itself.

## Scope
- **Investigate**: Dirac's source — edit protocol, hashline mechanism, batch edit format, context management, any diff-format innovations
- **Compare**: Against Pi's current edit/tool model to identify gaps
- **Produce**: Report with concrete porting paths (extension vs. Pi fork vs. prompt-only)
- **Do NOT**: Write production code, modify oil or Pi files

## Exit Criteria
- [ ] Dirac's batch edit protocol understood with examples
- [ ] Hashline mechanism explained (what it is, how it saves tokens)
- [ ] Gap analysis: what Pi/oil already does vs. what Dirac adds
- [ ] Porting options per feature: extension hook / prompt engineering / needs Pi fork
- [ ] DEMO.md with executable examples or concrete before/after comparisons
- [ ] No production code written (spike-scratch/ only)

## Findings

### 1. Dirac's Word-Anchor Edit Protocol

Dirac injects a single-token English word (from a ~1,700-word pool) plus `§` delimiter before each line when presenting files to the LLM:

```
Moderator§def complex_payment_processor(transaction_data):
Qualifier§    logger.info("Starting processing")
Corona§    return {"status": "success"}
```

The LLM then edits by specifying `{start_anchor, end_anchor, replacement}[]` as a list parameter — no old code repeated, no search block required. A backend State Manager runs Myers Diff after each edit to re-anchor only the changed lines and returns updated assignments to the LLM.

**Token cost**: ~50% reduction vs. search-replace for the same edits. Per the blog post: `edit_file` ~540 tokens vs. `replace_in_file` ~1,080 tokens for a 50-line function change.

### 2. File Skeletons (AST-native)

Dirac shows a **structural skeleton** by default — function/class signatures + their anchor labels — not full file content. Tree-sitter WASM (14 languages) is used as a structural index to determine what slices to fetch; the LLM never sees AST output directly.

### 3. Opportunistic Prefetching

Dirac proactively pushes predicted-next-needed context before the model asks. This is coupled with the anchor state staying coherent across prefetched reads.

### 4. List Parameters Everywhere

All Dirac tools accept list parameters, so a single tool call can address multiple files or operations. This explicitly overcomes LLM reluctance to fire many parallel tool calls simultaneously.

### 5. Pi's Current Model — What's Already There

Pi already has:
- **Batch edits per file** — `{oldText, newText}[]` array, applied atomically, already avoids multiple round trips for multi-hunk changes in one file
- **Auto-compaction** — LLM summarization at 16K reserve tokens, preserves 20K recent context
- **MCP proxy pattern** — single `mcp` tool (~200 tokens) avoids bloat from registering all MCP tools up front
- **Clean reads** — no line numbers injected, truncation at 2K lines/50KB

### 6. Gaps: Pi vs. Dirac

| Capability | Pi/oil | Dirac | Gap |
|-----------|--------|-------|-----|
| Edit identifies ranges | `oldText` exact-match (content-dependent) | Word-anchor (position-independent) | **Yes — high value** |
| Stale file detection | Fuzzy match (silent wrong-location risk) | Anchor validation + error response | **Yes** |
| File presentation | Full text, no structure | Skeleton by default | **Yes — medium value** |
| Multi-file batch | One file per call (model parallelizes) | List param covers multiple files | Negligible — Pi parallel calls work |
| Context prefetching | Auto-compaction + manual | Opportunistic push | Low priority |

## Recommendations

### Priority 1 — Word-anchor edit as a Pi extension (HIGH value, feasible)

Build a `dirac-edit` Pi extension that adds two tools:
- `dirac_read` — reads file, assigns word-anchor labels per line, writes `.dirac-anchors.json` sidecar, returns annotated content
- `dirac_edit` — accepts `{start_anchor, end_anchor, replacement}[]`, resolves against sidecar, replaces range, re-anchors via Myers Diff, updates sidecar

**Implementation path**: ~80 lines TypeScript, no Pi fork needed. State lives in `.dirac-anchors.json` per file (written by read, consumed by edit). The `diff` npm package provides Myers Diff off-the-shelf. Module-level in-process state is even simpler if Pi extensions share module scope within a session.

Lives in `~/.oil/extensions/dirac-edit.ts` or as an installable package.

### Priority 2 — File skeleton reads (MEDIUM value)

Extend `dirac_read` to return a structural outline (function/class signatures + anchor labels) by default, with an `expand` parameter to get full content for a specific anchor range. Requires `tree-sitter-wasm` (~3MB npm package). Can ship independently of the anchor edit tool.

Tilth's outline mode already does something similar — check if tilth_read via pi-mcp-adapter covers this need before building.

### Priority 3 — Skip opportunistic prefetching

Too complex and already partially covered by Pi's auto-compaction. Not worth porting.

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| Build dirac-edit extension | ~50% edit token reduction, no uniqueness failures, no Pi fork | Maintains anchor sidecar files, two new tools model must learn |
| Prompt-only improvements | Zero implementation effort | Can't eliminate uniqueness problem or stale-file risk |
| Fork Pi and patch core edit tool | Seamless integration | Maintenance burden on Pi upgrades |

{==Recommended path: build the Pi extension first. If it proves valuable, propose upstreaming to Pi core.==}

## Follow-up Actions
- [ ] Build `~/.oil/extensions/dirac-edit.ts` as a spike prototype in `spike-scratch/`
- [ ] Check if tilth_read outline mode already covers skeleton reads (via pi-mcp-adapter)
- [ ] Evaluate the ~1,700-word single-token anchor pool — can use the list from Can Bölük's original hash-anchors work or generate from tiktoken
- [ ] If prototype works well, consider publishing as `pi-dirac-edit` npm package

---
<!-- Previous spike content below — preserved for reference -->

# Pi → Oil: Walking Skeleton (previous spike)

## Status
**Current Phase**: Implementation
**Next**: feature-collab:enhance walking skeleton

---

## Goal

A working local coding agent invoked as `oil` (shell alias/wrapper over `pi`) that:
- Runs `feature-collab:enhance` on a PLAN.md the way Claude Code does
- Can be pointed at OpenAI/Codex subscription, LM Studio (Qwen local), or Anthropic
- Has beads context injection at session start (so `bd prime` runs and Pi knows about work)

---

## Walking Skeleton Scope

The skeleton is complete when:
1. `oil` runs (alias or wrapper for `pi`)
2. `oil` opens with beads context already injected (SessionStart extension runs `bd prime`)
3. `/feature-collab:enhance some description` loads the skill and runs the enhance workflow
4. Provider can be switched to OpenAI (Codex sub) or LM Studio Qwen with a flag or config

Out of scope for skeleton: full beads lifecycle (stop hook), all feature-collab:* skills working perfectly, production-quality extension.

---

## Harness Needs & Gaps

### Resolved from spike
- Skills: SKILL.md format is shared (Agent Skills standard) — feature-collab skills port directly
- Package install: `pi install /path` works with a `package.json` declaring skills
- Settings: `~/.pi/agent/settings.json` for global, `.pi/settings.json` for project
- Providers: Pi supports Anthropic, OpenAI, and custom OpenAI-compatible endpoints (LM Studio)

### Open Gaps (need resolution before/during build)

| Gap | Blocker? | Notes |
|-----|----------|-------|
| Pi extension TypeScript API (`on("session:start", ...)` exact shape) | Yes | Extension docs 404'd; need raw GitHub source |
| LM Studio OpenAI-compatible endpoint format in Pi settings | Yes | Likely `baseUrl` override under provider config |
| Slash command namespace in Pi — does `feature-collab:bugfix` format work? | Yes | Package name in package.json may control this |
| CC-specific SKILL.md frontmatter (`context: fork`, `agent:`) — silently ignored or error? | Medium | Need live test |
| `oil` alias: shell alias vs npm-linked wrapper vs symlinked bin | Low | Alias is simplest; wrapper needed if we want config injection |

### Concrete build tasks

1. **`package.json`** for `feature-collab/plugins/feature-collab/` — 5 lines, declares skills dir
2. **Pi settings** — `~/.pi/agent/settings.json` with Anthropic + OpenAI (Codex) + LM Studio (Qwen)
3. **Beads extension** — `~/.pi/agent/extensions/beads.ts` — runs `bd prime` on SessionStart
4. **`oil` alias/wrapper** — `~/.local/bin/oil` or shell alias
5. **Verify**: `oil` → `/feature-collab:enhance` loads and runs

---

## Original Spike Research

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
