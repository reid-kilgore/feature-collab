## Metrics Tracking

The orchestrator tracks workflow efficiency metrics for this session. These feed into retro baselines and anomaly detection.

**Schema** — maintain this object in working memory throughout the session:

```json
{
  "workflow_type": "{{WORKFLOW_TYPE}}",
  "started_at": "<ISO timestamp — set at skill start>",
  "phases_executed": 0,
  "user_interventions": 0,
  "agent_dispatches": 0,
  "dark_factory_escalations": 0,
  "scope_guardian_flags": 0,
  "criteria_not_ready_count": 0,
  "completed_at": null
}
```

**Increment rules**:
- `phases_executed` — increment at each phase boundary
- `user_interventions` — increment each time the orchestrator asks the user a question or waits for user input
- `agent_dispatches` — increment each time an agent is launched (parallel agents = N increments)
- `dark_factory_escalations` — increment when autonomous execution fails and the user is interrupted
- `scope_guardian_flags` — increment each time scope-guardian returns an actionable flag
- `criteria_not_ready_count` — increment each time criteria-assessor returns NOT READY

**Write metrics at workflow completion** (final phase, before PR/handoff):

```bash
mkdir -p ~/.claude/feature-collab/metrics
BRANCH=$(git branch --show-current)
DATE=$(date +%Y-%m-%d)
# Write the metrics JSON to ~/.claude/feature-collab/metrics/${DATE}-${BRANCH}.json
```

Individual agents do not need to know about metrics — this is orchestrator-only bookkeeping.