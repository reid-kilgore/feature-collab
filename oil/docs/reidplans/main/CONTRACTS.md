# Contracts: dirac-edit + tilth integration

## Files Changed

| File | Change |
|------|--------|
| `~/.oil/extensions/dirac-edit.ts` | New — word-anchor read/edit tools |
| `~/.oil/mcp.json` | Remove `tilth_edit` from `directTools` |

---

## Tool: `dirac_read`

**Purpose**: Read a file and annotate each line with a word anchor. Stores anchor→line mapping in session-scoped module state.

**Parameters**:
```typescript
Type.Object({
  path: Type.String({ description: "Absolute path to file" }),
  offset: Type.Optional(Type.Number({ description: "Line to start from (0-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Max lines to return" })),
})
```

**Returns** (content sent to LLM):
```
Moderator§def foo(x):
Qualifier§    return x + 1
Ripple§
Corona§class Bar:
Veranda§    pass
```

**Side effect**: Updates module-level `anchorState: Map<string, AnchorEntry[]>` where:
```typescript
interface AnchorEntry {
  anchor: string;   // word from ANCHOR_POOL
  lineIndex: number; // 0-based line number in file
  content: string;  // line content (for validation)
}
```

**promptGuidelines** (injected into LLM tool schema):
```
Call dirac_read before dirac_edit. The anchor words in the response (e.g., "Moderator§line content")
are the identifiers required by dirac_edit's start_anchor and end_anchor parameters.
```

**Behavior**:
- Reads file via `readFile(path, "utf8")`
- Deduplicates ANCHOR_POOL (preserving first occurrence) before assigning — pool duplicates are removed at call time
- Assigns anchors sequentially from the deduplicated pool; does NOT cycle
- If the window (after applying offset/limit) has more lines than `dedupedPool.length`, silently cap output at `dedupedPool.length` lines and append: `[File window exceeds anchor pool. Call again with offset=<nextLine> to continue.]`
- Default limit: min(500, dedupedPool.length) lines
- Replaces any existing anchor state for the file on each call

---

## Tool: `dirac_edit`

**Purpose**: Apply one or more range replacements identified by anchor words. All edits are validated before any are applied (atomic).

**promptGuidelines** (injected into LLM tool schema):
```
IMPORTANT: dirac_edit requires a prior dirac_read call on the same file in this session.
Anchor words (e.g., "Moderator", "Ripple") are system-assigned identifiers — they are NOT
line numbers, code fragments, or file content. They are opaque tokens returned in dirac_read output.
Do not attempt to construct or guess anchor names.
```

**Parameters**:
```typescript
Type.Object({
  path: Type.String({ description: "Absolute path to file" }),
  edits: Type.Array(Type.Object({
    start_anchor: Type.String({ description: "Anchor word at start of range (inclusive)" }),
    end_anchor: Type.String({ description: "Anchor word at end of range (inclusive)" }),
    replacement: Type.String({ description: "New content to replace the range" }),
  }), { description: "One or more range replacements, applied in order" }),
})
```

**Returns** (content sent to LLM):
```
Applied 2 edit(s) to /path/to/file.py

Updated anchors (re-read to see full file):
  Moderator → line 1 (unchanged)
  Veranda   → line 6 (was 7, shifted)
  [5 new anchors assigned to replacement lines]
```

**Behavior — validate-all-first, then apply atomically**:

**Phase A: Validate all (no mutations)**
1. For every edit: look up `start_anchor` and `end_anchor` in anchorState for `path`. If either is missing, throw immediately (no changes written). If the same anchor word appears more than once in anchorState for this file (corruption guard), throw immediately.
2. Resolve each edit to `{ startLine, endLine }` using stored `lineIndex`. Verify `startLine <= endLine`.
3. Read current file into `lines[]`.
4. For every edit: check `lines[startLine] === storedContent` for `start_anchor` AND `lines[endLine] === storedContent` for `end_anchor`. Lookup is by `lineIndex` (address), NOT by content-scan. If file is shorter than stored lineIndex, or content at that index doesn't match: throw with edit number and "no changes written" message.
5. Overlap pre-check: sort resolved ranges by `startLine`. For each consecutive pair (A, B): if `A.endLine >= B.startLine`, throw overlap error naming both edits. Adjacent ranges (`A.endLine + 1 == B.startLine`) are valid. Single-line edits (`startLine == endLine`) are valid.

**Phase B: Apply and write (only if Phase A fully passed)**

6. Apply edits to in-memory buffer in ascending `startLine` order.
7. Update anchor state: for each edit replacing lines [s, e] with N new lines, shift all surviving anchors with `lineIndex > e` by `N - (e - s + 1)`; assign fresh anchors to the N replacement lines from the deduplicated pool (skipping anchors already in use in this file's state).
8. Write file via `writeFile(path, newContent, "utf8")`.

**Error cases** (all thrown as errors; file and state are NEVER mutated before all validations pass):
- Anchor not found in state → `"Unknown anchor 'X' — anchor names are system-assigned words from dirac_read output (e.g., 'Moderator', 'Ripple'), not code text. Call dirac_read on this file first."`
- Ambiguous anchor (duplicate in state, corruption guard) → `"Ambiguous anchor 'X' — multiple entries exist. Call dirac_read to refresh state."`
- Anchor stale (`lines[lineIndex]` doesn't match stored content) → `"Anchor 'X' is stale (edit N of M) — no changes written. Call dirac_read to refresh."`
- File shorter than stored lineIndex → same stale error
- Overlapping edits → `"Edits overlap: edit N (lines A-B, anchors X→Y) and edit M (lines C-D, anchors P→Q) share lines C-B. Reorder or split into separate dirac_edit calls."`
- `start_anchor` lineIndex > `end_anchor` lineIndex → `"start_anchor 'X' (line N) must precede end_anchor 'Y' (line M)"`

---

## Anchor Pool

```typescript
// Raw pool — MAY contain duplicates; always deduplicate before use
const ANCHOR_POOL_RAW = [
  "Moderator", "Qualifier", "Ripple", "Corona", "Veranda", "Canopy",
  "Pinnacle", "Firewall", "Nebula", "Meridian", "Citadel", "Rampart",
  "Cascade", "Palisade", "Vanguard", "Bastion", "Parapet", "Sentinel",
  "Redoubt", "Barbican", "Bulwark", "Stockade", "Turret", "Battlement",
  "Portcullis", "Moat", "Drawbridge", "Garrison", "Fortress",
  "Pavilion", "Arbor", "Trellis", "Pergola", "Portico", "Colonnade",
  "Atrium", "Rotunda", "Cupola", "Lantern", "Pediment", "Cornice",
  "Frieze", "Plinth", "Pilaster", "Baluster", "Finial", "Crocket",
  "Spire", "Belfry", "Clerestory", "Triforium", "Narthex", "Apse",
  "Transept", "Chancel", "Sacristy", "Vestibule", "Foyer", "Loggia",
  "Mezzanine", "Belvedere", "Solarium", "Conservatory", "Orangery",
  "Grotto", "Folly", "Gazebo", "Topiary",
  "Parterre", "Bosquet", "Quincunx", "Labyrinth", "Espalier",
  "Pleached", "Weeping", "Understory", "Glade", "Copse",
];

// At module init — dedup, preserve first occurrence:
const ANCHOR_POOL = [...new Set(ANCHOR_POOL_RAW)];
// ANCHOR_POOL.length must be verified > 0 at startup; if empty, extension must throw on load
```

**Uniqueness invariant**: Anchors assigned to a file window are unique within that window. No cycling. A file larger than `ANCHOR_POOL.length` requires multiple `dirac_read` calls with `offset` pagination — the pool size is the hard maximum per window.

---

## Module-Level State

```typescript
// Persists for the lifetime of the extension (one oil session)
const anchorState = new Map<string, AnchorEntry[]>();
// key: absolute file path
// value: array of AnchorEntry, sorted by lineIndex ascending
```

---

## `~/.oil/mcp.json` Change

Remove `"tilth_edit"` from the `directTools` array:

```json
{
  "mcpServers": {
    "tilth": {
      "command": "npx",
      "args": ["tilth", "--mcp", "--edit"],
      "lifecycle": "lazy",
      "directTools": ["tilth_search", "tilth_read", "tilth_files", "tilth_deps", "tilth_diff"]
    }
  }
}
```

(was: `["tilth_search", "tilth_read", "tilth_files", "tilth_deps", "tilth_diff", "tilth_edit"]`)

---
<!-- Previous contracts below — preserved for reference -->

# Contracts: Oil Walking Skeleton (previous)

## Scope Decision
- Skill invocation in Pi: `/skill:enhance`, `/skill:bugfix`, etc. (Option C — accepted difference from CC's `/feature-collab:enhance`)
- Skill content is identical between Pi and CC; only the prefix differs

---

## Files to Create

### 1. `/Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab/package.json`
Declares the feature-collab plugin directory as a Pi-installable package.

```json
{
  "name": "feature-collab",
  "version": "1.0.0",
  "description": "feature-collab skills for Pi coding agent",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"]
  }
}
```

### 2. `~/.oil/agent/extensions/beads.ts`
Runs `bd prime` at session start and injects output as steering context.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    const result = await pi.exec("bd", ["prime"], { signal: ctx.signal, timeout: 5000 });
    if (result.code === 0 && result.stdout.trim()) {
      pi.sendMessage(
        { customType: "beads-prime", content: result.stdout, display: true },
        { deliverAs: "steer" }
      );
    }
  });
}
```

### 3. `~/.oil/agent/extensions/lm-studio.ts`
Registers LM Studio as an OpenAI-compatible provider. Silently skips if LM Studio is not running.

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default async function (pi: ExtensionAPI) {
  try {
    const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return;
    const { data } = await res.json();
    pi.registerProvider("lm-studio", {
      baseUrl: "http://localhost:1234/v1",
      apiKey: "lm-studio",
      api: "openai-completions",
      models: data.map((m: { id: string }) => ({
        id: m.id,
        name: m.id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 4096,
      })),
    });
  } catch {
    // LM Studio not running — skip silently
  }
}
```

### 4. `~/.oil/agent/auth.json`
API keys as env var references (Pi resolves them from the environment at runtime).

```json
{
  "anthropic": { "type": "api_key", "key": "ANTHROPIC_API_KEY" },
  "openai":    { "type": "api_key", "key": "OPENAI_API_KEY" }
}
```

### 5. Shell function `oil` (added to `~/.zshrc` or `~/.zshrc.local`)
Isolated config dir so `oil` doesn't share settings with any other `pi` usage.

```zsh
function oil() {
  PI_CODING_AGENT_DIR="${HOME}/.oil" pi "$@"
}
```

---

## Provider Usage

| Intent | Command |
|--------|---------|
| Anthropic (default) | `oil` |
| OpenAI / Codex sub | `oil --provider openai --model gpt-4o` |
| LM Studio / Qwen (when running) | `oil --provider lm-studio --model <model-id>` |

---

## Verification Steps (integration, not unit tests)

1. `which pi` exits 0 (Pi is installed)
2. `source ~/.zshrc && which oil` or `type oil` confirms function exists
3. `oil --version` exits 0
4. `PI_CODING_AGENT_DIR=~/.oil pi --list-skills 2>&1 | grep enhance` finds the skill
5. `oil` launches → `bd prime` output appears in session context
6. `oil --provider openai --model gpt-4o` connects when `OPENAI_API_KEY` is set
7. With LM Studio running: `oil --provider lm-studio` shows Qwen model

---

## Install Sequence (run by implementation agent)

```bash
# 0. Ensure pi is installed
npm install -g @mariozechner/pi-coding-agent

# 1. Create oil config directory
mkdir -p ~/.oil/agent/extensions

# 2. Write config files (auth.json, extensions)
# [done by implementation agent]

# 3. Install feature-collab skills into oil
PI_CODING_AGENT_DIR=~/.oil pi install \
  /Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab

# 4. Add oil function to shell (if not already present)
# [done by implementation agent, idempotent]

# 5. Reload shell and verify
source ~/.zshrc && oil --version
```
