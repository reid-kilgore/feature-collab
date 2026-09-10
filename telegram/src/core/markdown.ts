// Markdown -> Telegram HTML subset. Telegram's HTML parse mode supports a small tag set:
// <b>, <i>, <code>, <pre>, <a href="">. Everything else must be escaped.
//
// Supported Markdown: **bold** / __bold__, *italic* / _italic_, `code`, ```pre``` blocks,
// [text](url) links, and "- " / "* " list items rendered as bullet lines.

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Token {
  type: "text" | "pre";
  content: string;
}

function splitPreBlocks(input: string): Token[] {
  const tokens: Token[] = [];
  const re = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: "text", content: input.slice(lastIndex, match.index) });
    tokens.push({ type: "pre", content: match[1] ?? "" });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < input.length) tokens.push({ type: "text", content: input.slice(lastIndex) });
  return tokens;
}

function renderInline(text: string): string {
  // Escape first, then reintroduce tags for recognized inline markers. We work on the
  // escaped string so literal &/</> in the source never become part of a tag.
  let escaped = escapeHtml(text);

  // Links: [text](url) - do this before bold/italic so link text isn't re-mangled.
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|tg:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    return `<a href="${url}">${label}</a>`;
  });

  // Inline code: `code`
  escaped = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`);

  // Bold: **text** or __text__
  escaped = escaped.replace(/\*\*([^\n]+?)\*\*/g, (_m, inner: string) => `<b>${inner}</b>`);
  escaped = escaped.replace(/__([^\n]+?)__/g, (_m, inner: string) => `<b>${inner}</b>`);

  // Italic: *text* or _text_ (single, not adjacent to a word char to avoid snake_case)
  escaped = escaped.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, (_m, inner: string) => `<i>${inner}</i>`);
  escaped = escaped.replace(/(?<![_\w])_([^_\n]+?)_(?!_)/g, (_m, inner: string) => `<i>${inner}</i>`);

  return escaped;
}

function renderLine(line: string): string {
  const listMatch = /^\s*[-*]\s+(.*)$/.exec(line);
  if (listMatch) return `• ${renderInline(listMatch[1] ?? "")}`;
  return renderInline(line);
}

export function markdownToTelegramHtml(input: string): string {
  const tokens = splitPreBlocks(input);
  const parts = tokens.map((token) => {
    if (token.type === "pre") return `<pre>${escapeHtml(token.content)}</pre>`;
    return token.content
      .split("\n")
      .map(renderLine)
      .join("\n");
  });
  return parts.join("");
}

// Telegram HTML message limit is 4096 characters. Split on paragraph (blank-line)
// boundaries where possible, falling back to hard splits for a single huge paragraph.
export function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const paragraphs = text.split(/\n\n/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
    } else {
      // A single paragraph longer than the limit: hard-split it.
      let rest = paragraph;
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current = rest;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
