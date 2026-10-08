import AppIntents
import SwiftUI
import WidgetKit

/// Agents waiting for the user (unread `waiting` events), with Approve and Deny for a permission (the op inbox.answer),
/// as the notification has. Kept current by the server's widget push when one starts or stops waiting.

struct ApproveEvent: AppIntent {
    static let title: LocalizedStringResource = "Approve"
    static let isDiscoverable = false
    // It runs something on the Mac: the phone unlocked, like the notification's Approve.
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication
    @Parameter(title: "Event") var id: String

    init() {}
    init(_ id: String) { self.id = id }

    func perform() async throws -> some IntentResult {
        _ = try await Servers.call("POST", "ops/inbox.answer", ["id": id, "answer": "approve"], from: "widget")
        return .result()
    }
}

struct DenyEvent: AppIntent {
    static let title: LocalizedStringResource = "Deny"
    static let isDiscoverable = false
    @Parameter(title: "Event") var id: String

    init() {}
    init(_ id: String) { self.id = id }

    func perform() async throws -> some IntentResult {
        _ = try await Servers.call("POST", "ops/inbox.answer", ["id": id, "answer": "deny"], from: "widget")
        return .result()
    }
}

struct AgentsEntry: TimelineEntry {
    let date: Date
    let waiting: [Feed.Waiting]
    let stale: Bool
}

struct AgentsProvider: TimelineProvider {
    func placeholder(in context: Context) -> AgentsEntry {
        AgentsEntry(date: .now, waiting: [Feed.Waiting(id: "1", title: "Claude Code is waiting for you", body: "Wants to use Bash", ask: "permission", terminal: "claude-1")], stale: false)
    }
    func getSnapshot(in context: Context, completion: @escaping (AgentsEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await entry()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AgentsEntry>) -> Void) {
        Task { completion(Timeline(entries: [await entry()], policy: .after(.now.addingTimeInterval(900)))) }
    }

    private func entry() async -> AgentsEntry {
        let (w, stale) = await Feed.waiting()
        return AgentsEntry(date: .now, waiting: w ?? [], stale: stale)
    }
}

struct AgentsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "agents", provider: AgentsProvider()) { AgentsView(entry: $0) }
            .configurationDisplayName("Agents waiting")
            .description("Agents waiting for you: approve or deny from here.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
            .pushHandler(WidgetPushes.self)
    }
}

struct AgentsView: View {
    @Environment(\.widgetFamily) private var family
    let entry: AgentsEntry

    var body: some View {
        let n = entry.waiting.count
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) { Image(systemName: "hand.raised.fill").font(.caption); Text("\(n)").font(.title3.bold()) }
            }
            .containerBackground(.clear, for: .widget)
        case .accessoryInline:
            Label(n == 0 ? "No agent waiting" : "\(n) waiting", systemImage: "hand.raised").containerBackground(.clear, for: .widget)
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Text(n == 0 ? "No agent waiting" : "\(n) waiting").font(.headline)
                if let w = entry.waiting.first { Text(w.body ?? w.title).font(.caption).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(.clear, for: .widget)
        default:
            let rows = family == .systemLarge ? 4 : family == .systemMedium ? 2 : 1
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Agents", systemImage: "hand.raised.fill").font(.headline)
                    Spacer()
                    if n > 0 { Text("\(n)").font(.headline).foregroundStyle(.tint) }
                }
                if n == 0 {
                    Spacer()
                    Text(entry.stale ? "Can't reach your Mac" : "No agent is waiting").font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(entry.waiting.prefix(rows)) { w in WaitingRow(event: w, buttons: family != .systemSmall) }
                Spacer(minLength: 0)
            }
            .widgetURL(Links.command("inbox:open"))
            .containerBackground(.background, for: .widget)
        }
    }
}

struct WaitingRow: View {
    let event: Feed.Waiting
    let buttons: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text(event.body ?? "").font(.subheadline).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if buttons && event.answerable {
                Button(intent: DenyEvent(event.id)) { Image(systemName: "xmark") }.tint(.red).accessibilityLabel("Deny")
                Button(intent: ApproveEvent(event.id)) { Image(systemName: "checkmark") }.tint(.green).accessibilityLabel("Approve")
            }
        }
    }
}
