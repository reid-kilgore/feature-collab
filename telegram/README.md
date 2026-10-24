# agent-telegram

A laptop-local tool that lets a coding agent (Claude Code, Codex, any shell) send you
messages, images, and files over Telegram, and ask you blocking structured questions that
you answer from your phone. See `DESIGN.md` for the full design.

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
tg send --button "Review page=https://example.com/review/7" "Ready for review"
tg send "Report: [the report](https://example.com/report)"   # a lone link becomes a button too; --no-button stops that

tg ask --json '{"version":1,"questions":[{"id":"go","prompt":"Deploy now?","type":"single","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}]}'

tg recv --wait --timeout 4h     # block for the user's next message; the text is their instruction to you
```

A link can also sit under a message as a tappable button. `--button "label=url"` adds one (repeat it for
more; each is its own row). With no `--button`, a message whose text holds exactly one http(s) link
(a bare address or a `[label](url)` link, counting a repeated address once) gets that link as a button,
named after the link's label or `Open <host>`; the link stays in the text. `--no-button` turns the
automatic button off. Only http and https links are buttons. If Telegram refuses a button (it does for
an IP address or localhost), the message is sent again without buttons and the refusal is logged.
A `tg ask` batch whose `message` holds one link gets the same button on its header message, which
carries no answer keyboard.

A message starts with its content: no header line. `warning` and `error` put one ⚠️ or ❌ at
the start of the first line. A small italic last line says who sent it: the sender's tmux address
(`session:window`, for example `ship:geo`) whenever it runs inside tmux. Outside tmux it is the
channel's name, and only when you pass `--title` or `--channel`. A caller that reaches this machine
over ssh has no tmux here, so it passes its own address: `ssh host "tg send --from ship:geo 'text'"`
(or the environment variable `AGENT_TELEGRAM_FROM`); get it with `tmux display-message -p '#S:#W'`.
`tg ask` shows the same address as the last line of its header and in the "Answers sent to the agent" footer; it takes `--from` and `AGENT_TELEGRAM_FROM` the same way. The address must be SESSION:WINDOW (it must contain a colon); a bare name is refused with exit 2. `tg ask` needs a sender address: with none of `--from`, `AGENT_TELEGRAM_FROM` or a tmux window it prints one line and exits 2, without asking anything.

`tg ask --key KEY` (or a top-level `"key"` in the payload) tags a question with a decision key. When the answer is recorded some other way, `tg cancel --key KEY` cancels every pending question with that key and prints `{"cancelled":[ids]}` (exit 0, also when none match). `tg pending` shows each question's sender and key; `tg pending --json` prints one entry per pending question set with `id`, `title`, `key`, `sender` and `created_at`.

A question left open for over an hour is swept. The daemon cancels one that names no sender by itself (one notice to you, one audit row). For one with a sender, the dispatcher session is handed a nudge for the asking session ("is this still needed? cancel it if not"); once it sends it, that question is left alone for three hours. If the asking session cannot be reached, the dispatcher cancels the question and tells you once.

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

`tg ask` prints one JSON result to stdout. See `skill/SKILL.md`
for the full agent-facing contract, including timeouts, defaults, and conversation mode
(`tg send` / `tg recv --wait` loop).

Other commands: `tg status`, `tg pending [--json]`, `tg cancel <id|all>`, `tg cancel --key KEY`, `tg wait <id>`,
`tg doctor`, `tg daemon` (foreground, what launchd runs).

## Dispatcher: one session that listens for your bare messages

By default a plain message you send the bot goes to whichever coding session last sent you
something. With a dispatcher, it goes to one dedicated session that decides where the work
should go and tells you. The dispatcher never does the work itself: it can only run the
targets you list.

1. Copy `examples/dispatcher.example.json` to `~/.config/agent-telegram/dispatcher.json`.
   Set `targets` (each one is a command that reads your message on standard input, or the
   built-in `claude-session` that starts a new session in an allowed directory) and
   `defaultTarget`. Everything else has a default.
2. Link the skill: `ln -s "$(pwd)/skill/dispatcher" ~/.claude/skills/telegram-dispatcher`.
   A tmux window does not read your shell profile, so if `claude` lives in a directory only
   your profile adds to PATH (for example `~/.local/bin`), set `session.claudeBin` to its full path.
3. `tg doctor` checks the file. `tg dispatcher start` opens a tmux window running a Claude
   session as the dispatcher; `tg dispatcher stop` closes it.
   While `"enabled"` is false the session commands still run but real messages keep their old
   routing, so you can try the whole loop first: `tg dispatcher trial "hello"` puts a synthetic
   message in the dispatcher's queue.
4. Set `"enabled": true` and send the bot a message. A 👀 reaction means the dispatcher has it, ✍ means it is queued
   because the dispatcher is not listening (you also get one notice per outage), and 🫡 means
   it was handed off. The acknowledgement is a reply under your message.

Unread messages left on channels nobody is listening on (for example an old tmux pane id) can
reach a new session that gets the same id. `tg quarantine --stale-channels --older 1d --dry-run`
lists them by channel; without `--dry-run` it moves them into the log as `legacy`. The
dispatcher's own queue is never touched.

Every message is kept in `~/.local/state/agent-telegram/inquiries.jsonl`. `tg inquiries list
--open` shows what has not been routed, and `tg inquiries revive <id>` puts one back in the
dispatcher's queue. Removing `dispatcher.json`, or setting `"enabled": false`, restores the
old routing at once, with no restart. Details: `DESIGN-dispatcher.md`.

## Tailscale re-approval watch

If your laptops reach each other over Tailscale SSH, an approval lapses now and then and ssh waits for a
login link. Create `~/.config/agent-telegram/tailscale.json` and the daemon probes on a timer and sends you the
link with an Approve button, once, then tells you when it works again:

```
{ "version": 1, "local": "laptop1", "hosts": ["laptop2"],
  "reverse": [{ "via": "laptop2", "target": "laptop1" }], "interval": "2m", "reminder": "1h" }
```

`hosts` are ssh aliases probed from this machine. `reverse` probes the way back by asking the other machine to
run the probe, which works while the first direction does. Delete the file to switch it off; no restart needed.

The probe runs every 2 minutes by default (`interval`). Every probe and every state change is written to `daemon.log` with its time, and `tg status` shows the last probe time and result for each direction, so a silent watch can be told from a watch that never ran. A probe that prints nothing and does not finish is killed, and after two in a row you get one message.

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
