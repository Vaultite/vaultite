import Foundation
import WatchConnectivity
import WatchKit

/// The watch's way to the server, through the phone (App/WatchLink.swift). The Inbox is messages (the phone must be
/// reachable); a voice note is a file, queued until the phone takes it, its outcome coming back later (`notes`).
@MainActor
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneLink()

    struct Event: Identifiable, Equatable {
        let id: String
        let title: String
        /// Markdown (an agent's answer); `preview`, the same as one plain line.
        let body: String
        let preview: String
        let kind: String
        /// open (it needs the user, or a message to read), working (its agent is on their answer) or done.
        var state: String
        let ask: String
        let terminal: String
        let session: String
        /// Its host answers it (an agent run outside a terminal), not a terminal.
        let host: Bool
        var read: Bool
        let t: Date

        /// An agent waiting on a permission (in an app terminal, or its host's): Approve and Deny answer it.
        var approvable: Bool { state == "open" && kind != "info" && ask == "permission" && (!terminal.isEmpty || host) }
        /// An agent's session at its prompt, or asking its own question (a reply answers it): a reply goes back into it.
        var repliable: Bool { kind == "session" && state != "done" && ["answer", "report", "error", "question", ""].contains(ask) }
    }

    /// A voice note sent: on its way, saved (what it said), or failed (why).
    struct Note: Identifiable, Equatable {
        enum State: Equatable { case sending, saved(String), failed(String) }
        let id: String
        var state: State
        var at = Date()
        /// The agent it was handed to (Claude, Codex), else nil: it's only in the inbox.
        var agent: String?
    }

    @Published var events: [Event] = []
    /// What needs the user (sessions and asks open), the title's count.
    @Published var needs = 0
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
                return Event(id: id, title: title, body: e["body"] as? String ?? "", preview: e["preview"] as? String ?? e["body"] as? String ?? "",
                             kind: e["kind"] as? String ?? "info", state: e["state"] as? String ?? "open", ask: e["ask"] as? String ?? "",
                             terminal: e["terminal"] as? String ?? "", session: e["session"] as? String ?? "", host: e["host"] as? Bool ?? false,
                             read: e["read"] as? Bool ?? false, t: Date(timeIntervalSince1970: (e["t"] as? Double ?? 0) / 1000))
            }
            needs = r["needs"] as? Int ?? events.filter { $0.state == "open" && ($0.kind == "session" || $0.kind == "waiting") }.count
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Answer an event (approve, deny, done, or reply with `text`): what happened, in a word or a line.
    func answer(_ id: String, _ answer: String, text: String? = nil) async -> (ok: Bool, text: String) {
        do {
            var message: [String: Any] = ["do": "answer", "id": id, "answer": answer]
            if let text { message["text"] = text }
            let r = try await ask(message)
            if let i = events.firstIndex(where: { $0.id == id }) {
                let needed = events[i].state == "open" && events[i].kind != "info"
                events[i].read = true
                if answer == "done" { events.remove(at: i); if needed { needs = max(0, needs - 1) } }
                else if answer != "read" { events[i].state = "working"; if needed { needs = max(0, needs - 1) } }
            }
            WKInterfaceDevice.current().play(.success)
            return (true, r["text"] as? String ?? "Done")
        } catch {
            WKInterfaceDevice.current().play(.failure)
            return (false, error.localizedDescription)
        }
    }

    /// Send a recording to the phone: a short one as a message while it's near (its outcome is the answer), else as a
    /// file, queued while it's away; `trim`, the seconds of silence the phone cuts from its end.
    func send(recording url: URL, trim: TimeInterval = 0) {
        let id = UUID().uuidString
        notes.insert(Note(id: id, state: .sending), at: 0)
        notes = Array(notes.prefix(5))
        let s = WCSession.default
        var metadata: [String: Any] = ["do": "voice", "id": id]
        if trim > 0 { metadata["trim"] = trim }
        if trim == 0, s.isReachable, let data = try? Data(contentsOf: url), data.count < 60_000 {
            s.sendMessageData(data, replyHandler: { reply in
                let outcome = (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any] ?? [:]
                try? FileManager.default.removeItem(at: url)
                Task { @MainActor in self.heard(id, outcome) }
            }, errorHandler: { _ in
                // Not now: as a file, then.
                Task { @MainActor in s.transferFile(url, metadata: metadata) }
            })
            return
        }
        s.transferFile(url, metadata: metadata)
        if s.isReachable { s.sendMessage(["do": "wake"], replyHandler: nil) }
    }

    /// A voice note's outcome (`error`, else `text`, and `terminal` when an agent has it: `<agent>[_<account>]-<id>`).
    private func heard(_ id: String, _ outcome: [String: Any]) {
        let error = outcome["error"] as? String
        let state: Note.State = error.map { .failed($0) } ?? .saved(outcome["text"] as? String ?? "")
        let agent = (outcome["terminal"] as? String)?.split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map { $0.prefix(1).uppercased() + $0.dropFirst() }
        if let i = notes.firstIndex(where: { $0.id == id }) {
            notes[i].state = state
            notes[i].agent = agent
        } else {
            notes.insert(Note(id: id, state: state, agent: agent), at: 0)
        }
        // Stopping was the haptic that it's got: another only when it went wrong.
        if error != nil { WKInterfaceDevice.current().play(.failure) }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}

    /// The phone came near again: what failed for want of it is asked again.
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor in if self.problem != nil { await self.refresh() } }
    }

    /// A voice note's outcome, from the phone: a message when it's near, else queued.
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        outcome(message)
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        outcome(userInfo)
    }

    nonisolated private func outcome(_ info: [String: Any]) {
        guard let id = info["voice"] as? String else { return }
        let outcome = info.filter { ["error", "text", "terminal"].contains($0.key) }.mapValues { "\($0)" }
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
