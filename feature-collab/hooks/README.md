# Hooks Installation

These are canonical copies of the wip session lifecycle hooks used by Claude Code.

## Install

Copy or symlink these files into `~/.claude/hooks/`:

```bash
ln -s /path/to/feature-collab/hooks/on-stop.sh ~/.claude/hooks/on-stop.sh
ln -s /path/to/feature-collab/hooks/on-prompt.sh ~/.claude/hooks/on-prompt.sh
```

Or copy directly:

```bash
cp feature-collab/hooks/on-*.sh ~/.claude/hooks/
```

Restart Claude Code to pick up the hooks.
