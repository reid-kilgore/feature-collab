# Handoff Notes

**Created**: 2026-03-28
**Reason**: Moving to feature-collab for Linear session start and PLAN annotation features
**Feature**: WipViewer — SwiftUI macOS app for wip tool

## Current State

**Phase**: Spike + enhance complete. Two new features scoped and ready to build.
**Sub-phase**: Iterative UI polishing done. App is functional with list, detail, notes, status changes, PR links, markdown plan rendering.
**Waiting For**: User to kick off `/feature-collab` for either LINEAR_SESSION_START.md or PLAN_ANNOTATION.md

## What Was Accomplished This Session

- **Spike**: Researched building single-file SwiftUI apps from CLI. Key finding: `.app` bundle with `Info.plist` (NSPrincipalClass) is REQUIRED for windows to appear. Bare executables never show UI.
- **Built WipViewer.swift**: ~550 line single-file SwiftUI app that reads `wip list --json`, shows items in a sidebar with status badges, detail view with notes/branches/PR links, markdown PLAN.md rendering via WKWebView with mdannotate's renderer, status changes via gear menu, note adding, keyboard shortcuts (d=done, x=blocked).
- **Performance work**: Split loading into fast active-items poll (2s, every 1s) and slow done-items load (10ms via direct NDJSON read). PR URLs cached in store to avoid re-fetching.
- **Brainstormed ~70 ideas** for the wip ecosystem (IDEAS.md, DETAILS.md)
- **Scoped two features** with full writeups (LINEAR_SESSION_START.md, PLAN_ANNOTATION.md)

## What Needs to Happen Next

1. **Pick one of the two features to build first**:
   - `LINEAR_SESSION_START.md` — Cmd+L → type PAS-123 → creates worktree + tmux window + starts Claude
   - `PLAN_ANNOTATION.md` — Embed mdannotate editor in WKWebView for in-app CriticMarkup annotation

2. **For Linear Session Start** (if chosen first):
   - Read LINEAR_SESSION_START.md for full spec
   - Shell out to `wip _start_linear "PAS-123" "slug"` (Option A — reuse existing wip command)
   - tmux commands work from .app via `/opt/homebrew/bin/tmux` (verified)
   - Need to handle: Linear cache refresh, slug generation, tmux detection, error states

3. **For Plan Annotation** (if chosen first):
   - Read PLAN_ANNOTATION.md for full spec
   - Run `cd ~/dev/fun_claude/web && npm run build` to produce dist/
   - Load dist/index.html into WKWebView via `loadFileURL`
   - Use WKScriptMessageHandler to get annotated content back
   - Inject JS to hide irrelevant buttons, add "Done" button

4. **Bug to fix**: Done items DisclosureGroup in sidebar doesn't appear (data loads but UI may not render — needs debugging)

## Key Learnings & Context

### SwiftUI from CLI — Critical Knowledge
- **`.app` bundle is non-negotiable** — bare executables compile and run but macOS window server ignores them. No window ever appears.
- **Pattern**: `@main` struct with `@NSApplicationDelegateAdaptor` + `Settings { EmptyView() }` body. Real UI via AppDelegate + NSWindow + NSHostingView.
- **Compile**: `swiftc -parse-as-library -framework SwiftUI -framework AppKit -framework WebKit -o App.app/Contents/MacOS/App App.swift`
- **Run**: `open App.app` (NOT `./App`)
- **Info.plist** must have `NSPrincipalClass = NSApplication`. For menu bar apps add `LSUIElement = true`.

### Shell Commands from .app
- .app bundles do NOT get login shell PATH. Use `/opt/homebrew/bin/tmux` (full path) or `/bin/zsh -l -c "..."` (slower).
- tmux socket at `/private/tmp/tmux-$(id -u)/default`
- `wip` is at `~/bin/wip` (symlink). The shell helper uses `/bin/zsh -l -c` which sources profile and gets PATH.

### wip Tool Internals
- Data: NDJSON in `~/panop/*/work.txt`. 257 items, 247 DONE.
- `wip list --json` (active only) takes ~2s. `wip list --json --all` takes ~10s. Direct NDJSON read takes ~10ms.
- `gwt` is a **zsh function** in ~/.zshrc, NOT a binary. Must be called from interactive zsh.
- `wip _start_linear "PAS-123" "slug"` does: lookup in Linear cache → write launcher script → tmux new-window running gwt → poll for PLAN.md → patch with Linear content → link linear_id.
- Linear cache at `~/panop/.wip-linear` (JSONL). Auto-refreshes if >2min stale.

### PR Lookup
- `gh pr list --head "branch" --json url --jq '.[0].url'` — ~275ms, returns empty if no PR.
- Must `cd` to the repo dir first (use item's `loc` field).

### mdannotate
- Web app at `~/dev/fun_claude/web/` — vanilla JS, Vite build, no external deps.
- Editor is a raw `<textarea>` with regex-based CriticMarkup parsing.
- `renderMarkdown()` in preview.js is already embedded in the app's WKWebView for the Plan tab.
- For annotation: load the full editor (need `npm run build` first), inject content via JS, get back via WKScriptMessageHandler.

### Performance Notes
- 1-second polling with `wip list --json` works fine (~2s per call, guard prevents overlap).
- Done items loaded via direct `find ~/panop -name work.txt | jq` — instant.
- PR URLs cached in `WipStore.prStates` dictionary — fetch once per branch, survives view switches.

## Files to Read on Resume

1. **This file** (HANDOFF.md) — session context and learnings
2. **PLAN.md** (at repo root `./PLAN.md`) — spike findings and SwiftUI templates
3. **WipViewer.swift** — the main app source (~550 lines)
4. **LINEAR_SESSION_START.md** — feature spec for Linear workflow
5. **PLAN_ANNOTATION.md** — feature spec for in-app annotation
6. **IDEAS.md** — full brainstorm of 70+ ideas
7. **DETAILS.md** — explanations for complex ideas

## File Layout

```
swiftui-play/
  WipViewer.swift              ← main app source
  WipViewer.app/               ← .app bundle (binary + Info.plist)
  PLAN.md                      ← spike findings (SwiftUI CLI knowledge)
  IDEAS.md                     ← brainstorm ideas
  DETAILS.md                   ← idea explanations
  LINEAR_SESSION_START.md      ← feature spec
  PLAN_ANNOTATION.md           ← feature spec
  spike-scratch/               ← hello world prototypes (can ignore)
  docs/reidplans/rk-swiftui-cli-spike/
    PLAN.md                    ← enhance-phase plan (stale — root PLAN.md is canonical)
    HANDOFF.md                 ← this file
```

## Open Questions

- [ ] Done items DisclosureGroup doesn't render in sidebar — needs debugging (data loads correctly, UI issue)
- [ ] Should Linear Session Start auto-launch Claude or just open the tmux window? (current spec: auto-launch)
- [ ] For Plan Annotation: load from filesystem (~/dev/fun_claude/web/dist/) or bundle into .app? (current recommendation: filesystem)

## Warnings

- Do NOT try to run the binary directly (`./WipViewer`) — it will hang with no window. Always use `open WipViewer.app`.
- The `gwt` function only works from interactive zsh (it's in ~/.zshrc). Shell-out with `-l` flag or call `wip _start_linear` which handles this.
- `wip list --json --all` takes 10 SECONDS. Never put it in the 1-second poll loop. Use direct NDJSON read for done items.
- The app uses `globalKeyHandler` (file-level var) as a bridge from AppDelegate's NSEvent monitor to ContentView's SwiftUI state. This is a workaround because SwiftUI's `.onKeyPress` doesn't work reliably with List focus.
