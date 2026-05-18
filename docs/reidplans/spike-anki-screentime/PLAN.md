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

### F9. Embedding Anki's OSS Rust core (`rslib`) makes the app a REAL AnkiWeb client — this reframes everything

User's instinct ("can't we extract from OSS Anki desktop?") is correct, and better
than an "AnkiWeb API" (which doesn't exist). Don't reverse-engineer the protocol —
**embed `rslib`** (the Rust core of `ankitects/anki`) via C FFI, like the OSS iOS
client **`amgi`** (`github.com/antigluten/amgi`) and Android's `rsdroid` already do.

What you get **inside rslib, for free** (it IS Anki):
- `SyncLogin`(user,pass,"") → AnkiWeb `hkey`; `SyncCollection` → full bidirectional
  sync with **AnkiWeb itself** (AnkiDroid proves this works against AnkiWeb).
- `GetQueuedCards` + `AnswerCard` → real reviews: writes `revlog` **and** updates
  card scheduling state with correct **FSRS** — then `SyncCollection` pushes it to
  AnkiWeb, appearing on desktop + AnkiMobile.
- Stats/graphs/`revlog` reads for the scoreboard.

This **collapses the design**: one engine is the gate signal, the write-back, the
scoreboard source, and the deck source. No swift-FSRS reimplementation, no manual
`.colpkg` export, no AnkiConnect dependency, no protocol reverse-engineering.

Costs / caveats:
- Build infra: cross-compile rslib → `.xcframework` (arm64 device + sim), `protoc`
  codegen, C FFI bridge, Swift protobuf bindings. ~1–2 wk; `amgi`'s
  `build-xcframework.sh` is a working template. Binary ~15–40 MB.
- rslib is **not a stable/public API** (issue #2520 open). Pin to an Anki tag like
  `amgi`/`rsdroid` do; budget periodic (~2–4×/yr) update work on Anki releases.
- iOS 17+ (amgi's floor). Need full-sync conflict-resolution UX (upload vs
  download). rslib needs exclusive SQLite access — coordinate vs AnkiMobile.
- Unverified: does `amgi` sync *specifically* with AnkiWeb (README says "any
  compatible server")? AnkiDroid + rslib `SyncLogin` evidence says yes — **confirm
  by building/running `amgi` before committing**.

### F10. If NOT embedding rslib: the write-back data contract (jank v1 fallback)

Making an in-app review "count" requires `revlog` row **+** `cards` state update,
both with `usn = -1` (the sentinel for "pending upload"; official Anki client then
syncs them to AnkiWeb on next sync — you don't implement the protocol).

- `revlog` alone → stats right, **scheduling wrong** (card keeps old due date).
- `.apkg`/`.colpkg` import does **NOT merge `revlog`** — dead end for write-back.
- AnkiMobile URL scheme has **no review-injection verb** — dead end.
- **Jank v1 path = AnkiConnect when desktop reachable**: `insertReviews` (revlog,
  `usn=-1`) + `setSpecificValueOfCard` (patch `due`/`ivl`/`factor`/`reps`); for
  FSRS, user runs Tools→FSRS→Reschedule once. Fragile (desktop on + LAN; AnkiConnect
  repo archived Nov 2025). Strictly inferior to F9 for anything beyond a stopgap.

### F8. Prior art to crib from

- **foqos** — `github.com/awaseem/foqos` — mature OSS blocker (SwiftData, monitor
  ext, App Group, widgets). Best architectural reference.
- ScreenBreak — `github.com/christianp-622/ScreenBreak` — explores all 3 frameworks.
- Apple WWDC21 "Meet the Screen Time API", WWDC22 "What's new".
- Habit Doom blog — production gotchas (scheduling, memory). Ryan Ashcraft —
  "SQLite in App Group Containers — Just Don't".

---

## Recommendations

User decisions captured: gate metric = **both/configurable** (cards OR minutes,
tunable); write-back **wanted**, jank acceptable short-term, proper later.

Given F9, the strongest architecture is **rslib-centric** — one engine does gate,
write-back, scoreboard, and deck. Two viable phasings:

**Recommended — rslib from v1 (de-risk the build spike first):**

1. **v0 — De-risk spike (small, ~1–3 days):** clone `amgi`, build its
   `.xcframework`, run on a device, **prove it logs into and syncs YOUR AnkiWeb
   account** and that `AnswerCard`→`SyncCollection` round-trips to desktop. This is
   the single biggest unknown; resolve before committing the full build.
2. **v1 — Full app on rslib:**
   - Paid dev account; Family Controls dev entitlement; dev-profile install (1-yr).
   - SwiftUI app: `FamilyControls` auth → `FamilyActivityPicker` → shield blocking.
   - Embed rslib: open collection (synced from AnkiWeb), `GetQueuedCards` /
     `AnswerCard` for in-app study = **real Anki reviews, real FSRS, real
     write-back** via `SyncCollection`.
   - Gate: configurable threshold — N cards **or** M minutes (user-tunable, either
     satisfies) → clear shields → unlock window (chained ≤30-min
     `DeviceActivitySchedule`) → auto re-lock.
   - Scoreboard: rslib stats/`revlog` as source of truth; mirror aggregates to
     SwiftData in Documents (+ optional CloudKit backup for cross-device).
   - Minimal monitor extension reads `SharedState.json` only (6 MB cap).

**Fallback — if v0 fails or build infra too heavy:** swift-FSRS in-app engine +
**AnkiConnect jank write-back** (F10) when desktop reachable; `.colpkg` import for
scoreboard. Strictly worse; only if rslib embedding proves infeasible.

**Drop / do-not-build:** Anki-app foreground-usage detection via DeviceActivity as
the unblock trigger (F3 — unverifiable, unreliable, gameable). `.apkg` import as a
write-back vehicle (F10 — doesn't merge `revlog`). Hand-rolled sync protocol (F9 —
brittle, breaks on Anki bumps, no upgrade path).

## Trade-offs

| Engine option | Pros | Cons |
|--------|------|------|
| **Embed rslib (recommended)** | Real Anki client: correct FSRS, true bidirectional AnkiWeb write-back, scoreboard + gate + deck from one source; no manual export | Rust→xcframework build infra (~1–2 wk); rslib API unstable (pin + maintain ~quarterly); iOS 17+; ~15–40 MB; AnkiWeb-sync needs hands-on confirmation |
| swift-FSRS in-app + AnkiConnect write-back | No Rust toolchain; fast to first build | Write-back only when desktop on+LAN; FSRS may diverge from user's tuned params; AnkiConnect archived; scoreboard needs separate `.colpkg` import |
| `.colpkg` import only (read-only) | Simplest; gold `revlog` data | No write-back at all; manual export friction; gameable |

For the **gate signal itself**, in-app study (either engine) is trustworthy;
Anki-app usage detection (F3) and AnkiConnect-over-LAN are too fragile.

## Open Questions (remaining for decision)

1. **rslib AnkiWeb sync — confirm:** does building/running `amgi` actually sync with
   *AnkiWeb* (not just self-hosted)? Resolve via v0 spike before full commit.
2. **Build-infra appetite:** accept the Rust→xcframework toolchain + ~quarterly
   rslib-pin maintenance, or take the swift-FSRS fallback to ship sooner?
3. **Unlock window:** fixed (e.g. 30 min/session) or proportional to study done?
4. **Collection conflict:** rslib needs exclusive SQLite; if you also run AnkiMobile,
   how to coordinate (sync-on-open/close, advise not running both mid-session)?
5. **Distribution:** confirm permanent personal sideload via paid dev profile is
   fine. Note: distributing (even TestFlight) triggers **AGPL** → must open-source
   the app. Personal sideload = no AGPL obligation. Keep it personal?
6. **iCloud scoreboard sync** across your own devices? Cheap via
   `NSPersistentCloudKitContainer`.
7. **Bypass tolerance:** accept Settings/Face-ID bypass (F7) for personal honesty,
   or attempt partial mitigation (block Settings app)?
8. **Browser blocking:** domain block is Safari-only; Chrome/Brave/Firefox must be
   blocked as whole apps. Acceptable?
9. **iOS 17+ floor** (rslib/amgi requirement). OK?

## Follow-up Actions

- [ ] **v0 de-risk spike** (recommended first): clone `amgi`, build xcframework,
      confirm AnkiWeb login+sync+`AnswerCard` round-trip on a real device. Gate the
      full build on this. Could be its own short `/spike`.
- [ ] Enroll paid Apple Developer account (hard blocker — no on-device path without).
- [ ] Then `/feature-collab` (multi-component, >200 lines) — v1 scope. Spike
      Findings carry forward as DISCOVERY context (no re-research).
- [ ] Clone/study `foqos` (monitor-extension + App-Group) and `amgi` (rslib FFI).
- [ ] Decide Open Questions 1, 2, 5 before architecture lock.

## Prototypes

None built — feasibility resolved by API/constraint research. The one remaining
empirical unknown (rslib↔AnkiWeb on iOS) is best de-risked by building the existing
`amgi` project, captured as the v0 follow-up action. `spike-scratch/anki-screentime/`
left empty.
