// The reactions the bot sets on Reid's messages, and the list Telegram accepts.
//
// setMessageReaction fails for any emoji outside this fixed list (Bot API, ReactionTypeEmoji,
// copied 2026-10-22), and api.ts swallows that failure. 📥 was never on the list, so a message
// that nobody was listening for got no feedback. test/reactions.test.ts keeps every emoji the
// code uses inside the list.

export const ALLOWED_REACTIONS: ReadonlySet<string> = new Set(
  "❤ 👍 👎 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡 🥱 🥴 😍 🐳 ❤‍🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 💋 🖕 😈 😴 😭 🤓 👻 👨‍💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿 🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷‍♂ 🤷 🤷‍♀ 😡".split(" "),
);

// A listener has the message now.
export const REACTION_DELIVERED = "👀";
// Recorded and queued; nobody is listening yet.
export const REACTION_QUEUED = "✍";
// Handed to its target (used by the dispatcher, not yet by the daemon).
export const REACTION_HANDED_OFF = "🫡";
