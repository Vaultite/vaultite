import AVFoundation
import Speech
import UIKit
import WatchConnectivity

/// The watch's way to the server: the watch can't reach the tailnet itself, so it asks the phone (WatchConnectivity),
/// which asks the server it opened last (Servers.current), like the share extension. The watch's side:
/// Watch/PhoneLink.swift. What it asks, as a message (a dictionary, answered with one):
///   - `do: inbox`: the Inbox's latest events (GET /api/inbox/events) -> `events` ([{id, title, body, kind, ask, read,
///     t}]), `unread`.
///   - `do: answer`, `id`, `answer` (approve, deny, read): the op inbox.answer -> `ok`.
///   - `do: wake`: nothing; it wakes this app so the recordings sent with it come in now.
/// A short voice note comes as message data, the phone near, answered with its outcome (JSON). Otherwise it comes as a file (transferFile, metadata `do: voice`, `id`): sent on (Voice.send: transcribed here when
/// short, else by the server), and the outcome sent back (transferUserInfo: `voice` (its id), `text`, `path` or `error`).
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { await Voice.retry() }
        }
    }

    /// With the watch app there, ask for speech recognition now, while the app is in front: a voice note wakes it in
    /// the background, where it can't ask (the older recognizer needs it; SpeechTranscriber doesn't).
    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        guard state == .activated, session.isWatchAppInstalled, SFSpeechRecognizer.authorizationStatus() == .notDetermined else { return }
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState == .active { SFSpeechRecognizer.requestAuthorization { _ in } }
        }
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() } // another watch was paired

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        let task = UIApplication.shared.beginBackgroundTask(withName: "watch")
        Task {
            replyHandler(await self.handle(message))
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    /// `do: wake`, sent without waiting for an answer: being woken was the point.
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {}

    /// A short voice note, as the message itself (the phone is near): its outcome is the answer (JSON: the keys a file's
    /// outcome has).
    func session(_ session: WCSession, didReceiveMessageData data: Data, replyHandler: @escaping (Data) -> Void) {
        let id = UUID().uuidString
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(id).m4a")
        let task = UIApplication.shared.beginBackgroundTask(withName: "voice")
        Task {
            var outcome: [String: Any] = ["voice": id]
            do {
                try data.write(to: url)
                outcome.merge(await Voice.send(url, from: "Apple Watch")) { $1 }
            } catch {
                outcome["error"] = Servers.say(error)
            }
            replyHandler((try? JSONSerialization.data(withJSONObject: outcome)) ?? Data())
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private func handle(_ m: [String: Any]) async -> [String: Any] {
        do {
            switch m["do"] as? String {
            case "inbox":
                let r = try await Servers.call("GET", "inbox/events?limit=30", from: "watch")
                let events = (r["events"] as? [[String: Any]] ?? []).map { e in
                    // Only what a message carries (plist values: no JSON nulls).
                    e.filter { ["id", "title", "body", "kind", "ask", "read", "t", "terminal"].contains($0.key) && !($0.value is NSNull) }
                }
                return ["events": events, "unread": r["unread"] as? Int ?? 0]
            case "answer":
                guard let id = m["id"] as? String, let answer = m["answer"] as? String else { return ["error": "Nothing to answer"] }
                return ["ok": true, "text": try await Push.answer(id, answer)]
            default:
                return ["ok": true]
            }
        } catch {
            return ["error": Servers.say(error)]
        }
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?["do"] as? String == "voice", let id = file.metadata?["id"] as? String else { return }
        // The file is gone when this returns: keep it until it's transcribed.
        let kept = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(id).m4a")
        try? FileManager.default.removeItem(at: kept)
        do { try FileManager.default.moveItem(at: file.fileURL, to: kept) } catch {
            WCSession.default.transferUserInfo(["voice": id, "error": Servers.say(error)])
            return
        }
        let task = UIApplication.shared.beginBackgroundTask(withName: "voice")
        Task {
            var outcome: [String: Any] = ["voice": id]
            outcome.merge(await Voice.send(kept, from: "Apple Watch")) { $1 }
            WCSession.default.transferUserInfo(outcome)
            UIApplication.shared.endBackgroundTask(task)
        }
    }
}

/// A recording on its way to the inbox, never lost: a short one transcribed here (the op inbox.voice, with the recording,
/// kept above its words); a long one, or one
/// this phone couldn't transcribe or send, goes as it is to the server (audio-recorder/voice), which transcribes it or
/// keeps the audio. It waits in Application Support/Voice notes until it's sent, so one the server can't be reached for
/// (or the app stopped mid-way) goes the app's next time in front.
@MainActor
enum Voice {
    /// Longer than this, the server transcribes it: here it'd outlast what iOS gives an app in the background.
    static let longest: TimeInterval = 180
    private static let waiting = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Voice notes", isDirectory: true)
    /// The ones being sent now (by send or retry: never both).
    private static var sending = Set<String>()

    /// Send it on; the file is taken. Its outcome: `text` (what was said, or where it is), `path` and `terminal` when this
    /// phone transcribed it, `error` when it couldn't even be kept.
    static func send(_ file: URL, from: String) async -> [String: Any] {
        let client = from == "Apple Watch" ? "watch" : "iphone"
        let url = waiting.appendingPathComponent("\(client)-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString).\(file.pathExtension)")
        do {
            try FileManager.default.createDirectory(at: waiting, withIntermediateDirectories: true)
            try FileManager.default.moveItem(at: file, to: url)
        } catch {
            return ["error": Servers.say(error)]
        }
        sending.insert(url.lastPathComponent)
        defer { sending.remove(url.lastPathComponent) }
        let seconds = (try? AVAudioFile(forReading: url)).map { Double($0.length) / $0.fileFormat.sampleRate } ?? 0
        if seconds > 0, seconds <= longest, let text = try? await Transcribe.file(url), let audio = try? Data(contentsOf: url),
           let r = try? await Servers.call("POST", "ops/inbox.voice", ["text": text, "from": from, "audio": audio.base64EncodedString(),
                                                                        "ext": url.pathExtension], from: client) {
            try? FileManager.default.removeItem(at: url)
            var out: [String: Any] = ["text": text, "path": r["path"] as? String ?? ""]
            if let t = r["terminal"] as? String { out["terminal"] = t }
            return out
        }
        do {
            try await upload(url)
            return ["text": "Sent to your server to transcribe: it'll be in your inbox"]
        } catch {
            return ["text": "Kept on your iPhone: it's sent when Vaultite next opens (\(Servers.say(error)))"]
        }
    }

    /// Send the recordings still waiting, oldest first; what still can't go stays.
    static func retry() async {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: waiting.path) else { return }
        for name in names.sorted() where !name.hasPrefix(".") && !sending.contains(name) {
            sending.insert(name)
            defer { sending.remove(name) }
            do { try await upload(waiting.appendingPathComponent(name)) } catch { return }
        }
    }

    /// To the server as it is, then gone from here.
    private static func upload(_ url: URL) async throws {
        let watch = url.lastPathComponent.hasPrefix("watch-")
        let data = try Data(contentsOf: url)
        _ = try await Servers.call("POST", "audio-recorder/voice", ["data": data.base64EncodedString(), "ext": url.pathExtension,
                                   "from": watch ? "Apple Watch" : "iPhone"], from: watch ? "watch" : "iphone", timeout: 600)
        try? FileManager.default.removeItem(at: url)
    }
}

/// What a recording says, transcribed on this phone.
enum Transcribe {
    static func file(_ url: URL) async throws -> String {
        let text: String
        // Its model not there and not downloadable now (no network, a simulator): the older recognizer.
        do { text = try await analyzer(url) } catch { text = try await recognizer(url) }
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { throw Servers.Failure("Nothing was heard") }
        return t
    }

    private static func analyzer(_ url: URL) async throws -> String {
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else {
            return try await recognizer(url)
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await install.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let collect = Task {
            var out = ""
            for try await r in transcriber.results { out += String(r.text.characters) }
            return out
        }
        let audio = try AVAudioFile(forReading: url)
        if let end = try await analyzer.analyzeSequence(from: audio) {
            try await analyzer.finalizeAndFinish(through: end)
        } else {
            await analyzer.cancelAndFinishNow()
        }
        return try await collect.value
    }

    /// A language SpeechTranscriber hasn't, or its model missing: the older recognizer, on the device when it can.
    private static func recognizer(_ url: URL) async throws -> String {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            throw Servers.Failure("Open Vaultite on your iPhone and allow speech recognition")
        }
        guard let recognizer = SFSpeechRecognizer() ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            throw Servers.Failure("Speech recognition isn't available now")
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = true
        return try await withCheckedThrowingContinuation { c in
            var done = false
            recognizer.recognitionTask(with: request) { result, error in
                if done { return }
                if let error { done = true; return c.resume(throwing: error) }
                if let result, result.isFinal { done = true; c.resume(returning: result.bestTranscription.formattedString) }
            }
        }
    }
}
