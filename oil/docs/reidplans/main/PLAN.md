<!--
ANNOTATION GUIDE:
- You: Use any CriticMarkup to comment, add, or delete text
- Claude: Uses {==highlights==} only
-->

# Spike: Claude Code Harness Local Setup & Drop-in Configuration

## Status
**Current Phase**: Report
**Waiting For**: User review

---

## Question

Two related but distinct research threads:

**Thread A — Harness internals**: What is the Claude Code "coding harness"? What components does it expose, what knobs exist to configure or extend it (hooks, settings, MCPs, skills, CLAUDE.md), and how does the local architecture work?

**Thread B — Drop-in configuration**: How do you configure a local Claude Code instance so that it acts as a "drop-in" replacement for a hosted coding agent — invoking skills with slash commands, reading from local skill/agent marketplaces, sharing CLAUDE.md and agent definitions across projects?

---

## Findings

### Thread A: The Configuration Surface is Enormous

Claude Code exposes **4 primary extension points** plus **2 secondary** ones:

**1. `settings.json` — master control** (80+ keys across 10 categories)
- Model/behavior: `model`, `effortLevel`, `alwaysThinkingEnabled`, `agent`
- Interface: `tui`, `viewMode`, `statusLine`, `language`, `theme`, `spinnerVerbs`
- Permissions: `permissions.allow/deny/ask`, `permissions.additionalDirectories`, `permissions.defaultMode`
- Sandbox: network allowlists/denylists, filesystem read/write controls, proxy
- Environment: `env` (inject vars into every session), `apiKeyHelper`, credential scripts
- Hooks: (see below)
- Plugins: `enabledPlugins`, `extraKnownMarketplaces`
- Worktree: `worktree.symlinkDirectories`, `worktree.sparsePaths`
- Attribution: custom git commit/PR footers
- MCP: MCPs are in `~/.claude.json`, not `settings.json`

**2. Hooks — 28 lifecycle events**
Every significant moment in a session fires an event. Key ones:
- `SessionStart` / `SessionEnd` — setup/teardown
- `UserPromptSubmit` — inject context before every prompt (what your `on-prompt.sh` does)
- `PreToolUse` / `PostToolUse` — wrap every tool call; PreToolUse can modify input or deny
- `Stop` — after every Claude response (what your `on-stop.sh` uses)
- `PreCompact` / `PostCompact` — context management events
- `SubagentStart` / `SubagentStop` — agent lifecycle
- `FileChanged` — react to specific file changes
- `ConfigChange` — react to settings changes

Hook handlers can be: `command` (shell), `http` (webhook), `mcp_tool`, `prompt` (send to Claude), or `agent` (spawn subagent).

PreToolUse hooks can intercept and **modify the tool's input** (`updatedInput`) or **deny it** without prompting the user — this is the most powerful hook capability.

**3. Skills (`~/.claude/skills/<name>/SKILL.md`)** — slash commands
Full frontmatter schema: model override, effort override, tool allowlists, `context: fork` (isolated subagent), path-scoping, argument substitution, inline shell execution with `` !`cmd` ``.

**4. Subagents (`~/.claude/agents/<name>.md`)** — specialized workers
Each is a markdown file with YAML frontmatter defining: model, tools allowlist/denylist, permissionMode, maxTurns, preloaded skills, MCP server access, hooks, isolation (worktree), and the system prompt in the body.

**5. MCP servers** — external tools/APIs
Three transports: `stdio` (local process), `http` (streamable, current standard), `sse` (deprecated). Config lives in `.mcp.json` (project, shared) or `~/.claude.json` (user/local, private). Env var expansion built in.

**6. CLAUDE.md hierarchy** — persistent instructions
7 load levels: managed policy → user global → user rules → project → project-local → project rules → subdirectory (lazy). All concatenate (no override). Path-scoped rules via `.claude/rules/*.md` with `paths:` frontmatter. `@import` syntax for composing from shared files.

**Key local files you already have:**
- `~/.claude/settings.json` — richly configured (hooks, statusLine, permissions)
- `~/.claude/CLAUDE.md` — global instructions
- `~/.claude/hooks/on-prompt.sh` — UserPromptSubmit context injection pattern
- `~/.claude/hooks/on-stop.sh` — Stop event side effects
- `~/.claude/statusline-command.sh` — custom status bar

---

### Thread B: The Drop-in Setup

**Slash command routing:**
```
/my-skill          → ~/.claude/skills/my-skill/SKILL.md          (personal, all projects)
/my-skill          → .claude/skills/my-skill/SKILL.md             (project-only)
/plugin-name:skill → via installed plugin with name "plugin-name" (plugin namespace)
```

**Critical finding**: colon-namespaced commands like `/feature-collab:bugfix` require a **plugin** with `name: "feature-collab"` in `plugin.json`. You cannot get colon syntax from a subdirectory inside `~/.claude/skills/`. This means your current `feature-collab:*` skills are either:
- (a) Loaded via `--plugin-dir` or installed as a proper plugin, OR
- (b) Using an undocumented flat-file naming convention with colons in filenames

**{==This is an open gap — run `ls ~/.claude/skills/` to determine the actual format==}**

**CLAUDE.md composition:**
All files concatenate (deepest/most-specific file has final say). The full stack for a project at `~/dev/fun_claude/oil/`:
1. `/Library/Application Support/ClaudeCode/CLAUDE.md` (managed, if exists)
2. `~/.claude/CLAUDE.md`
3. `~/.claude/rules/*.md`
4. `~/dev/fun_claude/CLAUDE.md`
5. `~/dev/fun_claude/oil/CLAUDE.md` (doesn't exist — oil inherits both parents)
6. `~/dev/fun_claude/oil/.claude/rules/*.md` (if any)

**Five tiers for sharing skills across projects:**

| Tier | Mechanism | Scope | Persistence |
|------|-----------|-------|-------------|
| 1 | `~/.claude/skills/<name>/SKILL.md` | All projects, no colon namespace | Permanent |
| 2 | `~/.claude/rules/*.md` with symlinks | All projects, path-scoped rules | Permanent |
| 3 | `claude --plugin-dir ~/.claude/my-plugin` | Session-only | Per-invocation |
| 4 | Plugin installed to user scope | All projects, colon namespace | Permanent |
| 5 | `extraKnownMarketplaces` + `enabledPlugins` in `settings.json` | All projects | Permanent |

**Custom subagents globally**: create `~/.claude/agents/<name>.md` — available everywhere, referenced as `agent: name` in skill frontmatter or auto-delegated based on `description`.

---

## Recommendations

### Priority 1: Audit the current feature-collab skill setup

Run `ls ~/.claude/skills/` and `ls ~/.claude/` to understand the current structure. Determine if feature-collab skills are:
- Installed plugins → document the structure, replicate pattern for new plugins
- Flat files with colons in names → upgrade to proper plugin structure
- Loaded via `--plugin-dir` → make persistent via `enabledPlugins` + `extraKnownMarketplaces`

### Priority 2: Formalize the plugin structure for feature-collab

Once structure is understood, package the feature-collab skills as a proper plugin with:
```
~/.claude/local-plugins/feature-collab/
  .claude-plugin/
    plugin.json   # {"name": "feature-collab", "version": "1.0.0"}
  skills/
    bugfix/SKILL.md
    spike/SKILL.md
    ...
  agents/
    code-explorer.md
    code-architect.md
```

Register in `~/.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": {
    "local": {
      "source": {"source": "directory", "path": "~/.claude/local-plugins"}
    }
  },
  "enabledPlugins": {"feature-collab@local": true}
}
```

### Priority 3: Extend hooks for the harness you want

Hooks you don't have yet but could add:
- `PreToolUse` matcher `Write|Edit` — auto-snapshot before file writes
- `SubagentStart` — inject per-agent context (e.g., which model is being used)
- `PreCompact` — already have `bd prime`; could also checkpoint wip state
- `FileChanged` matcher `.env` — refresh env on file change

### Priority 4: Set up path-scoped rules

Move project-type-specific instructions out of CLAUDE.md into `~/.claude/rules/`:
```
~/.claude/rules/
  typescript.md    # paths: src/**/*.ts — TypeScript-specific rules
  swift.md         # paths: **/*.swift — Swift rules
  python.md        # paths: **/*.py — Python rules
```

These only consume context when Claude is editing matching files.

---

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| Personal skills (`~/.claude/skills/`) | Immediate, no setup | No colon namespace, no bundling with agents |
| Plugin structure | Colon namespace, agents + skills + MCPs bundled | More setup; requires plugin.json |
| Per-project `.claude/skills/` | Project-specific, committed to git | Not global; others on project must also use CC |
| `--plugin-dir` per session | Quick, no install | Not persistent; breaks in subagents/worktrees |

---

## Follow-up Actions

- [ ] Run `ls ~/.claude/skills/` to determine current feature-collab structure
- [ ] If flat files: document whether colons in filenames are actually supported
- [ ] If already a plugin: find plugin.json and document the exact structure
- [ ] Prototype a minimal new plugin (1 skill + 1 agent) to validate the full flow
- [ ] Consider adding `SubagentStart` hook to log/audit agent spawning
- [ ] Consider `~/.claude/rules/` path-scoped rules for multi-language projects
- [ ] Consider `CLAUDE_ENV_FILE` pattern in SessionStart to inject dynamic env

## Gaps Remaining

1. Exact format of `~/.claude/skills/` (directory vs flat-file)
2. How `feature-collab:*` namespace is currently achieved
3. Full `plugin.json` schema and marketplace registration flow (needs live testing)
4. Hook `if` field exact syntax
5. Hook `once` and `asyncRewake` field behavior
6. Full list of valid `outputStyle` values
7. Agent teams system (separate from subagents — multiple parallel sessions)
8. MCP Channels protocol

## Status
**Current Phase**: Complete
**Completed**: 2026-04-30
