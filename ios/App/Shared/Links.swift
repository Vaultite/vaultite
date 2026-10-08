import AppIntents
import Foundation

/// What the widgets, controls and shortcuts ask the app for, as a `vaultite://` address: `record` (a voice note, the
/// app's VoiceNote.swift), `command/<id>` (a palette command) or `open/<path>` (a vault file), the last two done by the
/// server's page (phoneapp.ts takeLinks).
enum Links {
    static let record = URL(string: "vaultite://record")!
    static func command(_ id: String) -> URL { URL(string: "vaultite://command/\(id)")! }
    static func open(_ path: String) -> URL {
        URL(string: "vaultite://open/" + (path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""))!
    }

    /// The app hears of an address asked for (AppViewController); the last one waits in `pending` until it's taken.
    static let asked = Notification.Name("VaultiteLinkAsked")
    @MainActor static var pending: URL?

    @MainActor static func ask(_ url: URL) {
        guard url.scheme == "vaultite" else { return }
        pending = url
        NotificationCenter.default.post(name: asked, object: nil)
    }
}

/// What a widget, a control or a shortcut can open the app to do.
enum VaultiteAction: String, AppEnum {
    case voiceNote, newNote, dailyNote, search, openNote

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Action"
    static let caseDisplayRepresentations: [VaultiteAction: DisplayRepresentation] = [
        .voiceNote: DisplayRepresentation(title: "Voice note", image: .init(systemName: "mic.fill")),
        .newNote: DisplayRepresentation(title: "New note", image: .init(systemName: "square.and.pencil")),
        .dailyNote: DisplayRepresentation(title: "Daily note", image: .init(systemName: "calendar")),
        .search: DisplayRepresentation(title: "Search", image: .init(systemName: "magnifyingglass")),
        .openNote: DisplayRepresentation(title: "Open a note", image: .init(systemName: "doc.text")),
    ]

    var title: String {
        switch self {
        case .voiceNote: "Voice note"
        case .newNote: "New note"
        case .dailyNote: "Daily note"
        case .search: "Search"
        case .openNote: "Open a note"
        }
    }

    var symbol: String {
        switch self {
        case .voiceNote: "mic.fill"
        case .newNote: "square.and.pencil"
        case .dailyNote: "calendar"
        case .search: "magnifyingglass"
        case .openNote: "doc.text"
        }
    }

    var url: URL {
        switch self {
        case .voiceNote: Links.record
        case .newNote: Links.command("file:new")
        case .dailyNote: Links.command("today:daily-note")
        case .search: Links.command("search:open-tab")
        case .openNote: Links.command("switcher:open")
        }
    }
}

/// Open the app to do something. In both targets: the system runs it in the app (openAppWhenRun), wherever it's asked.
struct OpenVaultite: AppIntent {
    static let title: LocalizedStringResource = "Open Vaultite"
    static let description = IntentDescription("Record a voice note, write a new note, open today's daily note, search or open a note.")
    static let openAppWhenRun = true

    @Parameter(title: "Action", default: .voiceNote) var action: VaultiteAction

    init() {}
    init(_ action: VaultiteAction) { self.action = action }

    @MainActor func perform() async throws -> some IntentResult {
        Links.ask(action.url)
        return .result()
    }
}
