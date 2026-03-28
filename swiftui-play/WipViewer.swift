import Cocoa
import SwiftUI
import WebKit

// MARK: - Shell helper

func shell(_ command: String) -> String {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-l", "-c", command]
    process.standardOutput = pipe
    process.standardError = pipe
    try? process.run()
    process.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

// MARK: - Data Model

struct WipBranch: Codable {
    let name: String
    let status: String?
}

struct WipItem: Codable, Identifiable {
    let name: String
    let loc: String?
    let status: String
    let branches: [WipBranch]?
    let linear_id: String?
    let notes: [String]?
    let priority: Bool?
    let repo: String?

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name, loc, status, branches, linear_id, notes, priority, repo
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        loc = try container.decodeIfPresent(String.self, forKey: .loc)
        status = try container.decode(String.self, forKey: .status)
        linear_id = try container.decodeIfPresent(String.self, forKey: .linear_id)
        notes = try container.decodeIfPresent([String].self, forKey: .notes)
        priority = try container.decodeIfPresent(Bool.self, forKey: .priority)
        repo = try container.decodeIfPresent(String.self, forKey: .repo)

        // Branches can be objects or strings
        if let branchObjects = try? container.decodeIfPresent([WipBranch].self, forKey: .branches) {
            branches = branchObjects
        } else if let branchStrings = try? container.decodeIfPresent([String].self, forKey: .branches) {
            branches = branchStrings.map { WipBranch(name: $0, status: nil) }
        } else {
            branches = nil
        }
    }
}

// MARK: - Status Helpers

let statusOrder: [String] = ["ACTIVE", "IN_REVIEW", "BLOCKED", "WAITING", "RETRO", "NEW", "DONE", "CLOSED"]

func statusColor(_ status: String) -> Color {
    switch status {
    case "ACTIVE":    return .green
    case "IN_REVIEW": return .blue
    case "WAITING":   return .orange
    case "BLOCKED":   return .red
    case "NEW":       return .gray
    case "DONE":      return Color(.disabledControlTextColor)
    case "CLOSED":    return Color(.disabledControlTextColor)
    case "RETRO":     return .purple
    default:          return .gray
    }
}

func sortItems(_ items: [WipItem]) -> [WipItem] {
    items.sorted { a, b in
        let aPriority = a.priority == true
        let bPriority = b.priority == true
        if aPriority != bPriority { return aPriority }
        let aIdx = statusOrder.firstIndex(of: a.status) ?? statusOrder.count
        let bIdx = statusOrder.firstIndex(of: b.status) ?? statusOrder.count
        if aIdx != bIdx { return aIdx < bIdx }
        return a.name < b.name
    }
}

// MARK: - Store

enum PRState {
    case loading
    case noPR
    case found(String)
}

class WipStore: ObservableObject {
    @Published var items: [WipItem] = []
    @Published var doneItems: [WipItem] = []
    @Published var initialLoadComplete: Bool = false
    @Published var error: String? = nil
    @Published var prStates: [String: PRState] = [:]
    private var isLoadingActive: Bool = false
    private var isLoadingDone: Bool = false

    func fetchPR(branch: String, repoLoc: String?) {
        if prStates[branch] != nil { return }  // already fetched or loading
        prStates[branch] = .loading
        guard let loc = repoLoc, !loc.isEmpty else {
            prStates[branch] = .noPR
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let url = shell("cd '\(loc)' && gh pr list --head '\(branch)' --json url --jq '.[0].url' 2>/dev/null")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                self.prStates[branch] = url.starts(with: "http") ? .found(url) : .noPR
            }
        }
    }

    func loadActive() {
        guard !isLoadingActive else { return }
        isLoadingActive = true
        DispatchQueue.global(qos: .userInitiated).async {
            let output = shell("wip list --json")
            DispatchQueue.main.async {
                self.isLoadingActive = false
                guard let data = output.data(using: .utf8) else {
                    if !self.initialLoadComplete { self.error = "No output from wip" }
                    return
                }
                do {
                    let decoded = try JSONDecoder().decode([WipItem].self, from: data)
                    self.items = sortItems(decoded)
                    self.initialLoadComplete = true
                } catch {
                    self.error = "JSON decode error: \(error.localizedDescription)"
                }
            }
        }
    }

    func loadDone() {
        guard !isLoadingDone else { return }
        isLoadingDone = true
        DispatchQueue.global(qos: .background).async {
            // Read NDJSON directly — 10ms vs 10s through wip list --json --all
            // Sort by name descending (rk-MMDD prefix gives rough recency)
            let output = shell("find ~/panop -name work.txt -exec cat {} + | jq -c 'select(.status == \"DONE\" or .status == \"CLOSED\")' 2>/dev/null")
            DispatchQueue.main.async {
                self.isLoadingDone = false
                let lines = output.split(separator: "\n").compactMap { line -> WipItem? in
                    guard let data = line.data(using: .utf8) else { return nil }
                    return try? JSONDecoder().decode(WipItem.self, from: data)
                }
                // Sort by name descending — rk-MMDD prefix means most recent first
                let sorted = lines.sorted { $0.name > $1.name }
                self.doneItems = Array(sorted.prefix(15))
            }
        }
    }

    func changeStatus(item: WipItem, newStatus: String, completion: @escaping () -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            _ = shell("wip status \(item.name) \(newStatus)")
            DispatchQueue.main.async {
                self.loadActive()
                self.loadDone()
                completion()
            }
        }
    }

    func addNote(item: WipItem, text: String, completion: @escaping () -> Void) {
        let escaped = text.replacingOccurrences(of: "'", with: "'\\''")
        DispatchQueue.global(qos: .userInitiated).async {
            _ = shell("wip note \(item.name) '\(escaped)'")
            DispatchQueue.main.async {
                self.loadActive()
                completion()
            }
        }
    }
}

// MARK: - Key Handler (shared callback set by ContentView)

/// Global callback: AppDelegate calls this when a key is pressed.
/// ContentView sets it to handle d/x shortcuts.
var globalKeyHandler: ((String) -> Void)? = nil

// MARK: - Status Badge

struct StatusBadge: View {
    let status: String

    var body: some View {
        Text(status)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(.white)
            .frame(width: 72)
            .padding(.vertical, 2)
            .background(statusColor(status))
            .cornerRadius(4)
    }
}

func displayName(_ name: String) -> String {
    // Strip "rk-MMDD-" prefix: "rk-0327-comp-data-problems" → "comp data problems"
    let parts = name.split(separator: "-").map(String.init)
    if parts.count > 2, parts[0] == "rk", parts[1].count == 4, parts[1].allSatisfy(\.isNumber) {
        return parts.dropFirst(2).joined(separator: " ")
    }
    return name
}

// MARK: - List Row

struct WipRowView: View {
    let item: WipItem
    let isSelected: Bool
    var dimmed: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            StatusBadge(status: item.status)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(displayName(item.name))
                        .font(.system(size: 13, weight: item.priority == true ? .bold : .medium))
                        .lineLimit(1)
                    if item.priority == true {
                        Circle()
                            .fill(Color.yellow)
                            .frame(width: 5, height: 5)
                    }
                }
                if let repo = item.repo {
                    Text(repo)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
        .cornerRadius(6)
        .opacity(dimmed ? 0.55 : 1.0)
    }
}

// MARK: - Markdown Web View

struct MarkdownWebView: NSViewRepresentable {
    let markdown: String

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.setValue(false, forKey: "drawsBackground") // transparent bg
        loadMarkdown(webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        loadMarkdown(webView)
    }

    private func loadMarkdown(_ webView: WKWebView) {
        let escaped = markdown
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")
        let html = Self.htmlTemplate.replacingOccurrences(of: "__MARKDOWN_CONTENT__", with: escaped)
        webView.loadHTMLString(html, baseURL: nil)
    }

    static let htmlTemplate: String = #"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
:root {
    --bg-primary: #ffffff;
    --bg-secondary: #f8f9fa;
    --bg-tertiary: #f0f0f0;
    --text-primary: #333333;
    --text-secondary: #666666;
    --text-muted: #999999;
    --border-color: #e0e0e0;
    --accent-color: #1a73e8;
    --highlight-bg: #fff59d;
    --highlight-border: #fbc02d;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg-primary: #1e1e1e;
        --bg-secondary: #252526;
        --bg-tertiary: #2d2d2d;
        --text-primary: #e0e0e0;
        --text-secondary: #a0a0a0;
        --text-muted: #707070;
        --border-color: #404040;
        --highlight-bg: #5c4d00;
        --highlight-border: #8c7000;
    }
}
body {
    font-family: -apple-system, 'Georgia', serif;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-primary);
    background: var(--bg-primary);
    padding: 16px;
    margin: 0;
}
h1 { font-size: 1.8em; margin: 0.5em 0; font-weight: 600; }
h2 { font-size: 1.4em; margin: 0.8em 0 0.4em; font-weight: 600; color: var(--text-secondary); }
h3 { font-size: 1.2em; margin: 0.8em 0 0.4em; font-weight: 600; }
p { margin: 0.6em 0; }
ul, ol { margin: 0.2em 0; padding-left: 1.2em; }
li { margin: 0; line-height: 1.4; }
li.task-item { list-style: none; margin-left: -1.2em; }
.checkbox { margin-right: 0.4em; }
code {
    background: var(--bg-tertiary);
    padding: 2px 5px;
    border-radius: 3px;
    font-family: 'SF Mono', SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
}
pre {
    background: var(--bg-tertiary);
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 1em 0;
}
pre code { background: none; padding: 0; }
pre .keyword { color: #d73a49; }
pre .type { color: #6f42c1; }
pre .string { color: #22863a; }
pre .number { color: #005cc5; }
pre .comment { color: #6a737d; font-style: italic; }
pre .property { color: #005cc5; }
@media (prefers-color-scheme: dark) {
    pre .keyword { color: #ff7b72; }
    pre .type { color: #d2a8ff; }
    pre .string { color: #a5d6ff; }
    pre .number { color: #79c0ff; }
    pre .comment { color: #8b949e; }
    pre .property { color: #79c0ff; }
}
blockquote {
    border-left: 3px solid var(--border-color);
    padding-left: 12px;
    color: var(--text-secondary);
    margin: 1em 0;
}
hr { border: none; border-top: 1px solid var(--border-color); margin: 1.5em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid var(--border-color); padding: 6px 10px; text-align: left; }
th { background: var(--bg-secondary); font-weight: 600; }
tr:nth-child(even) { background: var(--bg-secondary); }
a { color: var(--accent-color); text-decoration: none; }
a:hover { text-decoration: underline; }
.preview-highlight { background: var(--highlight-bg); padding: 1px 0; border-radius: 2px; }
.preview-highlight.has-comment { border-bottom: 2px solid var(--highlight-border); }
.preview-comment-marker {
    display: inline-block; background: var(--accent-color); color: white;
    font-size: 10px; padding: 1px 5px; border-radius: 8px; margin-left: 2px;
    font-family: -apple-system, sans-serif; vertical-align: middle;
}
</style></head>
<body>
<div id="content"></div>
<script>
function escapeHtml(text) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMarkdown(md) {
    // CriticMarkup
    md = md.replace(/\{==([^=]*)==\}\{>>([^<]*)<<\}/g, function(match, text, comment) {
        return '<span class="preview-highlight has-comment" title="'+escapeHtml(comment)+'">'+escapeHtml(text)+'</span><span class="preview-comment-marker">'+escapeHtml(comment.substring(0,20))+(comment.length>20?'...':'')+'</span>';
    });
    md = md.replace(/\{==([^=]*)==\}/g, '<span class="preview-highlight">$1</span>');

    // Fenced code blocks
    md = md.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
        return '<pre><code class="language-'+(lang||'text')+'">'+highlightCode(code.trim(), lang)+'</code></pre>';
    });

    // Tables
    md = md.replace(/^(\|.+\|)\n(\|[-:\| ]+\|)\n((?:\|.+\|\n?)+)/gm, function(match, header, separator, body) {
        var headerCells = header.split('|').slice(1,-1).map(function(c){return '<th>'+c.trim()+'</th>';}).join('');
        var bodyRows = body.trim().split('\n').map(function(row){
            var cells = row.split('|').slice(1,-1).map(function(c){return '<td>'+c.trim()+'</td>';}).join('');
            return '<tr>'+cells+'</tr>';
        }).join('');
        return '<table><thead><tr>'+headerCells+'</tr></thead><tbody>'+bodyRows+'</tbody></table>';
    });

    // Headings
    md = md.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    md = md.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    md = md.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    md = md.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    md = md.replace(/`([^`]+)`/g, '<code>$1</code>');
    md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    md = md.replace(/^---+$/gm, '<hr>');
    md = md.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');

    // Lists
    var lines = md.split('\n');
    var result = [];
    var listStack = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (listMatch) {
            var indent = listMatch[1].length;
            var content = listMatch[3];
            var level = Math.floor(indent / 2);
            while (listStack.length > level + 1) { result.push('</ul>'); listStack.pop(); }
            while (listStack.length < level + 1) { result.push('<ul>'); listStack.push(level); }
            var checkboxMatch = content.match(/^\[([ xX])\]\s+(.*)$/);
            if (checkboxMatch) {
                var checked = checkboxMatch[1].toLowerCase() === 'x';
                var text = checkboxMatch[2];
                var checkbox = checked ? '<input type="checkbox" class="checkbox" checked disabled>' : '<input type="checkbox" class="checkbox" disabled>';
                result.push('<li class="task-item">' + checkbox + text + '</li>');
            } else {
                result.push('<li>' + content + '</li>');
            }
        } else {
            while (listStack.length > 0) { result.push('</ul>'); listStack.pop(); }
            result.push(line);
        }
    }
    while (listStack.length > 0) { result.push('</ul>'); listStack.pop(); }
    md = result.join('\n');

    // Paragraphs
    md = md.split('\n\n').map(function(para) {
        para = para.trim();
        if (!para) return '';
        if (para.match(/^<(h[1-6]|ul|ol|li|pre|hr|blockquote|table|\/)/)) return para;
        return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    return md;
}

function highlightCode(code, lang) {
    var html = escapeHtml(code);
    var protectedTokens = [];
    function protect(match) {
        var id = '__PROTECTED_' + protectedTokens.length + '__';
        protectedTokens.push(match);
        return id;
    }
    html = html.replace(/(\/\/.*$)/gm, function(m) { return protect('<span class="comment">' + m + '</span>'); });
    html = html.replace(/(\/\*[\s\S]*?\*\/)/g, function(m) { return protect('<span class="comment">' + m + '</span>'); });
    html = html.replace(/(&quot;[^&]*&quot;)/g, function(m) { return protect('<span class="string">' + m + '</span>'); });
    html = html.replace(/('(?:[^'\\]|\\.)*')/g, function(m) { return protect('<span class="string">' + m + '</span>'); });
    html = html.replace(/(`(?:[^`\\]|\\.)*`)/g, function(m) { return protect('<span class="string">' + m + '</span>'); });
    html = html.replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|finally|new|delete|typeof|instanceof|in|of|class|extends|import|export|from|default|async|await|yield|static|get|set|interface|type|enum|implements|public|private|protected|readonly|abstract|declare|namespace|module)\b/g, '<span class="keyword">$1</span>');
    html = html.replace(/\b(string|number|boolean|void|null|undefined|any|never|unknown|object|symbol|bigint|Array|Object|Function|Promise|Map|Set|Date|RegExp|Error)\b/g, '<span class="type">$1</span>');
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
    html = html.replace(/(\w+)(?=\s*:)/g, '<span class="property">$1</span>');
    for (var i = 0; i < protectedTokens.length; i++) {
        html = html.replace('__PROTECTED_' + i + '__', protectedTokens[i]);
    }
    return html;
}

document.getElementById('content').innerHTML = renderMarkdown(`__MARKDOWN_CONTENT__`);
</script>
</body>
</html>
"""#
}

// MARK: - Plan View

struct PlanView: View {
    let item: WipItem
    @State private var planContent: String? = nil
    @State private var loaded = false

    var body: some View {
        Group {
            if let content = planContent {
                MarkdownWebView(markdown: content)
            } else if loaded {
                Text("No PLAN.md found")
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            loadPlan()
        }
    }

    func loadPlan() {
        guard let loc = item.loc, !loc.isEmpty else {
            planContent = nil
            return
        }
        DispatchQueue.global(qos: .utility).async {
            let fm = FileManager.default
            let reidplansDir = loc + "/docs/reidplans"
            var found: String? = nil
            if let branches = try? fm.contentsOfDirectory(atPath: reidplansDir) {
                for branch in branches {
                    let candidate = reidplansDir + "/" + branch + "/PLAN.md"
                    if fm.fileExists(atPath: candidate) {
                        found = candidate
                        break
                    }
                }
            }
            let content: String? = found.flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }
            DispatchQueue.main.async {
                planContent = content
            }
        }
    }
}

// MARK: - Branch Row (with PR lookup)

struct BranchRow: View {
    let branchName: String
    let repoLoc: String?
    @ObservedObject var store: WipStore

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
            Text(branchName)
                .font(.system(size: 13, design: .monospaced))
            Spacer()
            switch store.prStates[branchName] {
            case .loading:
                ProgressView()
                    .scaleEffect(0.5)
                    .frame(width: 16, height: 16)
            case .found(let url):
                Button(action: {
                    if let nsURL = URL(string: url) {
                        NSWorkspace.shared.open(nsURL)
                    }
                }) {
                    HStack(spacing: 3) {
                        Image(systemName: "arrow.up.right.square")
                            .font(.system(size: 11))
                        Text("PR")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundColor(.accentColor)
                }
                .buttonStyle(PlainButtonStyle())
                .help(url)
            case .noPR, nil:
                EmptyView()
            }
        }
        .padding(.vertical, 2)
        .onAppear {
            store.fetchPR(branch: branchName, repoLoc: repoLoc)
        }
    }
}

// MARK: - Detail View

struct WipDetailView: View {
    let item: WipItem
    @ObservedObject var store: WipStore
    @State private var noteText: String = ""
    @State private var isSavingNote: Bool = false
    @State private var isChangingStatus: Bool = false
    @State private var selectedTab: Int = 0

    let allStatuses = ["ACTIVE", "IN_REVIEW", "WAITING", "BLOCKED", "RETRO", "NEW", "DONE", "CLOSED"]

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 10) {
                    Text(item.name)
                        .font(.title2)
                        .fontWeight(.bold)
                    if item.priority == true {
                        Circle()
                            .fill(Color.yellow)
                            .frame(width: 7, height: 7)
                    }
                    StatusBadge(status: item.status)
                    Spacer()
                    // Gear menu for status changes
                    Menu {
                        ForEach(allStatuses, id: \.self) { s in
                            Button(action: {
                                guard s != item.status, !isChangingStatus else { return }
                                isChangingStatus = true
                                store.changeStatus(item: item, newStatus: s) {
                                    isChangingStatus = false
                                }
                            }) {
                                if s == item.status {
                                    Label(s, systemImage: "checkmark")
                                } else {
                                    Text(s)
                                }
                            }
                            .disabled(isChangingStatus)
                        }
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 14))
                            .foregroundColor(.secondary)
                    }
                    .menuStyle(BorderlessButtonMenuStyle())
                    .frame(width: 24, height: 24)
                    .help("Change status")
                }
                if let linearId = item.linear_id {
                    Text(linearId)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                if let loc = item.loc {
                    Text(loc)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                if let repo = item.repo {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                            .font(.system(size: 11))
                        Text(repo)
                            .font(.system(size: 12))
                    }
                    .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            Divider()

            // Tab picker
            Picker("", selection: $selectedTab) {
                Text("Notes").tag(0)
                Text("Plan").tag(1)
            }
            .pickerStyle(SegmentedPickerStyle())
            .padding(.horizontal, 20)
            .padding(.vertical, 8)

            Divider()

            if selectedTab == 0 {
                notesTab
            } else {
                PlanView(item: item)
            }
        }
    }

    var notesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {

                // Branches
                if let branches = item.branches, !branches.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Branches")
                            .font(.headline)
                        ForEach(branches, id: \.name) { branch in
                            BranchRow(branchName: branch.name, repoLoc: item.loc, store: store)
                        }
                    }
                    Divider()
                }

                // Add note
                VStack(alignment: .leading, spacing: 8) {
                    Text("Add Note")
                        .font(.headline)
                    HStack(spacing: 8) {
                        TextField("Type a note...", text: $noteText)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                            .onSubmit { submitNote() }
                        Button("Add") { submitNote() }
                            .disabled(noteText.trimmingCharacters(in: .whitespaces).isEmpty || isSavingNote)
                    }
                }

                // Notes
                if let notes = item.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Notes")
                            .font(.headline)
                        ForEach(notes.reversed(), id: \.self) { note in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "note.text")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                                    .padding(.top, 2)
                                Text(note)
                                    .font(.system(size: 12))
                                    .foregroundColor(.primary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(8)
                            .background(Color(.controlBackgroundColor))
                            .cornerRadius(6)
                        }
                    }
                }

                Spacer(minLength: 20)
            }
            .padding(20)
        }
    }

    func submitNote() {
        let text = noteText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !isSavingNote else { return }
        isSavingNote = true
        noteText = ""
        store.addNote(item: item, text: text) {
            isSavingNote = false
        }
    }
}

// MARK: - Empty Detail

struct EmptyDetailView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "list.bullet.rectangle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("Select an item")
                .font(.title3)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Main Content

struct ContentView: View {
    @StateObject private var store = WipStore()
    @State private var selectedId: String? = nil
    @State private var timer: Timer? = nil
    @State private var showDone: Bool = false

    var selectedItem: WipItem? {
        store.items.first { $0.id == selectedId }
            ?? store.doneItems.first { $0.id == selectedId }
    }

    var body: some View {
        HSplitView {
            // Sidebar
            VStack(spacing: 0) {
                if !store.initialLoadComplete {
                    VStack(spacing: 12) {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text("Loading...")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = store.error {
                    ScrollView {
                        Text(error)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(.red)
                            .padding(12)
                    }
                } else {
                    List(selection: $selectedId) {
                        // Active items
                        ForEach(store.items) { item in
                            WipRowView(item: item, isSelected: selectedId == item.id)
                                .tag(item.id)
                                .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                        }

                        // Done items disclosure group
                        if !store.doneItems.isEmpty {
                            DisclosureGroup(
                                isExpanded: $showDone,
                                content: {
                                    ForEach(store.doneItems) { item in
                                        HStack(spacing: 0) {
                                            WipRowView(item: item, isSelected: selectedId == item.id, dimmed: true)
                                            Button(action: {
                                                store.changeStatus(item: item, newStatus: "ACTIVE") {}
                                            }) {
                                                Image(systemName: "arrow.uturn.backward.circle")
                                                    .font(.system(size: 12))
                                                    .foregroundColor(.secondary)
                                            }
                                            .buttonStyle(PlainButtonStyle())
                                            .help("Reactivate")
                                            .padding(.trailing, 6)
                                        }
                                        .tag(item.id)
                                        .listRowInsets(EdgeInsets(top: 2, leading: 0, bottom: 2, trailing: 0))
                                    }
                                },
                                label: {
                                    Text("Recent Done (\(store.doneItems.count))")
                                        .font(.system(size: 11))
                                        .foregroundColor(.secondary)
                                }
                            )
                            .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                        }
                    }
                    .listStyle(SidebarListStyle())
                }
            }
            .frame(minWidth: 240, idealWidth: 280, maxWidth: 360)

            // Detail pane
            Group {
                if let item = selectedItem {
                    WipDetailView(item: item, store: store)
                        .id(item.id)
                } else {
                    EmptyDetailView()
                }
            }
            .frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            store.loadActive()
            store.loadDone()
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
                store.loadActive()
            }
            // Register keyboard handler for d/x shortcuts
            globalKeyHandler = { [self] key in
                guard let item = self.selectedItem else { return }
                if key == "d" && item.status != "DONE" {
                    store.changeStatus(item: item, newStatus: "DONE") {}
                } else if key == "x" && item.status != "BLOCKED" {
                    store.changeStatus(item: item, newStatus: "BLOCKED") {}
                }
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
            globalKeyHandler = nil
        }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 600),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "WIP Viewer"
        window.contentView = NSHostingView(rootView: ContentView())
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Install global key monitor for d/x shortcuts
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            // Don't intercept if the user is typing in a text field / text view
            if let responder = self.window.firstResponder, responder is NSTextView {
                return event
            }
            let chars = event.charactersIgnoringModifiers ?? ""
            // Only handle bare d and x (no command/option/control modifiers)
            let mods = event.modifierFlags.intersection([.command, .option, .control])
            if mods.isEmpty && (chars == "d" || chars == "x") {
                globalKeyHandler?(chars)
                return nil  // consume the event
            }
            return event
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

// MARK: - Entry Point

@main
struct WipViewerApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}
