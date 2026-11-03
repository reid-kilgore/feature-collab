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

export interface InlineOptions {
  // False when the text will sit inside a bold element already (a question prompt): bold markers are removed
  // and their text kept, so the HTML never nests one bold in another.
  bold?: boolean;
  // False inside a link label, where a bare URL must not become a second link.
  autolink?: boolean;
}

// Characters that may not appear in a URL we turn into a link: space, quotes, angle brackets, backtick.
// The text is already escaped, so a "<" is "&lt;": a URL stops there too.
const URL_CHARS = "(?:(?!&lt;|&gt;)[^\\s\"'`\\u0000])+";
const LINK = new RegExp(`\\[([^\\]\\n]+)\\]\\((https?:\\/\\/${URL_CHARS})\\)`, "g");
const BARE_URL = new RegExp(`https?:\\/\\/${URL_CHARS}`, "g");

// Splits trailing sentence punctuation off a bare URL, and a closing bracket the URL does not open.
function trimUrl(url: string): { url: string; rest: string } {
  let end = url.length;
  for (;;) {
    const last = url[end - 1];
    if (last && ".,:!?".includes(last)) end--;
    else if (last === ")" && (url.slice(0, end).match(/\(/g)?.length ?? 0) < (url.slice(0, end).match(/\)/g)?.length ?? 0)) end--;
    else break;
  }
  return { url: url.slice(0, end), rest: url.slice(end) };
}

// Inline Markdown to Telegram's HTML subset. Escape first, then add only the tags produced here, so nothing
// the author writes can add a tag or an attribute. Code spans and links are set aside while the rest is
// converted, so a URL's underscores or a code span's asterisks are never read as formatting.
export function markdownInline(text: string, options: InlineOptions = {}): string {
  const wantBold = options.bold !== false;
  const stash: string[] = [];
  const put = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
  let out = escapeHtml(text);

  // Inline code: `code`
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => put(`<code>${code}</code>`));
  // Links: [label](https://url). The label may carry bold or italics. Only http and https.
  out = out.replace(LINK, (_m, label: string, url: string) => put(`<a href="${url}">${markdownInline(label, { ...options, autolink: false })}</a>`));
  // Bare URLs.
  if (options.autolink !== false) out = out.replace(BARE_URL, (match) => {
    const { url, rest } = trimUrl(match);
    return `${put(`<a href="${url}">${url}</a>`)}${rest}`;
  });
  // Bold: **text** or __text__
  const boldOpen = wantBold ? "<b>" : "";
  const boldClose = wantBold ? "</b>" : "";
  out = out.replace(/\*\*([^\n]+?)\*\*/g, (_m, inner: string) => `${boldOpen}${inner}${boldClose}`);
  out = out.replace(/__([^\n]+?)__/g, (_m, inner: string) => `${boldOpen}${inner}${boldClose}`);
  // Italic: *text* or _text_ (single, not adjacent to a word char to avoid snake_case)
  out = out.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\*)/g, (_m, inner: string) => `<i>${inner}</i>`);
  out = out.replace(/(?<![_\w])_([^_\n]+?)_(?!_)/g, (_m, inner: string) => `<i>${inner}</i>`);

  // Put the set-aside pieces back; a piece can hold the placeholder of an earlier one.
  let guard = 0;
  while (/\u0000\d+\u0000/.test(out) && guard++ < 8) out = out.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => stash[Number(n)] ?? "");
  return out;
}

function renderLine(line: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
  if (heading) return `<b>${markdownInline(heading[1] ?? "", { bold: false })}</b>`;
  const listMatch = /^\s*[-*]\s+(.*)$/.exec(line);
  if (listMatch) return `• ${markdownInline(listMatch[1] ?? "")}`;
  return markdownInline(line);
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

// ---- nodes, for the Mini App page ----
//
// The page builds its DOM from these with createElement and textContent only, so it never parses HTML. They
// come from the very HTML the chat sends, which holds nothing but the five tags below, so the two cannot
// disagree about what a message says.

export type MdNode =
  | { t: "text"; v: string }
  | { t: "b" | "i" | "code" | "pre"; c: MdNode[] }
  | { t: "a"; href: string; c: MdNode[] };

const SAFE_HREF = /^https?:\/\/[^\s"'<>`]+$/;

function unescapeHtml(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export function htmlToNodes(html: string): MdNode[] {
  const root: MdNode[] = [];
  const stack: Array<{ tag: string; node: Exclude<MdNode, { t: "text" }> }> = [];
  const current = (): MdNode[] => (stack.length ? stack[stack.length - 1]!.node.c : root);
  const re = /<(\/?)(b|i|code|pre|a)(?: href="([^"]*)")?>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, closing, tag, rawHref, plain] = m;
    if (plain !== undefined) {
      current().push({ t: "text", v: unescapeHtml(plain) });
    } else if (!closing) {
      if (tag === "a") {
        const href = unescapeHtml(rawHref ?? "");
        if (!SAFE_HREF.test(href)) {
          // Not a link we would make ourselves: keep its text, drop the tag.
          stack.push({ tag: "a-dropped", node: { t: "b", c: current() } });
          continue;
        }
        const node: MdNode = { t: "a", href, c: [] };
        current().push(node);
        stack.push({ tag: "a", node });
      } else {
        const node: MdNode = { t: tag as "b" | "i" | "code" | "pre", c: [] };
        current().push(node);
        stack.push({ tag: tag!, node });
      }
    } else {
      const top = stack[stack.length - 1];
      if (top && (top.tag === tag || (top.tag === "a-dropped" && tag === "a"))) stack.pop();
    }
  }
  return root;
}

// A message, a prompt or a description as nodes: block Markdown (headings, lists, pre) included.
export function markdownToNodes(input: string): MdNode[] {
  return htmlToNodes(markdownToTelegramHtml(input));
}

// Room kept in each chunk for the tags that balanceTags closes at its end and opens again at the start of the next.
const TAG_RESERVE = 128;

// Telegram HTML message limit is 4096 characters. Split on paragraph (blank-line)
// boundaries where possible; a single paragraph that is too long is cut at a line break, then a space,
// and never inside a tag or an entity. A tag that is open at a cut is closed there and opened again at the
// start of the next chunk, so every chunk parses on its own and none is longer than the limit.
export function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const max = Math.max(1, limit - TAG_RESERVE);
  const paragraphs = text.split(/\n\n/);
  const pieces: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) pieces.push(current);
    current = paragraph;
  }
  if (current) pieces.push(current);
  return balanceTags(pieces.flatMap((piece) => hardSplit(piece, max)), limit);
}

// Cuts a piece into parts of at most `limit` characters: at a line break if one sits in the back half, else
// at a space, else at the limit; the cut is moved back out of a tag or entity that it would split.
function hardSplit(piece: string, max: number): string[] {
  if (piece.length <= max) return [piece];
  const parts: string[] = [];
  let rest = piece;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    const lt = rest.lastIndexOf("<", cut - 1);
    if (lt > rest.lastIndexOf(">", cut - 1) && lt > 0) cut = lt;
    const amp = rest.lastIndexOf("&", cut - 1);
    if (amp >= 0 && cut - amp <= 8 && rest.indexOf(";", amp) >= cut && amp > 0) cut = amp;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[ \n]/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

function balanceTags(chunks: string[], limit: number): string[] {
  const out: string[] = [];
  let open: string[] = []; // full opening tags, outermost first
  for (const chunk of chunks) {
    let body = open.join("") + chunk;
    const stack = [...open];
    for (const m of chunk.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
      if (m[1]) {
        const at = stack.map((t) => /^<([a-z0-9-]+)/i.exec(t)![1]!.toLowerCase()).lastIndexOf(m[2]!.toLowerCase());
        if (at >= 0) stack.length = at;
      } else {
        stack.push(m[0]);
      }
    }
    body += [...stack].reverse().map((t) => `</${/^<([a-z0-9-]+)/i.exec(t)![1]}>`).join("");
    out.push(body.length <= limit ? body : body.slice(0, limit));
    open = stack;
  }
  return out;
}
