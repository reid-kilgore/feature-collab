# Hook registration moved — 2026-08-10

These hooks are now registered in `~/.claude/settings.json`, pointing at the canonical copies in
`meta-agent-repo/canonical-bundle/content/hooks/feature-collab/`. `hooks.json` was renamed to
`hooks.json.disabled` so the hooks fire from exactly one source instead of two.

Registered: h1-main-thread-refuser, h6-current-state-write-guard, h-test-spec-commit-lock,
h5-graceful-skip-detector.

Deliberately NOT registered: **h2-typecheck-enforcer**. It gates on the freshness of a marker file
at `/tmp/fc-typecheck-<branch>`, and nothing verifies a typecheck actually ran or passed — `touch`
satisfies it. It also blocks every agent dispatch including read-only ones, which pushes work onto
the main thread that h1 exists to prevent. Re-register it only once it checks a real tsc result.

h4-ci-monitor runs from cron via h4-sweep.sh, not as a tool hook.

To restore the old behavior: `mv hooks.json.disabled hooks.json` and remove the feature-collab
entries from `~/.claude/settings.json`.
