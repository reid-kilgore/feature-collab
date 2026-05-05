# Handoff Notes

**Created**: 2026-05-05T19:37:05Z
**Reason**: User invoked `/feature-collab:handoff` — primary work shipped, parking before next session
**Feature**: feature-collab plugin cruft cut + api-walkthrough Bruno rewrite

## Important: Deviation From Standard fc Layout

This work was on the feature-collab plugin **itself** (a meta-repo refactor), not a product feature. There is no `docs/reidplans/main/` dir for this work. Instead:

- **PLAN.md** lives at `feature-collab/plugins/feature-collab/PLAN.md` (next to the plugin code)
- **This HANDOFF.md** lives at `feature-collab/plugins/feature-collab/HANDOFF.md`
- No CONTRACTS.md, TEST_SPEC.md, DETAILS.md, DECISIONS.md, or SESSION_STATE.md were created — this was a markdown-only refactor, no contracts or tests apply

A new session should `cd feature-collab/plugins/feature-collab/` and read PLAN.md + HANDOFF.md from there.

## Current State

**Phase**: PR1 (cuts) + PR2 (api-walkthrough rewrite) **complete and pushed to `origin main`** as commit `d75be7c`.
**Sub-phase**: Idle. Waiting on either user review of shipped changes or greenlight to start follow-up audit work.
**Waiting For**: User direction.

## What Was Just Completed

1. Audited the feature-collab plugin for dead code; published findings in PLAN.md.
2. Locked decisions: rip metrics, sibling Bruno collections, broader cruft audit greenlit.
3. Shipped one combined commit (`d75be7c`, 34 files, +459 / -2335 lines):
   - Deleted: `agents/{browser-verifier,teleport,resume-agent}.md`, `commands/teleport.md`, all 4 `commands/*.md.tmpl`, full `templates/` dir, `scripts/{gen-skills,teleport}.sh` + empty `scripts/`.
   - Removed CodeRabbit phase from `feature-collab.md` (was Phase 6) and `enhance.md` (was Phase 3); renumbered subsequent phases (7→6, 8→7, 9→8 in feature-collab; 4→3, 5→4 in enhance).
   - Removed `~/.feature-collab/metrics/` writes from 5 commands and from `retro-synthesizer.md`.
   - Removed `~/.claude/feature-collab/suppressions/` blocks from `code-reviewer.md`, `criteria-assessor.md`, `code-security.md`, `feature-collab.md`, `enhance.md` (path was broken — commands wrote to one location with no consumer at the actual created dir).
   - Removed `browser-verifier` invocations from `feature-collab.md` Phase 8 and `bugfix.md`.
   - Rewrote `agents/api-walkthrough.md`: now writes to `~/Library/Application Support/bruno/<collection>/` (sibling to `rollfi-sandbox`), encodes login + token-capture pattern, numbered dirs, `auth: inherit`, `script:post-response` chaining, supports both Bearer and Basic auth.
   - Updated `feature-collab.md` Phase 8, `enhance.md` Phase 1+4, `bugfix.md` to reflect new Bruno destination and clarify Bruno collection IS the proof for API changes (no separate DEMO.md).
4. Closed bd epic `fun_claude-g7h`.
5. Pushed to `origin main`.

## What Needs to Happen Next

These are the unfinished items from the original cruft audit (in PLAN.md "Medium confidence" + "Open Questions"):

1. **Audit `commands/refactor.md` + `agents/refactor.md`** — likely delete; verify zero usage in WIPs/branches before cutting. Check `wip` history and grep `~/.feature-collab/retros/*.md` for `/refactor` invocations.
2. **Audit `commands/release.md`** — verify usage; delete if 0.
3. **Audit `agents/handoff.md` vs `agents/pickup.md` vs (now-deleted) `resume-agent.md`** — handoff still exists, pickup still exists, resume-agent was cut. Inspect remaining two for overlap. Consider consolidating into `pickup` only, or document a clear separation in their frontmatter.
4. **Audit `agents/linear-issues.md` + `commands/linear-issues.md`** — 0 retro mentions found, but Linear may still be live for fast follows. Verify with user before cutting.
5. **Decide PR-local DEMO.md fate** — open question in PLAN.md. Default proposed: keep DEMO.md only for non-API demos (CLI / data / refactor proofs), since API changes now use Bruno collections instead. Confirm with user, then update commands accordingly.
6. **Smoke-test the rewritten api-walkthrough** — the agent has not actually been invoked against a real feature yet. The first real `/feature-collab` or `/enhance` run that hits Phase 8/4 with API changes will be the integration test. Watch for: malformed `.bru` syntax, wrong destination resolution, missing env-var captures, login-flow assumptions that don't match the target API.

## Active Todo List

No bd tasks open under the (now closed) `fun_claude-g7h` epic. If the next session wants to track follow-ups 1–5 above, create a new epic:

```bash
bd create --title="[epic] feature-collab follow-up audits (refactor, release, handoff, linear)" --type=task --priority=3
```

Then file one bd task per audit item.

## Key Learnings & Context

- **Metrics existed but had no real consumer** — initial assumption "we never write metrics" was wrong (58 files in `~/.feature-collab/metrics/` since March), but the consumer (`retro-synthesizer`) treated them as optional and the schema was bare counters. Net: still cruft. Lesson: "no one reads it" is the right test, not "no one writes it."
- **Suppressions had a path mismatch** — commands wrote to `~/.claude/feature-collab/suppressions/`, but the only created dir on disk was `~/.feature-collab/suppressions/` (empty). Reads in agents pointed at the former, so even if writes had landed they'd never have been read. Removed cleanly.
- **CodeRabbit CLI is not installed on this machine** — `which coderabbitai` empty, npm global empty, 0 retros mention it. Phase was dead code in 2 skills.
- **Templating system was abandoned** — `*.md.tmpl` files with `{{FRAGMENT}}` placeholders existed alongside the real `.md` files, but the `.md` files had been edited directly and diverged. `gen-skills.sh` was no longer authoritative. All cut.
- **Bruno conventions reference**: `~/Library/Application Support/bruno/rollfi-sandbox/` is the gold-standard pattern. Numbered dirs (`00 Sanity`, `10 ...`), numbered files (`01 X.bru`), `meta { name, type, seq }`, collection-level `Authorization` header in `collection.bru` with `auth { mode: none }`, per-request `auth: inherit`, `script:post-response` blocks that `bru.setVar()` captured IDs. New collections from api-walkthrough should be siblings, not subfolders of existing collections.
- **Combined commit was the right call** — phase renumbering (CodeRabbit removal cascaded 7→6, 8→7, 9→8) intermixed PR1 cuts and PR2 Bruno-destination updates in the same files. Splitting risked corruption. Single commit with explicit message covering both work streams.
- **Agent model usage** — used Sonnet for the rewrite work, Haiku for the commit-and-push agent. Confirmed working.

## Files to Read on Resume

1. `feature-collab/plugins/feature-collab/PLAN.md` — full audit findings + decisions + remaining items
2. `feature-collab/plugins/feature-collab/HANDOFF.md` — this file
3. `feature-collab/plugins/feature-collab/agents/api-walkthrough.md` — the rewritten agent (read this before invoking it for the first time, to sanity-check the conventions)
4. `~/Library/Application Support/bruno/rollfi-sandbox/{collection.bru,bruno.json,environments/sandbox.bru,00 Sanity/01 List Companies.bru,10 Employer Onboarding/01 Create Company.bru}` — the convention reference, in case you want to compare the agent's documented pattern against the source of truth
5. Latest commit: `git show d75be7c --stat` to see the full diff

## Open Questions

- [ ] **Q1**: Keep PR-local DEMO.md at all? Default proposed in PLAN.md: keep only for non-API demos. Confirm with user.
- [ ] **Q2**: Do `refactor`, `release`, `linear-issues` skills still earn their keep? — needs user input.
- [ ] **Q3**: Should `handoff` and `pickup` agents be consolidated into one? — needs decision.

## Warnings

- **Do NOT re-run the cuts** — they're shipped. Subsequent sessions should treat the current state as the new baseline.
- **The `metrics/` and `suppressions/` directories on disk still exist** with old contents. They're now orphaned. The user can `rm -rf ~/.feature-collab/metrics` and `rm -rf ~/.feature-collab/suppressions` and `rm -rf ~/.claude/feature-collab/suppressions` at their leisure. Don't do it without asking — the user might want to read the metrics for one last retrospective glance before deletion.
- **`api-walkthrough` is unbattle-tested** — its first invocation on a real feature is the integration test. Be ready to fix issues during that run.
- **The original `templates/fragments/` content is gone** — anything useful in those fragments (orchestrator-rules, transparency-rules, model-tiering, etc.) is now only present inline in the `.md` files. If a future change wants to factor shared content, it must be re-derived; do NOT try to restore the fragments.
- **PLAN.md and HANDOFF.md at the plugin root are uncommitted** unless they got swept up in the commit. Verify with `git status` on resume — if uncommitted, stage and commit them in their own `docs:` commit, or move them out of the plugin dir if the user prefers them not to ship as part of the plugin distribution.
