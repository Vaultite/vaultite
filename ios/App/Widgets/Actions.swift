import AppIntents
import SwiftUI
import WidgetKit

/// Vaultite's shortcuts: a voice note, a new note, today's daily note, search, open a note. Each
/// opens the app at its address (Links), on the home screen, the lock screen and in Control Center.

struct ActionChoice: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Action"
    @Parameter(title: "Action", default: .voiceNote) var action: VaultiteAction
}

struct ActionEntry: TimelineEntry { let date = Date.now; let action: VaultiteAction }

struct ActionProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ActionEntry { ActionEntry(action: .voiceNote) }
    func snapshot(for c: ActionChoice, in context: Context) async -> ActionEntry { ActionEntry(action: c.action) }
    func timeline(for c: ActionChoice, in context: Context) async -> Timeline<ActionEntry> {
        Timeline(entries: [ActionEntry(action: c.action)], policy: .never)
    }
}

/// One action, picked when it's added (Edit widget).
struct ActionWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "action", intent: ActionChoice.self, provider: ActionProvider()) { e in
            ActionView(action: e.action).widgetURL(e.action.url)
        }
        .configurationDisplayName("Shortcut")
        .description("A voice note, a new note, your daily note, search or a note, a tap away.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular, .systemSmall])
    }
}

struct ActionView: View {
    @Environment(\.widgetFamily) private var family
    let action: VaultiteAction

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack { AccessoryWidgetBackground(); Image(systemName: action.symbol).font(.title2) }
                .containerBackground(.clear, for: .widget)
        case .accessoryInline:
            Label(action.title, systemImage: action.symbol).containerBackground(.clear, for: .widget)
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: action.symbol).font(.title2)
                VStack(alignment: .leading) {
                    Text("Vaultite").font(.headline)
                    Text(action.title).font(.caption)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(.clear, for: .widget)
        default:
            VStack(alignment: .leading) {
                Image(systemName: action.symbol).font(.system(size: 34)).foregroundStyle(.tint)
                Spacer()
                Text(action.title).font(.headline)
                Text("Vaultite").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

/// All of them at once: a grid on the home screen.
struct ActionsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "actions", provider: StaticProvider()) { _ in ActionsView() }
            .configurationDisplayName("Shortcuts")
            .description("A voice note, a new note, your daily note and search.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StaticProvider: TimelineProvider {
    struct Entry: TimelineEntry { let date = Date.now }
    func placeholder(in context: Context) -> Entry { Entry() }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry()], policy: .never))
    }
}

struct ActionsView: View {
    @Environment(\.widgetFamily) private var family
    private let actions: [VaultiteAction] = [.voiceNote, .newNote, .dailyNote, .search]

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: family == .systemMedium ? 4 : 2)
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(actions, id: \.self) { a in
                Link(destination: a.url) {
                    VStack(spacing: 4) {
                        Image(systemName: a.symbol).font(.title2)
                        if family == .systemMedium { Text(a.title).font(.caption2).lineLimit(1) }
                    }
                    .frame(maxWidth: .infinity, minHeight: family == .systemMedium ? 110 : 60)
                    .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 14))
                }
                .accessibilityLabel(a.title)
            }
        }
        .containerBackground(.background, for: .widget)
    }
}

/// Control Center, the lock screen's buttons and the Action button: a voice note.
struct VoiceNoteControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "voice-note") {
            ControlWidgetButton(action: OpenVaultite(.voiceNote)) { Label("Voice note", systemImage: "mic.fill") }
        }
        .displayName("Voice note")
        .description("Record a voice note for your inbox.")
    }
}

struct ControlChoice: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Action"
    @Parameter(title: "Action", default: .dailyNote) var action: VaultiteAction
}

/// The same, for any of the actions.
struct ActionControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: "action", intent: ControlChoice.self) { c in
            ControlWidgetButton(action: OpenVaultite(c.action)) { Label(c.action.title, systemImage: c.action.symbol) }
        }
        .displayName("Vaultite")
        .description("A new note, your daily note, search or a note.")
    }
}
