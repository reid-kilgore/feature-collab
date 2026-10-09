# agent-telegram

A laptop-local tool that lets a coding agent (Claude Code, Codex, any shell) send Reid
messages, images, and files over Telegram, and ask him blocking structured questions that
he answers from his phone. See `DESIGN.md` for the full design.

## Install

```
npm install
npm link
```

This puts `tg` on your `PATH`. Requires Node >= 26 (native TypeScript execution,
`node:sqlite`). No runtime dependencies.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Run `tg setup` (interactive: pastes the token, stores it in the macOS Keychain) or
   `tg setup --token <token>` (non-interactive: also works over ssh onto a second
   laptop). Send the bot any message when prompted so it can discover your chat id.
3. `tg setup` installs and loads a launchd agent so the daemon survives reboots. The CLI
   also auto-starts the daemon on demand, so this step is a convenience, not a requirement.

Each laptop needs its own bot and its own `tg setup`, because Telegram allows only one
`getUpdates` consumer per bot. Nothing in config or state is shared between machines.

## Use

```
tg send "Build finished"
tg send --level error --title "Tests failing" "3 failures in src/api"
tg send --image ./screenshot.png "Before/after"

tg ask --json '{"version":1,"questions":[{"id":"go","prompt":"Deploy now?","type":"single","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}]}'

tg recv --wait --timeout 4h     # block for Reid's next message; text is his instruction to you
```

`tg ask` documents must be `{id, title, markdown}` or `{id, title, path}`:

```
tg ask --json '{"version":1,"questions":[{"id":"ok","prompt":"Ship it?","type":"single","options":[{"value":"y","label":"Yes"},{"value":"n","label":"No"}]}],"documents":[{"id":"plan","title":"Plan","markdown":"```mermaid\ngraph TD; A-->B\n```"},{"id":"shot","title":"After","path":"after.png"}]}'
```

Pictures are sent as photos, not files: an image `path` (png/jpg/jpeg/gif/webp), markdown
images (`![alt](rel.png)`) in a document, and every mermaid or svg fence (in a document or
in `message`). Fences are rendered to PNG with a headless Chromium found at `$TG_CHROMIUM`
or the newest `~/Library/Caches/ms-playwright/chromium*` install on the machine running the
daemon (mermaid is loaded from the pinned jsdelivr CDN, so it needs network). If rendering
fails, the fence source is sent as a code block and the daemon logs a warning.

`tg ask` prints exactly the `ask-questions` result shape to stdout. See `skill/SKILL.md`
for the full agent-facing contract, including timeouts, defaults, and conversation mode
(`tg send` / `tg recv --wait` loop).

Other commands: `tg status`, `tg pending`, `tg cancel <id|all>`, `tg wait <id>`,
`tg doctor`, `tg daemon` (foreground, what launchd runs).

## Skill

Symlink `skill/` into `~/.claude/skills/telegram` so Claude Code picks it up, and/or paste
`skill/AGENTS-snippet.md` into a Codex `AGENTS.md`.

```
ln -s "$(pwd)/skill" ~/.claude/skills/telegram
```

## Development

```
npm test         # node:test, no network - a fake Bot API server stands in for Telegram
npm run typecheck
```

Tests never touch the real Keychain, `~/.config`, or launchd: set `AGENT_TELEGRAM_HOME` to
redirect all paths into a temp directory (token storage moves to a plain file under it
instead of the Keychain) and `TELEGRAM_API_BASE` to point at a local fake Bot API server.
