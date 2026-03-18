## WIP Tracking

```bash
# At start: detect and activate wip item
wip get "$(git branch --show-current)" && wip status <item> ACTIVE && wip note <item> "Starting {{SKILL_NAME}}: {{DESCRIPTION}}"
# At phase transitions: wip note <item> "Phase N: [status]"
# When creating branches: wip add-branch <item> <branch>
# At completion: wip status <item> IN_REVIEW  (agent-managed — hooks won't overwrite)
# DONE status is set only after branch is merged (not by this skill)
# If wip get fails, skip tracking silently
```

`IN_REVIEW` tells hooks not to overwrite with ACTIVE/WAITING — preserves the status until a human acts.