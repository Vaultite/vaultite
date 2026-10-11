import AVFoundation
import Foundation

/// Audio and video kept on this iPhone (the player's Download, web/src/core/phoneapp.ts): fetched in the background,
/// even with the app closed, and played from the first screen when the server can't be reached. Where offline playback
/// stopped waits here until the server's page takes it (`takePlaces`).
final class Downloads: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = Downloads()

    struct Item: Codable {
        var path: String, title: String, server: String, url: String
        var file: String?
        var size: Int64 = 0, got: Int64 = 0
        var done = false
        var error: String?
    }

    private let lock = NSLock()
    private var items: [String: Item] = [:]
    private let dir: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        var u = d
        try? u.setResourceValues(v)
        return d
    }()
    private var index: URL { dir.appendingPathComponent("index.json") }
    /// What iOS gives to call once a background session's events are delivered (AppDelegate).
    var finished: (() -> Void)?

    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: "app.vaultite.downloads")
        c.sessionSendsLaunchEvents = true
        c.isDiscretionary = false
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    override init() {
        super.init()
        if let data = try? Data(contentsOf: index), let saved = try? JSONDecoder().decode([String: Item].self, from: data) { items = saved }
        _ = session // (reconnects to downloads begun before the app was closed)
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: index, options: .atomic) }
    }

    /// The sound plays on with the screen locked or in another app, with the lock screen's controls.
    static func playback() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, policy: .longFormAudio)
    }

    func start(url: URL, path: String, title: String, server: String) {
        lock.lock(); defer { lock.unlock() }
        if let old = items[path], old.done, let f = old.file, FileManager.default.fileExists(atPath: f) { return }
        items[path] = Item(path: path, title: title, server: server, url: url.absoluteString)
        save()
        let task = session.downloadTask(with: url)
        task.taskDescription = path
        task.resume()
    }

    func list() -> [Item] {
        lock.lock(); defer { lock.unlock() }
        return items.values.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    func remove(path: String) {
        lock.lock(); defer { lock.unlock() }
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == path }.forEach { $0.cancel() } }
        if let f = items[path]?.file { try? FileManager.default.removeItem(atPath: f) }
        items[path] = nil
        save()
    }

    private func update(_ path: String?, _ change: (inout Item) -> Void) {
        guard let path else { return }
        lock.lock(); defer { lock.unlock() }
        guard var it = items[path] else { return }
        change(&it)
        items[path] = it
        save()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        lock.lock()
        if var it = items[downloadTask.taskDescription ?? ""] { it.got = totalBytesWritten; it.size = max(0, totalBytesExpectedToWrite); items[it.path] = it }
        lock.unlock() // (progress isn't saved on every write: once at the end)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 || status == 206 else {
            return update(downloadTask.taskDescription) { $0.error = "The server answered \(status)" }
        }
        let path = downloadTask.taskDescription ?? UUID().uuidString
        let ext = (path as NSString).pathExtension
        let to = dir.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        do {
            try FileManager.default.moveItem(at: location, to: to)
            update(path) { $0.file = to.path; $0.done = true; $0.error = nil; $0.got = $0.size > 0 ? $0.size : $0.got }
        } catch {
            update(path) { $0.error = error.localizedDescription }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, (error as NSError).code != NSURLErrorCancelled else { return }
        update(task.taskDescription) { $0.error = Servers.say(error) }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { self.finished?(); self.finished = nil }
    }

    // ---------- where offline playback stopped, for the server

    private let placesKey = "offlinePlaces"
    func setPlace(_ place: [String: Any]) {
        guard let path = place["path"] as? String else { return }
        var all = UserDefaults.standard.dictionary(forKey: placesKey) ?? [:]
        all[path] = place
        UserDefaults.standard.set(all, forKey: placesKey)
    }
    func takePlaces() -> [[String: Any]] {
        let all = UserDefaults.standard.dictionary(forKey: placesKey) ?? [:]
        UserDefaults.standard.removeObject(forKey: placesKey)
        return all.values.compactMap { $0 as? [String: Any] }
    }
}
