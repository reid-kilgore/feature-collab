#!/bin/bash

# mdannotate - Markdown annotation tool using CriticMarkup
# Usage: ./mdannotate.sh <markdown-file>           # Open in hosted web editor
#        ./mdannotate.sh --local <markdown-file>   # Use local HTML (offline mode)
#        ./mdannotate.sh --decode <hash>           # Extract markdown from URL hash

set -e

# Configuration - Update this URL after deployment
HOSTED_URL="${MDANNOTATE_URL:-https://mdannotate.onrender.com}"

# Get the directory where this script lives (for local mode)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_help() {
    echo "mdannotate - Markdown annotation tool using CriticMarkup"
    echo ""
    echo "Usage:"
    echo "  mdannotate <file.md>           Open file in web annotation editor"
    echo "  mdannotate --local <file.md>   Use local HTML (offline mode)"
    echo "  mdannotate --decode <hash>     Decode a document hash to stdout"
    echo "  mdannotate --help              Show this help"
    echo ""
    echo "Workflow:"
    echo "  1. Run: mdannotate notes.md"
    echo "  2. Annotate in your browser"
    echo "  3. Click 'Copy for Terminal' in the web app"
    echo "  4. Paste the command in your terminal to save changes"
    echo ""
    echo "Environment:"
    echo "  MDANNOTATE_URL    Override the hosted URL (default: $HOSTED_URL)"
}

# URL encode function using Python - returns URL parameters
encode_to_url() {
    local file="$1"
    local filename="$2"
    python3 << PYEOF
import gzip
import base64
import sys
import urllib.parse

with open("$file", 'rb') as f:
    content = f.read()

# Compress with gzip
compressed = gzip.compress(content, compresslevel=9)

# Base64 encode (URL-safe, strip padding)
encoded = base64.urlsafe_b64encode(compressed).decode('ascii').rstrip('=')

# Check size
if len(encoded) > 32000:
    print(f"Warning: Encoded size is {len(encoded)} chars. URLs over 32KB may not work in all browsers.", file=sys.stderr)

# Build URL parameters
filename = "$filename"
url_params = "doc=" + encoded
if filename:
    url_params += "&name=" + urllib.parse.quote(filename)

print(url_params)
PYEOF
}

decode_from_url() {
    local encoded="$1"
    python3 << PYEOF
import gzip
import base64
import sys

encoded = """$encoded"""

# Strip any URL prefix
if '#doc=' in encoded:
    encoded = encoded.split('#doc=')[1]
elif 'doc=' in encoded:
    encoded = encoded.split('doc=')[1]

# Handle & separator for additional params (like &name=...)
if '&' in encoded:
    encoded = encoded.split('&')[0]

# Add padding if needed (URL-safe base64 often strips it)
padding = 4 - (len(encoded) % 4)
if padding != 4:
    encoded += '=' * padding

# URL-safe base64 decode
try:
    compressed = base64.urlsafe_b64decode(encoded)
    content = gzip.decompress(compressed)
    sys.stdout.buffer.write(content)
except Exception as e:
    print(f"Error decoding: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# Handle --help
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    show_help
    exit 0
fi

if [ -z "$1" ]; then
    show_help
    exit 1
fi

# Handle --decode explicitly
if [ "$1" = "--decode" ]; then
    if [ -z "$2" ]; then
        echo "Error: --decode requires a hash argument"
        exit 1
    fi
    decode_from_url "$2"
    exit 0
fi

# Handle --local flag (offline mode using local HTML)
LOCAL_MODE=false
if [ "$1" = "--local" ]; then
    LOCAL_MODE=true
    shift
    if [ -z "$1" ]; then
        echo "Error: --local requires a file argument"
        exit 1
    fi
fi

# Auto-detect mode from argument
ARG="$1"

# Check if it looks like a compressed hash (starts with gzip magic in base64)
if [[ "$ARG" == H4sI* ]] || [[ "$ARG" == *"#doc=H4sI"* ]]; then
    # Decode mode
    decode_from_url "$ARG"
    exit 0
fi

# Check if it's a file
if [ ! -f "$ARG" ]; then
    echo "Error: '$ARG' is not a file or valid encoded document"
    echo ""
    show_help
    exit 1
fi

INPUT_FILE="$ARG"
FILENAME=$(basename "$INPUT_FILE")

# Hosted mode (default): Open the web app with encoded document
if [ "$LOCAL_MODE" = false ]; then
    URL_PARAMS=$(encode_to_url "$INPUT_FILE" "$FILENAME")
    FULL_URL="${HOSTED_URL}/#${URL_PARAMS}"

    echo "Opening in browser..."
    echo "When done, click 'Copy for Terminal' and paste the command to save."
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$FULL_URL"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$FULL_URL" 2>/dev/null || echo "Open this URL in your browser: $FULL_URL"
    else
        echo "Open this URL in your browser: $FULL_URL"
    fi
    exit 0
fi

# Local mode: Generate HTML file locally
# Get the base name - use temp directory for HTML to avoid clutter
BASENAME=$(basename "$INPUT_FILE" .md)
TMPDIR="${TMPDIR:-/tmp}"
OUTPUT_FILE="${TMPDIR}/${BASENAME}.annotate.html"

# Read the markdown content and escape for JSON embedding
MARKDOWN_CONTENT=$(cat "$INPUT_FILE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')

# Generate the HTML file
cat > "$OUTPUT_FILE" << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Annotate: FILENAME_PLACEHOLDER</title>
    <style>
        :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f8f9fa;
            --bg-tertiary: #f0f0f0;
            --text-primary: #333333;
            --text-secondary: #666666;
            --text-muted: #999999;
            --border-color: #e0e0e0;
            --accent-color: #1a73e8;
            --accent-hover: #1557b0;
            --highlight-bg: #fff59d;
            --highlight-border: #fbc02d;
            --danger-color: #e53935;
            --success-color: #43a047;
        }

        .dark-mode {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d2d;
            --text-primary: #e0e0e0;
            --text-secondary: #a0a0a0;
            --text-muted: #707070;
            --border-color: #404040;
            --highlight-bg: #5c4d00;
            --highlight-border: #8c7000;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-secondary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            transition: background 0.2s, color 0.2s;
        }

        .header {
            background: var(--bg-primary);
            padding: 8px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            flex-shrink: 0;
            gap: 12px;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header h1 {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-primary);
        }

        .header-buttons {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .btn {
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 5px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s;
        }

        .btn:hover {
            background: var(--border-color);
        }

        .btn-primary {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }

        .btn-primary:hover {
            background: var(--accent-hover);
        }

        .btn-primary[draggable="true"] {
            cursor: grab;
        }

        .btn-primary[draggable="true"]:active {
            cursor: grabbing;
        }

        .btn-icon {
            padding: 5px 8px;
            font-size: 14px;
        }

        .btn.active {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }

        .shortcuts-hint {
            font-size: 11px;
            color: var(--text-muted);
        }

        .main-container {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        /* Source pane */
        .source-pane {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: var(--bg-primary);
            min-width: 300px;
            transition: flex 0.2s, min-width 0.2s;
        }

        .source-pane.collapsed {
            flex: 0;
            min-width: 0;
            overflow: hidden;
        }

        .pane-header {
            padding: 6px 12px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            font-size: 11px;
            font-weight: 600;
            color: var(--text-secondary);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .editor-wrapper {
            flex: 1;
            position: relative;
            overflow: hidden;
        }

        /* Line numbers */
        .line-numbers {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 40px;
            background: var(--bg-secondary);
            border-right: 1px solid var(--border-color);
            padding: 12px 0;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.6;
            color: var(--text-muted);
            text-align: right;
            overflow: hidden;
            user-select: none;
        }

        .line-numbers div {
            padding-right: 8px;
        }

        /* Syntax highlighting layer */
        .syntax-highlight {
            position: absolute;
            left: 40px;
            top: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow: auto;
            pointer-events: none;
            color: transparent;
        }

        .syntax-highlight .hl {
            background: var(--highlight-bg);
            border-radius: 2px;
        }

        .syntax-highlight .cm {
            background: rgba(26, 115, 232, 0.2);
            border-radius: 2px;
        }

        .syntax-highlight .bracket {
            color: var(--text-muted);
        }

        .source-editor {
            position: absolute;
            left: 40px;
            top: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            line-height: 1.6;
            border: none;
            resize: none;
            outline: none;
            background: transparent;
            color: var(--text-primary);
            overflow: auto;
            caret-color: var(--accent-color);
        }

        /* Preview pane */
        .preview-pane {
            flex: 1;
            min-width: 300px;
            background: var(--bg-primary);
            border-left: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            transition: flex 0.2s, min-width 0.2s;
        }

        .preview-pane.collapsed {
            flex: 0;
            min-width: 0;
            border-left: none;
            overflow: hidden;
        }

        .preview-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            font-family: 'Georgia', serif;
            font-size: 14px;
            line-height: 1.7;
        }

        .preview-content h1 { font-size: 1.8em; margin: 0.5em 0; font-weight: 600; }
        .preview-content h2 { font-size: 1.4em; margin: 0.8em 0 0.4em; font-weight: 600; color: var(--text-secondary); }
        .preview-content h3 { font-size: 1.2em; margin: 0.8em 0 0.4em; font-weight: 600; }
        .preview-content p { margin: 0.6em 0; }
        .preview-content ul, .preview-content ol { margin: 0.2em 0; padding-left: 1.2em; }
        .preview-content > ul { margin: 0.4em 0; }
        .preview-content li { margin: 0; line-height: 1.4; }
        .preview-content li > ul { margin: 0; }
        .preview-content li.task-item { list-style: none; margin-left: -1.2em; }
        .preview-content .checkbox { margin-right: 0.4em; }
        .preview-content code {
            background: var(--bg-tertiary);
            padding: 2px 5px;
            border-radius: 3px;
            font-family: 'SF Mono', monospace;
            font-size: 0.9em;
        }
        .preview-content pre {
            background: var(--bg-tertiary);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 1em 0;
        }
        .preview-content pre code {
            background: none;
            padding: 0;
        }

        /* Syntax highlighting */
        .preview-content pre .keyword { color: #d73a49; }
        .preview-content pre .type { color: #6f42c1; }
        .preview-content pre .string { color: #22863a; }
        .preview-content pre .number { color: #005cc5; }
        .preview-content pre .comment { color: #6a737d; font-style: italic; }
        .preview-content pre .punctuation { color: #24292e; }
        .preview-content pre .property { color: #005cc5; }

        .dark-mode .preview-content pre .keyword { color: #ff7b72; }
        .dark-mode .preview-content pre .type { color: #d2a8ff; }
        .dark-mode .preview-content pre .string { color: #a5d6ff; }
        .dark-mode .preview-content pre .number { color: #79c0ff; }
        .dark-mode .preview-content pre .comment { color: #8b949e; }
        .dark-mode .preview-content pre .punctuation { color: #c9d1d9; }
        .dark-mode .preview-content pre .property { color: #79c0ff; }
        .preview-content blockquote {
            border-left: 3px solid var(--border-color);
            padding-left: 12px;
            color: var(--text-secondary);
            margin: 1em 0;
        }
        .preview-content hr {
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 1.5em 0;
        }

        .preview-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
            font-size: 0.9em;
        }

        .preview-content th, .preview-content td {
            border: 1px solid var(--border-color);
            padding: 6px 10px;
            text-align: left;
        }

        .preview-content th {
            background: var(--bg-secondary);
            font-weight: 600;
        }

        .preview-content tr:nth-child(even) {
            background: var(--bg-secondary);
        }

        .preview-highlight {
            background: var(--highlight-bg);
            padding: 1px 0;
            border-radius: 2px;
            cursor: pointer;
        }

        .preview-highlight.has-comment {
            border-bottom: 2px solid var(--highlight-border);
        }

        .preview-comment-marker {
            display: inline-block;
            background: var(--accent-color);
            color: white;
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 8px;
            margin-left: 2px;
            cursor: pointer;
            font-family: sans-serif;
            vertical-align: middle;
        }

        /* Comments pane */
        .comments-pane {
            width: 280px;
            background: var(--bg-secondary);
            border-left: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            transition: width 0.2s;
        }

        .comments-pane.collapsed {
            width: 0;
            border-left: none;
            overflow: hidden;
        }

        .comments-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }

        .comment-card {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
            position: relative;
        }

        .comment-card:hover {
            border-color: var(--accent-color);
        }

        .comment-card.active {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
        }

        .comment-card .highlight-text {
            background: var(--highlight-bg);
            padding: 4px 6px;
            border-radius: 3px;
            margin-bottom: 6px;
            font-family: monospace;
            font-size: 11px;
            word-break: break-word;
            max-height: 60px;
            overflow: hidden;
        }

        .comment-card .comment-text {
            color: var(--text-primary);
            line-height: 1.4;
        }

        .comment-card .card-actions {
            margin-top: 6px;
            display: flex;
            gap: 8px;
        }

        .comment-card .card-actions button {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 11px;
            padding: 2px 4px;
        }

        .comment-card .card-actions button:hover {
            color: var(--accent-color);
        }

        .comment-card .card-actions .delete-btn:hover {
            color: var(--danger-color);
        }

        .comment-card .close-x {
            position: absolute;
            top: 6px;
            right: 6px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: var(--bg-tertiary);
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 14px;
            line-height: 18px;
            text-align: center;
            opacity: 0;
            transition: opacity 0.15s;
        }

        .comment-card:hover .close-x {
            opacity: 1;
        }

        .comment-card .close-x:hover {
            background: var(--danger-color);
            color: white;
        }

        .clear-all-btn {
            font-size: 10px;
            color: var(--text-muted);
            background: none;
            border: none;
            cursor: pointer;
            padding: 2px 6px;
        }

        .clear-all-btn:hover {
            color: var(--danger-color);
        }

        .no-comments {
            color: var(--text-muted);
            font-size: 12px;
            text-align: center;
            padding: 20px;
            line-height: 1.6;
        }

        /* Floating toolbar */
        .toolbar {
            position: fixed;
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 4px;
            display: none;
            gap: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
        }

        .toolbar.visible {
            display: flex;
        }

        .toolbar button {
            background: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .toolbar button:hover {
            background: var(--border-color);
        }

        .toolbar .shortcut {
            color: var(--text-muted);
            font-size: 10px;
            margin-left: 4px;
        }

        /* Modal */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 2000;
        }

        .modal-overlay.visible {
            display: flex;
        }

        .modal {
            background: var(--bg-primary);
            border-radius: 8px;
            padding: 20px;
            width: 420px;
            max-width: 90vw;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal h3 {
            margin-bottom: 12px;
            font-size: 15px;
            color: var(--text-primary);
        }

        .modal .selected-preview {
            background: var(--highlight-bg);
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 12px;
            font-family: monospace;
            font-size: 11px;
            max-height: 80px;
            overflow: hidden;
        }

        .modal textarea {
            width: 100%;
            height: 80px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            font-size: 13px;
            resize: vertical;
            background: var(--bg-primary);
            color: var(--text-primary);
        }

        .modal textarea:focus {
            outline: none;
            border-color: var(--accent-color);
        }

        .modal-buttons {
            margin-top: 12px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        /* Status bar */
        .status-bar {
            background: var(--bg-primary);
            padding: 4px 12px;
            font-size: 11px;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
            display: flex;
            justify-content: space-between;
            flex-shrink: 0;
        }

        .status-bar .left {
            display: flex;
            gap: 16px;
        }

        .status-modified {
            color: var(--danger-color);
        }

        .status-saved {
            color: var(--success-color);
        }

        /* Resizer */
        .resizer {
            width: 6px;
            background: transparent;
            cursor: col-resize;
            position: relative;
            flex-shrink: 0;
        }

        .resizer::after {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            left: 2px;
            width: 2px;
            background: var(--border-color);
            transition: background 0.15s;
        }

        .resizer:hover::after,
        .resizer.dragging::after {
            background: var(--accent-color);
        }

        /* Help content */
        .help-content {
            font-size: 13px;
            line-height: 1.6;
            color: var(--text-secondary);
        }

        .help-content h4 {
            color: var(--text-primary);
            margin: 16px 0 8px;
            font-size: 13px;
        }

        .help-content h4:first-child {
            margin-top: 0;
        }

        .help-content kbd {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 11px;
        }

        .help-content code {
            background: var(--bg-tertiary);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }

        .help-content ul {
            margin: 8px 0;
            padding-left: 20px;
        }

        .help-content li {
            margin: 4px 0;
        }

        /* Toast notification */
        .toast {
            position: fixed;
            bottom: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-primary);
            color: var(--text-primary);
            padding: 10px 20px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-size: 13px;
            z-index: 3000;
            opacity: 0;
            transition: opacity 0.2s;
            pointer-events: none;
        }

        .toast.visible {
            opacity: 1;
        }

    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h1>FILENAME_PLACEHOLDER</h1>
            <span class="shortcuts-hint"><kbd>⌘E</kbd> comment</span>
        </div>
        <div class="header-buttons">
            <button class="btn btn-icon" onclick="toggleDarkMode()" title="Toggle dark mode">🌓</button>
            <button class="btn active" id="sourceToggle" onclick="toggleSource()">Source</button>
            <button class="btn active" id="previewToggle" onclick="togglePreview()">Preview</button>
            <button class="btn" id="annotationsToggle" onclick="toggleAnnotations()" style="display: none;">Annotations</button>
            <button class="btn" onclick="showHelp()">Help</button>
            <button class="btn" onclick="copyShareUrl()">Share URL</button>
            <button class="btn btn-primary" id="downloadBtn" onclick="downloadFile()" draggable="true">Download</button>
        </div>
    </div>

    <div class="main-container">
        <div class="source-pane">
            <div class="pane-header">
                <span>Source</span>
            </div>
            <div class="editor-wrapper">
                <div class="line-numbers" id="lineNumbers"></div>
                <div class="syntax-highlight" id="syntaxHighlight"></div>
                <textarea class="source-editor" id="editor" spellcheck="false"></textarea>
            </div>
        </div>

        <div class="resizer" id="previewResizer"></div>
        <div class="preview-pane" id="previewPane">
            <div class="pane-header">Preview</div>
            <div class="preview-content" id="previewContent"></div>
        </div>

        <div class="resizer" id="commentsResizer"></div>
        <div class="comments-pane collapsed">
            <div class="pane-header">
                <span>Annotations <span id="commentCount"></span></span>
                <button class="clear-all-btn" id="clearAllBtn" onclick="clearAllAnnotations()" style="display: none;">Clear All</button>
            </div>
            <div class="comments-list" id="commentsList"></div>
        </div>
    </div>

    <div class="status-bar">
        <div class="left">
            <span id="status">Ready</span>
            <span id="stats"></span>
        </div>
        <span id="position">Ln 1, Col 1</span>
    </div>

    <div class="toast" id="toast"></div>

    <div class="toolbar" id="toolbar">
        <button onclick="addHighlight()">Highlight</button>
        <button onclick="addComment()">Comment<span class="shortcut">⌘E</span></button>
    </div>

    <div class="modal-overlay" id="commentModal">
        <div class="modal">
            <h3 id="modalTitle">Add Comment</h3>
            <div class="selected-preview" id="selectedPreview"></div>
            <textarea id="commentInput" placeholder="Enter your comment..."></textarea>
            <div class="modal-buttons">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" id="modalSubmit" onclick="submitComment()">Add</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="helpModal">
        <div class="modal" style="width: 480px;">
            <h3>Keyboard Shortcuts & Help</h3>
            <div class="help-content">
                <h4>Shortcuts</h4>
                <ul>
                    <li><kbd>⌘</kbd>+<kbd>E</kbd> — Add comment to selection</li>
                    <li><kbd>⌘</kbd>+<kbd>S</kbd> — Download file</li>
                    <li><kbd>Esc</kbd> — Close modals</li>
                </ul>

                <h4>How to Use</h4>
                <ul>
                    <li>Select text in the source editor</li>
                    <li>Click Highlight or Comment (or use shortcuts)</li>
                    <li>Click an annotation card to jump to that location</li>
                    <li>Edit or delete annotations from the sidebar</li>
                    <li>Drag pane borders to resize</li>
                </ul>

                <h4>Saving & Sharing</h4>
                <ul>
                    <li><strong>Download:</strong> Click or drag to Finder/Desktop</li>
                    <li><strong>Share URL:</strong> Copies a link with the full document encoded</li>
                </ul>

                <h4>Format: CriticMarkup</h4>
                <ul>
                    <li>Highlight: <code>{==text==}</code></li>
                    <li>Comment: <code>{==text==}{&gt;&gt;note&lt;&lt;}</code></li>
                </ul>
            </div>
            <div class="modal-buttons">
                <button class="btn btn-primary" onclick="closeHelp()">Done</button>
            </div>
        </div>
    </div>

    <script>
        // No localStorage for document content - allows multiple tabs
        const originalFilename = 'FILENAME_PLACEHOLDER';

        const editor = document.getElementById('editor');
        const toolbar = document.getElementById('toolbar');
        const commentsList = document.getElementById('commentsList');
        const commentModal = document.getElementById('commentModal');
        const commentInput = document.getElementById('commentInput');
        const selectedPreview = document.getElementById('selectedPreview');
        const helpModal = document.getElementById('helpModal');
        const status = document.getElementById('status');
        const stats = document.getElementById('stats');
        const position = document.getElementById('position');
        const lineNumbers = document.getElementById('lineNumbers');
        const syntaxHighlight = document.getElementById('syntaxHighlight');
        const previewPane = document.getElementById('previewPane');
        const previewContent = document.getElementById('previewContent');
        const previewToggle = document.getElementById('previewToggle');
        const commentCount = document.getElementById('commentCount');
        const modalTitle = document.getElementById('modalTitle');
        const modalSubmit = document.getElementById('modalSubmit');
        const clearAllBtn = document.getElementById('clearAllBtn');

        let isModified = false;
        let pendingStart = 0;
        let pendingEnd = 0;
        let pendingText = ''; // For preview selections
        let pendingMatchCount = 1;
        let selectionFromPreview = false;
        let editingIndex = -1; // For editing existing comments
        let activeCommentIndex = -1;
        let userHidAnnotations = false; // Track if user manually hid annotations pane
        let hadAnnotationsBefore = false; // Track if we've ever had annotations

        // Initialize
        let content = CONTENT_PLACEHOLDER;
        content = content.replace(/^<!--\nANNOTATION FORMAT:[\s\S]*?-->\n\n?/, '');
        let loadedFromUrl = false;

        // Check for document in URL hash
        async function loadFromHash() {
            const hash = window.location.hash;
            if (hash.startsWith('#doc=')) {
                const encoded = hash.substring(5);
                try {
                    // Add padding if needed
                    let padded = encoded;
                    const padding = 4 - (encoded.length % 4);
                    if (padding !== 4) {
                        padded += '='.repeat(padding);
                    }

                    // Convert URL-safe base64 to regular base64
                    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) {
                        bytes[i] = binary.charCodeAt(i);
                    }

                    // Decompress using DecompressionStream
                    const ds = new DecompressionStream('gzip');
                    const decompressed = new Response(
                        new Blob([bytes]).stream().pipeThrough(ds)
                    );
                    const text = await decompressed.text();

                    content = text.replace(/^<!--\nANNOTATION FORMAT:[\s\S]*?-->\n\n?/, '');
                    loadedFromUrl = true;
                    editor.value = content;
                    updateAll();

                    // Update title to indicate loaded from URL
                    document.querySelector('.header h1').textContent = 'Shared Document (from URL)';

                    // Clear the hash to avoid confusion on reload
                    // history.replaceState(null, '', window.location.pathname);
                } catch (e) {
                    console.error('Failed to load from URL hash:', e);
                    alert('Failed to load document from URL: ' + e.message);
                }
            }
        }

        // Try to load from URL hash first (async, will update when done)
        if (window.location.hash.startsWith('#doc=')) {
            loadFromHash();
            loadedFromUrl = true;
        }

        editor.value = content;
        updateAll();

        // If document already has annotations, mark that we've had them
        if (getAnnotations().length > 0) {
            hadAnnotationsBefore = true;
        }

        // Load dark mode preference
        if (localStorage.getItem('mdannotate_darkmode') === 'true') {
            document.body.classList.add('dark-mode');
        }

        // Event listeners
        editor.addEventListener('mouseup', handleSelection);
        editor.addEventListener('keyup', (e) => {
            if (e.shiftKey) handleSelection();
            updatePosition();
        });

        editor.addEventListener('input', () => {
            setModified();
            updateAll();
        });

        editor.addEventListener('scroll', () => {
            syntaxHighlight.scrollTop = editor.scrollTop;
            syntaxHighlight.scrollLeft = editor.scrollLeft;
            lineNumbers.style.transform = `translateY(-${editor.scrollTop}px)`;
        });

        editor.addEventListener('click', () => {
            updatePosition();
            toolbar.classList.remove('visible');
        });

        document.addEventListener('mousedown', (e) => {
            if (!toolbar.contains(e.target) && e.target !== editor && !previewContent.contains(e.target)) {
                toolbar.classList.remove('visible');
            }
        });

        document.addEventListener('keydown', (e) => {
            const isMod = e.metaKey || e.ctrlKey;

            if (e.key === 'Escape') {
                closeModal();
                closeHelp();
                toolbar.classList.remove('visible');
            }

            if (isMod && e.key === 's') {
                e.preventDefault();
                downloadFile();
            }

            if (isMod && e.key === 'e') {
                e.preventDefault();
                // Check for preview selection first
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();
                if (selectedText && previewContent.contains(selection.anchorNode)) {
                    handlePreviewSelection();
                    if (pendingStart !== pendingEnd) {
                        addComment();
                    }
                } else if (editor.selectionStart !== editor.selectionEnd) {
                    pendingStart = editor.selectionStart;
                    pendingEnd = editor.selectionEnd;
                    selectionFromPreview = false;
                    addComment();
                }
            }
        });

        commentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitComment();
            }
        });

        // Warn before closing if there are unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (isModified) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        function handleSelection() {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;

            if (start !== end) {
                const rect = editor.getBoundingClientRect();
                const text = editor.value.substring(0, end);
                const lines = text.split('\n');
                const lineHeight = 19.2;

                toolbar.style.top = Math.min(rect.top + lines.length * lineHeight + 20, rect.bottom - 40) + 'px';
                toolbar.style.left = (rect.left + 80) + 'px';
                toolbar.classList.add('visible');

                pendingStart = start;
                pendingEnd = end;
                selectionFromPreview = false;
            } else {
                toolbar.classList.remove('visible');
            }
        }

        function handlePreviewSelection() {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText && selectedText.length > 0) {
                // Find this text in the source
                const sourceText = editor.value;
                const index = sourceText.indexOf(selectedText);

                if (index !== -1) {
                    // Count occurrences
                    let count = 0;
                    let searchIndex = 0;
                    while ((searchIndex = sourceText.indexOf(selectedText, searchIndex)) !== -1) {
                        count++;
                        searchIndex += selectedText.length;
                    }

                    // Position toolbar near selection
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();

                    toolbar.style.top = (rect.bottom + 5) + 'px';
                    toolbar.style.left = rect.left + 'px';
                    toolbar.classList.add('visible');

                    pendingStart = index;
                    pendingEnd = index + selectedText.length;
                    pendingText = selectedText;
                    pendingMatchCount = count;
                    selectionFromPreview = true;
                } else {
                    // Text not found in source (might be transformed by markdown)
                    toolbar.classList.remove('visible');
                    showToast('Text not found in source (may be transformed by markdown)');
                }
            } else {
                toolbar.classList.remove('visible');
            }
        }

        // Preview selection handling
        previewContent.addEventListener('mouseup', () => {
            setTimeout(handlePreviewSelection, 10);
        });

        function addHighlight() {
            if (pendingStart === pendingEnd) return;

            // Save scroll position
            const scrollTop = editor.scrollTop;

            const text = editor.value;
            const selected = text.substring(pendingStart, pendingEnd);
            const before = text.substring(0, pendingStart);
            const after = text.substring(pendingEnd);

            editor.value = before + '{==' + selected + '==}' + after;
            toolbar.classList.remove('visible');
            setModified();
            updateAll();

            // Clear browser selection if from preview
            if (selectionFromPreview) {
                window.getSelection().removeAllRanges();
                if (pendingMatchCount > 1) {
                    showToast(`${pendingMatchCount} matches found — annotated first occurrence`);
                }
            } else {
                const newPos = pendingStart + selected.length + 8;
                editor.setSelectionRange(newPos, newPos);
                editor.focus();
                editor.scrollTop = scrollTop;
            }
        }

        function addComment() {
            if (pendingStart === pendingEnd) return;

            editingIndex = -1;
            modalTitle.textContent = 'Add Comment';
            modalSubmit.textContent = 'Add';

            const selected = editor.value.substring(pendingStart, pendingEnd);
            selectedPreview.textContent = selected.length > 150 ? selected.substring(0, 150) + '...' : selected;
            commentInput.value = '';
            commentModal.classList.add('visible');
            commentInput.focus();
            toolbar.classList.remove('visible');
        }

        function editComment(index) {
            const annotations = getAnnotations();
            if (index < 0 || index >= annotations.length) return;

            const ann = annotations[index];
            editingIndex = index;
            pendingStart = ann.index;
            pendingEnd = ann.index + ann.fullMatch.length;

            modalTitle.textContent = 'Edit Comment';
            modalSubmit.textContent = 'Save';
            selectedPreview.textContent = ann.highlight.length > 150 ? ann.highlight.substring(0, 150) + '...' : ann.highlight;
            commentInput.value = ann.comment;
            commentModal.classList.add('visible');
            commentInput.focus();
        }

        function submitComment() {
            const comment = commentInput.value.trim();
            if (!comment) {
                closeModal();
                return;
            }

            // Save scroll position
            const scrollTop = editor.scrollTop;

            const text = editor.value;

            if (editingIndex >= 0) {
                // Editing existing
                const annotations = getAnnotations();
                const ann = annotations[editingIndex];
                const newAnnotation = '{==' + ann.highlight + '==}{>>' + comment + '<<}';
                editor.value = text.substring(0, ann.index) + newAnnotation + text.substring(ann.index + ann.fullMatch.length);
            } else {
                // New comment
                const selected = text.substring(pendingStart, pendingEnd);
                const before = text.substring(0, pendingStart);
                const after = text.substring(pendingEnd);
                editor.value = before + '{==' + selected + '==}{>>' + comment + '<<}' + after;
            }

            closeModal();
            setModified();
            updateAll();

            // Clear browser selection if from preview, otherwise focus editor
            if (selectionFromPreview) {
                window.getSelection().removeAllRanges();
                if (pendingMatchCount > 1) {
                    showToast(`${pendingMatchCount} matches found — annotated first occurrence`);
                }
            } else {
                editor.focus();
                editor.scrollTop = scrollTop;
            }
        }

        function closeModal() {
            commentModal.classList.remove('visible');
            selectionFromPreview = false;
            editingIndex = -1;
        }

        function showHelp() {
            helpModal.classList.add('visible');
        }

        function closeHelp() {
            helpModal.classList.remove('visible');
        }

        function toggleSource() {
            const sourcePane = document.querySelector('.source-pane');
            const sourceToggle = document.getElementById('sourceToggle');
            const isCollapsed = sourcePane.classList.contains('collapsed');

            if (isCollapsed) {
                sourcePane.classList.remove('collapsed');
                sourceToggle.classList.add('active');
            } else {
                sourcePane.classList.add('collapsed');
                sourceToggle.classList.remove('active');
            }
        }

        function togglePreview() {
            const isCollapsed = previewPane.classList.contains('collapsed');
            if (isCollapsed) {
                previewPane.classList.remove('collapsed');
                previewPane.style.width = ''; // Clear inline width to use flex
                previewToggle.classList.add('active');
                updatePreview();
            } else {
                previewPane.classList.add('collapsed');
                previewPane.style.width = '0';
                previewToggle.classList.remove('active');
            }
        }

        function toggleDarkMode() {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem('mdannotate_darkmode', document.body.classList.contains('dark-mode'));
        }

        function toggleAnnotations() {
            const commentsPane = document.querySelector('.comments-pane');
            const annotationsToggle = document.getElementById('annotationsToggle');
            const isCollapsed = commentsPane.classList.contains('collapsed');

            if (isCollapsed) {
                commentsPane.classList.remove('collapsed');
                commentsPane.style.width = '280px';
                annotationsToggle.classList.add('active');
                userHidAnnotations = false;
            } else {
                commentsPane.classList.add('collapsed');
                commentsPane.style.width = '0';
                annotationsToggle.classList.remove('active');
                userHidAnnotations = true;
            }
        }

        function setModified() {
            isModified = true;
            status.textContent = 'Modified';
            status.classList.add('status-modified');
            status.classList.remove('status-saved');
        }

        function updatePosition() {
            const pos = editor.selectionStart;
            const text = editor.value.substring(0, pos);
            const lines = text.split('\n');
            const line = lines.length;
            const col = lines[lines.length - 1].length + 1;
            position.textContent = `Ln ${line}, Col ${col}`;
        }

        function updateAll() {
            updateLineNumbers();
            updateSyntaxHighlight();
            updateComments();
            updatePreview();
            updateStats();
            updatePosition();
        }

        function updateLineNumbers() {
            const lines = editor.value.split('\n');
            lineNumbers.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join('');
        }

        function updateSyntaxHighlight() {
            let html = escapeHtml(editor.value);

            // Highlight CriticMarkup syntax
            html = html.replace(/(\{==)([\s\S]*?)(==\})(\{&gt;&gt;)([\s\S]*?)(&lt;&lt;\})/g,
                '<span class="bracket">$1</span><span class="hl">$2</span><span class="bracket">$3$4</span><span class="cm">$5</span><span class="bracket">$6</span>');

            html = html.replace(/(\{==)([\s\S]*?)(==\})(?!\{&gt;&gt;)/g,
                '<span class="bracket">$1</span><span class="hl">$2</span><span class="bracket">$3</span>');

            syntaxHighlight.innerHTML = html + '\n';
        }

        function getAnnotations() {
            const text = editor.value;
            const annotations = [];

            // Match both highlight-only and highlight+comment
            const regex = /\{==([^=]*)==\}(?:\{>>([^<]*)<<\})?/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                annotations.push({
                    highlight: match[1],
                    comment: match[2] || null,
                    index: match.index,
                    fullMatch: match[0]
                });
            }

            return annotations;
        }

        function updateComments() {
            const annotations = getAnnotations();
            const commentsPane = document.querySelector('.comments-pane');
            const annotationsToggle = document.getElementById('annotationsToggle');

            commentCount.textContent = annotations.length ? `(${annotations.length})` : '';
            clearAllBtn.style.display = annotations.length > 0 ? 'block' : 'none';

            if (annotations.length === 0) {
                // Hide pane and toggle when no annotations
                commentsPane.classList.add('collapsed');
                commentsPane.style.width = '0';
                annotationsToggle.style.display = 'none';
                annotationsToggle.classList.remove('active');
                commentsList.innerHTML = '<div class="no-comments">No annotations yet.<br><br>Select text and press <kbd>⌘E</kbd> to add a comment.</div>';
                return;
            }

            // Show toggle button when there are annotations
            annotationsToggle.style.display = '';

            // Auto-show pane only if:
            // 1. This is the first annotation ever (!hadAnnotationsBefore), OR
            // 2. User hasn't manually hidden the pane (!userHidAnnotations)
            const isFirstAnnotation = !hadAnnotationsBefore;
            hadAnnotationsBefore = true;

            if (commentsPane.classList.contains('collapsed') && (isFirstAnnotation || !userHidAnnotations)) {
                commentsPane.classList.remove('collapsed');
                commentsPane.style.width = '280px';
                annotationsToggle.classList.add('active');
            }

            // Keep button state in sync
            if (!commentsPane.classList.contains('collapsed')) {
                annotationsToggle.classList.add('active');
            }

            commentsList.innerHTML = annotations.map((ann, i) => {
                return `
                <div class="comment-card ${activeCommentIndex === i ? 'active' : ''}"
                     onclick="jumpToAnnotation(${i})">
                    <button class="close-x" onclick="event.stopPropagation(); deleteAnnotation(${i})" title="Delete">×</button>
                    <div class="highlight-text">${escapeHtml(ann.highlight)}</div>
                    ${ann.comment ? `<div class="comment-text">${escapeHtml(ann.comment)}</div>` : '<div class="comment-text" style="color: var(--text-muted); font-style: italic;">No comment</div>'}
                    <div class="card-actions">
                        <button onclick="event.stopPropagation(); editComment(${i})">${ann.comment ? 'Edit' : 'Add Comment'}</button>
                    </div>
                </div>
            `}).join('');
        }

        function jumpToAnnotation(index) {
            const annotations = getAnnotations();
            if (index < 0 || index >= annotations.length) return;

            const ann = annotations[index];
            activeCommentIndex = index;

            // Select the annotation in the editor
            editor.focus();
            editor.setSelectionRange(ann.index, ann.index + ann.fullMatch.length);

            // Scroll into view
            const linesBefore = editor.value.substring(0, ann.index).split('\n').length;
            const lineHeight = 19.2;
            editor.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);

            updateComments();
        }

        function deleteAnnotation(index) {
            const annotations = getAnnotations();
            if (index < 0 || index >= annotations.length) return;

            const ann = annotations[index];
            const text = editor.value;

            // Keep just the highlighted text, remove markup
            editor.value = text.substring(0, ann.index) + ann.highlight + text.substring(ann.index + ann.fullMatch.length);

            setModified();
            updateAll();

            if (activeCommentIndex === index) {
                activeCommentIndex = -1;
            }
        }

        function clearAllAnnotations() {
            const annotations = getAnnotations();
            if (annotations.length === 0) return;

            // Remove all annotations, working backwards to preserve indices
            let text = editor.value;
            for (let i = annotations.length - 1; i >= 0; i--) {
                const ann = annotations[i];
                text = text.substring(0, ann.index) + ann.highlight + text.substring(ann.index + ann.fullMatch.length);
            }

            editor.value = text;
            activeCommentIndex = -1;
            setModified();
            updateAll();
        }

        function updatePreview() {
            if (previewPane.classList.contains('collapsed')) return;

            let md = editor.value;

            // Render CriticMarkup as visual highlights
            md = md.replace(/\{==([^=]*)==\}\{>>([^<]*)<<\}/g, (match, text, comment) => {
                return `<span class="preview-highlight has-comment" title="${escapeHtml(comment)}">${escapeHtml(text)}</span><span class="preview-comment-marker">${escapeHtml(comment.substring(0, 20))}${comment.length > 20 ? '...' : ''}</span>`;
            });

            md = md.replace(/\{==([^=]*)==\}/g, '<span class="preview-highlight">$1</span>');

            // Fenced code blocks (must be done early, before other processing)
            md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
                return '<pre><code class="language-' + (lang || 'text') + '">' + highlightCode(code.trim(), lang) + '</code></pre>';
            });

            // Tables
            md = md.replace(/^(\|.+\|)\n(\|[-:\| ]+\|)\n((?:\|.+\|\n?)+)/gm, (match, header, separator, body) => {
                const headerCells = header.split('|').slice(1, -1).map(c => '<th>' + c.trim() + '</th>').join('');
                const bodyRows = body.trim().split('\n').map(row => {
                    const cells = row.split('|').slice(1, -1).map(c => '<td>' + c.trim() + '</td>').join('');
                    return '<tr>' + cells + '</tr>';
                }).join('');
                return '<table><thead><tr>' + headerCells + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
            });

            // Simple markdown rendering
            md = md.replace(/^### (.*)$/gm, '<h3>$1</h3>');
            md = md.replace(/^## (.*)$/gm, '<h2>$1</h2>');
            md = md.replace(/^# (.*)$/gm, '<h1>$1</h1>');
            md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
            md = md.replace(/^---+$/gm, '<hr>');
            md = md.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');

            // Handle lists with proper nesting
            const lines = md.split('\n');
            let result = [];
            let listStack = []; // Track nested list levels

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);

                if (listMatch) {
                    const indent = listMatch[1].length;
                    let content = listMatch[3];
                    const level = Math.floor(indent / 2);

                    // Close lists that are deeper than current
                    while (listStack.length > level + 1) {
                        result.push('</ul>');
                        listStack.pop();
                    }

                    // Open new lists if needed
                    while (listStack.length < level + 1) {
                        result.push('<ul>');
                        listStack.push(level);
                    }

                    // Check for task list checkbox
                    const checkboxMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
                    if (checkboxMatch) {
                        const checked = checkboxMatch[1].toLowerCase() === 'x';
                        const text = checkboxMatch[2];
                        const checkbox = checked
                            ? '<input type="checkbox" class="checkbox" checked disabled>'
                            : '<input type="checkbox" class="checkbox" disabled>';
                        result.push('<li class="task-item">' + checkbox + text + '</li>');
                    } else {
                        result.push('<li>' + content + '</li>');
                    }
                } else {
                    // Close all open lists
                    while (listStack.length > 0) {
                        result.push('</ul>');
                        listStack.pop();
                    }
                    result.push(line);
                }
            }

            // Close any remaining lists
            while (listStack.length > 0) {
                result.push('</ul>');
                listStack.pop();
            }

            md = result.join('\n');

            // Paragraphs (skip elements that shouldn't be wrapped)
            md = md.split('\n\n').map(para => {
                para = para.trim();
                if (!para) return '';
                if (para.match(/^<(h[1-6]|ul|ol|li|pre|hr|blockquote|table|\/)/)) return para;
                return `<p>${para.replace(/\n/g, '<br>')}</p>`;
            }).join('\n');

            previewContent.innerHTML = md;
        }

        function updateStats() {
            const text = editor.value;
            const annotations = getAnnotations();
            const highlights = annotations.length;
            const comments = annotations.filter(a => a.comment).length;
            const words = text.trim().split(/\s+/).filter(w => w).length;

            stats.textContent = `${words} words · ${highlights} highlights · ${comments} comments`;
        }

        function escapeHtml(text) {
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        let toastTimeout;
        function showToast(message, duration = 3000) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('visible');
            clearTimeout(toastTimeout);
            toastTimeout = setTimeout(() => {
                toast.classList.remove('visible');
            }, duration);
        }

        function highlightCode(code, lang) {
            let html = escapeHtml(code);

            // Extract comments and strings first to protect them from other regexes
            const protected = [];
            const protect = (match) => {
                const id = `__PROTECTED_${protected.length}__`;
                protected.push(match);
                return id;
            };

            // Protect comments
            html = html.replace(/(\/\/.*$)/gm, (m) => protect('<span class="comment">' + m + '</span>'));
            html = html.replace(/(\/\*[\s\S]*?\*\/)/g, (m) => protect('<span class="comment">' + m + '</span>'));

            // Protect strings
            html = html.replace(/(&quot;[^&]*&quot;)/g, (m) => protect('<span class="string">' + m + '</span>'));
            html = html.replace(/('(?:[^'\\]|\\.)*')/g, (m) => protect('<span class="string">' + m + '</span>'));
            html = html.replace(/(`(?:[^`\\]|\\.)*`)/g, (m) => protect('<span class="string">' + m + '</span>'));

            // Keywords
            const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|finally|new|delete|typeof|instanceof|in|of|class|extends|import|export|from|default|async|await|yield|static|get|set|interface|type|enum|implements|public|private|protected|readonly|abstract|declare|namespace|module)\b/g;
            html = html.replace(keywords, '<span class="keyword">$1</span>');

            // Types (TypeScript/Flow)
            const types = /\b(string|number|boolean|void|null|undefined|any|never|unknown|object|symbol|bigint|Array|Object|Function|Promise|Map|Set|Date|RegExp|Error)\b/g;
            html = html.replace(types, '<span class="type">$1</span>');

            // Numbers
            html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');

            // Property names (before colon)
            html = html.replace(/(\w+)(?=\s*:)/g, '<span class="property">$1</span>');

            // Restore protected content
            for (let i = 0; i < protected.length; i++) {
                html = html.replace(`__PROTECTED_${i}__`, protected[i]);
            }

            return html;
        }

        function downloadFile() {
            const header = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;
            const content = header + editor.value;

            const blob = new Blob([content], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = originalFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            isModified = false;
            status.textContent = 'Downloaded';
            status.classList.remove('status-modified');
            status.classList.add('status-saved');
        }

        async function copyShareUrl() {
            const header = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;
            const content = header + editor.value;

            try {
                // Compress with gzip
                const encoder = new TextEncoder();
                const data = encoder.encode(content);
                const cs = new CompressionStream('gzip');
                const writer = cs.writable.getWriter();
                writer.write(data);
                writer.close();

                const compressed = await new Response(cs.readable).arrayBuffer();
                const bytes = new Uint8Array(compressed);

                // Convert to URL-safe base64
                let binary = '';
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                const urlSafe = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

                // Create the shareable URL
                const shareHash = '#doc=' + urlSafe;
                const fullUrl = window.location.origin + window.location.pathname + shareHash;

                // Check size
                if (urlSafe.length > 32000) {
                    alert(`Warning: URL is ${urlSafe.length} characters. Very large URLs may not work in all browsers or when shared.`);
                }

                // Copy to clipboard
                await navigator.clipboard.writeText(fullUrl);

                status.textContent = `URL copied (${urlSafe.length} chars)`;
                status.classList.remove('status-modified');
                status.classList.add('status-saved');

                setTimeout(() => {
                    if (isModified) {
                        status.textContent = 'Modified';
                        status.classList.add('status-modified');
                        status.classList.remove('status-saved');
                    } else {
                        status.textContent = 'Ready';
                        status.classList.remove('status-modified', 'status-saved');
                    }
                }, 3000);

            } catch (e) {
                console.error('Failed to create share URL:', e);
                alert('Failed to create shareable URL: ' + e.message);
            }
        }

        // Initialize position
        updatePosition();

        // Drag-and-drop download
        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.addEventListener('dragstart', (e) => {
            const header = `<!--
ANNOTATION FORMAT: CriticMarkup
- Highlights: {==highlighted text==}
- Comments: {>>comment text<<}
- Combined: {==highlight==}{>>comment<<}
Learn more: https://criticmarkup.com
-->

`;
            const content = header + editor.value;

            // Create a data URL for the file
            const dataUrl = 'data:text/markdown;base64,' + btoa(unescape(encodeURIComponent(content)));

            // Chrome/Edge support DownloadURL for drag to Finder/desktop
            e.dataTransfer.setData('DownloadURL', `text/markdown:${originalFilename}:${dataUrl}`);

            // Also set plain text as fallback (the content itself)
            e.dataTransfer.setData('text/plain', content);

            // Visual feedback
            e.dataTransfer.effectAllowed = 'copy';
        });

        // Resizable panes
        const previewResizer = document.getElementById('previewResizer');
        const commentsResizer = document.getElementById('commentsResizer');
        const commentsPane = document.querySelector('.comments-pane');

        function initResizer(resizer, targetPane, direction, onResize) {
            let startX, startWidth;

            resizer.addEventListener('mousedown', (e) => {
                startX = e.clientX;
                startWidth = targetPane.offsetWidth;
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            function onMouseMove(e) {
                const diff = direction === 'left' ? (startX - e.clientX) : (e.clientX - startX);
                const newWidth = Math.max(0, Math.min(800, startWidth + diff));
                targetPane.style.width = newWidth + 'px';
                if (onResize) onResize(newWidth);
            }

            function onMouseUp() {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        }

        initResizer(previewResizer, previewPane, 'left', (width) => {
            // Sync button state with pane visibility
            if (width < 50) {
                previewToggle.classList.remove('active');
                previewPane.classList.add('collapsed');
                previewPane.style.width = '0';
            } else {
                previewToggle.classList.add('active');
                previewPane.classList.remove('collapsed');
                updatePreview();
            }
        });
        initResizer(commentsResizer, commentsPane, 'left', (width) => {
            // Sync button state with pane visibility
            const annotationsToggle = document.getElementById('annotationsToggle');
            if (width < 50) {
                annotationsToggle.classList.remove('active');
                commentsPane.classList.add('collapsed');
            } else {
                annotationsToggle.classList.add('active');
                commentsPane.classList.remove('collapsed');
            }
        });
    </script>
</body>
</html>
HTMLEOF

# Replace placeholders
sed -i '' "s/FILENAME_PLACEHOLDER/$(basename "$INPUT_FILE")/g" "$OUTPUT_FILE"

# Use Python to safely inject the JSON content
python3 << PYEOF
import re

with open("$OUTPUT_FILE", 'r') as f:
    html = f.read()

content = $MARKDOWN_CONTENT
html = html.replace('CONTENT_PLACEHOLDER', repr(content))

with open("$OUTPUT_FILE", 'w') as f:
    f.write(html)
PYEOF

# Open in default browser (no need to print temp path)
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "$OUTPUT_FILE"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "$OUTPUT_FILE" 2>/dev/null || echo "Open $OUTPUT_FILE in your browser"
else
    echo "Open $OUTPUT_FILE in your browser"
fi
