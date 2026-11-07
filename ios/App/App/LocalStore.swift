import CryptoKit
import Foundation
import Network

/// The phone's copy of a vault, for device sync and the offline app: plain files the page's sync engine reads and
/// writes through Shell's local* methods. Area "vault" is in Documents (the Files app shows it), "sync" (the engine's
/// own state) in Application Support. File work runs on `queue`, one call at a time.
final class LocalStore: @unchecked Sendable {
    static let shared = LocalStore()

    let queue = DispatchQueue(label: "app.vaultite.local")
    private let lock = NSLock()
    private var onWifi = false
    private let monitor = NWPathMonitor()
    private let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 300
        c.timeoutIntervalForResource = 24 * 3600
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        return URLSession(configuration: c)
    }()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            self.lock.lock()
            self.onWifi = path.status == .satisfied && path.usesInterfaceType(.wifi)
            self.lock.unlock()
        }
        monitor.start(queue: DispatchQueue(label: "app.vaultite.local.path"))
    }

    struct Bad: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }

    // ---------- where things are

    static func valid(vault: String) -> Bool {
        vault.range(of: "^[A-Za-z0-9-]{1,80}$", options: .regularExpression) != nil
    }

    static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    /// A vault's copy (area "vault"), whether it's there or not.
    static func copy(of vault: String) -> URL { documents.appendingPathComponent("Vault").appendingPathComponent(vault, isDirectory: true) }

    static func root(area: String?, vault: String?) throws -> URL {
        guard let vault, valid(vault: vault) else { throw Bad("not a vault id") }
        switch area {
        case "vault": return copy(of: vault)
        case "sync":
            return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Sync").appendingPathComponent(vault, isDirectory: true)
        default: throw Bad("no such area")
        }
    }

    /// A relative path inside `root`; never out of it.
    static func file(_ root: URL, _ path: String?) throws -> URL {
        guard let path, !path.isEmpty, !path.hasPrefix("/"), !path.contains("\0") else { throw Bad("not a relative path") }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        if parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) { throw Bad("not a relative path") }
        return parts.reduce(root) { $0.appendingPathComponent(String($1)) }
    }

    /// Whether a vault's copy has anything in it (the offline app can open it).
    static func hasCopy(_ vault: String) -> Bool {
        guard valid(vault: vault), let names = try? FileManager.default.contentsOfDirectory(atPath: copy(of: vault).path) else { return false }
        return names.contains { $0 != ".DS_Store" }
    }

    // ---------- the offline app's vault, and which vault each server's app serves

    static var offlineVault: String? {
        get { UserDefaults.standard.string(forKey: "offlineVault") }
        set { UserDefaults.standard.set(newValue, forKey: "offlineVault") }
    }

    static func offlineURL(_ vault: String) -> URL? {
        var c = URLComponents()
        c.scheme = LocalScheme.scheme
        c.host = LocalScheme.host
        c.path = "/offline.html"
        c.queryItems = [URLQueryItem(name: "vault", value: vault)]
        return c.url
    }

    /// A server's address as one key whatever way it's written (scheme, host and port).
    static func origin(_ address: String) -> String? {
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased() else { return nil }
        return "\(scheme)://\(host):\(url.port ?? (scheme == "https" ? 443 : 80))"
    }

    private static let offlineKey = "offlineVaults"
    static func setVault(_ vault: String?, for server: String) {
        guard let key = origin(server) else { return }
        var all = UserDefaults.standard.dictionary(forKey: offlineKey) as? [String: String] ?? [:]
        all[key] = vault
        UserDefaults.standard.set(all, forKey: offlineKey)
    }
    static func vault(for server: String) -> String? {
        guard let key = origin(server) else { return nil }
        return (UserDefaults.standard.dictionary(forKey: offlineKey) as? [String: String])?[key]
    }

    // ---------- the files

    static func stat(_ url: URL) throws -> [String: Any] {
        let a = try FileManager.default.attributesOfItem(atPath: url.path)
        return ["size": (a[.size] as? NSNumber)?.int64Value ?? 0, "mtime": ms(a[.modificationDate] as? Date)]
    }

    private static func ms(_ date: Date?) -> Int64 { Int64(((date?.timeIntervalSince1970 ?? 0) * 1000).rounded(.down)) }

    private static func skipped(_ name: String) -> Bool { name == ".DS_Store" || name.hasSuffix(".sync-part") }

    func list(_ root: URL) -> [[String: Any]] {
        guard let walk = FileManager.default.enumerator(atPath: root.path) else { return [] }
        var files: [[String: Any]] = []
        while let rel = walk.nextObject() as? String {
            guard let a = walk.fileAttributes, a[.type] as? FileAttributeType == .typeRegular,
                  !Self.skipped((rel as NSString).lastPathComponent) else { continue }
            files.append(["path": rel.precomposedStringWithCanonicalMapping, "size": (a[.size] as? NSNumber)?.int64Value ?? 0,
                          "mtime": Self.ms(a[.modificationDate] as? Date)])
        }
        return files
    }

    func read(_ root: URL, _ paths: [String]) throws -> [String: Any] {
        var files: [String: Any] = [:]
        for p in paths {
            let url = try Self.file(root, p)
            if let data = try? Data(contentsOf: url, options: .mappedIfSafe) { files[p] = data.base64EncodedString() } else { files[p] = NSNull() }
        }
        return files
    }

    func write(_ url: URL, _ data: Data, append: Bool) throws -> [String: Any] {
        let fm = FileManager.default
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if append, fm.fileExists(atPath: url.path) {
            let h = try FileHandle(forWritingTo: url)
            defer { try? h.close() }
            try h.seekToEnd()
            try h.write(contentsOf: data)
        } else {
            let part = Self.part(url)
            do {
                try data.write(to: part)
                try Self.replace(part, url)
            } catch {
                try? fm.removeItem(at: part)
                throw error
            }
        }
        return try Self.stat(url)
    }

    /// A temporary name next to `url`, which list skips and a rename puts in place.
    private static func part(_ url: URL) -> URL {
        let tag = UUID().uuidString.prefix(8).lowercased()
        return url.deletingLastPathComponent().appendingPathComponent("\(url.lastPathComponent).\(tag).sync-part")
    }

    /// rename(2): atomic, and it replaces what's there.
    private static func replace(_ from: URL, _ to: URL) throws {
        if Darwin.rename(from.path, to.path) != 0 {
            throw Bad(String(cString: strerror(errno)))
        }
    }

    func remove(_ root: URL, _ url: URL) throws {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) {
            if isDir.boolValue { throw Bad("a folder, not a file") }
            try FileManager.default.removeItem(at: url)
        }
        Self.prune(root, url.deletingLastPathComponent())
    }

    func move(_ root: URL, _ from: URL, _ to: URL) throws -> [String: Any] {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: from.path, isDirectory: &isDir), !isDir.boolValue else { throw Bad("no such file") }
        try FileManager.default.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.replace(from, to)
        Self.prune(root, from.deletingLastPathComponent())
        return try Self.stat(to)
    }

    /// Folders left empty (or with only a .DS_Store), up to the area's root, which stays.
    private static func prune(_ root: URL, _ dir: URL) {
        let fm = FileManager.default
        let top = root.standardizedFileURL.path
        var d = dir.standardizedFileURL
        while d.path.hasPrefix(top + "/") {
            guard let names = try? fm.contentsOfDirectory(atPath: d.path), names.allSatisfy({ $0 == ".DS_Store" }) else { return }
            guard (try? fm.removeItem(at: d)) != nil else { return }
            d = d.deletingLastPathComponent()
        }
    }

    /// A URL's bytes put at `url` once they're all here, with their SHA-256 (hex).
    func fetch(_ from: URL, headers: [String: String], to url: URL, done: @escaping (Result<[String: Any], Error>) -> Void) {
        var request = URLRequest(url: from)
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        session.downloadTask(with: request) { location, response, error in
            if let error { return done(.failure(Bad(Servers.say(error)))) }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200, let location else { return done(.failure(Bad("The server answered \(status)"))) }
            // URLSession deletes its file when this returns: moved next to where it goes first, then hashed.
            let part = Self.part(url)
            do {
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.moveItem(at: location, to: part)
            } catch { return done(.failure(error)) }
            self.queue.async {
                do {
                    let sha = try Self.sha256(part)
                    try Self.replace(part, url)
                    var info = try Self.stat(url)
                    info["sha256"] = sha
                    done(.success(info))
                } catch {
                    try? FileManager.default.removeItem(at: part)
                    done(.failure(error))
                }
            }
        }.resume()
    }

    static func sha256(_ url: URL) throws -> String {
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        var hash = SHA256()
        while let chunk = try h.read(upToCount: 1 << 20), !chunk.isEmpty { hash.update(data: chunk) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func info() -> [String: Any] {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let free = (try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage ?? 0
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.documents.appendingPathComponent("Vault").path)) ?? []
        lock.lock()
        let wifi = onWifi
        lock.unlock()
        return ["free": free, "wifi": wifi, "vaults": names.filter(Self.hasCopy).sorted()]
    }
}
