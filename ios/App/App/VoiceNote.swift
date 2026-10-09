import AVFoundation
import Speech
import SwiftUI

/// A voice note on the phone (vaultite://record: the Action button, a control, a widget): it records as soon as it
/// shows, then goes to the inbox like the watch's (Voice, WatchLink.swift: transcribed here when short, else by the
/// server).
@MainActor
final class VoiceNote: NSObject, ObservableObject {
    enum Step: Equatable { case starting, recording, sending, sent(String), failed(String) }
    @Published var step = Step.starting
    @Published var started = Date()

    private var recorder: AVAudioRecorder?
    private var file: URL?
    var close: () -> Void = {}

    func start() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            return step = .failed("Vaultite may not use the microphone (Settings > Vaultite)")
        }
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
            _ = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let r = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 24_000,
            ])
            guard r.record() else { throw Servers.Failure("The microphone didn't start") }
            recorder = r
            file = url
            started = Date()
            step = .recording
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        } catch {
            step = .failed(Servers.say(error))
        }
    }

    /// Stop and send; a tap by mistake (under a second) isn't a note.
    func stop() async {
        guard let recorder, let file else { return }
        let long = recorder.currentTime
        finish()
        if long < 0.7 { try? FileManager.default.removeItem(at: file); return close() }
        step = .sending
        let outcome = await Voice.send(file, from: "iPhone")
        if let error = outcome["error"] as? String {
            step = .failed(error)
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return
        }
        step = .sent(outcome["text"] as? String ?? "")
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        try? await Task.sleep(for: .seconds(1.5))
        close()
    }

    func cancel() {
        if let file { try? FileManager.default.removeItem(at: file) }
        finish()
        close()
    }

    private func finish() {
        recorder?.stop()
        recorder = nil
        file = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

struct VoiceNoteView: View {
    @ObservedObject var note: VoiceNote

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            switch note.step {
            case .starting:
                ProgressView()
            case .recording:
                TimelineView(.periodic(from: note.started, by: 1)) { t in
                    Text(Duration.seconds(t.date.timeIntervalSince(note.started).rounded(.down)), format: .time(pattern: .minuteSecond))
                        .font(.system(size: 48, weight: .light).monospacedDigit())
                }
                Text("Recording").foregroundStyle(.secondary)
                Button { Task { await note.stop() } } label: {
                    Image(systemName: "stop.fill").font(.system(size: 32)).frame(width: 88, height: 88)
                        .background(Circle().fill(.red)).foregroundStyle(.white)
                }
                .accessibilityLabel("Stop and send")
            case .sending:
                ProgressView()
                Text("Sending to your inbox").foregroundStyle(.secondary)
            case .sent(let text):
                Image(systemName: "checkmark.circle.fill").font(.system(size: 48)).foregroundStyle(.green)
                Text(text).multilineTextAlignment(.center).lineLimit(6).padding(.horizontal)
            case .failed(let why):
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(.orange)
                Text(why).multilineTextAlignment(.center).padding(.horizontal)
            }
            Spacer()
            if case .sending = note.step {} else {
                Button(note.step == .recording || note.step == .starting ? "Cancel" : "Close") { note.cancel() }
                    .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity)
        .task { await note.start() }
    }
}
