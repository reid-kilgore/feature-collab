# gstack Analysis: Insights for feature-collab

## Executive Summary

gstack is Garry Tan's personal Claude Code skill system — 13 skills forming a complete SDLC pipeline (plan → review → implement → QA → ship → retro). It's production-hardened, opinionated, and has several patterns that feature-collab either lacks entirely or implements less effectively. The two systems have different philosophies (gstack is role-based sequential pipeline; feature-collab is phase-based with parallel adversarial agents), but there are ~10 concrete insights worth adopting.

---

## What gstack Does Well (That We Don't)

### 1. WTF-Likelihood Budget — Quantitative Stopping Heuristic

**gstack pattern:** Every autonomous fix loop has an explicit risk formula:
```
Each revert: +15%
Each fix touching >3 files: +5%
After fix 15: +1% per additional fix
Touching unrelated files: +20%
If WTF > 20%: stop and ask. Hard cap at 50 fixes.
```

**Our gap:** feature-collab's dark factory escalates after "5 failure cycles" (implementation) or "3 cycles" (criteria), but this is a blunt count. It doesn't weight *severity* of failures. A single revert of a 200-line change should trigger escalation faster than 3 minor test fixes.

**Proposal:** Add a risk-budget formula to `code-architect` and `code-reviewer` agents. Track reverts, file-spread, and fix count. Escalate based on accumulated risk, not just iteration count.

### 2. Fix-First Heuristic (AUTO-FIX vs ASK Classification)

**gstack pattern:** Code review findings are classified before presentation:
- **AUTO-FIX:** dead code, missing validation, magic numbers, stale comments — applied silently
- **ASK:** security, race conditions, design decisions, >20 line changes — batched into single question

**Our gap:** `code-reviewer` and `code-security` agents report all findings equally. The orchestrator presents everything to the user, creating review fatigue. No distinction between mechanical fixes and judgment calls.

**Proposal:** Add a confidence/severity matrix to reviewer agents. Findings above a confidence threshold for mechanical categories get auto-fixed. Judgment calls get batched into a single user question with lettered options.

### 3. Persistent Cross-Session State

**gstack pattern:** Structured state persists to `~/.gstack/projects/{slug}/`:
- Review results (JSONL logs)
- CEO plans
- Greptile false-positive history (learning loop)
- QA report baselines (regression comparison)
- Retro history (week-over-week trending)

**Our gap:** feature-collab's persistence is HANDOFF.md (unstructured prose) and memory files. No structured, machine-readable state that future sessions can query. Each session re-discovers everything.

**Proposal:** Create a `~/.claude/projects/{slug}/` structure with:
- `reviews.jsonl` — structured review outcomes per branch
- `retro-history/` — JSON snapshots for trending
- `qa-baselines/` — health scores per page for regression detection
- `suppressed-findings.json` — known false positives from linters/reviewers

### 4. Diff-Scoped Verification

**gstack pattern:** `bin/gstack-diff-scope` parses `git diff main...HEAD --name-only` and outputs `SCOPE_FRONTEND=true/false`, `SCOPE_BACKEND=true/false`. QA only exercises pages affected by changed files. Design review only triggers when frontend files changed.

**Our gap:** feature-collab's `code-verifier` generates TEST_SPEC.md from CONTRACTS.md, but doesn't narrow scope based on what actually changed. The browser-verifier runs full walkthroughs regardless of diff.

**Proposal:** Add a `diff-scope` step early in the workflow that maps changed files → affected components → required verification. Feed this into test-runner and browser-verifier to skip unaffected areas.

### 5. Template-Driven Skill Generation

**gstack pattern:** `SKILL.md.tmpl` files contain prose + `{{PLACEHOLDER}}` tokens. A build script (`gen-skill-docs.ts`) fills placeholders from source code (command registries, flag definitions). Output SKILL.md is committed and validated in CI — docs can never drift from implementation.

**Our gap:** All our agent/command markdown is hand-maintained. When we add a new agent or change a pattern, we manually update every file that references it. Cross-cutting concerns (like the orchestrator iron laws) are copy-pasted across commands.

**Proposal:** Extract shared blocks (orchestrator rules, model tiering table, escalation protocol) into template fragments. Build a simple generator that composes them into final command/agent files. Validate in CI that generated files match templates.

### 6. Structured Question Format as Cross-Skill Contract

**gstack pattern:** Every user-facing question follows rigid format:
1. Re-ground (project + branch + what we're doing)
2. Simplify to ELI16 English
3. Recommend with Completeness score per option
4. Lettered options with time estimates

Design assumption: "user hasn't looked at this window in 20 minutes."

**Our gap:** feature-collab's user-facing questions vary by agent and phase. No consistent format. No re-grounding for users running parallel sessions.

**Proposal:** Define a question format contract in the orchestrator rules. Every AskUserQuestion from any phase must re-ground context, provide a recommendation, and offer lettered options. This is especially important for dark-factory escalations where the user has been hands-off.

### 7. Bisectable Commit Splitting

**gstack pattern:** `/ship` analyzes the full diff and groups changes into logical, independently-buildable commits: infrastructure → models+tests → controllers+tests → version+changelog.

**Our gap:** feature-collab commits are ad-hoc — whatever the commit agent produces. No structural reasoning about commit ordering or bisectability.

**Proposal:** Add a commit-splitting step to Phase 9 (or as part of the commit agent). Analyze the diff, group by dependency layer, produce commits that each pass tests independently.

---

## What gstack Does Well (That We Already Do, Differently)

### 8. Multi-Stakeholder Review → We Have Adversarial Agents

gstack uses role-based reviews (CEO, Eng Manager, Designer). We use adversarial agents (scope-guardian, criteria-assessor, test-gap-finder). Both achieve the same goal: multiple perspectives catch what a single perspective misses. **Our approach is arguably stronger** because adversarial agents are explicitly incentivized to find problems, while role-based agents may rubber-stamp.

**Minor enhancement:** Consider adding a "product perspective" agent that reviews from the user's POV — not adversarial, but asking "does this actually solve the user's problem?" This is what gstack's CEO review does well.

### 9. Retro System → We Have 4-Agent Retro

gstack's retro is git-analytics-focused (LOC, session times, test ratios, team attribution). Ours is transcript-focused (compliance, experience, technical code review, synthesis). **Both approaches have value.**

**Enhancement:** Add git-analytics metrics to our retro-technical agent. LOC counts, test-to-production ratio, session duration, and week-over-week trending would complement the code review findings.

### 10. Completeness Principle → We Have Scope Guardian

gstack's "Boil the Lake" is a philosophical principle embedded in every skill. Our scope-guardian is an adversarial enforcer. Same goal, different mechanism.

**Enhancement:** The "Boil the Lake" framing with explicit compression ratios (100x for boilerplate, 50x for tests) is useful for user-facing recommendations. When presenting options, include the effort multiplier.

---

## What gstack Does That We Should NOT Adopt

### Role-Based Sequential Pipeline
gstack's `/plan-ceo-review` → `/plan-eng-review` → `/plan-design-review` → `/ship` pipeline assumes a single human running skills in order. Feature-collab's phase model with parallel agent dispatch is more powerful for automated workflows. Don't regress to sequential.

### Browser as Primary QA Surface
gstack's QA is heavily browser-based (navigate pages, check console, screenshot bugs). This makes sense for web apps but isn't generalizable. Our test-based verification is more portable.

### Self-Upgrade Mechanism
gstack's self-update (check GitHub VERSION, download, swap) adds complexity we don't need since feature-collab is a plugin managed differently.

---

## Prioritized Implementation Plan

| Priority | Insight | Effort | Impact |
|----------|---------|--------|--------|
| **P0** | WTF-likelihood budget for dark factory | Small (formula in 2 agents) | High — prevents runaway autonomous editing |
| **P0** | Fix-First heuristic for code-reviewer | Medium (classification logic) | High — reduces review fatigue dramatically |
| **P1** | Structured question format contract | Small (add to orchestrator rules) | Medium — consistency across parallel sessions |
| **P1** | Diff-scoped verification | Medium (new diff-scope step) | Medium — faster verification, less noise |
| **P1** | Persistent cross-session state | Medium (new directory structure) | Medium — enables trending, learning |
| **P2** | Template-driven skill generation | Large (build system + migration) | Medium — prevents doc drift long-term |
| **P2** | Bisectable commit splitting | Medium (new commit analysis step) | Low-Medium — nice for review/debugging |
| **P2** | Git analytics in retro | Small (add to retro-technical) | Low — supplements existing retro |
| **P3** | Product perspective agent | Small (new agent definition) | Low — nice-to-have |
| **P3** | Compression ratios in recommendations | Small (text additions) | Low — better framing |

---

## Key Architectural Insight

gstack's deepest insight is that **LLM workflows need the same production-hardening as production code**: failure modes discovered in practice get encoded as permanent constraints (CHANGELOG clobber protection, Greptile false-positive suppression, AI slop detection). Feature-collab already does this through the retro → encode cycle, but gstack makes it more systematic with persistent state files that accumulate knowledge across sessions.

The single most valuable pattern to steal is the **false-positive suppression loop**: when a reviewer flags something that turns out to be a non-issue, record it so it's never flagged again. This applies to our code-reviewer, code-security, and criteria-assessor agents. Over time, the system gets smarter and less noisy.
