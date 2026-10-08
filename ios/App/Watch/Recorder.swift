import AVFoundation
import Foundation
import WatchKit

/// The microphone: one recording at a time, AAC in an .m4a (small: mono, 16 kHz, 3 KB a second), handed to the phone
/// when it stops.
@MainActor
final class Recorder: NSObject, ObservableObject {
    @Published var recording = false
    @Published var started: Date?
    @Published var problem: String?

    private var recorder: AVAudioRecorder?
    private var file: URL?

    func toggle() async {
        if recording { stop() } else { await start() }
    }

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
            guard r.record() else { throw PhoneLink.Failure("The microphone didn't start") }
            recorder = r
            file = url
            recording = true
            started = Date()
            WKInterfaceDevice.current().play(.start)
        } catch {
            problem = error.localizedDescription
        }
    }

    func stop() {
        guard let recorder, let file else { return }
        let long = recorder.currentTime
        recorder.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
        self.recorder = nil
        self.file = nil
        recording = false
        started = nil
        WKInterfaceDevice.current().play(.stop)
        // A tap by mistake isn't a note.
        if long < 0.7 {
            try? FileManager.default.removeItem(at: file)
            return
        }
        PhoneLink.shared.send(recording: file)
    }
}
