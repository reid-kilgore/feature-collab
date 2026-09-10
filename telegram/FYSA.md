# FYSA — agent-telegram

## Goal
A laptop-local `tg` CLI plus a Claude/Codex skill so an agent can send Reid messages, images, and
files over Telegram and ask Reid blocking structured questions (same contract as `ask-questions`).
Spec: `/Users/reid/dev/fun_claude/telegram/DESIGN.md`.

## Work plan
1. Token and account setup (BotFather token → Keychain, discover chat id). **Needs Reid.**
2. Implement CLI + daemon + Telegram adapter + tests (Sonnet implementer, running).
3. Real-Telegram smoke test: `tg send`, `tg ask` single/multi/text from the phone.
4. Install: `npm link`, launchd, `~/.claude/skills/telegram` symlink, Codex AGENTS snippet.
5. Commit (haiku commit agent).

## You are here
Working on REDD-mason: bot @qedd_mason_bot, token in Keychain, chat id in
`~/.config/agent-telegram/config.json`, daemon under launchd (`com.reid.agent-telegram`).
Real smoke passed first-hand: `tg send` (text, image), `tg ask` (single, Other, multi-select, typed
reply), `tg recv --wait` (phone → agent), multi-agent channel routing (reply-to → sender channel, plain → listener). Skill symlinked into `~/.claude/skills/telegram` and
`~/.codex/skills/telegram`. Both forecast-patching tmux windows were told to use `tg` (done).
All implementation done (migration, SIGTERM fix, channel routing). Gates green: typecheck clean,
38 tests pass. Daemon restarted under launchd on the final code. Commit is being made by a Haiku agent.
Deferred: second laptop sharing; tmux push (wave 2).

## Actions needed from Reid now
| Action | Where |
|---|---|
| Nothing right now. | |

## Standing instructions from Reid (accepted 2026-09-10)
- Check in every 5 minutes while work is running.
- Every time a real Telegram test message is sent to Reid's phone, also send a Claude app push notification.
