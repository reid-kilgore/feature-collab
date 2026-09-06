# Prompt Source Inventory — 2026-08-10

Every file that shapes agent behavior on this laptop, its deployed location, and its
canonical source. All entries below are first-hand: I listed, diffed, or read each path.

Canonical root: `/Users/reid/dev/meta-agent-repo/canonical-bundle/content`

## Claude Code

| Deployed | Kind | Canonical source | State |
|---|---|---|---|
| `~/.claude/CLAUDE.md` | global instructions | none | **POLLUTED** — real file, not versioned. `content/instructions/` is empty. |
| `~/.claude/skills/*` (18) | skills | `content/skills/<name>` | OK — symlinks. |
| `~/.claude/skills/codex` | skill | none | **POLLUTED** — real dir, not versioned. |
| `~/.claude/skills/restore-sessions` | skill | none | **POLLUTED** — real dir, not versioned. |
| `~/.claude/skills/drawbar` | skill | `/Users/reid/dev/fun_claude/drawbar` | Symlink to a *different* repo (fun_claude, untracked dir). |
| `~/.claude/commands/load-review.md` | command | `content/commands/load-review.md` | OK — symlink. |
| `~/.claude/commands/perf.md` | command | none | **POLLUTED** — real file, not versioned. |
| `~/.claude/hooks/on-prompt.sh`, `on-stop.sh`, `session-state.sh` | hooks | `content/hooks/panop-wip/` | OK — symlinks. |
| `~/.claude/hooks/caveman-*.js`, `package.json` | hooks | none | Third-party plugin residue (caveman). Not versioned. |
| `~/.claude/agents/` | agents | `content/agents/` | Both empty. No global agents deployed. |
| `~/.claude/plugins/installed_plugins.json` | plugin registry | none | feature-collab is **not listed**. Installed: feature-dev, supervise, swift-lsp, ts-lsp, caveman, gh-checks. |
| `~/.claude/plugins/data/feature-collab-*` (2 dirs) | plugin state | n/a | **STALE** — leftover state for an uninstalled plugin. |

## Codex

| Deployed | Kind | Canonical source | State |
|---|---|---|---|
| `~/.codex/AGENTS.md` (7.7 KB) | global instructions | none | **POLLUTED** — real file, not versioned anywhere. |
| `~/.codex/rules/default.rules` (23 KB) | approval allowlist | none | Not versioned, but **not an instruction file**. 17 `prefix_rule` entries only; most of the 23 KB is embedded SQL and one whole `codex exec` command captured as a literal allow-rule. Moot in practice because `approval_policy = "never"`. Does not shape reasoning. |
| `~/.codex/skills/meta-agent-core/*` (17) | skills | `content/skills/<name>` | OK — symlinks. |
| `~/.codex/skills/hourly` | skill | none | **POLLUTED** — real dir, not versioned. |
| `~/.codex/skills/.system/*` (6) | skills | vendor | Codex built-ins. Expected. |
| `~/.codex/config.toml` | config | none | Not versioned. Sets `model = gpt-5.6-sol`, `model_reasoning_effort = high`, `approval_policy = never`, `sandbox_mode = danger-full-access`. |

## Canonical bundle — coverage gaps

| Canonical path | Files | Note |
|---|---|---|
| `content/skills/` | 18 | Real content. This is the only well-governed surface. |
| `content/commands/` | 1 | `load-review.md` only. |
| `content/hooks/` | 3 | `panop-wip` only. |
| `content/plugins/` | 3 | gh-checks only. |
| `content/codex/` | 5 | gh-checks plus a marketplace file. |
| `content/codex/plugins/feature-collab/{agents,commands,skills}` | 0 | **HOLLOW** — directories exist, all empty. |
| `content/agents/` | 0 | Empty. |
| `content/instructions/` | 0 | Empty. This is where `CLAUDE.md` and `AGENTS.md` belong. |

## Repository states

- `meta-agent-repo` — level with `origin/main`. Dirty: `content/skills/retro/SKILL.md` modified and
  uncommitted, plus untracked `docs/FEATURE_COLLAB_SYSTEM_RETRO.md` and `docs/reidplans/`.
- `/Users/reid/dev/fun_claude` — this **is** the `feature-collab` checkout
  (`git@github.com:reid-kilgore/feature-collab.git`). HEAD is **5 commits ahead** of `origin/main`.
  Dirty: 6 plugin files modified, 2 retro agent files deleted, roughly 40 untracked directories.
  Nothing in `feature-collab/plugins/feature-collab` is installed or loaded by either agent.

## Conclusion

The GitHub `feature-collab` tree is not the source of truth. It is five commits and a dirty
working tree behind the laptop, and the plugin it holds is not installed in Claude Code at all.

Skills are the one governed surface: 35 of 35 skill symlinks resolve into `meta-agent-repo`.

Everything that is *not* a skill is ungoverned. `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
sit in context on every turn and existed in no repository until this inventory was written.

**Correction to an earlier hypothesis.** I first suspected the 31 KB of `AGENTS.md` plus
`default.rules` was driving the Codex overwork. Reading both files disproves it.
`default.rules` is an approval allowlist with no instructional content, and `approval_policy`
is set to `never` anyway. `AGENTS.md` is a close mirror of `CLAUDE.md`: model-tier selection,
commit delegation, CI notes, and style. Neither file tells any agent to review repeatedly.

## The real mechanism

The framework is not incoherent. It is unenforced and mostly unloaded.

1. **The rules are good and specific.** `content/skills/feature-collab/SKILL.md` sets a hard
   **six-invocation ceiling**, permits exactly **one reviewer retry**, and says to stop and ask
   the user rather than review again. It forbids precisely the behavior being observed.
2. **The rules are rarely loaded.** All 112 Codex sessions in the last five days list the
   feature-collab skill, because skill descriptions are always advertised. Only **18 of 112**
   ever contain the words that carry the ceiling, meaning the skill body was actually read into
   context in about 16 percent of sessions.
3. **Enforcement is partial for Claude and absent for Codex.** Six hooks exist in the plugin
   with a `hooks.json` that wires them to `PreToolUse` and `PostToolUse`. Hook output appears in
   15 of 41 Claude Code sessions from the last five days, so they do fire. But every hook gates
   on "feature-collab active", meaning a `SESSION_STATE.md` within five parent directories;
   without that file each hook returns allow. `SESSION_STATE.md` appears in 25 of 41 sessions.
   Codex has no hook mechanism registered at all.

   **None of the six caps review count.** `h1` refuses main-thread edits and commits, `h2`
   demands a fresh typecheck before an Agent dispatch, `h5` warns on silent skips, `h6` restricts
   who may write `current_state`, and the test-spec lock blocks entry to implementation. The one
   failure mode actually costing you time — a fourth release review — passes every one of them.
4. **A curated agent roster exists, and only Claude Code can reach it.** The feature-collab
   plugin holds **29 agent files, 3,283 lines**, including exactly the roles Codex kept
   re-inventing: `code-reviewer`, `code-verifier`, `code-security`, `code-architect`,
   `code-explorer`, `test-runner`, `test-implementer`, `pr-creator`, `pre-commit-gates`,
   `commit-splitter`, `criteria-assessor`, and — most pointedly — `scope-guardian` (181 lines)
   and `transition-decider` (102 lines), which are the anti-scope-creep and when-to-stop agents.
   The canonical Codex path `content/codex/plugins/feature-collab/agents/` is **empty**. So Codex
   has nothing to select and invents a name every time.

**Correction to the plugin claim.** I earlier wrote that the feature-collab plugin is installed
nowhere, on the basis of its absence from `installed_plugins.json`. That was wrong for Claude
Code. `known_marketplaces.json` registers `feature-collab-marketplace` as a *directory* source
pointing at `/Users/reid/dev/fun_claude/feature-collab`, and the agents resolve through it: in
the last five days Claude Code spawned `feature-collab:code-architect` 64 times,
`feature-collab:code-reviewer` 50 times, `feature-collab:code-explorer` 26 times,
`feature-collab:code-security` 17 times, plus `enhance` and `test-runner`. The plugin is live for
Claude and absent for Codex. The enforcement *hooks* in that plugin are still unregistered.

## The measured asymmetry

| | Claude Code | Codex |
|---|---|---|
| Agent spawns, 5 days | 750 | 94 |
| Drawn from a named roster | 581 (77%) | 0 |
| Ad-hoc or unset | 169 (23%) | 94 (100%) |
| Distinct names invented | n/a — types are reused | 94 of 94 |
| Review-shaped share | 210 of 750 (28%) | 40 of 94 (43%) |

This is the answer to "this never happened with Claude." Claude Code reuses about a dozen agent
types across 750 spawns because a roster is loaded and reachable. Codex invents a fresh agent for
every delegation because its roster directory is empty. The invocation ceiling in the skill is
the same for both; only Claude has the named roles that make the ceiling mean anything.

Measured result over five days: 94 Codex subagents, **94 distinct one-off names**, zero reuse.
Classified by name, 40 are review, audit, or check agents against only 17 implement or fix
agents, and 29 carry retry, recheck, final, exception, or numbered-round markers. The invite-flow
work alone spawned about 17 subagents, including `invite_flow_release_review_two`, `_three`, and
`_four`, plus `invite_flow_final_reviewer` and `invite_flow_final_release_review` — against a
documented ceiling of six.

## Retro corpus already on disk

- `~/.feature-collab/retros/` — 106 dated session retros, March through August, 1.3 MB total,
  17 written in the last 14 days. Consistent structure: Verdict, Scores, Key Findings,
  Key Themes, Root Causes, Recommendations, Encodings Applied.
- `~/.feature-collab/retros/system/2026-08-02-feature-collab/` — one prior *system* retro,
  14 files including `system-retro.md`, `system-retro.json`, `workflow-analysis.md`,
  `runtime-analysis.md`, `outcome-analysis.md`, `timeline.md`, and the prompts used.
- `~/.feature-collab/metrics/` — per-session JSON metrics, same naming scheme as the retros.
- `/Users/reid/dev/fun_claude/feature-collab/*RETRO*.md` — 12 loose untracked retro documents.
- `/Users/reid/dev/meta-agent-repo/docs/FEATURE_COLLAB_SYSTEM_RETRO.md` — 1 untracked.

Total: about 120 existing retro documents, all readable, no transcript mining required.
