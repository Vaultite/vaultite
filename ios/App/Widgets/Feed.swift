import Foundation

/// What the widgets show, from the server the app opened last (Servers.current), each kept in the app group: when the
/// server can't be reached (the Mac asleep, no tailnet), a widget shows the last one, marked stale.
enum Feed {
    /// A routine (the op routine.list): `on` it applies that day, `week` done each day Monday first, `icon` a Lucide
    /// name or an emoji (RoutineIcon).
    struct Routine: Codable, Hashable {
        let name: String
        var done: Bool
        let auto: Bool
        var on: Bool = true
        var icon: String = ""
        var week: [Bool] = []
        var target: Int = 7
        /// Ticked by hand today (done may also come from the data).
        var ticked: Bool = false

        init(name: String, done: Bool, auto: Bool, on: Bool = true, icon: String = "", week: [Bool] = [], target: Int = 7) {
            self.name = name; self.done = done; self.auto = auto; self.on = on; self.icon = icon; self.week = week; self.target = target
            ticked = done && !auto
        }

        /// A tap ticks it today or unticks a tick by hand; one done by its data alone has nothing to undo.
        var tappable: Bool { on && !(done && !ticked) }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decode(String.self, forKey: .name)
            done = try c.decode(Bool.self, forKey: .done)
            auto = try c.decode(Bool.self, forKey: .auto)
            on = try c.decodeIfPresent(Bool.self, forKey: .on) ?? true
            icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? ""
            week = try c.decodeIfPresent([Bool].self, forKey: .week) ?? []
            target = try c.decodeIfPresent(Int.self, forKey: .target) ?? 7
            ticked = try c.decodeIfPresent(Bool.self, forKey: .ticked) ?? (done && !auto)
        }
    }
    /// `page`: the Today page, which a tap outside a routine opens.
    struct Routines: Codable { let date: String; var page: String? = nil; let routines: [Routine] }

    /// An agent waiting for the user (an unread `waiting` event); `ask` permission with a terminal: Approve and Deny.
    struct Waiting: Codable, Hashable, Identifiable {
        let id: String
        let title: String
        let body: String?
        let ask: String?
        let terminal: String?
        var answerable: Bool { ask == "permission" && terminal != nil && !(terminal ?? "").contains("@") }
    }

    /// The user's date, as the vault writes it (YYYY-MM-DD).
    static func today(_ now: Date = .now) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: now)
    }

    static func routines() async -> (Routines?, stale: Bool) {
        let date = today()
        return await kept("widget.routines") {
            let r = try await Servers.call("POST", "ops/routine.list", ["date": date], from: "widget")
            return try decode(Routines.self, r)
        }
    }

    static func waiting() async -> ([Waiting]?, stale: Bool) {
        await kept("widget.waiting") {
            let r = try await Servers.call("GET", "inbox/events?limit=50", from: "widget")
            let events = (r["events"] as? [[String: Any]] ?? []).filter { $0["kind"] as? String == "waiting" && $0["read"] as? Bool != true }
            return try decode([Waiting].self, events)
        }
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ json: Any) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: json))
    }

    /// Fresh from the server and kept, else the one kept last.
    private static func kept<T: Codable>(_ key: String, _ load: () async throws -> T) async -> (T?, stale: Bool) {
        do {
            let value = try await load()
            Servers.defaults.set(try? JSONEncoder().encode(value), forKey: key)
            return (value, false)
        } catch {
            let old = Servers.defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
            return (old, true)
        }
    }
}
