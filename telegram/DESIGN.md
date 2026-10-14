# agent-telegram — design

A laptop-local tool that lets a coding agent (Claude Code, Codex, anything with a shell)
send Reid messages, images, and files over Telegram, and ask Reid structured questions
that block the agent until Reid answers on his phone.

## Intents (extracted from the original brief, with taste corrections)

1. Agent → Reid: text, Markdown, images/screenshots, files, with a level (info/success/warning/error).
2. Reid → agent: single-choice, multi-choice, yes/no, free text, batches of questions, cancel, timeout.
3. The interaction model is transport-neutral. Telegram is the first transport. A second transport
   must render the same payload without changing the agent-facing contract.
4. Security: only Reid's Telegram user/chat can drive it. Secrets never in the repo. Incoming text is
   data, never commands. Stale/duplicate button presses are harmless.
5. Durable: a question survives daemon restarts; a question is resolved exactly once; there is an audit trail.
6. Easy setup and a skill so an LLM knows when and how to use it.

Taste corrections to the brief:

- **Do not invent a new `AskUserEvent` schema.** The `ask-questions` CLI already on this machine has a
  proven payload/result contract (`ask-questions --help`). The agent-facing contract of this tool is
  that same contract, version 1, plus two optional fields. An agent that knows `ask-questions` knows
  `tg ask`. Swapping "ask in browser" for "ask on phone" is a one-word change.
- **The CLI boundary is the agent API.** "Emit event, pause, resume" is simply a blocking process that
  prints one JSON value on stdout. No in-process event bus, no `UserInteractionTransport` interface for
  the agent to import. Works identically for Claude, Codex, and shell scripts.
- **No webhook. A Mini App since 2026-10-14.** Long polling from a daemon stays the only way updates
  arrive: a webhook would silence `getUpdates`, so none is registered. Reid decided on 2026-10-14
  (typed approval in the tooling pane, layout A) to add a Telegram Mini App that lists the open
  `tg ask` batches and answers them on one page; see "Mini App" below. It is optional and off
  unless configured. The chat flow (inline keyboards + ForceReply) is unchanged and remains the
  fallback.

## Runtime and dependencies

- Node ≥ 26 (installed: v26.8.1). TypeScript run natively (`node src/x.ts`, erasable syntax only:
  no enums, no parameter properties, no `namespace`). `node:sqlite` for storage. `fetch` for Telegram.
- **Zero runtime dependencies.** Tests with `node:test`. Typecheck with `tsc --noEmit` (dev dep only).
- Installed like `ask-questions`: `npm link` puts `tg` on PATH.

## Layout

```
telegram/
  package.json              name agent-telegram, "bin": {"tg": "./bin/tg.js"}, type module
  bin/tg.js                 shebang, imports ../src/cli/main.ts
  src/
    contract/
      payload.ts            AskPayload / AskResult types + validate(payload) (mirrors ask-questions v1)
      notify.ts             Notification type
    core/
      store.ts              SQLite schema + repository (questions, answers, audit, updates seen)
      interaction.ts        transport-neutral state machine for one question batch
      answers.ts            applies a whole page of Mini App answers through interaction.ts
      chat-move.ts          "Open in chat": reposts a live question as a reply, retires the old copy
      markdown.ts           Markdown → Telegram HTML subset (bold/italic/code/pre/links/lists→bullets)
    miniapp/
      server.ts             loopback HTTP server inside the daemon: page shell + /api routes
      initdata.ts           Telegram initData validation (HMAC, max age, allowed user)
      views.ts              what the page may see: open batches only
      page.ts, web/         static page shell (index.html, app.js, app.css), no data in it
    transports/telegram/
      api.ts                thin Bot API client over fetch (sendMessage, editMessageText, sendPhoto,
                            sendDocument, answerCallbackQuery, getUpdates, getMe)
      render.ts             AskPayload question → {text, reply_markup}; resolved view; notification view
      handler.ts            Telegram Update → interaction transitions (callbacks, replies, commands)
      poller.ts             getUpdates loop with offset persistence, backoff, 409 handling
    daemon/
      server.ts             unix socket, newline-delimited JSON request/response; owns poller + store
      protocol.ts           request/response types shared with CLI
    cli/
      main.ts               tg <command> parsing
      setup.ts              tg setup
      client.ts             socket client; auto-starts daemon if socket dead (spawn detached)
    config.ts               paths, config file, secret lookup
  skill/
    SKILL.md                for ~/.claude/skills/telegram (symlink)
    AGENTS-snippet.md       paragraph to paste into a Codex AGENTS.md
  launchd/
    com.reid.agent-telegram.plist.template
  test/                     node:test files
  README.md
  DESIGN.md (this file)
```

## Agent-facing contract

### `tg ask`

```
tg ask --file q.json | --json '...' | (stdin)   [--timeout 4h] [--on-timeout cancel|default]
```

Payload: exactly the `ask-questions` v1 schema (`version`, `title?`, `message?`, `questions[]`,
`documents?`), extended with optional top-level `timeoutSeconds` and `onTimeout` ("cancel" | "default")
and optional per-question `default` (option value, or array for multiple). `documents` are accepted and
sent as a `.md` file attachment before the questions (Telegram has no side panel). Pictures go as photos: image `path` documents, markdown images, and mermaid/svg fences (rendered to PNG by headless Chromium in the daemon, `src/transports/telegram/diagram-render.ts`; source sent as a code block plus a stderr warning if rendering fails).

Result on stdout: exactly the `ask-questions` result shape.

```
{"version":1,"status":"submitted","askerPath":"/abs/cwd","answers":{"id":{"value":..., "notes":""}},"annotations":{},"submittedAt":"ISO"}
{"version":1,"status":"cancelled","askerPath":"/abs/cwd","answers":{},"annotations":{}}
{"version":1,"status":"expired","askerPath":"/abs/cwd","answers":{...defaults if onTimeout=default...},"annotations":{}}
```

`askerPath` from cwd; `askerTmuxWindow` best-effort like ask-questions. Exit codes: 0 submitted,
2 cancelled/expired/Ctrl-C, 1 invalid input or daemon error. `notes` is always `""` from Telegram.
Multiple-choice values are arrays; single-choice is a string (or the free-text string when Other used);
text is a string. An unanswered optional question has value `null`.

Blocking: the CLI blocks for hours. Ctrl-C cancels the question on Telegram too (message edited).

### `tg send`

```
tg send "text"                                    plain/Markdown text, level info
tg send --level success|warning|error|info --title "Done" "body"
tg send --image path.png ["caption"]              sendPhoto (falls back to sendDocument if >10MB or not an image)
tg send --file path ["caption"]                    sendDocument
tg send -                                          body from stdin
```

Level prefixes: ℹ️ / ✅ / ⚠️ / ❌. Title bold on its own line. Body Markdown → Telegram HTML; on a
Telegram parse error, retry as plain text (never fail a notification because of formatting).
Messages >4096 chars are split on paragraph boundaries. Exit 0 on delivery.

### `tg status`, `tg pending`, `tg cancel <id>`, `tg daemon`, `tg setup`, `tg doctor`

- `status`: daemon alive, bot username, allowed user, pending count, last update age.
- `pending`: list pending questions (id, title, age, askerPath).
- `cancel <id|all>`: cancel from the laptop side.
- `daemon`: run the daemon in the foreground (what launchd runs). `--no-launchd` docs.
- `setup`: interactive: token → Keychain (`security add-generic-password -U -s agent-telegram -a bot-token`),
  `getMe` to verify, `getUpdates` to discover the chat/user that messaged the bot, write
  `~/.config/agent-telegram/config.json` `{ "chatId": "...", "userId": "...", "botUsername": "..." }`,
  install and load the launchd plist, send a hello message. Flags: `--token X` and `--chat-id`
  for non-interactive use. Idempotent.
- `doctor`: checks each of the above and prints what is wrong.

## Secrets and config

- Token: `TELEGRAM_BOT_TOKEN` env var if set, else Keychain `security find-generic-password -s agent-telegram -a bot-token -w`.
  Never logged. Error messages redact anything matching `\d+:[A-Za-z0-9_-]{30,}`.
- Config: `~/.config/agent-telegram/config.json` (chatId, userId, botUsername). Overridable by
  `AGENT_TELEGRAM_HOME` (used by tests).
- State: `~/.local/state/agent-telegram/state.sqlite`, socket at `~/.local/state/agent-telegram/daemon.sock`,
  daemon log at `~/.local/state/agent-telegram/daemon.log`.

## Daemon

One daemon per laptop because Telegram allows one `getUpdates` consumer per bot. The CLI connects to
the unix socket; if the connection fails it spawns `tg daemon` detached and retries for ~3 s (so the tool
works even without launchd). launchd (`KeepAlive`, `RunAtLoad`) is the recommended supervisor and is
installed by `tg setup`. A daemon acquires an exclusive lock file; a second daemon exits immediately.

Socket protocol: newline-delimited JSON. Requests: `{op:"notify", ...}`, `{op:"ask", payload, askerPath,
askerTmuxWindow, timeoutSeconds, onTimeout}` → replies `{id}` then, later, `{result}` on the same connection
when resolved (connection stays open; the CLI blocks on it). If the CLI disconnects before resolution the
question is cancelled on Telegram (edited to "cancelled by agent"). `{op:"status"}`, `{op:"pending"}`,
`{op:"cancel", id}`. Include a `{op:"wait", id}` so a restarted CLI can re-attach to a pending question
(print the id on stderr when asking, so an agent can recover after its own timeout).

## Mini App (added 2026-10-14)

Layout A of the approved design: a list of open question sets (newest first; title, asking
session, "N of M answered", age, deadline, progress bar, "read at" time) and a set screen with one
card per question (radio cards for single choice, checkboxes for multiple choice, "Other, or a
note" when `allowOther` is set, a skip control only where the chat flow shows Skip, `(Recommended)`
labels shown as a RECOMMENDED tag) and a sticky "Send N answers" button. Added later (2026-10-14,
same day, Reid's decision in the tooling pane): the header "…" menu (Open in chat, Copy set title,
Cancel this set), a per-question "In chat" link, and a long press on a list card (Answer here, Open
in chat, Cancel this set). See "Open in chat" below.

**Where it runs.** In the daemon process, because only the daemon can resolve a waiting `tg ask`
caller. It is isolated: it starts only when `config.json` has a `miniapp` block, it binds
127.0.0.1 only, a bad block or a busy port is logged and the daemon carries on without it, and no
error in a request handler escapes (it becomes a bare 500). A separate process talking to the unix
socket was considered and rejected for now: it would need new daemon requests for list, detail and
batch submit, and a second place to get the lock right, for no gain while the HTTP code has no
shared mutable state with the poller beyond the store it already uses.

**The lock.** The page is reached over Tailscale Funnel (public HTTPS), so Telegram initData is
the only lock. Every `/api` request carries it in the `x-telegram-init-data` header. The server
recomputes the HMAC-SHA256 (secret = HMAC_SHA256("WebAppData", bot token)) over the sorted
fields, compares in constant time, rejects repeated fields, requires `auth_date` no older than
`maxAgeSeconds` (default 3600; Telegram issues fresh initData on every open, so an hour covers a
sitting while limiting replay of a leaked value) and no more than 60 seconds in the future, and
requires the signed `user.id` to equal the configured user id. Anything else is a bare 401. The
URL also starts with a random path segment (`miniapp.secret`), which only keeps scanners out; it is
not relied on. The page shell is public and holds no data. The data API returns open batches only
and never the bot token, chat ids, or message ids.

**Answers and conflicts.** A submit goes through `core/answers.ts`, which calls the same
`applyAnswerSingle`, `applyAnswerText`, `applyContinueMultiple` and `applySkip` the chat buttons
use, so the asker resolves once and chat messages are edited as usual. Everything is validated
before anything changes. A question already answered, skipped, cancelled or expired (for example
answered in chat while the page was open) gets a per-question `conflict` result and is not touched;
a malformed answer gets `invalid`; the others go through. Questions not yet sent to chat are
answered without ever being sent. If a submit leaves some questions unanswered, chat continues with
the first of them. A question marked live for a submit that then fails is put back to waiting.
Submits for one batch run one at a time. `advanceOrFinish` no longer sends the next chat question
while a chat message is still live, or finishes the batch while any question is live; for the chat
flow, which keeps one question live, nothing changes.

**Open in chat, and Cancel.** Telegram has no link to one message in a private chat, so "Open in
chat" is a repost, not a jump. The page calls `POST /api/batches/:id/chat` (optionally with a
`questionId`) and then `Telegram.WebApp.close()`; `core/chat-move.ts` sends the question again as a
reply to its original message (`reply_parameters`, still sent if the original was deleted), with
live buttons and any options already ticked. The old copy has to stop taking answers, so: the new
message id is stored and the move is written to the audit trail (`question_moved`) before the old
message is edited; the old message becomes "moved to the message below" with no buttons; and
`handleCallback` refuses any tap on a message recorded as moved, so the old buttons are dead even if
the edit failed or was slow. A question answered while the new message was being sent is a conflict
and the new message is deleted. Moves, submits and cancels for one batch run one at a time.

For the whole set, the chat flow shows one question at a time, so "Open in chat" reposts the
question that is live in chat now, and the rest follow in order once it is answered, exactly as
before (if nothing is live yet, the next waiting question is sent). For one question that has not
been shown yet, it is sent now, ahead of its turn; `advanceOrFinish` then holds the next question
back only for a live question that comes before it, so the questions skipped over still appear. A
choice question whose "Other" prompt was open starts again from its buttons. Answers typed in the
page but not sent stay in the page's draft, not in the store.

`POST /api/batches/:id/cancel` goes through `cancelBatch`. The page asks to confirm, and the server
refuses without `{"confirm": true}`. Both routes need the same initData as every other route.

**Config** (hand-set in `config.json`; `tg setup` keeps it): `miniapp.port` (local port),
`miniapp.secret` (16+ chars of letters, digits, `_`, `-`), `miniapp.publicUrl` (the Funnel https
origin), optional `miniapp.maxAgeSeconds` (60 to 86400). When it is running the daemon sets the
chat menu button to open the app (`setChatMenuButton`), adds `/open` to the command menu, and
`/open` replies with a button that opens it. The page loads Telegram's `telegram-web-app.js` from
telegram.org; there are still no runtime dependencies (`node:http`, `node:crypto` only).

## Telegram rendering

One Telegram message per question, sent sequentially: question N is sent only after question N-1 is
resolved. A batch with `title`/`message` first sends a header message (`📋 <b>title</b>` + rendered
message). Each question message: `<b>Q2/3 — prompt</b>` then option descriptions as `• <b>label</b> — desc`.

- **single**: one inline button per option (one per row; label truncated to 40 chars). Tap = submit.
  If `allowOther` (default true): `✍️ Other…` button. Always `✖ Cancel batch` button. Optional questions
  (`required:false`) also get `⏭ Skip`.
- **multiple**: toggle buttons `☐ label` / `☑ label`, two per row when labels are short (≤16 chars),
  then `✔ Continue`, `✍️ Other…`, `⏭ Skip` (if optional), `✖ Cancel batch`. Continue with zero selections
  on a required question → `answerCallbackQuery` alert "Select at least one option". Other on multiple
  = free text appended as an extra selected value.
- **text**: message sent with `ForceReply` (`selective: true`); user replies to it. Also inline `⏭ Skip`
  (if optional) and `✖ Cancel batch`. ForceReply and inline keyboard cannot share one message, so send
  the prompt with inline keyboard, and a second short message `Reply to this message with your answer.`
  with ForceReply. Track both message ids.
- **Other…**: same second-message ForceReply flow, state → `awaiting_text`. A reply that is not a
  `reply_to_message` to the tracked prompt is ignored with a hint ("Reply to the question message.")
  when a question is pending, otherwise ignored silently.
- **Defaults**: `default` pre-selects toggles (multiple) or marks `label ★` (single). Used on
  `onTimeout: "default"`.
- **Resolved edit**: after any resolution edit the question message to
  `✅ <b>prompt</b>\n<i>answer text</i>` (or `⏭ skipped`, `✖ cancelled`, `⏰ expired`) and remove the
  keyboard. ForceReply helper message is deleted.
- **Batch done**: after the last question, send `✅ Answers sent to the agent (askerPath basename, tmux window)`.
- **callback_data**: `q:<shortId>:t:<optIdx>` toggle, `q:<shortId>:s:<optIdx>` select, `q:<shortId>:go`,
  `q:<shortId>:other`, `q:<shortId>:skip`, `q:<shortId>:x`. `shortId` = 10-char random per question,
  stored in DB. Always ≤ 64 bytes. Every callback gets `answerCallbackQuery` immediately.
- **Stale buttons**: callback for a non-pending question → answerCallbackQuery "This question is already
  resolved" and, best-effort, edit that message to its resolved view.
- **Commands**: `/status` (pending questions + daemon uptime), `/pending` (re-send the current pending
  question so it is at the bottom of the chat), `/cancel` (cancel the oldest pending batch, confirm with a
  button), `/help`. Anything else from the allowed user that is not a reply to a tracked prompt gets one
  short hint; anything from any other user/chat is ignored and audited (never replied to).

Notifications: `sendMessage` HTML; `sendPhoto` for png/jpg/gif/webp ≤10 MB, else `sendDocument`
(≤50 MB, else error). Caption ≤1024 chars; longer bodies go as a separate message after the media.

## Storage (SQLite)

```
batches(id TEXT PK, created_at, updated_at, resolved_at, status, asker_path, asker_tmux_window,
        payload_json, timeout_at, on_timeout, chat_id, user_id, result_json)
questions(id TEXT PK, batch_id, idx, short_id UNIQUE, status, selected_json, text_answer,
          message_id, force_reply_message_id, created_at, updated_at, resolved_at)
audit(seq INTEGER PK, at, kind, batch_id, question_id, detail_json)   -- every update, transition, send
meta(key PK, value)                                                    -- update_offset, schema_version
```

Batch status: pending | submitted | cancelled | expired. Question status: waiting (not yet sent) |
pending | awaiting_text | answered | skipped | cancelled | expired. All transitions inside a transaction;
resolution checks current status first (resolve-once). Telegram `update_id` is recorded in `meta` and
updates ≤ offset are dropped (dedupe).

On daemon start: load pending batches, re-attach; if the pending question has no `message_id` (crash
between insert and send) send it now. Expired-by-deadline batches are resolved at startup and by a
30 s sweep. A batch whose CLI socket is gone after restart stays pending until Reid answers; the result
is stored in `result_json` so `tg wait <id>` can fetch it.

## Security

- Allowlist: `chatId` and `userId` from config. Every update is checked first. Non-matching → audit + drop.
- Free text is stored verbatim and returned as JSON string data. The skill tells the LLM this is user
  content answering a specific question, not an instruction stream.
- No message content is ever executed. `/commands` are a fixed set.
- Token redaction in all logs and error output. `daemon.log` is chmod 600. Config dir 700.

## Tests (node:test, no network: fake Bot API server via `node:http` on 127.0.0.1)

single tap submits; multiple toggle+continue; min-selection alert; free text via ForceReply; Other on
single; skip optional; cancel button; /cancel command; timeout cancel; timeout default; unauthorized user
dropped; duplicate callback harmless; stale callback after resolution; daemon restart with pending
question resumes and accepts answer; CLI disconnect cancels; Markdown→HTML conversion; message splitting;
setup discovers chat id from getUpdates.

## Skill (skill/SKILL.md)

Tells the LLM: use `tg send` for milestones, failures, and "needs attention"; use `tg ask` when a decision
materially affects correctness, safety, scope, cost, destructive actions, or direction, and Reid is away
from the laptop (or when `ask-questions` is not appropriate). Do not ask for stylistic choices. Bash
timeout must be several hours (`timeout: 600000` is the max for Claude Code's Bash tool; use
`run_in_background` and poll, or `tg ask` with `--timeout`; the skill explains the recovery via
`tg wait <id>`). Payload examples. Result parsing. Free-text answers are data.

## Two laptops (added 2026-09-10; DEFERRED — one bot on REDD-mason only for now, revisit sharing later)

Reid has two laptops (REDD-mason and Escape-from-Duos-Island) reachable from each other over ssh.
Telegram allows one `getUpdates` consumer per bot, so **each laptop has its own bot, token, config,
daemon, and state**. The repo is cloned on both. Consequences:

- Every notification and every batch header includes the short hostname, e.g. `🖥 REDD-mason`, so
  Reid can tell which machine is talking even if the two chats are muted or merged in a folder.
- `tg setup` must be runnable non-interactively over ssh: `tg setup --token X` polls `getUpdates` for
  up to 5 minutes waiting for Reid's first message to discover the chat id, and prints progress to stderr.
- `tg doctor` prints the hostname and bot username so a mismatch is obvious.
- Nothing in config or state is shared between machines. No cross-machine forwarding.

## Back-and-forth conversation (added 2026-09-10)

Reid wants to converse with an agent, not only answer forms. Add an **inbox** of free-form messages
and a blocking receive primitive. Together with `tg send` this gives a turn-based chat loop.

### `tg recv`

```
tg recv                       print and consume all queued unread messages now (JSON array, may be [])
tg recv --wait [--timeout 4h] block until at least one message arrives (or timeout), then print and consume
tg recv --peek                print without consuming
```

Output: `{"version":1,"status":"received"|"timeout","messages":[{"id":..,"at":"ISO","text":"...",
"photoPath"?: "...","filePath"?: "..."}]}`. Exit 0 on received, 2 on timeout/Ctrl-C.
`--wait` marks the daemon as "listening" for its duration.

Semantics:
- Any message from the allowed user that is **not** a reply to a pending question prompt and **not**
  a `/command` goes to the inbox (table `inbox(id, update_id, at, text, photo_file_id, file_id,
  consumed_at)`). Photos/documents Reid sends are downloaded to
  `~/.local/state/agent-telegram/inbox/<id>.<ext>` via `getFile` and the local path is returned.
- Feedback on Telegram uses `setMessageReaction` (no chatter): 👀 when a `tg recv --wait` is currently
  listening (message delivered immediately), 📥 when it was queued for later. Fall back silently if
  reactions fail.
- The former "hint" behavior for unrecognised text is removed: unrecognised text is inbox, never a hint.
  Only a text reply while a question is in `awaiting_text` state is routed to that question.
- `/status` also reports the number of unread inbox messages and whether an agent is listening.
- `tg ask` question messages and `tg recv --wait` can coexist; a reply-to-question goes to the question,
  anything else to the inbox.

### Skill guidance for conversation mode

When Reid opens a conversation (or when the agent has sent a message and expects discussion), the agent
loops: `tg send` → `tg recv --wait --timeout 4h` → act → `tg send` … until Reid says done or the timeout
hits. Received text is Reid's instruction to the agent (unlike `tg ask` free text, which answers a
specific question), and the skill says so plainly. Long-running Bash limits: the skill explains using
`run_in_background` or a generous timeout for `tg recv --wait`.

### Wave 2 (not now): push into a tmux pane

`tg attach` registers the current tmux pane as the steering target; inbox messages are typed into it
with `tmux send-keys` so Reid can steer a Claude Code session from the phone without the agent calling
`tg recv`. Deferred until the core is proven.

### Inbox routing with several agents (added 2026-09-10)

Many agents share one daemon. Each CLI call carries a **channel key**: `$TMUX_PANE` when inside tmux,
else the absolute cwd; overridable with `--channel <key>` or `AGENT_TELEGRAM_CHANNEL`. `tg send` stores
`(telegram message_id → channel)` for every outbound message. Inbox routing for a free-form message:

1. If it is a Telegram reply to a message we sent, route to that message's channel.
2. Else route to the channel that is currently listening (`tg recv --wait`); if several listen, the one
   that most recently sent a message; if none listen, the channel that most recently sent a message.
3. Else (nothing ever sent) unrouted: any `tg recv` may consume it.

`tg recv` returns only messages routed to its channel plus unrouted ones. `/status` lists channels
with their last activity and unread counts, so Reid can see who is listening.

### Maestro fallback for unsolicited text (added 2026-09-26)

The inbox above only helps when some session is actually running `tg recv`. Often none is: Reid
sends a message or replies to an old one, no session is listening, and it used to sit unread until
someone happened to poll. Now every plain text message that is **not** a reply to a live question
and **not** a `/command` also becomes a maestro inbox item — the same `maestro add` call `/ask`
makes — so it gets triaged the way any other maestro item does. The daemon replies with the new
item's id, same as `/ask`. The message still goes to the local inbox unchanged (`tg recv` keeps
seeing it), so nothing that already reads that inbox breaks.

If the message is a Telegram reply to an earlier message, the maestro item quotes the first 200
characters of what it replied to, so a bare "yes, do that" still carries its context. A maestro
failure here is shown to Reid as a `⚠️` warning, never a crash and never a silently dropped
message — the same disposition `/ask` uses.

Photos and documents (no `message.text`) are unaffected: they still go to the local inbox only, as
before. A bare caption rarely stands on its own in the maestro recent-items list the way a full
text message does, so this fallback is text-only.
