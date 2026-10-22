# Telegram for your Claude: setup guide

## Note to Claude (read this first)

A person who is not a programmer pasted this file to you. They want a private Telegram bot on their own
account, so that you and other Claude sessions can message them, ask them quick questions, and start new
work when they text the bot from their phone.

How to work with them:

- Do the steps in order. After each step, check that it worked before you go on.
- Steps marked **PERSON** need them to tap or type something. Say exactly what to do, in one or two short
  sentences, and wait.
- **Never ask the person to paste the bot token into this chat, and never print it.** The token goes into
  the `tg setup` prompt in their own terminal. If they paste it into the chat by mistake, tell them to
  revoke it with BotFather (`/revoke`) and make a new one.
- Ask before you run anything that changes the system: a launchd job, a symlink, a config file.
- This bot is theirs alone. It must be a new bot made for them. Never reuse a token or a chat id from
  anyone else.
- Work in the person's home folder and the repository you clone. Do not touch anything else.

You need: macOS, Node 26 or newer (`node --version`), git, and Claude Code. The dispatcher in Part 4 also
needs `tmux` (`brew install tmux`).

---

## What you are setting up

- `tg send "text"`: a Claude session sends the person a message.
- `tg ask`: a session asks a question and waits. The person answers with buttons on their phone.
- `tg recv`: a session waits for the person's next message and treats it as an instruction.
- **The dispatcher** (Part 4): one dedicated Claude session. When the person texts the bot something new,
  it decides where the message should go and sends it there, for example into a new Claude session that
  starts work in a project folder. The dispatcher only routes. It never does the work itself.
- **The Tailscale watch** (Part 5, optional): sends the person the login link when Tailscale SSH between
  two of their computers needs approval again.

All of it runs on the person's own computer. The only outside service is Telegram.

---

## Part 1. Create the bot

1. **PERSON:** open Telegram and start a chat with **@BotFather** (the official bot with a blue tick).
2. **PERSON:** send `/newbot`. BotFather asks for two things:
   - A display name, for example `My Claude`. Anything is fine.
   - A username. It must be unique and end in `bot`, for example `jane_claude_bot`.
3. BotFather replies with a long token that looks like `123456789:AA…`. **PERSON:** keep that message
   open. Do not copy it into the chat with you. You will use it in Part 2.
4. **PERSON:** open the new bot (BotFather gives a link like `t.me/jane_claude_bot`) and press **Start**.

Check: the person can see their bot in Telegram. That is all for now.

---

## Part 2. Install the tool

Run these yourself, in a folder the person chooses (for example `~/tools`):

```
git clone <repo-url>      # the person who sent you this file gave you the address
cd <repo>/telegram
npm install
npm link
```

`npm link` puts the `tg` command on the PATH. Check: `tg doctor` runs and says the token and config are
not set yet. That is expected.

Now the token. **PERSON:** in their own terminal (in Claude Code, typing `! tg setup` runs it in the
session), run:

```
tg setup
```

It asks for the token. **PERSON:** paste it there and press Enter. Then it says "Send any message to your
bot now". **PERSON:** send the bot a message, for example `hello`, within 5 minutes.

`tg setup` then:

- stores the token in the macOS Keychain, never in a file;
- finds the person's chat and user id from that message, and writes `~/.config/agent-telegram/config.json`
  with the bot username and the two ids;
- installs and loads a launchd job so the background daemon starts at login and restarts if it stops;
- sends a hello message to the phone.

Check, in this order:

1. The phone shows "agent-telegram set up".
2. `tg doctor` shows the token present, the config present, and `daemon: alive`.
3. `tg send "Test from Claude"` arrives on the phone starting with that text. If you ran it inside tmux, a small italic line with the tmux window name follows it; that is normal.

If step 2 fails, look at `~/.local/state/agent-telegram/daemon.log` (the token is hidden in it) and
`launchctl list | grep agent-telegram`.

To restart the daemon after an update, find the job name with `launchctl list | grep agent-telegram` and run
`launchctl kickstart -k gui/$(id -u)/<that name>`. Wait until `daemon started` is the last line of the
daemon log before you run other `tg` commands: it takes up to about 20 seconds.

---

## Part 3. Link the skills

A skill is a short instruction file that tells Claude when and how to use a tool. Link both:

```
mkdir -p ~/.claude/skills
ln -s <repo>/telegram/skill ~/.claude/skills/telegram
ln -s <repo>/telegram/skill/dispatcher ~/.claude/skills/telegram-dispatcher
```

The first, `telegram`, is for every Claude session: when to send a message, when to ask a question, and how
to write for a phone screen. The second, `telegram-dispatcher`, is read only by the dispatcher session in
Part 4.

Check: `ls ~/.claude/skills/telegram/SKILL.md ~/.claude/skills/telegram-dispatcher/SKILL.md` finds both files.

---

## Part 4. The dispatcher

Skip this part if the person only wants notifications and questions.

The idea: the person texts the bot. One dedicated Claude session, the dispatcher, reads it, picks a target
from a list the person controls, and hands the message over. The person gets a short reply under their
message saying where it went.

### 4.1 Write the config

```
cp <repo>/telegram/examples/dispatcher.example.json ~/.config/agent-telegram/dispatcher.json
chmod 600 ~/.config/agent-telegram/dispatcher.json
```

Open it and set these. Show the person the result before you save.

- `"enabled"`: set **false** for now. It stays false until the test in 4.3 works.
- `session.claudeBin`: the full path of `claude` (run `which claude`). A tmux window does not read the
  person's shell profile, so a bare `claude` is often not found.
- `session.cwd`: a **new, empty folder** only for the dispatcher, for example `~/dispatcher-home`. Create it.
  Do not use the home folder: Claude asks once whether to trust the folder, and you do not want to trust
  everything.
- `session.name`: optional. A fixed name such as `TG-DISPATCHER` so other sessions can find it.
- `defaultTarget`: the name of the target to use when nothing else fits.
- `targets`: the places a message can go. Start with two:
  - `notes`: appends the message to a file. Set the file path in `argv`. This is the safe default.
  - `new-session`: starts a new Claude session. Set `allowedCwds` to the exact project folders it may start
    in, and nothing else. This target starts an agent from a text message, so keep the list short.
    Leave this target out if the person does not want that yet.

Each target has a `description` written for the dispatcher: one sentence on when to use it. Write them
clearly; the dispatcher reads them to decide.

A message is passed to a target on standard input, never as part of a command line. A target cannot be made
to run something else by what the message says.

Check: `tg doctor` prints `dispatcher: disabled` and no warnings. Fix any warning it names.

### 4.2 Start the dispatcher

```
tg dispatcher start
```

This opens a tmux window with a Claude session called the dispatcher. The first time, Claude asks "Do you
trust this folder?" for the dedicated folder. **PERSON:** attach to see it (`tmux attach -t main`, or the
session named in `session.tmuxSession`, then switch to the window `tg-dispatcher`) and choose **Yes, I trust this folder**. Detach with Ctrl-b then d.

Check: `tg status` shows `a session is listening on dispatcher`.

### 4.3 Test it before it is live

While `enabled` is false, real messages from the phone keep the old routing, but you can try the whole loop:

```
tg dispatcher trial "Test: note that the dispatcher works"
```

Within about 30 seconds the phone gets a message naming the target the dispatcher chose. Check the target did
its job, for example the line is in the notes file. Then set `"enabled": true` in `dispatcher.json`. No
restart is needed.

Now **PERSON:** text the bot a real message. A 👀 on it means the dispatcher has it. A reply under your
message says where it went. A 🫡 means it was handed off.

### 4.4 If something is off

- `tg status` shows the dispatcher state. `tg inquiries list` shows every message the person sent and what
  became of it. `tg inquiries list --open` shows what has not been routed yet.
- If the dispatcher is not listening, the person gets one notice and messages wait in the queue. Nothing
  is lost. `tg dispatcher start` brings it back.
- `tg inquiries revive <id>` puts an old message back in the dispatcher's queue.

---

## Part 5. Optional: Tailscale approval links

Only for a person who connects two of their own computers with Tailscale SSH. Every so often Tailscale asks
for a fresh approval in a browser. Without this, a command that needs it just sits waiting, and the person
does not know why.

1. Find the `ssh` names of the other computer (in `~/.ssh/config`, the `Host` lines). Say it is `laptop2`.
2. Write `~/.config/agent-telegram/tailscale.json` (mode 600):

```
{ "version": 1, "local": "laptop1", "hosts": ["laptop2"],
  "reverse": [{ "via": "laptop2", "target": "laptop1" }],
  "interval": "10m", "reminder": "1h" }
```

`hosts` are probed from this computer. `reverse` asks the other computer to probe back, which works while
the first direction does. `local` is how this computer is named in messages. No restart is needed.

Check: within a few minutes nothing arrives if all is well. When an approval lapses, the phone gets one
message with an **Approve** button, and a "works again" message after the person approves. Delete the file
to switch it off.

---

## Part 6. What to use it for

Put the paragraph at the end of this part into the person's global instructions (`~/.claude/CLAUDE.md`) so
every session behaves this way. These are the uses.

### 6.1 Text an idea, start a new Claude session

The person is away from the desk. They text: "Look into why the sign-up page is slow, in the website
folder." The dispatcher picks the `new-session` target with the website folder, and a new Claude session
starts there with that message as its first instruction. The phone gets: "Started a Claude session in
`website`." The person can follow it in tmux, and the session reports back with `tg send` when it has
something to say.

The same works for product work: "Draft a one-page spec for the export feature in the docs folder."

A new session is an ordinary Claude session. It uses the person's own default model and permission mode,
the same as when they start `claude` themselves, and it opens as a new window in the same tmux session as
the dispatcher (or in the session named by `session.tmuxSession`). It asks before risky steps only if their
settings make it ask. In an automatic mode it will not ask at all; in a stricter mode it waits for an answer
inside its tmux window, where nobody may be looking. **Help the person choose a permission mode on purpose**
before they rely on this, and tell them how to watch the windows (`tmux attach`). If a session needs a
decision it can ask on the phone with `tg ask`.

**Required, once for each allowed folder:** open `claude` in that folder yourself and answer "Yes, I trust this
folder". The dispatcher cannot answer that question. Without it a new session in that folder stops at the
trust question and never starts working.

### 6.2 A session needs a Tailscale approval

A command is waiting on a Tailscale login. The session sends the link:

```
tg send "**Tailscale needs approval** for laptop1 to laptop2.
Approve: <the https://login.tailscale.com/... link from the command output>"
```

The person taps the link on the phone, approves, and the command goes on. (The Part 5 watch does this
without a session.)

### 6.3 A session needs an SSO device code

Cloud logins often print a link and a short code, and then wait. For example:

```
aws sso login --use-device-code --no-browser
```

The session runs it, copies the link and the code from the output, and sends both in one message:

```
tg send "**AWS login needs you**
Open: <link>
Code: \`ABCD-EFGH\`
I will carry on when you finish."
```

The code goes in backticks so it is easy to copy. Then it waits for the command to finish. The same pattern
works for any "open this link and enter this code" login (`gh auth login`, `gcloud auth login --no-browser`).

### 6.4 Milestones and failures

```
tg send --level success --title "Deploy finished" "**211 tests passed** in 4m 12s"
tg send --level error --title "Build broke" "3 type errors in \`src/api/index.ts\`"
```

An `error` or `warning` message starts with ❌ or ⚠️. Others start with the text itself.

### 6.5 A quick decision

When the person is away and a choice matters, the session asks and waits:

```
tg ask --json '{"version":1,"questions":[{"id":"go","prompt":"Delete the 12 stale branches?","type":"single","required":true,"options":[{"value":"yes","label":"Yes"},{"value":"no","label":"No"}]}]}'
```

The question shows with buttons on the phone. The answer comes back to the session as JSON.

### 6.6 Paste this into `~/.claude/CLAUDE.md`

```
## Telegram

This computer has `tg`. It sends me messages on my phone and asks me questions.

- Use `tg send` for milestones, failures, and anything that needs my attention.
- When a command waits for me to open a link (a Tailscale approval, an SSO or device-code login),
  send me the link, and the code if there is one, with `tg send`, then wait for the command.
- When a decision matters and I might be away, use `tg ask` with buttons.
- Write for a phone: the answer in one short line first, then one fact per line, bold only the key
  number or label, ids and paths in `code`, no tables. Read the telegram skill for details.
- Never put a password, a token, or a secret in a message.
```

---

## Part 7. Safety, and how to turn it off

What protects the person:

- **One chat only.** Setup records the person's own chat and user id. Telegram messages from anyone else
  are ignored and logged. The bot never replies to them.
- **The token stays in the Keychain**, not in a file and not in any message. If it leaks, open BotFather,
  send `/revoke`, pick the bot, and run `tg setup` again with the new token.
- **Messages are not end-to-end encrypted.** They pass through Telegram's servers. Never put a password, an
  API key, a one-time code that grants access, or customer data in a message. Login codes for device
  logins (Part 6.3) are short-lived and only work with the matching login in progress, but do not send
  anything longer-lived.
- **Anyone who can use the person's Telegram account can use the bot.** Turn on Telegram's two-step
  verification and a phone lock. If this matters to the person, leave out the `new-session` target.
- **The dispatcher is limited by its config.** It can only run the targets listed in `dispatcher.json`,
  and `new-session` only in the listed folders. The dispatcher session is told to use only `tg` commands
  and is pre-approved for only those. It is a normal Claude session, not a sandbox, so keep its folder
  empty and the target list short.

How to turn it off, from the smallest step to the largest:

1. Stop routing to the dispatcher, at once, no restart: set `"enabled": false` in `dispatcher.json`.
   Messages then go back to the old routing.
2. Close the dispatcher session: `tg dispatcher stop`.
3. Remove the dispatcher: delete `~/.config/agent-telegram/dispatcher.json`.
4. Stop the Tailscale watch: delete `tailscale.json`.
5. Stop the whole daemon: `launchctl unload ~/Library/LaunchAgents/<job name>.plist`
   (the name comes from `launchctl list | grep agent-telegram`).
6. Remove the bot: in BotFather, `/deletebot`.

---

## Appendix. Commands at a glance

| Command | What it does |
|---|---|
| `tg send "text"` | send a message (`--title`, `--level`, `--image file.png`) |
| `tg ask --json '…'` | ask a question with buttons and wait for the answer |
| `tg recv --wait` | wait for the person's next message |
| `tg status` | daemon, queue and dispatcher state |
| `tg doctor` | checks the setup and says what is wrong |
| `tg dispatcher start`, `stop`, `trial "text"` | run, close, or try the dispatcher |
| `tg inquiries list --open` | messages not yet routed |
| `tg quarantine --stale-channels --dry-run` | list old unread messages on dead channels |

To update later: `git pull` in the repository, then restart the daemon as in Part 2.
