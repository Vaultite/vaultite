import Foundation
import WatchConnectivity
import WatchKit

/// The watch's way to the server, through the phone (the phone's side and what it's asked: App/WatchLink.swift). The
/// Inbox's events and answering them are messages (the phone must be reachable); a voice note is a file, queued until
/// the phone takes it, its outcome coming back later (`notes`).
@MainActor
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneLink()

    struct Event: Identifiable, Equatable {
        let id: String
        let title: String
        let body: String
        let kind: String
        let ask: String
        let terminal: String
        var read: Bool
        let t: Date

        /// An agent waiting on a permission in an app terminal: Approve and Deny answer it.
        var approvable: Bool { kind == "waiting" && ask == "permission" && !terminal.isEmpty && !read }
    }

    /// A voice note sent: on its way, saved (what it said), or failed (why).
    struct Note: Identifiable, Equatable {
        enum State: Equatable { case sending, saved(String), failed(String) }
        let id: String
        var state: State
        var dispatched = false
    }

    @Published var events: [Event] = []
    @Published var unread = 0
    @Published var loading = false
    @Published var problem: String?
    @Published var notes: [Note] = []

    struct Failure: LocalizedError {
        let errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Ask the phone something (a message), its answer; its `error` thrown.
    func ask(_ message: [String: Any]) async throws -> [String: Any] {
        let s = WCSession.default
        // Just launched: the session comes up, and finds the phone, in a moment.
        for _ in 0..<20 where s.activationState != .activated || !s.isReachable {
            try? await Task.sleep(for: .milliseconds(150))
        }
        guard s.activationState == .activated, s.isReachable else { throw Failure("Your iPhone isn't reachable") }
        let answer: [String: Any] = try await withCheckedThrowingContinuation { c in
            s.sendMessage(message, replyHandler: { c.resume(returning: $0) }, errorHandler: { c.resume(throwing: $0) })
        }
        if let e = answer["error"] as? String { throw Failure(e) }
        return answer
    }

    func refresh() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await ask(["do": "inbox"])
            events = (r["events"] as? [[String: Any]] ?? []).compactMap { e in
                guard let id = e["id"] as? String, let title = e["title"] as? String else { return nil }
                return Event(id: id, title: title, body: e["body"] as? String ?? "", kind: e["kind"] as? String ?? "info",
                             ask: e["ask"] as? String ?? "", terminal: e["terminal"] as? String ?? "", read: e["read"] as? Bool ?? false,
                             t: Date(timeIntervalSince1970: (e["t"] as? Double ?? 0) / 1000))
            }
            unread = r["unread"] as? Int ?? events.filter { !$0.read }.count
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Answer an event (approve, deny, read): what happened, in a word or a line.
    func answer(_ id: String, _ answer: String) async -> (ok: Bool, text: String) {
        do {
            let r = try await ask(["do": "answer", "id": id, "answer": answer])
            if let i = events.firstIndex(where: { $0.id == id }), !events[i].read { events[i].read = true; unread = max(0, unread - 1) }
            WKInterfaceDevice.current().play(.success)
            return (true, r["text"] as? String ?? "Done")
        } catch {
            WKInterfaceDevice.current().play(.failure)
            return (false, error.localizedDescription)
        }
    }

    /// Send a recording to the phone: a short one as a message while it's near (its outcome is the answer), else as a
    /// file, queued while it's away (its outcome comes later, didReceiveUserInfo).
    func send(recording url: URL) {
        let id = UUID().uuidString
        notes.insert(Note(id: id, state: .sending), at: 0)
        notes = Array(notes.prefix(5))
        let s = WCSession.default
        if s.isReachable, let data = try? Data(contentsOf: url), data.count < 60_000 {
            s.sendMessageData(data, replyHandler: { reply in
                let outcome = (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any] ?? [:]
                try? FileManager.default.removeItem(at: url)
                Task { @MainActor in self.heard(id, outcome) }
            }, errorHandler: { _ in
                // Not now: as a file, then.
                Task { @MainActor in s.transferFile(url, metadata: ["do": "voice", "id": id]) }
            })
            return
        }
        s.transferFile(url, metadata: ["do": "voice", "id": id])
        if s.isReachable { s.sendMessage(["do": "wake"], replyHandler: nil) }
    }

    /// A voice note's outcome (`error`, else `text` and `terminal` when the front door has it).
    private func heard(_ id: String, _ outcome: [String: Any]) {
        let error = outcome["error"] as? String
        let state: Note.State = error.map { .failed($0) } ?? .saved(outcome["text"] as? String ?? "")
        let dispatched = outcome["terminal"] != nil
        if let i = notes.firstIndex(where: { $0.id == id }) {
            notes[i].state = state
            notes[i].dispatched = dispatched
        } else {
            notes.insert(Note(id: id, state: state, dispatched: dispatched), at: 0)
        }
        WKInterfaceDevice.current().play(error == nil ? .success : .failure)
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}

    /// The phone came near again: what failed for want of it is asked again.
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in if self.problem != nil { await self.refresh() } }
    }

    /// A voice note's outcome, from the phone.
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let id = userInfo["voice"] as? String else { return }
        let outcome = userInfo.filter { ["error", "text", "terminal"].contains($0.key) }.mapValues { "\($0)" }
        Task { @MainActor in self.heard(id, outcome) }
    }

    /// A file that didn't make it to the phone.
    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        let id = fileTransfer.file.metadata?["id"] as? String
        let url = fileTransfer.file.fileURL
        try? FileManager.default.removeItem(at: url)
        guard let error, let id else { return }
        let why = error.localizedDescription
        Task { @MainActor in
            if let i = self.notes.firstIndex(where: { $0.id == id }) { self.notes[i].state = .failed(why) }
        }
    }
}
