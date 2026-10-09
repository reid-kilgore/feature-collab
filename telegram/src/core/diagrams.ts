// Pure helpers for the picture parts of a markdown message: diagram fences
// (```mermaid / ```svg) and markdown image references (![alt](relative.png)).

export type DiagramKind = "mermaid" | "svg";

export interface Diagram {
  kind: DiagramKind;
  source: string;
}

export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

export function isImagePath(p: string): boolean {
  const lower = p.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const FENCE_RE = /^```(mermaid|svg)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;

// Pulls every mermaid and svg fence out of the markdown. Each fence is replaced in the
// returned text by a "[diagram N]" line so the text still reads in order.
export function extractDiagrams(markdown: string): { text: string; diagrams: Diagram[] } {
  const diagrams: Diagram[] = [];
  const text = markdown.replace(FENCE_RE, (_match, kind: string, source: string) => {
    diagrams.push({ kind: kind as DiagramKind, source: source.replace(/\n$/, "") });
    return `[diagram ${diagrams.length}]`;
  });
  return { text, diagrams };
}

// Relative image references in markdown, in order. Remote (scheme:) and data: references
// and references inside code fences are ignored.
export function extractMarkdownImageRefs(markdown: string): string[] {
  const withoutFences = markdown.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");
  const refs: string[] = [];
  const re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutFences)) !== null) {
    const ref = match[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) continue;
    refs.push(decodeURIComponent(ref));
  }
  return refs;
}
