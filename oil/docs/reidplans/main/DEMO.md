# DEMO: Dirac Improvements → Oil Spike

## Spike Findings — Concrete Examples

---

## 1. The Problem: Pi's Current Edit Tool

Pi uses exact-content search-replace. The LLM must quote the existing code verbatim in `oldText`:

```json
// Pi edit tool call (current)
{
  "tool": "edit",
  "path": "payments.py",
  "edits": [
    {
      "oldText": "def complex_payment_processor(transaction_data):\n    logger.info(\"Starting processing\")\n    logger.info(\"Payment successful\")\n    return {\"status\": \"success\"}",
      "newText": "def complex_payment_processor(transaction_data, strict_mode=True):\n    logger.info(\"Starting processing\")\n    if strict_mode:\n        validate_transaction(transaction_data)\n    logger.info(\"Payment successful\")\n    return {\"status\": \"success\"}"
    }
  ]
}
```

**Token cost**: ~50 lines of old code repeated + ~55 lines new code = ~105 lines of output tokens.

**Failure modes**:
- `oldText` not unique → edit silently applies to wrong location
- Stale content (file changed since read) → fuzzy matcher may match wrong block
- Long functions require quoting many lines to achieve uniqueness

---

## 2. Dirac's Word-Anchor Approach

When Dirac presents a file to the LLM, each line is prefixed with a single-token English word anchor:

```
# payments.py — as shown to LLM by dirac_read
Moderator§def complex_payment_processor(transaction_data):
Qualifier§    logger.info("Starting processing")
Ripple§    logger.info("Payment successful")
Corona§    return {"status": "success"}
```

The LLM edits by range: `start_anchor → end_anchor → replacement`. No old code repeated:

```json
// Dirac-style edit tool call
{
  "tool": "dirac_edit",
  "file_path": "payments.py",
  "edits": [
    {
      "start_anchor": "Moderator",
      "end_anchor": "Corona",
      "replacement": "def complex_payment_processor(transaction_data, strict_mode=True):\n    logger.info(\"Starting processing\")\n    if strict_mode:\n        validate_transaction(transaction_data)\n    logger.info(\"Payment successful\")\n    return {\"status\": \"success\"}"
    }
  ]
}
```

**Token cost**: 2 anchor words + ~55 lines new code = ~57 lines of output tokens. **~46% reduction** for this example. The blog post reports ~50% avg.

---

## 3. After Edit: Myers Diff Re-anchors Only Changed Lines

The State Manager diffs the new file and assigns fresh anchors to added/shifted lines. New file returned to LLM:

```
# payments.py — anchor state after edit
Moderator§def complex_payment_processor(transaction_data, strict_mode=True):
Qualifier§    logger.info("Starting processing")
Veranda§    if strict_mode:                          ← new anchor assigned
Canopy§        validate_transaction(transaction_data) ← new anchor assigned
Ripple§    logger.info("Payment successful")          ← unchanged, same anchor
Corona§    return {"status": "success"}               ← unchanged, same anchor
```

Only 2 lines needed new anchors (the inserted lines). No full re-read required.

---

## 4. File Skeleton: Reading Without Token Bloat

For a 500-line file, Dirac's `dirac_read` returns a skeleton by default:

```
# payments.py — skeleton view (dirac_read default)
Moderator§def complex_payment_processor(transaction_data, strict_mode=True): [line 1-45]
Firewall§def validate_transaction(transaction_data): [line 47-89]
Nebula§class PaymentError(Exception): [line 91-110]
Pinnacle§def process_batch(transactions: List[dict]) -> List[dict]: [line 112-200]
```

LLM can request expansion of a specific range:
```json
{ "tool": "dirac_read", "file_path": "payments.py", "expand": "Firewall" }
```

Returns only lines 47-89 — not all 500 lines.

---

## 5. Porting to Pi: The Extension Architecture

```typescript
// ~/.oil/extensions/dirac-edit.ts (prototype design)
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { diffLines } from "diff"; // Myers Diff, off-the-shelf npm

const ANCHOR_POOL = ["Moderator", "Qualifier", "Ripple", "Corona", "Firewall", ...]; // ~1,700 words

// State: per-file anchor maps, lives in-process (module scope)
const anchorState = new Map<string, Map<string, number>>(); // file → anchor → line index

export default function(pi: ExtensionAPI) {
  pi.registerTool("dirac_read", {
    description: "Read file with word-anchor labels for cheap range-based editing",
    parameters: { file_path: { type: "string" }, skeleton: { type: "boolean", default: true } },
    execute: async ({ file_path, skeleton }) => {
      const content = await readFile(file_path);
      const lines = content.split("\n");
      const fileAnchors = new Map<string, number>();
      const labeled = lines.map((line, i) => {
        const anchor = ANCHOR_POOL[i % ANCHOR_POOL.length]; // simplified assignment
        fileAnchors.set(anchor, i);
        return `${anchor}§${line}`;
      });
      anchorState.set(file_path, fileAnchors);
      return labeled.join("\n");
    }
  });

  pi.registerTool("dirac_edit", {
    description: "Edit file by anchor range — no old code quoting needed",
    parameters: {
      file_path: { type: "string" },
      edits: { type: "array", items: {
        start_anchor: { type: "string" }, end_anchor: { type: "string" },
        replacement: { type: "string" }
      }}
    },
    execute: async ({ file_path, edits }) => {
      // Look up line ranges from anchor state, apply replacements, re-anchor via Myers Diff
      // ... ~40 lines of implementation
    }
  });
}
```

**What makes this work without forking Pi**:
- `pi.registerTool()` adds LLM-callable tools with any schema
- Module-level `anchorState` persists within a session (Pi loads extensions as ES modules)
- No Pi core changes needed — the tools sit alongside Pi's native `edit` tool

**Hard part**: Proper anchor pool management (uniqueness per file, pool exhaustion fallback to 2-token combinations) is ~40 more lines. The Myers Diff reconciliation after edits is the trickiest part to get right.

---

## 6. Gap Summary

| Capability | Pi/oil today | With dirac-edit extension |
|-----------|-------------|--------------------------|
| Edit token cost | ~100% (quotes old+new) | ~50% (anchor + new only) |
| Uniqueness failures | Possible on non-unique blocks | Eliminated (anchor is injected identity) |
| Stale file detection | Fuzzy match (silent risk) | Anchor validation + error response |
| File reading | Full content, no structure | Skeleton by default + expand |
| Multi-file batch | One file per call | One file per call (same — Pi parallel calls cover this) |

---

## 7. Tilth Overlap Check

Before building skeleton reads, verify tilth already covers this:

```bash
# In oil, after tilth is wired via pi-mcp-adapter:
# tilth_read returns structural outline for large files (already)
# tilth_search finds symbols with source context (already)
```

If `tilth_read`'s outline mode plus `tilth_search` cover the "show me structure without reading 500 lines" use case, the skeleton read extension may not be worth building separately.

---

# DEMO: Claude Code Harness Local Setup & Drop-in Configuration (previous spike)

## Spike Findings — Executable Reference

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
