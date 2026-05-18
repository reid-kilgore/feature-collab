# Spike: iOS Screen-Time Control Gated by Anki Study

## Question

Build a personal iOS app (Brick-like) that blocks chosen apps + websites until the
user "earns" an unblock by either (1) using the Anki app, or (2) doing flashcards
inside our app. Plus a persistent personal scoreboard (time, cards, streaks).

Determine feasibility across: screen-time control, Anki data access, flashcard
reimplementation, persistence, and personal-use distribution.

## Status
**Current Phase**: Complete
**Completed**: 2026-05-18

---

## Findings

### F1. Screen-time blocking is fully possible — via Apple's Family Controls stack

Three cooperating frameworks (iOS 15+, current 2026):

- **FamilyControls** — auth + `FamilyActivityPicker`. User picks apps/categories/domains.
- **ManagedSettings** — `ManagedSettingsStore`: applies/clears shields (or hides apps).
- **DeviceActivity** — schedules + usage-threshold events; `DeviceActivityMonitor`
  extension receives callbacks.

Brick, Foqos (OSS, `github.com/awaseem/foqos`), one sec, Opal all use this exact
stack. NFC tags are just a UX trigger that opens the app and toggles the store.

**Programmatic unblock works.** The containing app (not only an extension) can call
`ManagedSettingsStore().shield.applications = nil` at any time. Conditional
"unblock after study" is a documented, achievable pattern.

### F2. Paid $99 Apple Developer account is mandatory — no free path

`com.apple.developer.family-controls` is a restricted entitlement.

| Path | Works? | Notes |
|------|--------|-------|
| Free Apple ID / Personal Team | **No** | Capability never appears in Xcode |
| AltStore / SideStore (free cert) | **No** | Personal cert ⇒ no restricted entitlements |
| **Paid $99/yr, dev profile via Xcode/`xcodebuild`** | **Yes** | **Recommended.** No Apple review for *development* builds |
| Paid + TestFlight/App Store/Ad-Hoc | Gated | Separate Apple approval, 3–8+ wk wait |

Critical correction to an early assumption: a **development** provisioning profile
under a paid account is valid for the **membership year, not 7 days**. Install via
Xcode once; no weekly re-sign. Sideload (AltStore/Xcode-free) is a dead end here.

### F3. The Anki-detection-via-Screen-Time path is the weakest leg — likely drop it

Hard constraints from the opaque-token privacy model:

- `ApplicationToken` is opaque. `.bundleIdentifier` / `.localizedDisplayName` → `nil`.
  **The app cannot verify the user picked Anki** (vs Clock/Calculator). Honor system only.
- You *can* set a `DeviceActivityEvent` usage threshold on the user-picked app and get
  an `eventDidReachThreshold` callback in the extension → then clear shields. BUT:
  - It's a **binary "hit threshold" signal**, not a minute counter.
  - `eventDidReachThreshold` / `intervalDidEnd` are **documented-unreliable** on
    current iOS (fire early, stack on crash, miss on sleep) — still unfixed 2026.
  - `DeviceActivityReport` extension *can* read real per-app minutes but is sandboxed
    — **cannot feed that data back to the main app** (no shared container write, no
    Darwin notifications, no network). Hard architectural wall.
- 6 MB hard memory cap on the monitor extension (`EXC_RESOURCE` crash if exceeded).

Conclusion: detecting "user studied in the Anki app for N minutes" reliably enough
to gate unblocking is **not robustly achievable**. Confirms hypothesis H3.

### F4. No good way to *read* Anki study data from an iOS-only setup

| Source | Reliability | Blocker |
|--------|-------------|---------|
| **AnkiConnect** (`localhost:8765`, e.g. `getNumCardsReviewedToday`) | High data, low robustness | Desktop-only add-on. Needs Anki running + LAN-reachable + config change. Fails if computer off. |
| **AnkiWeb** | Low | **No public API** (dev explicitly refuses). Sync = full-collection binary protocol. Scraping = credential-risky + fragile. |
| **Collection file** `.colpkg` (= ZIP + SQLite) | **High** | `revlog` table is the gold source: `id`(epoch-ms), `cid`, `ease`, `time`(ms), `type`. Query today's cards/time directly. Friction: **manual export** from AnkiMobile each time. |
| **AnkiMobile interop** | None | URL schemes are **write-only** (`addnote`, `search`, `sync`). No stats/Shortcuts/App-Intents. Different team ID ⇒ **no shared App Group**. Sandbox blocks reading its container. |

`revlog` query (adjust `4h` to user's Anki rollover hour):
```sql
SELECT COUNT(*) AS cards, SUM(time)/1000 AS secs
FROM revlog
WHERE id >= ((strftime('%s','now','localtime','start of day') + 4*3600) * 1000)
  AND type != 4;
```

### F5. Reimplementing flashcards in-app is the controllable path

- **`open-spaced-repetition/swift-fsrs`** — FSRS-6, MIT, SPM, iOS 13+. The full
  algorithm in a few hundred lines of Swift. No reimplementation pain.
- `fsrs-rs` (BSD, has optimizer) and Anki `rslib` (AGPL, wrapped by `amgi` on iOS)
  exist if deeper fidelity needed.
- **Licensing**: Anki core is AGPL. For a **personal app you never distribute,
  AGPL obligations do not trigger.** App Store submission *would* force open-sourcing.
- Simplest: ingest a user-exported `.apkg`/`.colpkg`, run reviews in-app with
  swift-fsrs, track our own `revlog`-equivalent → perfect, fully-owned study signal.

### F6. Architecture + persistence are well-trodden

- Targets: SwiftUI containing app + `DeviceActivityMonitor` extension (+ optional
  `ShieldConfiguration`), all sharing one App Group + the entitlement.
- **Persistence pattern (important):** main stats store = SwiftData/Core Data in the
  app's *Documents* dir (optionally `NSPersistentCloudKitContainer` for free iCloud
  backup across your own devices). Extension reads a tiny `SharedState.json` sidecar
  in the App Group — **never** put the SQLite DB in the App Group container
  (`0xDEAD10CC` crash class; documented 50%+ crash rates).
- Keep the extension minimal: read JSON → set/clear shields. Nothing heavy (6 MB).
- State machine: `LOCKED → (study in-app, goal met) → UNLOCK WINDOW (DeviceActivity
  schedule, chain ≤30 min blocks) → intervalDidEnd → LOCKED`.
- Watch: calling `startMonitoring()` on an already-monitored activity silently
  stops+restarts it, firing `intervalDidEnd` and collapsing the unlock window.

### F7. Inherent self-control weakness (accept for personal use)

Any iOS Screen-Time blocker is bypassable: Settings → Screen Time → toggle the
app's access off behind only Face ID (no Screen-Time passcode needed). Apple
unaddressed since 2023. For a personal honesty tool this is acceptable; it is not a
hardened gate.

### F8. Prior art to crib from

- **foqos** — `github.com/awaseem/foqos` — mature OSS blocker (SwiftData, monitor
  ext, App Group, widgets). Best architectural reference.
- ScreenBreak — `github.com/christianp-622/ScreenBreak` — explores all 3 frameworks.
- Apple WWDC21 "Meet the Screen Time API", WWDC22 "What's new".
- Habit Doom blog — production gotchas (scheduling, memory). Ryan Ashcraft —
  "SQLite in App Group Containers — Just Don't".

---

## Recommendations

**Recommended build (phased):**

1. **v1 — In-app flashcards + blocking, no live Anki coupling.**
   - Paid dev account, Family Controls dev entitlement, dev profile install.
   - SwiftUI app: auth → `FamilyActivityPicker` → block via shields.
   - In-app review engine using `swift-fsrs`. Ingest a user-exported `.apkg`/`.colpkg`
     for the deck content.
   - Gate: "study N cards / M minutes in-app" → clear shields → unlock window
     (chained ≤30-min `DeviceActivitySchedule`) → auto re-lock.
   - Scoreboard: SwiftData in Documents (+ optional CloudKit backup).
   - Minimal monitor extension reading `SharedState.json`.

2. **v2 — Anki stats ingestion for the scoreboard (read-only).**
   - On a schedule/manual trigger, import the latest `.colpkg`, query `revlog`,
     merge into the scoreboard so Anki-app study also counts toward stats/streaks.
   - Optionally AnkiConnect-over-LAN as a "if desktop reachable" bonus path.

3. **Drop / do-not-build:** detecting Anki-app foreground usage via DeviceActivity
   thresholds as the *unblock trigger* (F3 — unreliable, unverifiable, gameable).
   The in-app engine is the trustworthy signal; Anki-app study contributes to the
   *scoreboard* via F4 import, not to the *gate*.

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| **A. In-app flashcards as the gate** (recommended) | Perfect, fully-owned signal; offline; reliable; no Apple-API fragility | Must study in our app (forks workflow from AnkiMobile); needs review UX + FSRS |
| B. Anki-app usage detection as the gate | Study in real Anki | Can't verify it's Anki; binary unreliable callback; can't read minutes; gameable |
| C. AnkiConnect-over-LAN as the gate | Real Anki data, accurate | Needs desktop on + LAN + config; dead if computer off — too fragile |
| D. `.colpkg` import as the gate | Gold-source `revlog` data | Manual export each session = high friction + gameable ("forgot to export") |

`.colpkg` import (D) is excellent for the **scoreboard** (v2) but poor as a
real-time **gate**; in-app (A) is the gate.

## Open Questions (for end-of-spike decision)

1. **Gate metric:** unblock on *cards done* (e.g. 20) or *minutes studied* (e.g. 10),
   or both? Drives state machine + FSRS session design.
2. **Unlock window:** fixed (e.g. 30 min per session) or proportional to study done?
3. **Deck source:** author cards as bundled JSON, or always ingest the user's real
   Anki `.apkg`/`.colpkg`? (Recommend: ingest real deck so study is "real".)
4. **Write-back:** must in-app reviews sync back to Anki so AnkiMobile credits them,
   or is our app the system of record for gated study (Anki used separately)? Sync
   write-back is substantial engineering — default assumption: no write-back v1.
5. **AnkiWeb auto-pull:** worth implementing the sync protocol later to auto-refresh
   the collection (kills the manual-export friction), à la `amgi`? Defer decision.
6. **Distribution:** confirm permanent personal sideload via paid dev profile is
   acceptable (yearly membership, no weekly re-sign). Submit the *distribution*
   entitlement request now anyway (weeks-long queue) in case a 2nd device/TestFlight
   is wanted later?
7. **iCloud scoreboard sync** across your own devices (iPhone/iPad)? Cheap with
   `NSPersistentCloudKitContainer` if yes.
8. **Bypass tolerance:** accept the Settings/Face-ID bypass (F7) as fine for
   personal honesty, or invest in mitigations (block Settings app — partial only)?
9. **iOS version floor:** SwiftData + swift-fsrs ⇒ iOS 17+ comfortable. OK?
10. **Browser blocking:** domain blocking is Safari-only; Chrome/Brave/Firefox must
    be blocked as whole apps. Acceptable?

## Follow-up Actions

- [ ] If proceeding: `/feature-collab` (multi-component, >200 lines) — v1 scope.
      Spike Findings carry forward as DISCOVERY context.
- [ ] Decide Open Questions 1–4 before architecture lock.
- [ ] Enroll paid Apple Developer account (blocking dependency, no code path without it).
- [ ] Clone/study `foqos` for monitor-extension + App-Group wiring.

## Prototypes

None built — feasibility resolved by API/constraint research; no code needed to
de-risk further. `spike-scratch/anki-screentime/` left empty.
