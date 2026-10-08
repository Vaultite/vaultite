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
/// A short voice note comes as message data, the phone near, answered with its outcome (JSON). Otherwise it comes as a file (transferFile, metadata `do: voice`, `id`): transcribed here, on the device (Speech's
/// SpeechTranscriber on iOS 26, else SFSpeechRecognizer), sent to the op inbox.voice, and the outcome sent back
/// (transferUserInfo: `voice` (its id), `text`, `path` or `error`). Any failure is `error`, in the app's words.
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
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
                outcome.merge(try await self.voice(url)) { $1 }
            } catch {
                outcome["error"] = Servers.say(error)
            }
            try? FileManager.default.removeItem(at: url)
            replyHandler((try? JSONSerialization.data(withJSONObject: outcome)) ?? Data())
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    /// Transcribe a recording and give it to the server (the op inbox.voice): `text`, `path`, `terminal`.
    private func voice(_ url: URL) async throws -> [String: Any] {
        let text = try await Transcribe.file(url)
        let r = try await Servers.call("POST", "ops/inbox.voice", ["text": text, "from": "Apple Watch"], from: "watch")
        var out: [String: Any] = ["text": text, "path": r["path"] as? String ?? ""]
        if let t = r["terminal"] as? String { out["terminal"] = t }
        return out
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
            do {
                outcome.merge(try await self.voice(kept)) { $1 }
            } catch {
                outcome["error"] = Servers.say(error)
            }
            try? FileManager.default.removeItem(at: kept)
            WCSession.default.transferUserInfo(outcome)
            UIApplication.shared.endBackgroundTask(task)
        }
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
