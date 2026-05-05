# Feature-Collab Cruft Audit & Bruno-First Demo Refactor

## Status
**Current Phase**: PR1 (cuts) + PR2 (api-walkthrough rewrite) complete and pushed (`d75be7c`)
**Status**: HANDED OFF — see [HANDOFF.md](./HANDOFF.md) for resume instructions
**Last Updated**: 2026-05-05T19:37:05Z
**Waiting For**: User direction on follow-up audits (refactor / release / linear / handoff-pickup consolidation)

## Progress

- [x] PR1 cuts (2026-05-05):
  - Deleted: `agents/browser-verifier.md`, `agents/teleport.md`, `agents/resume-agent.md`, `commands/teleport.md`, 4× `commands/*.md.tmpl`, `templates/fragments/metrics-tracking.md`, full `templates/fragments/`, `templates/`, `scripts/gen-skills.sh`, `scripts/teleport.sh`, empty `scripts/`.
  - Edited: `commands/feature-collab.md` (CodeRabbit Phase 6 removed; 7→6, 8→7, 9→8 renumber; suppressions block out of Phase 7; metrics block removed; browser-verifier ref out of Phase 8 demo step; demo-builder demoted to conditional non-API fallback; Quick Reference renumbered).
  - Edited: `commands/enhance.md` (CodeRabbit Phase 3 removed; 4→3, 5→4 renumber; suppressions block out of Phase 3; metrics block removed; CodeRabbit rationalization row removed).
  - Edited: `commands/spike.md`, `commands/bugfix.md`, `commands/refactor.md` — metrics blocks removed.
  - Edited: `commands/bugfix.md` — browser-verifier ref removed; demo step rewritten as conditional Bruno/showboat split; step renumber.
  - Edited: `agents/code-reviewer.md`, `agents/criteria-assessor.md`, `agents/code-security.md` — suppression check blocks removed.
  - Edited: `agents/retro-synthesizer.md` — metrics-file input bullet, Workflow Efficiency Analysis section, Workflow Efficiency output section, JSON `metrics` block, and field-derivation bullet all removed.
- [x] PR2 api-walkthrough rewrite (2026-05-05):
  - Rewrote `agents/api-walkthrough.md` — now writes to `~/Library/Application Support/bruno/<collection>/` (sibling to `rollfi-sandbox`); uses `bruno.json` + `collection.bru` + `environments/<env>.bru`; supports Bearer (login + `bru.setVar("authToken", ...)` capture) and Basic-auth patterns; documents numbered-dir (`00 Sanity`, `10 X`, `20 Y`) and numbered-file (`01 Login.bru`) conventions; every request gets `auth: inherit`, a `docs { }` block, and a `script:post-response` block that asserts status, validates response shape, and `bru.setVar()`s captured IDs for downstream chaining. The Bruno collection IS the proof — no separate DEMO.md for API changes.
  - Updated `commands/feature-collab.md` Phase 8 — Bruno destination now the workspace dir; demo-builder demoted to non-API fallback only.
  - Updated `commands/enhance.md` Phase 1 step 10 + Phase 4 step 2 — Bruno destination corrected; non-API enhancements skip demo with user confirmation.
  - Updated `commands/bugfix.md` — Bruno collection captures both regression + fix; .bru post-response scripts double as regression tests.

## Goal

Strip unused machinery from feature-collab. Replace ad-hoc demo phase with a focused, conditional Bruno-collection workflow that lands collections in the user's real Bruno workspace (`~/Library/Application Support/bruno/`) and follows existing walkthrough conventions (login + post-response token capture, numbered sequencing, environments).

## Investigation Findings (2026-05-05)

### 1. Metrics — written but barely read

- Writers: 5 command files (`feature-collab.md`, `enhance.md`, `spike.md`, `bugfix.md`, `refactor.md`) + `templates/fragments/metrics-tracking.md`.
- Readers: **only** `agents/retro-synthesizer.md` (and the file is marked "optional").
- On disk: **58 files** in `~/.feature-collab/metrics/` going back to March — they ARE being written, contrary to initial assumption.
- Content: bare counters only — `phases_executed`, `user_interventions`, `agent_dispatches`, etc. No qualitative info, no failure modes, no agent timings.
- Verdict: **low-signal**. Files exist but content rarely drives a retro decision — the synthesizer treats it as optional, and the schema is too thin to anchor anomaly detection. Either (a) enrich the schema with timing + per-agent dispatch counts + escalation reasons, or (b) rip out entirely. Probably (b) unless there's a concrete consumer planned.

### 2. browser-verifier — likely unused

- Defined: `agents/browser-verifier.md` (sonnet-tier, uses `uvx rodney`).
- Referenced: `feature-collab.md:964`, `bugfix.md:301`, `enhance.md.tmpl:290`, `bugfix.md.tmpl:225`. Conditional on "if web feature" — no enforcement, no checklist.
- No clear retro/log evidence the agent has ever been invoked.
- Overlap: `claude-in-chrome` MCP tools provide superior browser automation (real Chrome, console reads, screenshots, network reads). Rodney is a CLI shim doing less.
- Verdict: **remove**. If browser proof is needed, dispatch a code-explorer/code-architect with `mcp__claude-in-chrome__*` tools.

### 3. demo-builder — generic showboat capture, wrong default

- Defined: `agents/demo-builder.md` (haiku, heavy showboat focus).
- Always run in `feature-collab` Phase 9 (`uvx showboat verify DEMO.md` + final captures). Always run in `enhance` Phase 5 implicitly.
- Captures curls + sed/grep code walkthroughs into a markdown blob in the PR's `$DOCS_DIR/`.
- Issue: PR-local `DEMO.md` is rarely opened later. Not the right artifact for "is this API still working in staging next week?"
- Verdict: **demote to optional / replace with Bruno walkthrough as default for backend changes**. Keep showboat for rare CLI-tool demos (refactor proofs, build pipelines, data scripts) but stop running it unconditionally.

### 4. api-walkthrough — right concept, wrong destination

- Writes `.bru` files to `$DOCS_DIR/bruno/` (i.e., `docs/reidplans/$BRANCH/bruno/`).
- Generates `bruno.json` + `environments/staging.bru` + per-endpoint `.bru` with method/url/headers/body.
- Missing: login flow with token capture, ordered numbering convention, post-response scripts, integration with the user's actual Bruno workspace.
- The user's real workspace lives at `~/Library/Application Support/bruno/rollfi-sandbox/` and uses:
  - Numbered dirs: `00 Sanity`, `10 Employer Onboarding`, `20 Employee Onboarding`, ...
  - Numbered files: `01 Create Company.bru`, `02 Submit KYB.bru`, ...
  - `script:post-response` blocks that `bru.setVar("companyId", ...)` for downstream calls
  - `auth: inherit` + collection-level `collection.bru`
  - `environments/sandbox.bru` with `vars { baseUrl, ... }`
- Verdict: **rewrite** to write into the real workspace under a feature-named subcollection, and follow the rollfi-sandbox conventions exactly.

### 5. Broader cruft audit (2026-05-05)

| Item | Installed/Used? | Verdict |
|------|-----------------|---------|
| `coderabbitai` CLI (Phase 6 of feature-collab, Phase 3 of enhance) | **NOT INSTALLED** (`which coderabbitai` empty, npm global empty). 0 retros mention it. | **REMOVE entire phase from all skills.** Dead code. |
| `browser-verifier` agent + 4 refs | NOT invoked in any retro. `claude-in-chrome` MCP supersedes. | **REMOVE.** Confirmed. |
| `rodney` CLI | `uvx rodney` works. 2 retros mention it. Tied to browser-verifier. | **Drop from skills**, keep tool around for ad-hoc use. |
| `showboat` CLI | `uvx showboat` works. 2 retros mention it. | **Demote to optional fallback** — non-API demos only. |
| `*.md.tmpl` files (4: bugfix, enhance, refactor, spike) | Out of sync with `.md` files (different content). Templating system unmaintained — `.md` files edited directly. | **REMOVE.** Cruft. |
| `wip` CLI | `/Users/reid/bin/wip` exists. 1 retro mentions it. | **Keep** — but audit if every phase note adds value, or if it's noise. |
| Suppressions (`~/.claude/feature-collab/suppressions/`) | Commands write to `~/.claude/feature-collab/suppressions/` but the actual created dir is `~/.feature-collab/suppressions/` (empty). Path mismatch. | **REMOVE or fix path.** Currently dead. |
| `linear-issues` agent + skill | 0 retros mention it. | **Audit further.** Possibly keep — Linear may still be live for fast follows. |
| `commands/refactor.md` | Self-references only. No retros use `/refactor`. | **Probably remove** — `/enhance` covers refactors. |
| `commands/release.md` | Need to grep for usage. | **Audit.** |
| `agents/handoff.md` / `agents/pickup.md` / `agents/resume-agent.md` | Three overlapping context-save agents. | **Consolidate to one** (probably keep `pickup`, remove `handoff` + `resume-agent`). |
| `agents/teleport.md` (EC2 hourly-dev) | 0 retros. | **REMOVE** unless user actively uses. |
| `metrics/` writes | 58 files, only retro-synthesizer reads (optional). | **REMOVE** (decision locked). |

## Scope Boundaries (DRAFT — NOT YET LOCKED)

### In Scope (MVP)
- [ ] Decide fate of `metrics/` writes — rip out or enrich. Default: rip.
- [ ] Remove `browser-verifier` agent + all references. Document `claude-in-chrome` as the browser-proof path.
- [ ] Make demo phase **conditional** in `feature-collab`, `enhance`, `bugfix`, `refactor` skills:
  - **API/backend change** → run new `bruno-walkthrough` flow (writes to `~/Library/Application Support/bruno/<feature-collection>/`)
  - **Schema-only / internal refactor / UI-only** → no demo, just test-runner verification
  - **CLI / data pipeline / build tooling** → optionally fall back to showboat
- [ ] Build new `bruno-walkthrough` skill OR replace `api-walkthrough` agent. Must include:
  - Discovers / reuses an existing `00 Login` (or similar) request that captures auth token via `script:post-response` → `bru.setVar("token", ...)`
  - Uses numbered-dir + numbered-file convention from rollfi-sandbox
  - Writes `bruno.json`, `collection.bru`, `environments/<env>.bru`
  - Each new request inherits auth and chains via post-response env vars (companyId, employeeId, etc.)
  - Writes to user's real Bruno workspace, NOT `$DOCS_DIR/bruno/`
- [ ] Audit other suspected cruft (teleport, resume-agent, *.tmpl files); decide keep/cut.

### Explicitly Out of Scope
- Replacing test-runner / scope-guardian / criteria-assessor (these are working).
- Rewriting the orchestrator discipline rules (Iron Law, etc.).
- Migrating existing `~/.feature-collab/metrics/` files anywhere.

### Fast Follows (Future)
| ID | Item | Rationale |
|----|------|-----------|
| FF-1 | Add a `bruno-walkthrough` standalone skill (not just an agent) so users can invoke it outside fc workflows | Decouples Bruno collection authoring from full feature workflow |
| FF-2 | Bruno collection lint — verify post-response scripts capture expected vars | Catches drift |

## Decisions Locked (2026-05-05)

- **Metrics**: RIP. Remove writes from all 5 commands and the fragment template. Update `retro-synthesizer` to drop the metrics-file dependency.
- **Bruno destination**: SIBLING collections under `~/Library/Application Support/bruno/<feature-collection>/` (same level as `rollfi-sandbox`). Each feature gets its own collection.
- **Broader cruft audit**: GREENLIT. Audit teleport, resume-agent, *.tmpl files, CodeRabbit phase, refactor, wip CLI, suppressions, showboat/rodney, linear-issues.

## Open Questions

- [ ] Q: Do we keep PR-local `DEMO.md` at all? Default: keep only when not an API change (CLI/data/refactor proof). API changes → Bruno collection only, no DEMO.md.

## Concepts to Trace (next session)

- `wip` CLI integration — referenced everywhere; verify it still exists and is in active use.
- Suppressions (`~/.claude/feature-collab/suppressions/`) — referenced by enhance/feature-collab; check usage.
- `showboat` and `rodney` — uvx-installed; check whether `showboat verify` actually runs in CI or anywhere automated.
- CodeRabbit phase — every command has a Phase N for `npx coderabbitai review`. Does the user actually have/use this CLI? If not, that whole phase is cruft.
- Linear issues integration — `agents/linear-issues.md` + skill. Verify usage.

## Proposed Cuts (post-audit, ready for user sign-off)

### High confidence — cut
| Item | Action |
|------|--------|
| `~/.feature-collab/metrics/` writes — 5 commands + `templates/fragments/metrics-tracking.md` | Remove all `mkdir -p ~/.feature-collab/metrics` blocks and the metrics-tracking schema sections |
| `agents/browser-verifier.md` + 4 refs (`feature-collab.md:964`, `enhance.md.tmpl:290`, `bugfix.md:301`, `bugfix.md.tmpl:225`) | Delete agent file. Remove all conditional invocations. |
| CodeRabbit phase: `feature-collab.md` Phase 6, `enhance.md` Phase 3, plus refs in `bugfix.md`, `refactor.md`, `hotfix.md` | Delete entire phase from each skill |
| `commands/*.md.tmpl` (bugfix, enhance, refactor, spike) | Delete |
| `agents/teleport.md` + `commands/teleport.md` | Delete unless user objects |
| Suppressions: path mismatch + dir empty in practice | Delete suppression-write logic from feature-collab.md and enhance.md |
| `agents/resume-agent.md` (overlap with pickup) | Delete |

### Medium confidence — cut pending verification
| Item | Action |
|------|--------|
| `commands/refactor.md` + `agents/refactor.md` | Likely delete; verify zero usage in WIPs/branches |
| `agents/handoff.md` (overlap with pickup) | Consolidate into pickup or keep both with clearer separation |
| `agents/linear-issues.md` + `commands/linear-issues.md` | Verify Linear is still live; keep if so |
| `commands/release.md` | Verify usage; delete if 0 |

### Rewrite
| Item | Action |
|------|--------|
| `agents/api-walkthrough.md` writing to `$DOCS_DIR/bruno/` | Rewrite: write into `~/Library/Application Support/bruno/<feature-collection>/` as sibling to `rollfi-sandbox`. Adopt rollfi-sandbox conventions: numbered dirs (`10 X`, `20 Y`), numbered files (`01 First.bru`), `script:post-response` token/id capture, `auth: inherit`, `environments/<env>.bru`, `bruno.json`, `collection.bru`. |
| `demo-builder` Phase 9/Phase 5 invocations | Wrap in conditional: API change → bruno-walkthrough; non-API → showboat-only fallback or skip |

### Skill additions
| Item | Action |
|------|--------|
| New skill: `bruno-walkthrough` (or absorb into rewritten api-walkthrough agent) | Define login-and-capture-token convention. Document the chain: login → set token var → subsequent requests `auth: inherit`. Document numbered-dir convention. |

## Next Steps

1. User signs off on cut list.
2. Decide: ship as one `/feature-collab` (likely >200 lines across many files) or break into multiple `/enhance` PRs.
   - **Suggested split**:
     - PR1: cut metrics + browser-verifier + tmpl files + CodeRabbit phase + suppressions + teleport + resume-agent (pure deletes, mostly mechanical)
     - PR2: rewrite api-walkthrough + add bruno-walkthrough conventions, make demo conditional
     - PR3 (optional): consolidate handoff/pickup, audit refactor/release/linear
3. After sign-off, invoke `/feature-collab` or `/enhance` per chosen split. PLAN.md carries forward.

---

## Annotation Log
| Date | Phase | Annotation | Response |
|------|-------|------------|----------|
| 2026-05-05 | Discovery | Initial scope draft based on FS audit | Pending user review |
