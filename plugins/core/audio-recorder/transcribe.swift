// Transcribes an audio file with Apple's on-device speech recognition (SpeechTranscriber, macOS 26), as the iPhone
// app does: the Audio recorder's transcriber on a Mac, nothing to install. Compiled the first time it's needed
// (plugin.ts). Prints the text; exit 2: this Mac can't (an older macOS, a language it hasn't), 1: it failed.
//   transcribe <file> [--language pt]     transcribe --check [--language pt]
import AVFoundation
import Foundation
import Speech

func fail(_ code: Int32, _ why: String) -> Never {
    FileHandle.standardError.write((why + "\n").data(using: .utf8)!)
    exit(code)
}

let args = Array(CommandLine.arguments.dropFirst())
var file: String?
var language: String?
var check = false
var i = 0
while i < args.count {
    switch args[i] {
    case "--check": check = true
    case "--language": i += 1; language = i < args.count ? args[i] : nil
    default: file = args[i]
    }
    i += 1
}

@available(macOS 26.0, *)
func locale() async -> Locale? {
    let wanted = language.flatMap { $0.isEmpty ? nil : Locale(identifier: $0) } ?? Locale.current
    return await SpeechTranscriber.supportedLocale(equivalentTo: wanted)
}

@available(macOS 26.0, *)
func transcribe(_ url: URL, _ locale: Locale) async throws -> String {
    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    // The language's model, the first time (a download, then kept by the system).
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

guard #available(macOS 26.0, *) else { fail(2, "Apple's speech recognition here needs macOS 26") }
let done = DispatchSemaphore(value: 0)
Task {
    defer { done.signal() }
    guard let loc = await locale() else { fail(2, "Apple's speech recognition has no \(language ?? Locale.current.identifier)") }
    if check { print(loc.identifier); return }
    guard let file else { fail(1, "usage: transcribe <file> [--language <code>]") }
    do {
        let text = try await transcribe(URL(fileURLWithPath: file), loc).trimmingCharacters(in: .whitespacesAndNewlines)
        print(text)
    } catch {
        fail(1, error.localizedDescription)
    }
}
done.wait()
