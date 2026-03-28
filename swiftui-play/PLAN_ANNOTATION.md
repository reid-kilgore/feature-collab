# Feature: In-App PLAN.md Annotation

## What It Does

An "Annotate" button on the Plan tab that switches from read-only markdown preview to an interactive annotation editor — the same CriticMarkup workflow as mdannotate but embedded directly in the app. Select text → highlight or comment → save back to the file.

When done annotating, the modified PLAN.md (with CriticMarkup `{==highlights==}` and `{>>comments<<}`) is written back to disk. Claude Code picks up the annotations on its next read.

## How mdannotate Works Today

The web app at `~/dev/fun_claude/web/` is:
- A Vite-bundled vanilla JS SPA (no React, no external editor library)
- The "editor" is a raw `<textarea>` with overlaid syntax highlighting
- Annotations work by reading `textarea.selectionStart/selectionEnd` on mouseup, then doing string surgery on `textarea.value`
- A floating toolbar pops up above the selection with "Highlight" and "Comment" buttons
- Preview pane renders markdown with CriticMarkup highlights using the same `renderMarkdown()` function we already embed

## Implementation: Embed in WKWebView

### Why WKWebView (not native SwiftUI)

The annotation UI (floating toolbar on text selection, textarea with syntax overlay, CriticMarkup parsing) is already built and tested in JS. Reimplementing in SwiftUI would be weeks of work. WKWebView gives us the exact same UX for ~50 lines of Swift glue.

### Build Step (one-time)

```bash
cd ~/dev/fun_claude/web
npm run build
# Produces dist/index.html, dist/assets/index-*.js, dist/assets/index-*.css
```

### Loading the Editor

Two options for getting the built assets into the app:

**Option A: Load from filesystem**
```swift
let distURL = URL(fileURLWithPath: "/Users/reid/dev/fun_claude/web/dist/index.html")
let distDir = distURL.deletingLastPathComponent()
webView.loadFileURL(distURL, allowingReadAccessTo: distDir)
```
Pros: Always up to date with web app changes. No copy step.
Cons: Hardcoded path. Breaks if web app moves.

**Option B: Bundle dist/ into the .app**
Copy `dist/` into `WipViewer.app/Contents/Resources/` and load via bundle path.
Pros: Self-contained.
Cons: Must rebuild and re-copy when web app changes.

**Recommended: Option A** for local development. The path is stable and we're the only user.

### Injecting Content

Instead of the URL-hash encoding that mdannotate uses (gzip + base64), inject the PLAN.md content directly after the page loads:

```swift
// After webView finishes loading:
let escaped = planContent.escapedForJS()
webView.evaluateJavaScript("""
    document.getElementById('editor').value = `\(escaped)`;
    window.mdannotate.updatePreview();
""")
```

### Getting Content Back

Use `WKScriptMessageHandler` for a "Done" button:

```swift
// Swift side:
webView.configuration.userContentController.add(handler, name: "annotationDone")

// JS side (injected):
window.webkit.messageHandlers.annotationDone.postMessage(
    document.getElementById('editor').value
);
```

The handler receives the raw CriticMarkup markdown string. Write it back to the PLAN.md file path.

### UI Injections

Inject a `WKUserScript` on page load that:
1. **Adds a "Done" button** that sends content back via the message handler
2. **Hides irrelevant buttons**: "Copy for CLI", "Share URL", file upload — these are for the standalone web app
3. **Hides the file-open UI** — content comes from the app, not from user drag-and-drop

```javascript
// Injected userScript:
// Hide standalone-app UI
document.querySelector('.file-actions')?.style.display = 'none';
// Add Done button
const btn = document.createElement('button');
btn.textContent = 'Done';
btn.onclick = () => {
    window.webkit.messageHandlers.annotationDone.postMessage(
        document.getElementById('editor').value
    );
};
document.querySelector('.toolbar-actions')?.appendChild(btn);
```

### Clipboard Workaround

`navigator.clipboard.writeText()` is restricted in WKWebView. Since the "Copy for CLI" button isn't needed (we write directly to disk), just hide it. If clipboard is needed for anything else, bridge it:

```javascript
navigator.clipboard.writeText = (text) => {
    window.webkit.messageHandlers.clipboard.postMessage(text);
    return Promise.resolve();
};
```

### Plan Tab Flow

Current state:
```
[Notes] [Plan]
         ↓
   Read-only markdown preview (MarkdownWebView)
```

New state:
```
[Notes] [Plan]
         ↓
   Read-only markdown preview (MarkdownWebView)
   [Annotate] button in top-right corner
         ↓ (click)
   Full mdannotate editor in WKWebView (replaces preview)
   [Done] button saves and returns to preview
```

The toggle between preview and editor is a `@State private var isAnnotating: Bool` in `PlanView`.

### File Watching (nice-to-have)

After saving annotations, the preview should reflect the changes. Since `PlanView.loadPlan()` reads from disk and we write back to disk, just re-call `loadPlan()` after the Done handler fires.

For live reload while annotating in the web editor: not needed. The editor IS the source of truth while open.

## Edge Cases

- **No PLAN.md**: Annotate button hidden (nothing to annotate)
- **Web app not built**: Show error "Run `npm run build` in ~/dev/fun_claude/web/ first"
- **File permissions**: PLAN.md is in a git worktree we own — always writable
- **Concurrent edits**: If Claude writes to PLAN.md while you're annotating, your save will overwrite. Acceptable for single-user local tool.
- **Large PLAN.md**: The textarea handles multi-thousand-line files fine (it's just a textarea, not a rich editor)

## Dependencies

- mdannotate web app built: `~/dev/fun_claude/web/dist/index.html` must exist
- WebKit framework (already imported)
- No new Swift dependencies
