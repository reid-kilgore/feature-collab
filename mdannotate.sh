#!/bin/bash

# mdannotate - Markdown annotation tool using CriticMarkup
# https://mdannotate.onrender.com

set -e

HOSTED_URL="https://mdannotate.onrender.com"

show_help() {
    echo "mdannotate - Markdown annotation tool using CriticMarkup"
    echo ""
    echo "Usage:"
    echo "  mdannotate <file.md>         Open file in web annotation editor"
    echo "  mdannotate --edit <file.md>  Open, wait for paste-back, save (use as \$EDITOR)"
    echo "  mdannotate --decode <hash>   Decode a document hash to stdout"
    echo "  mdannotate --help            Show this help"
    echo ""
    echo "Workflow:"
    echo "  1. Run: mdannotate notes.md"
    echo "  2. Annotate in your browser"
    echo "  3. Click 'Copy for Terminal' in the web app"
    echo "  4. Paste the command in your terminal to save changes"
}

encode_file() {
    python3 << PYEOF
import gzip, base64, sys, urllib.parse
with open("$1", 'rb') as f:
    content = f.read()
compressed = gzip.compress(content, compresslevel=9)
encoded = base64.urlsafe_b64encode(compressed).decode('ascii').rstrip('=')
if len(encoded) > 32000:
    print(f"Warning: Large file ({len(encoded)} chars). URL may not work everywhere.", file=sys.stderr)
filename = "$2"
params = "doc=" + encoded
if filename:
    params += "&name=" + urllib.parse.quote(filename)
print(params)
PYEOF
}

decode_hash() {
    python3 << PYEOF
import gzip, base64, sys
encoded = """$1"""
if '#doc=' in encoded:
    encoded = encoded.split('#doc=')[1]
elif 'doc=' in encoded:
    encoded = encoded.split('doc=')[1]
if '&' in encoded:
    encoded = encoded.split('&')[0]
padding = 4 - (len(encoded) % 4)
if padding != 4:
    encoded += '=' * padding
try:
    compressed = base64.urlsafe_b64decode(encoded)
    sys.stdout.buffer.write(gzip.decompress(compressed))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
}

# Handle arguments
case "$1" in
    --help|-h|"")
        show_help
        [ -z "$1" ] && exit 1 || exit 0
        ;;
    --edit)
        [ -z "$2" ] && echo "Error: --edit requires a file argument" && exit 1
        FILE="$2"
        PARAMS=$(encode_file "$FILE" "$(basename "$FILE")")
        URL="${HOSTED_URL}/#${PARAMS}"
        if [[ "$OSTYPE" == darwin* ]]; then open "$URL"
        elif command -v xdg-open &>/dev/null; then xdg-open "$URL"
        else echo "Open: $URL"; fi
        echo "Editing $(basename "$FILE") in browser..."
        echo "When done, click 'Copy for CLI' then paste here and press Enter:"
        echo ""
        read -r PASTED
        [ -z "$PASTED" ] && echo "No input received, file unchanged." && exit 0
        ENCODED="$PASTED"
        if [[ "$ENCODED" == *"#doc="* ]]; then
            ENCODED="${ENCODED#*#doc=}"; ENCODED="${ENCODED%%&*}"
        fi
        ENCODED="${ENCODED#mdannotate --decode }"; ENCODED="${ENCODED%% >*}"
        decode_hash "$ENCODED" | python3 -c "
import sys, re
content = sys.stdin.read()
content = re.sub(r'^<!--\nANNOTATION FORMAT:[\s\S]*?-->\n\n?', '', content)
sys.stdout.write(content)
" > "$FILE"
        echo "Saved to $FILE"
        ;;
    --decode)
        [ -z "$2" ] && echo "Error: --decode requires a hash" && exit 1
        decode_hash "$2"
        ;;
    H4sI* | doc=* | *"#doc="*)
        decode_hash "$1"
        ;;
    *)
        [ ! -f "$1" ] && echo "Error: '$1' is not a file" && exit 1
        PARAMS=$(encode_file "$1" "$(basename "$1")")
        URL="${HOSTED_URL}/#${PARAMS}"
        echo "Opening in browser... Use 'Copy for Terminal' to save changes."
        if [[ "$OSTYPE" == darwin* ]]; then
            open "$URL"
        elif command -v xdg-open &>/dev/null; then
            xdg-open "$URL"
        else
            echo "Open: $URL"
        fi
        ;;
esac
