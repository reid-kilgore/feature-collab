# Contracts: Oil Walking Skeleton

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
