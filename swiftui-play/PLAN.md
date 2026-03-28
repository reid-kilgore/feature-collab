# Single-File SwiftUI Apps from the CLI

## The Answer

Yes — single-file SwiftUI apps work from the terminal. The critical requirement is a **minimal .app bundle**. A bare executable will compile and run but **never shows a window** on macOS, even with activation policy hacks. The `.app` bundle with `Info.plist` containing `NSPrincipalClass` is what registers the process with the window server.

## Build & Run (2 steps)

```bash
# 1. Compile
swiftc -parse-as-library -framework SwiftUI -framework AppKit \
  -o MyApp.app/Contents/MacOS/MyApp MyApp.swift

# 2. Run
open MyApp.app
```

Before first compile, create the bundle skeleton:
```bash
mkdir -p MyApp.app/Contents/MacOS
```

And write `MyApp.app/Contents/Info.plist` once (see templates below).

## What We Tried & What Actually Worked

| Approach | Compiled? | Window Appeared? | Notes |
|---|---|---|---|
| `swiftc` → bare binary → `./app` | Yes | **No** | Process hangs, no window. Even with `NSApp.setActivationPolicy(.regular)` |
| `swiftc` → bare binary → `open app` | Yes | Yes, but... | Opens Terminal.app as intermediary — clunky |
| `swiftc` → .app bundle → `open MyApp.app` | Yes | **Yes** | Clean launch, proper window/menu bar integration |
| `swift app.swift` (script mode) | Yes | **No** | `@main` incompatible with script mode |

**The .app bundle is not optional.** macOS requires `NSPrincipalClass` in an `Info.plist` to register a GUI process with the window server. Without it, the run loop spins but the window server ignores the process.

## Compiler Flags

```
swiftc -parse-as-library -framework SwiftUI -framework AppKit -o <binary> <source.swift>
```

- **`-parse-as-library`**: Required when using `@main`. Without it, swiftc treats the file as a script (top-level code) which conflicts with `@main`.
- **`-framework SwiftUI -framework AppKit`**: Technically optional (swiftc auto-links imports), but explicit is clearer.

## App Architecture Pattern

Both windowed and menu bar apps use the same skeleton:

```swift
import Cocoa
import SwiftUI

// 1. AppDelegate does the real setup work
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create window or menu bar item here
    }
}

// 2. SwiftUI views are pure SwiftUI — no AppKit concerns
struct ContentView: View {
    var body: some View {
        Text("Hello")
    }
}

// 3. @main App struct is just a shell that wires in the delegate
@main
struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}
```

The `Settings { EmptyView() }` body is a placeholder — the real UI comes from the AppDelegate via `NSWindow`/`NSHostingView` or `NSStatusItem`/`NSPopover`. This is the pattern used by [simonw/bandwidther](https://github.com/simonw/bandwidther).

## Template: Windowed App

**Info.plist** (`MyApp.app/Contents/Info.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>MyApp</string>
    <key>CFBundleIdentifier</key>
    <string>dev.local.MyApp</string>
    <key>CFBundleName</key>
    <string>MyApp</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
</dict>
</plist>
```

**Swift source** — replace `ContentView` with your UI:
```swift
import Cocoa
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered, defer: false
        )
        window.center()
        window.title = "My App"
        window.contentView = NSHostingView(rootView: ContentView())
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Hello from the CLI!")
                .font(.largeTitle)
            Text("Built with swiftc, no Xcode needed")
                .foregroundColor(.secondary)
        }
        .frame(width: 400, height: 300)
    }
}

@main
struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene {
        Settings { EmptyView() }
    }
}
```

## Template: Menu Bar App

**Info.plist** — same as windowed but add `LSUIElement` to hide from Dock:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>MyApp</string>
    <key>CFBundleIdentifier</key>
    <string>dev.local.MyApp</string>
    <key>CFBundleName</key>
    <string>MyApp</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
```

**Swift source**:
```swift
import Cocoa
import SwiftUI

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!

    func applicationDidFinishLaunching(_ notification: Notification) {
        popover = NSPopover()
        popover.contentSize = NSSize(width: 300, height: 200)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: ContentView())

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "MyApp"
            button.action = #selector(togglePopover)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func togglePopover() {
        if let button = statusItem.button {
            if popover.isShown {
                popover.performClose(nil)
            } else {
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            }
        }
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Hello from the CLI!")
                .font(.title)
            Text("Built with swiftc, no Xcode needed")
                .foregroundColor(.secondary)
            Button("Quit") { NSApp.terminate(nil) }
        }
        .padding(20)
        .frame(width: 300, height: 200)
    }
}

@main
struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene {
        Settings { EmptyView() }
    }
}
```

## What Doesn't Work

- **SwiftUI Previews** (`#Preview`) — requires Xcode canvas
- **`@main` App with `WindowGroup`** — compiles but no window without .app bundle
- **Bare executables showing windows** — macOS window server ignores unregistered processes
- **`swift script.swift`** with `@main` — script mode conflicts with `@main` attribute
- **SwiftData / CloudKit** — require provisioning profiles and Developer account

## What We Don't Need

- **Xcode IDE** — never opened it
- **Code signing** — unsigned .app bundles work fine for local use
- **SPM / Package.swift** — unnecessary for single-file apps
- **swift-bundler or third-party tools** — manual .app bundle is 2 commands

## Key Insight

The gap between "compiles and runs" and "shows a window" is the `.app` bundle. Every blog post and Stack Overflow answer about CLI SwiftUI focuses on compilation flags — but compilation was never the problem. The window server registration is. This is the kind of thing that wastes hours if you don't know it.
