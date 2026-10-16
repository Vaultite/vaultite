import AVFoundation
import Foundation
import WatchKit

/// The microphone: one recording at a time, AAC in an .m4a (small: mono, 16 kHz, 3 KB a second), handed to the phone
/// when it stops. One forgotten stops itself: after `quiet` of silence, `pausedLongest` paused, or at `longest`.
@MainActor
final class Recorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let longest: TimeInterval = 10 * 60
    static let quiet: TimeInterval = 60
    static let pausedLongest: TimeInterval = 5 * 60
    /// Average power (dB) below this is silence.
    static let silence: Float = -40

    /// A note under way, paused or not.
    @Published var recording = false
    @Published var paused = false
    /// What the timer counts from (now less what's recorded), and when it stopped counting.
    @Published var since: Date?
    @Published var pausedAt: Date?
    /// The microphone's level, 0 to 1.
    @Published var level: Float = 0
    /// A problem, or a word on what just happened (gone in a moment).
    @Published var problem: String?

    private var recorder: AVAudioRecorder?
    private var file: URL?
    private var ticker: Timer?
    private var silentSince: Date?
    private var heard = false
    private var warned = false

    func start() async {
        problem = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            problem = "Vaultite may not use the microphone (Settings > Privacy)"
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).m4a")
            let r = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 24_000,
            ])
            r.delegate = self
            r.isMeteringEnabled = true
            // The cap holds even when the ticker can't run (the app suspended).
            guard r.record(forDuration: Self.longest) else { throw PhoneLink.Failure("The microphone didn't start") }
            recorder = r
            file = url
            recording = true
            paused = false
            pausedAt = nil
            since = Date()
            silentSince = nil
            heard = false
            warned = false
            ticker = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
                Task { @MainActor in self.tick() }
            }
            WKInterfaceDevice.current().play(.start)
        } catch {
            problem = error.localizedDescription
        }
    }

    func togglePause() {
        guard let recorder else { return }
        if paused {
            recorder.record()
            since = Date().addingTimeInterval(-recorder.currentTime)
            pausedAt = nil
        } else {
            recorder.pause()
            pausedAt = Date()
            level = 0
        }
        paused.toggle()
        silentSince = nil
        WKInterfaceDevice.current().play(.click)
    }

    /// Thrown away, never sent.
    func discard() {
        guard let file = finish() else { return }
        try? FileManager.default.removeItem(at: file)
        WKInterfaceDevice.current().play(.directionDown)
        say("Discarded")
    }

    /// Stopped by hand, or by itself: sent, less `trim` seconds of silence at its end.
    func stop(trim: TimeInterval = 0) {
        let seconds = recorder?.currentTime ?? 0
        guard let file = finish() else { return }
        WKInterfaceDevice.current().play(.stop)
        // A tap by mistake isn't a note, nor one left running that never heard a word.
        if seconds < 0.7 || (trim > 0 && !heard) {
            try? FileManager.default.removeItem(at: file)
            say(seconds < 0.7 ? "Too short, not saved" : "Nothing heard, not saved")
            return
        }
        PhoneLink.shared.send(recording: file, trim: trim)
    }

    /// It reached `longest`: stopped by itself, sent like one stopped by hand.
    nonisolated func audioRecorderDidFinishRecording(_ r: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in if self.recorder === r { self.stop() } }
    }

    private func tick() {
        guard let r = recorder else { return }
        let now = Date()
        if paused {
            if let p = pausedAt, now.timeIntervalSince(p) >= Self.pausedLongest { stop() }
            return
        }
        r.updateMeters()
        let db = r.averagePower(forChannel: 0)
        level = max(0, min(1, (db + 50) / 50))
        if db > Self.silence {
            heard = true
            silentSince = nil
        } else if silentSince == nil {
            silentSince = now
        }
        if let s = silentSince, now.timeIntervalSince(s) >= Self.quiet {
            stop(trim: now.timeIntervalSince(s) - 2)
        } else if r.currentTime >= Self.longest {
            stop()
        } else if !warned, r.currentTime >= Self.longest - 60 {
            // A minute left: a tap on the wrist, so a long one isn't cut off by surprise.
            warned = true
            WKInterfaceDevice.current().play(.notification)
        }
    }

    /// Stop recording; the file, nil when there was none.
    private func finish() -> URL? {
        guard let recorder, let file else { return nil }
        recorder.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
        ticker?.invalidate()
        ticker = nil
        self.recorder = nil
        self.file = nil
        recording = false
        paused = false
        since = nil
        pausedAt = nil
        level = 0
        return file
    }

    private func say(_ text: String) {
        problem = text
        Task { try? await Task.sleep(for: .seconds(2)); if problem == text { problem = nil } }
    }
}
