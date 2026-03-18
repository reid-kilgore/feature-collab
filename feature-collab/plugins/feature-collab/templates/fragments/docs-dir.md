## Document Paths

All project documents live in a branch-specific directory:

```
docs/reidplans/$(git branch --show-current)/
```

**At skill start**, resolve the doc directory:

```bash
DOCS_DIR="docs/reidplans/$(git branch --show-current)"
mkdir -p "$DOCS_DIR"
```

All references to PLAN.md, DEMO.md, CONTRACTS.md, TEST_SPEC.md, SESSION_STATE.md throughout this skill mean `$DOCS_DIR/<file>`.