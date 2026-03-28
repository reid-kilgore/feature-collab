import SwiftUI
import AppKit

// Script mode doesn't support @main, try manual NSApplicationMain style
struct ContentView: View {
    var body: some View {
        Text("Hello, World!")
            .padding()
    }
}

let app = NSApplication.shared
let delegate = NSObject()
app.run()
