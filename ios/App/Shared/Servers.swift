import Foundation
import UIKit

/// The servers the app knows (its first screen's list, web/src/phone.tsx) and the one it opened last. Kept in the app
/// group's defaults, so the share extension sends to the same server the app shows.
enum Servers {
    struct Server: Codable, Equatable {
        var url: String
        var name: String
    }

    static let defaults: UserDefaults = {
        if let group = Bundle.main.object(forInfoDictionaryKey: "VaultiteAppGroup") as? String, !group.isEmpty,
           let shared = UserDefaults(suiteName: group) {
            return shared
        }
        return .standard
    }()

    static var list: [Server] {
        get { defaults.data(forKey: "servers").flatMap { try? JSONDecoder().decode([Server].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "servers") }
    }

    static var last: String? {
        get { defaults.string(forKey: "last") }
        set { defaults.set(newValue, forKey: "last") }
    }

    /// Where things are sent: the server opened last, while it's still in the list, else the first.
    static var current: Server? { list.first { $0.url == last } ?? list.first }

    /// Whether an address is one of the servers' (the same scheme, host and port).
    static func knows(_ url: URL) -> Bool {
        guard let o = origin(url) else { return false }
        return list.contains { URL(string: $0.url).flatMap(origin) == o }
    }

    private static func origin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        return "\(scheme)://\(host):\(url.port ?? (scheme == "https" ? 443 : 80))"
    }

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }

    /// A request to the current server's API (`route` after /api/), its JSON answer; a 4xx or 5xx throws the server's
    /// error. `from`: what asks, as the server's activity names it (X-Vaultite-Client); `timeout`: longer for an upload.
    static func call(_ method: String, _ route: String, _ body: [String: Any]? = nil, from client: String = "iphone", timeout: TimeInterval = 30) async throws -> [String: Any] {
        guard let server = current, let url = URL(string: server.url + "/api/" + route) else {
            throw Failure("Open Vaultite and add your server first")
        }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(client, forHTTPHeaderField: "X-Vaultite-Client")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) { throw Failure(answer["error"] as? String ?? "The server answered \(status)") }
        return answer
    }

    /// The widgets' push token (iOS 26: Widgets/Widgets.swift gets it), told to the current server, which then reloads
    /// them when what they show changes (plugins/core/inbox/push.ts). The app tells it again with another server.
    static var widgetToken: String? {
        get { defaults.string(forKey: "widgetToken") }
        set { defaults.set(newValue, forKey: "widgetToken") }
    }

    static func tellWidgets() async {
        guard let token = widgetToken, current != nil else { return }
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        let app = Bundle.main.object(forInfoDictionaryKey: "VaultiteAppBundle") as? String ?? Bundle.main.bundleIdentifier ?? ""
        let name = await UIDevice.current.name
        _ = try? await call("POST", "inbox/devices", ["token": token, "env": env, "topic": app, "name": name, "widgets": true])
    }

    /// An error as a line of the app's (the system's words, without their full stop).
    static func say(_ error: Error) -> String {
        error.localizedDescription.trimmingCharacters(in: CharacterSet(charactersIn: ". "))
    }
}
