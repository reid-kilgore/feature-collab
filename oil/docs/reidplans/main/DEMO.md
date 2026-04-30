# DEMO: Claude Code Harness Local Setup & Drop-in Configuration

## Spike Findings — Executable Reference

---

## Thread A: The Full Configuration Surface

### 1. Settings Schema Location

```bash
# View your current global settings
cat ~/.claude/settings.json

# The JSON schema for editor autocomplete:
# Add to settings.json: "$schema": "https://json.schemastore.org/claude-code-settings.json"

# Settings precedence (highest to lowest):
# Managed (MDM/org policy)
# CLI flags (--permission-mode, --model, etc.)
# .claude/settings.local.json    (project-local, gitignored)
# .claude/settings.json          (project, commit to git)
# ~/.claude/settings.json        (user, all your projects)
```

### 2. Hook System — 28 Events

```bash
# Hook config lives in settings.json under "hooks":
# {
#   "hooks": {
#     "EventName": [
#       {
#         "matcher": "ToolName|OtherTool",   # optional regex on tool name / session source / etc.
#         "hooks": [
#           {
#             "type": "command",
#             "command": "bash /path/to/script.sh",
#             "timeout": 600,
#             "async": false
#           }
#         ]
#       }
#     ]
#   }
# }

# All 28 event names:
# Session:     SessionStart, Setup, SessionEnd
# Per-turn:    UserPromptSubmit, UserPromptExpansion, Stop, StopFailure
# Tools:       PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch
#              PermissionRequest, PermissionDenied
# Subagents:   SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle
# Files:       FileChanged, ConfigChange, CwdChanged, InstructionsLoaded
# Context:     PreCompact, PostCompact
# Worktree:    WorktreeCreate, WorktreeRemove
# MCP:         Elicitation, ElicitationResult, Notification

# Hook stdin payload (all events):
# {
#   "session_id": "abc123",
#   "transcript_path": "/path/to/transcript.jsonl",
#   "cwd": "/current/dir",
#   "permission_mode": "default",
#   "hook_event_name": "PreToolUse",
#   ...event-specific fields
# }
```

### 3. Hook That Injects Context on Every Prompt

```bash
# Your existing pattern in ~/.claude/hooks/on-prompt.sh
# This is a UserPromptSubmit hook. Plain stdout is injected into Claude's context.

# ~/.claude/settings.json:
# "hooks": {
#   "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "bash ~/.claude/hooks/on-prompt.sh"}]}]
# }

# The hook reads stdin for the prompt, outputs context to stdout.
# Claude sees the hook output as additional context before processing the prompt.
```

### 4. PreToolUse — Most Powerful Hook

```bash
# PreToolUse can modify a tool's input before execution, or deny it entirely.

# Example: intercept all Bash commands and log them
# Hook output JSON:
# {
#   "hookSpecificOutput": {
#     "hookEventName": "PreToolUse",
#     "permissionDecision": "allow",           # allow | deny | ask | defer
#     "updatedInput": {"command": "modified"}, # optional: change the command
#     "additionalContext": "logged: cmd"       # optional: shown to Claude
#   }
# }

# Exit code 2 = blocking denial (feeds stderr to Claude as explanation)
# Exit code 0 = success (parse stdout for JSON)
# Other exit = non-blocking error (continues anyway)
```

### 5. Skills — SKILL.md Format

```markdown
# ~/.claude/skills/my-workflow/SKILL.md

---
description: "What this does. Front-load keywords. 1536 char cap."
argument-hint: "[optional-arg]"
arguments: [name, branch]          # enables $name, $branch substitution
allowed-tools: Bash(git *) Read    # pre-approved tools (no permission prompt)
model: haiku                       # override model for this skill's turn
effort: medium                     # override effort level
context: fork                      # run in isolated subagent
agent: Explore                     # which agent when context: fork
disable-model-invocation: true     # only user can invoke (hidden from Claude)
user-invocable: false              # only Claude can invoke (hidden from / menu)
paths:                             # auto-activate only for matching files
  - "src/**/*.ts"
hooks:                             # hooks scoped to this skill only
  PreToolUse: [...]
---

Your instructions here.

Use $ARGUMENTS for any text after the skill name.
Use $name, $branch for named positional args.

Inline shell (executed before Claude sees the content):
Current branch: !`git branch --show-current`
```

### 6. Subagents — Agent File Format

```markdown
# ~/.claude/agents/my-specialist.md

---
name: my-specialist
description: "Expert at X. When Claude should delegate."
model: haiku                        # sonnet | opus | haiku | inherit
tools: [Read, Grep, Glob]           # allowlist
disallowedTools: [Bash, Write]      # denylist from inherited
permissionMode: acceptEdits         # default|acceptEdits|auto|dontAsk|bypassPermissions|plan
maxTurns: 20
skills: [beads-workflow]            # preloaded skill content injected at startup
mcpServers: [slack, github]         # available MCP servers
memory: user                        # cross-session learning
isolation: worktree                 # run in isolated git worktree
color: blue                         # UI color
effort: medium
---

You are a specialist in X. When invoked, focus only on Y and Z.
Never do W.
```

**Subagent storage precedence** (higher = wins):
1. Managed settings
2. `--agents` CLI JSON
3. `.claude/agents/` (project)
4. `~/.claude/agents/` (user/global)
5. Plugin `agents/`

**Built-in agent types**: `general-purpose`, `Explore`, `Plan`, `statusline-setup`, `Claude Code Guide`

### 7. MCP Configuration

```json
// .mcp.json (project-level, commit to git)
{
  "mcpServers": {
    "my-local-server": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "env": {
        "API_KEY": "${API_KEY}",
        "BASE_URL": "${BASE_URL:-https://api.example.com}"
      }
    },
    "remote-server": {
      "type": "http",
      "url": "${API_BASE_URL}/mcp",
      "headers": {"Authorization": "Bearer ${TOKEN}"}
    }
  }
}
```

```bash
# CLI management
claude mcp add --transport http my-server https://api.example.com/mcp
claude mcp add --scope user my-server -- npx my-server-package   # all projects
claude mcp add --scope project my-server -- npx my-server-package # this project (writes .mcp.json)
claude mcp list
claude mcp remove my-server

# MCP hook matcher pattern: mcp__<server-name>__<tool-name>
# Example: match all memory server tools → "mcp__memory__.*"
```

### 8. CLAUDE.md Hierarchy

```bash
# Full load order for ~/dev/fun_claude/oil/:
# 1. /Library/Application Support/ClaudeCode/CLAUDE.md  (managed policy, if exists)
# 2. ~/.claude/CLAUDE.md                                 (your global)
# 3. ~/.claude/rules/*.md                                (user path-scoped rules)
# 4. ~/dev/fun_claude/CLAUDE.md                          (parent project)
# 5. ~/dev/fun_claude/oil/CLAUDE.md                      (doesn't exist → skipped)
# 6. .claude/rules/*.md in project root                  (project rules)
# All are concatenated. Deepest file has final say on conflicts.

# CLAUDE.local.md = private, gitignored, appended after CLAUDE.md at same level
# @import syntax: "@path/to/file" anywhere in CLAUDE.md — expanded at launch
```

```markdown
# Example path-scoped rule: ~/.claude/rules/typescript.md
---
paths:
  - "src/**/*.ts"
  - "**/*.tsx"
---

# TypeScript Rules
Always check for proper null handling. Prefer explicit return types.
Never use `any` — use `unknown` and narrow.
```

---

## Thread B: Drop-in Configuration

### 9. Slash Command → File Mapping

```
Invocation              File Location
─────────────────────────────────────────────────────────────────
/my-skill               ~/.claude/skills/my-skill/SKILL.md       (personal, everywhere)
/my-skill               .claude/skills/my-skill/SKILL.md          (project-only)
/feature-collab:bugfix  requires plugin named "feature-collab"   (plugin namespace)
/built-in               bundled with Claude Code (not overridable by files)
```

**Precedence**: Enterprise > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`) > Plugin

**File watching**: edits to existing skills take effect immediately. New top-level directories require restart.

### 10. Creating a New Personal Slash Command

```bash
# Step 1: Create directory
mkdir -p ~/.claude/skills/my-workflow

# Step 2: Write SKILL.md
cat > ~/.claude/skills/my-workflow/SKILL.md << 'EOF'
---
description: "Does X when the user asks to do X."
allowed-tools: Bash(git *) Read
model: haiku
---

When invoked, do the following:
1. Check git status: !`git status --short`
2. ...
EOF

# Step 3: Invoke immediately (no restart needed)
# /my-workflow some optional args
```

### 11. Current feature-collab:* Setup — Gap to Verify

```bash
# OPEN QUESTION: how are the feature-collab:* skills currently loaded?
# Run this to find out:
ls -la ~/.claude/skills/
ls -la ~/.claude/
find ~/.claude -name "plugin.json" 2>/dev/null
find ~/.claude -name "marketplace.json" 2>/dev/null

# If you see files named "feature-collab:bugfix.md" → undocumented flat-file colons
# If you see a directory "feature-collab" with plugin.json → proper plugin
# If neither → loaded via --plugin-dir (session-only, not in settings.json)
```

### 12. Creating a Local Plugin (for colon namespace + bundling)

```bash
# Directory structure for a plugin named "feature-collab":
~/.claude/local-plugins/
  feature-collab/
    .claude-plugin/
      plugin.json         # required: declares the plugin name
    skills/
      bugfix/
        SKILL.md
      spike/
        SKILL.md
    agents/
      code-explorer.md
      code-architect.md

# plugin.json minimal content:
# {"name": "feature-collab", "version": "1.0.0", "description": "..."}
```

```json
// ~/.claude/settings.json additions to auto-load the plugin:
{
  "extraKnownMarketplaces": {
    "local": {
      "source": {
        "source": "directory",
        "path": "/Users/reid/.claude/local-plugins"
      }
    }
  },
  "enabledPlugins": {
    "feature-collab@local": true
  }
}
```

```bash
# Then within Claude Code:
/plugin marketplace add ~/.claude/local-plugins
/plugin install feature-collab@local --scope user
/reload-plugins

# After this, /feature-collab:bugfix works in every project automatically.
```

### 13. Drop-in Configuration Checklist

```bash
# Tier 1 (already done): personal skills in ~/.claude/skills/
ls ~/.claude/skills/   # verify: each should be a directory with SKILL.md

# Tier 2: global CLAUDE.md for behavioral norms
# ~/.claude/CLAUDE.md — already set up, keep under 200 lines

# Tier 3: path-scoped rules for language/framework specifics
mkdir -p ~/.claude/rules/
# Create per-language rule files with paths: frontmatter

# Tier 4: global agents for reusable workers
mkdir -p ~/.claude/agents/
# Create *.md files; referenced as agent: name in skill frontmatter

# Tier 5: plugin structure for namespaced skill collections
# (see section 12 above)

# Verification: does a skill work?
# Open Claude Code in any project, type /my-skill
# It should autocomplete and execute.
```

### 14. CLAUDE.md Composition Example

```markdown
# ~/.claude/CLAUDE.md (global)
# Loaded for EVERY project

## Git workflow
Always create a new branch before making changes.

## Beads
Use bd for ALL task tracking.

---

# ~/dev/myproject/CLAUDE.md (project)
# Concatenated AFTER global. Project-specific wins.

## Architecture
This is a monorepo with packages/frontend and packages/backend.
The database is Postgres; migrations live in db/migrations/.
```

```bash
# Both are loaded and concatenated. Claude sees the combined result.
# No override — all instructions are in scope.
# To see what Claude loaded: check the session context or use /status
```

### 15. Environment Variable Injection via SessionStart Hook

```bash
# Pattern: set env vars at session start that persist into all Bash tool calls
# Uses $CLAUDE_ENV_FILE (Claude provides the path; write to it)

# ~/.claude/hooks/session-setup.sh
#!/bin/bash
# Read session info from stdin (not needed for env injection, but available)
cat > "$CLAUDE_ENV_FILE" << 'EOF'
export AWS_PROFILE=dev
export NODE_ENV=development
export DATABASE_URL=postgres://localhost:5432/mydb
EOF

# settings.json:
# "hooks": {
#   "SessionStart": [{"hooks": [{"type": "command", "command": "bash ~/.claude/hooks/session-setup.sh"}]}]
# }
```

---

## Quick Reference Card

| Want to... | Do this |
|-----------|---------|
| Add a personal slash command `/foo` | Create `~/.claude/skills/foo/SKILL.md` |
| Make `/ns:foo` style command | Create a plugin named `ns` with `skills/foo/SKILL.md` |
| Add a global reusable agent | Create `~/.claude/agents/myagent.md` |
| Add global behavioral rules | Edit `~/.claude/CLAUDE.md` |
| Add project-specific rules | Create `.claude/skills/` or `CLAUDE.md` in project root |
| Add language-scoped rules | Create `~/.claude/rules/typescript.md` with `paths:` frontmatter |
| Run code on every prompt | `UserPromptSubmit` hook → stdout is injected as context |
| Intercept/modify tool calls | `PreToolUse` hook → return `updatedInput` in stdout JSON |
| Set env vars for all Bash calls | `SessionStart` hook writing to `$CLAUDE_ENV_FILE` |
| Add a local tool/API | `claude mcp add --scope user myserver -- cmd` |
| Share skills across a team | Commit `.mcp.json` + `.claude/` to git; each dev uses CC |
| Check what's loaded | `/status` or check session context window |
