#!/bin/sh
# UserPromptSubmit hook: Reid's next typed pane turn clears "away".
#
# Reads the hook JSON on stdin. Does nothing, quickly, unless the recorded presence is "away".
# Skips prompts that are not Reid typing (messages injected by other agents or by maestro start
# with a tag or bracket) and a record set under GRACE seconds ago (the turn that set it).
# Never blocks the prompt: always exits 0 and prints nothing on stdout.
#
# Install after review, in ~/.claude/settings.json:
#   "hooks": { "UserPromptSubmit": [ { "hooks": [ { "type": "command",
#       "command": "/path/to/telegram/hooks/presence-clear.sh" } ] } ] }
# Without the hook, an away record still lapses at its expiry (default 8 hours).

FILE="${MAESTRO_PRESENCE_FILE:-$HOME/.maestro/presence.json}"
GRACE="${PRESENCE_CLEAR_GRACE_SECONDS:-30}"
TG="${PRESENCE_TG:-tg}"

[ -f "$FILE" ] || exit 0
grep -q '"state": *"away"' "$FILE" 2>/dev/null || exit 0

INPUT=$(cat)
case "$INPUT" in
  *'"prompt":"<'*|*'"prompt": "<'*|*'"prompt":"['*|*'"prompt": "['*) exit 0 ;;
esac

SET_AT=$(sed -n 's/.*"setAt": *"\([^"]*\)".*/\1/p' "$FILE" | head -1)
if [ -n "$SET_AT" ]; then
  SET_EPOCH=$(date -j -u -f '%Y-%m-%dT%H:%M:%S' "${SET_AT%.*}" +%s 2>/dev/null || date -u -d "$SET_AT" +%s 2>/dev/null)
  NOW=$(date -u +%s)
  if [ -n "$SET_EPOCH" ] && [ $((NOW - SET_EPOCH)) -lt "$GRACE" ]; then exit 0; fi
fi

"$TG" presence present --by "hook:UserPromptSubmit" >/dev/null 2>&1
exit 0
