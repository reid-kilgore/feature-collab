# mdannotate

Markdown annotation tool using CriticMarkup. Opens markdown files in a browser-based editor for highlighting and commenting.

## Install

```bash
# Download the script
curl -o mdannotate.sh https://gist.githubusercontent.com/reid-kilgore/942febd6ffd4849e7bf9ce82cd5f5cb6/raw/mdannotate.sh
chmod +x mdannotate.sh
```

Or clone this repo and add it to your PATH.

## Usage

```bash
mdannotate.sh file.md           # Open in browser
mdannotate.sh --edit file.md    # Open, wait for paste-back, save (use as $EDITOR)
mdannotate.sh --decode <hash>   # Decode encoded document to stdout
```

## Use as $EDITOR (Claude Code, git, etc.)

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export EDITOR='mdannotate.sh --edit'
```

Then press `Ctrl+G` in Claude Code (or anywhere `$EDITOR` is used). Edit in the browser, click "Copy for CLI", paste back into the terminal.

## Development

The web app lives in `web/`. The CLI script `mdannotate.sh` is the single source of truth, also published as a gist.

To sync the gist after editing:

```bash
gh gist edit 942febd6ffd4849e7bf9ce82cd5f5cb6 -f mdannotate.sh
```
