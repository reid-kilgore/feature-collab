### Commit Planning Artifacts

Dispatch a haiku agent to commit planning documents. Untracked docs don't survive environment resets.

```bash
git add $DOCS_DIR/PLAN.md $DOCS_DIR/DEMO.md 2>/dev/null
git commit -m "docs: planning artifacts for $(git branch --show-current)"
```