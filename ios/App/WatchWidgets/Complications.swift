import SwiftUI
import WidgetKit

/// Vaultite on the watch face: a microphone. A tap opens the app recording (`vaultite-watch://record`: the app's
/// onOpenURL, Watch/ContentView.swift), so a voice note is one tap away. It shows nothing that changes, so its timeline
/// is one entry, never reloaded.
@main
struct VaultiteComplications: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "record", provider: Provider()) { _ in
            Face().widgetURL(URL(string: "vaultite-watch://record"))
        }
        .configurationDisplayName("Voice note")
        .description("Tap to record a voice note for your inbox.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

struct Entry: TimelineEntry { let date: Date }

struct Face: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCorner:
            Image(systemName: "mic.fill").font(.title2).widgetLabel("Vaultite")
                .containerBackground(.clear, for: .widget)
        case .accessoryInline:
            Label("Voice note", systemImage: "mic.fill")
                .containerBackground(.clear, for: .widget)
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "mic.circle.fill").font(.title)
                VStack(alignment: .leading) {
                    Text("Vaultite").font(.headline)
                    Text("Voice note").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(.clear, for: .widget)
        default:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill").font(.title2)
            }
            .containerBackground(.clear, for: .widget)
        }
    }
}
