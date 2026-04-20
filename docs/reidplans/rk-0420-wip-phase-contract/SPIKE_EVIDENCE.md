# Demo: evidence for spike findings

Research-only spike — no executable prototype. Evidence is the live source tree, citable at these commands:

## Nasqueron send-to-Claude blast radius
```bash
sed -n '510,530p;570,590p' /Users/reid/dev/fun_claude/swiftui-play/Sources/WipDetailView.swift
sed -n '105,135p' /Users/reid/dev/fun_claude/swiftui-play/Sources/TmuxService.swift
```

## Nasqueron polling hotspots
```bash
grep -nE 'Timer|\.schedul|refreshSessions|loadActive|loadDone' \
  /Users/reid/dev/fun_claude/swiftui-play/Sources/ContentView.swift \
  /Users/reid/dev/fun_claude/swiftui-play/Sources/WipViewer.swift
```

## wip state model is already extensible (arbitrary `set`)
```bash
sed -n '260,300p;370,390p' /Users/reid/dev/fun_claude/feature-collab/wip
# cmd_list renderer (needs phase column): lines 266–275
# cmd_status validator (needs new enum): line 289
# cmd_set arbitrary-key support (usable for phase today): lines 371–385
```

## Hook agent-managed guard (keep as-is)
```bash
sed -n '40,55p' /Users/reid/.claude/hooks/on-stop.sh
```

## `wip children` is project-lead-only
```bash
grep -rn 'wip children' /Users/reid/dev/fun_claude/feature-collab/plugins /Users/reid/dev/fun_claude/feature-collab/collab-manager.skill 2>/dev/null
# expected: hits only in commands/project-lead.md
```

## wip invocations across skills (the migration surface)
```bash
grep -rEn 'wip (status|note|set|add-branch|branch-status|children|start)' \
  /Users/reid/dev/fun_claude/feature-collab/plugins/feature-collab/commands | wc -l
```
