import AppIntents
import SwiftUI
import WidgetKit

/// The routines (the op routine.list), like Today's: the large one is the week, the medium one today's as icons, the
/// small one today's as a list. A tap on a routine ticks it for today, like Today's (Feed.Routine.tappable); anywhere
/// else opens the Today page. A routine's whole strip is its button (Hit): widgets only hit what's drawn.

struct CheckRoutine: AppIntent {
    static let title: LocalizedStringResource = "Tick a routine"
    static let isDiscoverable = false
    @Parameter(title: "Routine") var name: String
    @Parameter(title: "Done") var done: Bool

    init() {}
    init(_ name: String, done: Bool) { self.name = name; self.done = done }

    func perform() async throws -> some IntentResult {
        _ = try await Servers.call("POST", "ops/routine.check", ["routine": name, "date": Feed.today(), "done": done], from: "widget")
        return .result()
    }
}

struct RoutinesEntry: TimelineEntry {
    let date: Date
    /// Every routine (`on`: today's).
    let routines: [Feed.Routine]
    let stale: Bool
    var page: String? = nil
    var today: [Feed.Routine] { routines.filter(\.on) }
    /// Where a tap outside a routine goes: the Today page, else today's daily note.
    var link: URL { page.map(Links.open) ?? Links.command("today:daily-note") }
    var done: Int { today.filter(\.done).count }
    /// Today in the week, Monday first.
    var weekday: Int { (Calendar.current.component(.weekday, from: date) + 5) % 7 }
}

struct RoutinesProvider: TimelineProvider {
    static let sample = [
        Feed.Routine(name: "Stretch", done: true, auto: false, icon: "heart", week: [true, false, true, true, false, false, false]),
        Feed.Routine(name: "Practice piano", done: false, auto: false, icon: "music", week: [false, true, false, true, false, false, false]),
        Feed.Routine(name: "Gym", done: false, auto: true, icon: "dumbbell", week: [true, false, true, false, false, false, false], target: 3),
        Feed.Routine(name: "Journal", done: false, auto: false, icon: "calendar-check", week: [true, true, true, false, false, false, false]),
    ]
    func placeholder(in context: Context) -> RoutinesEntry { RoutinesEntry(date: .now, routines: Self.sample, stale: false) }
    func getSnapshot(in context: Context, completion: @escaping (RoutinesEntry) -> Void) {
        if context.isPreview { return completion(placeholder(in: context)) }
        Task { completion(await entry()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RoutinesEntry>) -> Void) {
        Task {
            // Again in half an hour (a log that ticks one), and just after midnight (a new day's list).
            let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400)).addingTimeInterval(60)
            completion(Timeline(entries: [await entry()], policy: .after(min(.now.addingTimeInterval(1800), midnight))))
        }
    }

    private func entry() async -> RoutinesEntry {
        let (r, stale) = await Feed.routines()
        // Kept from another day: nothing of it is known today.
        let list = r.map { r in r.date == Feed.today() ? r.routines : r.routines.map { var x = $0; x.done = false; x.ticked = false; x.week = []; return x } } ?? []
        return RoutinesEntry(date: .now, routines: list, stale: stale, page: r?.page)
    }
}

struct RoutinesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "routines", provider: RoutinesProvider()) { RoutinesView(entry: $0) }
            .configurationDisplayName("Routines")
            .description("Your routines, like Today's: tick today's off.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline])
            .pushHandler(WidgetPushes.self)
    }
}

struct RoutinesView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RoutinesEntry

    // No animation when it changes (a tick, a reload): it just shows.
    var body: some View {
        content.contentTransition(.identity).transaction { $0.animation = nil }
    }

    @ViewBuilder private var content: some View {
        let today = entry.today, total = today.count
        switch family {
        case .accessoryCircular:
            Gauge(value: Double(entry.done), in: 0...Double(max(total, 1))) { Image(systemName: "checkmark") } currentValueLabel: { Text("\(entry.done)") }
                .gaugeStyle(.accessoryCircularCapacity)
                .containerBackground(.clear, for: .widget)
        case .accessoryInline:
            Label("\(entry.done) of \(total) routines", systemImage: "checkmark.circle").containerBackground(.clear, for: .widget)
        case .accessoryRectangular:
            VStack(alignment: .leading) {
                Text("Routines \(entry.done)/\(total)").font(.headline)
                ForEach(today.filter { !$0.done }.prefix(2), id: \.self) { Text($0.name).font(.caption).lineLimit(1) }
                if total > 0 && entry.done == total { Text("All done").font(.caption) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .containerBackground(.clear, for: .widget)
        case .systemLarge:
            WeekGrid(entry: entry).widgetURL(entry.link).containerBackground(.background, for: .widget)
        case .systemMedium:
            TodayIcons(entry: entry).widgetURL(entry.link).containerBackground(.background, for: .widget)
        default:
            VStack(alignment: .leading, spacing: 0) {
                Header(entry: entry).padding(.bottom, 2)
                if total == 0 { Spacer(); Empty(entry: entry) }
                ForEach(today.prefix(4), id: \.self) { r in RoutineRow(routine: r) }
                Spacer(minLength: 0)
            }
            .widgetURL(entry.link)
            .containerBackground(.background, for: .widget)
        }
    }
}

struct Header: View {
    let entry: RoutinesEntry
    var body: some View {
        HStack {
            Text("Routines").font(.headline)
            Spacer()
            if entry.stale { Image(systemName: "icloud.slash").font(.caption).foregroundStyle(.secondary) }
            Text("\(entry.done)/\(entry.today.count)").font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

struct Empty: View {
    let entry: RoutinesEntry
    var body: some View {
        Text(entry.stale ? "Can't reach your Mac" : "No routines today").font(.caption).foregroundStyle(.secondary)
    }
}

/// The week, like Today's routines: a row per routine, a column per day; today's column ticks.
struct WeekGrid: View {
    let entry: RoutinesEntry
    private let days = ["M", "T", "W", "T", "F", "S", "S"]

    var body: some View {
        let rows = Array(entry.routines.prefix(10))
        VStack(spacing: 0) {
            Header(entry: entry).padding(.bottom, 6)
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                ForEach(0..<7, id: \.self) { i in
                    Text(days[i]).font(.caption2.weight(i == entry.weekday ? .bold : .regular))
                        .foregroundStyle(i == entry.weekday ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary)).frame(width: 24)
                }
            }
            if rows.isEmpty { Spacer(); Empty(entry: entry) }
            ForEach(rows, id: \.self) { r in
                let row = HStack(spacing: 4) {
                    RoutineIcon(icon: r.icon, name: r.name).font(.caption).frame(width: 16).foregroundStyle(.secondary)
                    Text(r.name).font(.caption).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(0..<7, id: \.self) { i in Day(routine: r, index: i, today: entry.weekday) }
                }
                .frame(maxHeight: .infinity)
                Tick(routine: r) { row }
            }
            Spacer(minLength: 0)
        }
    }
}

/// One day of a routine: done, not, or a day it doesn't apply (only today's is known for that: earlier days show as not).
struct Day: View {
    let routine: Feed.Routine
    let index: Int
    let today: Int

    var body: some View {
        let done = index == today ? routine.done : (routine.week.indices.contains(index) && routine.week[index])
        let dot = ZStack {
            Circle().fill(done ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary))
            if done { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white) }
            if index == today && !done { Circle().strokeBorder(.tint.opacity(0.5), lineWidth: 1.5) }
        }
        .frame(width: 22, height: 22)
        .opacity(index > today || (index == today && !routine.on) ? 0.35 : 1)
        .frame(width: 24)
        dot
    }
}

/// Today's routines as icons: tap one to tick it.
struct TodayIcons: View {
    let entry: RoutinesEntry

    var body: some View {
        let today = Array(entry.today.prefix(12))
        VStack(alignment: .leading, spacing: 6) {
            Header(entry: entry)
            if today.isEmpty { Spacer(); Empty(entry: entry) }
            // No gaps between them: a tap there would open the app.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 6), spacing: 0) {
                ForEach(today, id: \.self) { r in
                    let face = VStack(spacing: 2) {
                        ZStack {
                            Circle().fill(r.done ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.tertiary))
                            RoutineIcon(icon: r.icon, name: r.name).font(.system(size: 17)).foregroundStyle(r.done ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                        }
                        .frame(width: 38, height: 38)
                        Text(r.name).font(.system(size: 9)).lineLimit(1).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 3)
                    Tick(routine: r) { face }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

/// A routine's button, its whole area hit (a fill too faint to see: widgets don't hit what isn't drawn), or just the
/// content when a tap has nothing to do (it then opens Today, like the rest of the widget).
struct Tick<Content: View>: View {
    let routine: Feed.Routine
    @ViewBuilder let content: Content

    var body: some View {
        let hit = content.background(Color.primary.opacity(0.01))
        if routine.tappable {
            Button(intent: CheckRoutine(routine.name, done: !routine.ticked)) { hit }.buttonStyle(.plain)
        } else {
            hit
        }
    }
}

struct RoutineRow: View {
    let routine: Feed.Routine

    var body: some View {
        let label = HStack(spacing: 6) {
            Image(systemName: routine.done ? "checkmark.circle.fill" : routine.auto ? "circle.dotted" : "circle")
                .foregroundStyle(routine.done ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            Text(routine.name).lineLimit(1).strikethrough(routine.done).foregroundStyle(routine.done ? .secondary : .primary)
        }
        .font(.subheadline)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        Tick(routine: routine) { label }
    }
}
