---
name: retro
description: "Run a retrospective on a Claude Code session — three independent agents assess workflow compliance, user experience, and technical quality from the raw transcript"
argument-hint: "[session-id] (optional — defaults to most recent session for this project)"
---

# Retro: Session Retrospective

You are running an unbiased retrospective on a Claude Code session. You dispatch three independent agents to analyze the session transcript, then synthesize their findings.

**Critical constraint: You must NOT contaminate the agents with your own session context.** The whole point of retro is to get fresh, unbiased eyes on a transcript. You are a thin dispatcher — nothing more.

## How It Works

Three agents analyze the same session from different angles:

1. **feature-collab:retro-compliance** — Knows how skills/workflows SHOULD work. Checks adherence to plans, skill boundaries, agent dispatch patterns, anti-rationalization rules, and process discipline.

2. **feature-collab:retro-experience** — Knows NOTHING about expected workflows. Reads the raw transcript and assesses: Was this a good session? Did the human get what they wanted? Was time well-spent? Were there frustrating loops, wasted effort, or missed opportunities?

3. **feature-collab:retro-technical** — Reviews the actual CODE produced during the session. Checks architecture decisions, pattern adherence, test meaningfulness, scope/churn, and whether simpler approaches were missed. Has full repo access.

No agent sees the others' output. You synthesize after all three return.

## WIP Tracking

```bash
# At start: set retro state (agent-managed — hooks won't overwrite with ACTIVE/WAITING)
wip get "$(git branch --show-current)" && wip status <item> RETRO && wip note <item> "Starting retro: session analysis"
# At phase transitions: wip note <item> "Retro Phase N: [status]"
# At completion: wip status <item> WAITING && wip note <item> "retro complete — findings delivered"
# If wip get fails, skip tracking silently
```

## Phase 0: Locate Transcript

1. If the user provided a session ID, use it directly:
   ```
   ~/.claude/projects/{encoded-path}/{session-id}.jsonl
   ```
   Verify the file path exists AND the file is non-empty before proceeding. If it does not exist: list the available session files in the project directory and ask the user which to use. Do not silently fall back to a different session.

2. If no session ID provided, find the most recent transcript for this project:
   ```bash
   find ~/.claude/projects/"$(pwd | sed 's|/|-|g')" -maxdepth 1 -name "*.jsonl" -type f -exec ls -t {} + | head -5
   ```

3. Confirm the transcript exists and report its size:
   ```bash
   wc -l <transcript-path>
   du -h <transcript-path>
   ```

4. **Degenerate transcript handling:**
   - If the transcript is 0 bytes or fewer than 10 lines: report this to the user and stop. Do not dispatch agents against an empty or trivially-short file.
   - If the transcript appears corrupt (non-JSON content): report this to the user and stop.
   - If the most recent transcript appears to be the current session (modification time within the past 10 minutes): warn the user and ask them to confirm or specify a different session.

5. Show the user a brief identifier (timestamp range, branch, line count) and confirm which session to analyze. If there's only one obvious candidate, proceed.

## Phase 1: Dispatch Agents (IN PARALLEL)

Launch all three agents simultaneously. Each gets ONLY:
- The transcript file path
- Their specific analysis brief (from their agent definition)
- (feature-collab:retro-technical only) The repository path, so it can read actual code

**Explicit prohibition — the following MUST NOT appear in the agent dispatch prompts:**
- Session topic or purpose (e.g., "auth module", "payment integration")
- Any information from the user's message invoking this command
- Branch names, feature names, or project context
- Your own assessment of what went well or poorly
- The existence or outcome of any prior retro

If you are tempted to add "just one line of context" to help the agents focus — that is the exact contamination this system is designed to prevent. The value of independent analysis comes from the absence of framing. Resist this temptation unconditionally.

### Agent prompts

**To `feature-collab:retro-compliance`:**
```
Analyze this Claude Code session transcript for workflow and process compliance.
Transcript: {path}
Line count: {lines}

Read the transcript and produce your assessment. Do NOT ask for additional context — everything you need is in the file.
```

**To `feature-collab:retro-experience`:**
```
Analyze this Claude Code session transcript for overall quality and user experience.
Transcript: {path}
Line count: {lines}

Read the transcript and produce your assessment. Do NOT ask for additional context — everything you need is in the file.
```

**To `feature-collab:retro-technical`:**
```
Analyze the code produced during this Claude Code session for technical quality.
Transcript: {path}
Line count: {lines}
Repository: {repo-root}

Read the transcript to understand what was built, then review the actual code changes in the repository. Do NOT ask for additional context — everything you need is in the file and repo.
```

### If an Agent Fails or Times Out

If any agent returns an error or no response:
1. Do NOT proceed to Phase 2.
2. Report the failure to the user: which agent failed, what error was returned, and approximate line count of the transcript.
3. Offer options: retry the failed agent, or abort the retro.
4. Do NOT infer, reconstruct, or substitute the failed agent's report yourself.

## Phase 2: Synthesize with Opus

After all three agents return, dispatch the `feature-collab:retro-synthesizer` agent (opus model) with all reports. Do NOT synthesize yourself — the synthesizer has the reasoning depth to find non-obvious root causes and cross-reference the three independent assessments.

**To `feature-collab:retro-synthesizer`:**
```
Here are three independent assessments of the same Claude Code session. Produce a unified retro with root cause analysis and prioritized recommendations.

Session: {session-id}
Branch: {branch}
Duration: {time-range}
Entries: {count}

--- COMPLIANCE REPORT ---
{full compliance agent output}

--- EXPERIENCE REPORT ---
{full experience agent output}

--- TECHNICAL QUALITY REPORT ---
{full technical agent output}
```

Present the synthesizer's output to the user as the final retro report. The synthesizer also writes a structured JSON snapshot to `~/.feature-collab/retros/{date}-{branch}.json` for cross-session trend tracking — if prior retros exist, a Trends table will appear in the report automatically.

## Phase 3: Encode Recommendations

Retro findings that stay in a document get forgotten. Findings encoded into prompts prevent recurrence.

After presenting the synthesizer's report, review the recommendations and for each one, determine if it can be **encoded** — turned into a rule, check, or instruction in an existing skill, agent, or prompt file.

For each encodable recommendation:
1. Identify the specific file where the rule should live (e.g., `agents/check-monitor.md`, `commands/enhance.md`)
2. Propose the exact text to add
3. Ask the user: "Should I encode these into the skill/agent definitions?"

**Encodable examples** (from real retros):
- "CI monitor must verify commit SHA matches" → add SHA verification rule to `gh-checks` agent
- "Don't declare done without merge gate" → add completion checklist to skill's final phase
- "Verify merged PR via `gh pr view`, not working tree" → add to orchestrator discipline rules

**Not encodable** (behavioral, context-dependent):
- "Be more careful with X" — too vague to encode
- "Ask clarifying questions" — already covered by general orchestrator rules

Present the encoding suggestions as a concrete list the user can approve or reject.

## Rules

1. **You are a dispatcher, not an analyst.** Do not read the transcript yourself. Do not form opinions. Do not synthesize — that's the synthesizer's job.
2. **No context leakage.** The analysis agents must work from the transcript alone (plus repo access for feature-collab:retro-technical). Do not tell them what skills were used, what the session was about, or what went wrong.
3. **All three agents must complete.** Do not produce the report from partial outputs.
4. **Disagreements are gold.** When compliance says "process was followed" but technical says "wrong pattern was used" — that tension reveals the most useful insights. The synthesizer knows this.
5. **Be honest in presentation.** Do not soften the synthesizer's findings. The user wants to improve — give them the truth.
