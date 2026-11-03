// Live dictation (electron/dictation.ts): the microphone through Apple's recognizer or Parakeet (transcribe.cpp), told
// as JSON lines (web/src/core/dictation.ts' DictationEvent); commands on stdin. Tests: --file <audio> --engine <e>.
import AVFoundation
import Foundation
import Speech
#if PARAKEET
import CTranscribe
#endif

// MARK: - Output

let outLock = NSLock()
var started = Date()
/// The session the events are of (the app's number for it): one ends before the next starts, so none mixes.
var sessionId = 0
func emit(_ type: String, _ fields: [String: Any] = [:]) {
    var o = fields
    o["type"] = type
    if sessionId > 0 && type != "engines" { o["id"] = sessionId }
    o["at"] = Int(Date().timeIntervalSince(started) * 1000)
    guard let d = try? JSONSerialization.data(withJSONObject: o) else { return }
    outLock.lock()
    FileHandle.standardOutput.write(d + Data([10]))
    outLock.unlock()
}

struct Failure: Error { let code: String; let message: String }

// MARK: - Audio in: 16 kHz mono float, what both engines and the pause detector take

let RATE = 16000.0
let mono16k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: RATE, channels: 1, interleaved: false)!

final class Resampler {
    let converter: AVAudioConverter
    let ratio: Double
    init?(from: AVAudioFormat, to: AVAudioFormat = mono16k) {
        guard let c = AVAudioConverter(from: from, to: to) else { return nil }
        converter = c
        ratio = to.sampleRate / from.sampleRate
    }
    func convert(_ b: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let cap = AVAudioFrameCount(Double(b.frameLength) * ratio + 64)
        guard let o = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: cap) else { return nil }
        var given = false
        var err: NSError?
        converter.convert(to: o, error: &err) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return b
        }
        return err == nil ? o : nil
    }
    func samples(_ b: AVAudioPCMBuffer) -> [Float] {
        guard let o = convert(b), let p = o.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: p, count: Int(o.frameLength)))
    }
}

protocol Source: AnyObject {
    func start(_ sink: @escaping ([Float]) -> Void) throws
    func stop()
}

final class Microphone: Source {
    let engine = AVAudioEngine()
    func start(_ sink: @escaping ([Float]) -> Void) throws {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .denied, .restricted: throw Failure(code: "permission", message: "Vaultite isn't allowed to use the microphone")
        default: break
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0, let r = Resampler(from: format) else {
            throw Failure(code: "mic", message: "There's no microphone to listen to")
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { b, _ in sink(r.samples(b)) }
        engine.prepare()
        do { try engine.start() } catch { throw Failure(code: "mic", message: "The microphone didn't start: \(error.localizedDescription)") }
    }
    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

/// A file played into the session as the microphone would (in real time unless `fast`), then a breath of silence.
final class FileSource: Source {
    let url: URL, fast: Bool, done: () -> Void
    var stopped = false
    init(_ url: URL, fast: Bool, done: @escaping () -> Void) { self.url = url; self.fast = fast; self.done = done }
    func start(_ sink: @escaping ([Float]) -> Void) throws {
        let file: AVAudioFile
        do { file = try AVAudioFile(forReading: url) } catch { throw Failure(code: "file", message: "Can't read \(url.path)") }
        guard let r = Resampler(from: file.processingFormat) else { throw Failure(code: "file", message: "Can't convert \(url.path)") }
        let chunk = AVAudioFrameCount(file.processingFormat.sampleRate / 10)
        Thread.detachNewThread { [self] in
            let t = Date()
            var fed = 0.0
            func pace() { if !fast { let wait = t.addingTimeInterval(fed).timeIntervalSinceNow; if wait > 0 { Thread.sleep(forTimeInterval: wait) } } }
            while !stopped, let b = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) {
                guard (try? file.read(into: b, frameCount: chunk)) != nil, b.frameLength > 0 else { break }
                sink(r.samples(b))
                fed += Double(b.frameLength) / file.processingFormat.sampleRate
                pace()
            }
            for _ in 0..<25 where !stopped { sink([Float](repeating: 0, count: 1600)); fed += 0.1; pace() }
            if !stopped { done() }
        }
    }
    func stop() { stopped = true }
}

// MARK: - Engines

protocol Engine: AnyObject {
    /// 16 kHz mono audio, in order: only while the user speaks and a moment around it (silence makes words up).
    func feed(_ pcm: [Float])
    /// The user started speaking after a pause (the audio from a moment before comes next).
    func speech()
    /// The user paused (a clause's end): what was heard so far becomes final.
    func pause()
    /// The end: everything heard becomes final, then `done`.
    func finish(_ done: @escaping () -> Void)
}

/// Apple's DictationTranscriber (macOS 26): volatile results are the pending words, final ones the text.
@available(macOS 26.0, *)
final class Apple: Engine {
    let transcriber: DictationTranscriber
    let analyzer: SpeechAnalyzer
    let input: AsyncStream<AnalyzerInput>.Continuation
    let format: AVAudioFormat
    let converter: Resampler?
    var results: Task<Void, Never>?

    static func locale(_ language: String) async -> Locale? {
        let wanted = language.isEmpty ? Locale.current : Locale(identifier: language)
        return await DictationTranscriber.supportedLocale(equivalentTo: wanted)
    }

    init(language: String) async throws {
        guard let loc = await Apple.locale(language) else {
            throw Failure(code: "language", message: "Apple's dictation has no \(language.isEmpty ? Locale.current.identifier : language)")
        }
        transcriber = DictationTranscriber(locale: loc, contentHints: [], transcriptionOptions: [.punctuation],
                                           reportingOptions: [.volatileResults, .frequentFinalization], attributeOptions: [])
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            if !(await DictationTranscriber.installedLocales).contains(loc) { emit("loading", ["what": "language"]) }
            try await install.downloadAndInstall()
        }
        format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) ?? mono16k
        converter = format == mono16k ? nil : Resampler(from: mono16k, to: format)
        let (stream, cont) = AsyncStream.makeStream(of: AnalyzerInput.self)
        input = cont
        analyzer = SpeechAnalyzer(modules: [transcriber])
        try await analyzer.prepareToAnalyze(in: format)
        try await analyzer.start(inputSequence: stream)
        let t = transcriber
        results = Task {
            do {
                for try await r in t.results {
                    let text = String(r.text.characters)
                    if r.isFinal {
                        if !text.isEmpty { emit("final", ["text": text]) }
                        emit("pending", ["text": ""])
                    } else {
                        emit("pending", ["text": text])
                    }
                }
            } catch {
                emit("error", ["code": "engine", "message": error.localizedDescription])
            }
        }
    }

    func feed(_ pcm: [Float]) {
        guard !pcm.isEmpty, let b = AVAudioPCMBuffer(pcmFormat: mono16k, frameCapacity: AVAudioFrameCount(pcm.count)) else { return }
        b.frameLength = AVAudioFrameCount(pcm.count)
        pcm.withUnsafeBufferPointer { b.floatChannelData![0].update(from: $0.baseAddress!, count: pcm.count) }
        guard let x = converter.map({ $0.convert(b) }) ?? b else { return }
        input.yield(AnalyzerInput(buffer: x))
    }
    func speech() {}
    func pause() {
        let a = analyzer
        Task { try? await a.finalize(through: nil) }
    }
    func finish(_ done: @escaping () -> Void) {
        input.finish()
        let a = analyzer, r = results
        Task {
            try? await a.finalizeAndFinishThroughEndOfInput()
            await r?.value
            done()
        }
    }
}

#if PARAKEET
/// Parakeet (parakeet-unified-en-0.6b's GGUF) through transcribe.cpp's buffered streaming, an utterance a stream: its
/// greedy decoder commits each chunk's words for good (no tentative text), so they come as final ~320 ms behind.
final class Parakeet: Engine {
    static var model: OpaquePointer?
    static var session: OpaquePointer?
    static var loaded = ""
    var active = false
    var emitted = 0 // committed bytes already sent as final
    var pending = ""

    init(model path: String) throws {
        if Parakeet.loaded != path {
            if let s = Parakeet.session { transcribe_session_free(s); Parakeet.session = nil }
            if let m = Parakeet.model { transcribe_model_free(m); Parakeet.model = nil }
            guard FileManager.default.fileExists(atPath: path) else { throw Failure(code: "model", message: "Parakeet's model isn't at \(path)") }
            emit("loading", ["what": "model"])
            _ = transcribe_init_backends_default()
            var m: OpaquePointer?
            var st = transcribe_model_load_file(path, nil, &m)
            guard st == TRANSCRIBE_OK, let model = m else { throw Failure(code: "model", message: "Parakeet's model didn't load: \(String(cString: transcribe_status_string(Int32(st.rawValue))))") }
            var s: OpaquePointer?
            st = transcribe_session_init(model, nil, &s)
            guard st == TRANSCRIBE_OK, let session = s else { transcribe_model_free(model); throw Failure(code: "model", message: "Parakeet couldn't start") }
            Parakeet.model = model
            Parakeet.session = session
            Parakeet.loaded = path
            // (silence through it once: Metal's kernels built and the weights read in now, not on the first words)
            begin()
            if active {
                let quiet = [Float](repeating: 0, count: Int(RATE * 0.6))
                _ = quiet.withUnsafeBufferPointer { transcribe_stream_feed(session, $0.baseAddress, Int32(quiet.count), nil) }
                _ = transcribe_stream_finalize(session, nil)
            }
            transcribe_stream_reset(session)
            active = false
        }
    }

    func begin() {
        guard let s = Parakeet.session, let m = Parakeet.model else { return }
        var params = transcribe_stream_params()
        transcribe_stream_params_init(&params)
        // (L, C, R) = 5.6 s / 160 ms / 160 ms: words 320 ms behind the voice, at 1.64% WER (the model card's menu)
        var ext = transcribe_parakeet_buffered_stream_ext()
        transcribe_parakeet_buffered_stream_ext_init(&ext)
        ext.left_ms = 5600; ext.chunk_ms = 160; ext.right_ms = 160
        let ok = transcribe_model_accepts_ext_kind(m, TRANSCRIBE_EXT_SLOT_STREAM, TRANSCRIBE_EXT_KIND_PARAKEET_BUFFERED_STREAM)
        let st = withUnsafePointer(to: &ext) { e in
            e.withMemoryRebound(to: transcribe_ext.self, capacity: 1) { p in
                if ok { params.family = p }
                return transcribe_stream_begin(s, nil, &params)
            }
        }
        guard st == TRANSCRIBE_OK else { emit("error", ["code": "engine", "message": String(cString: transcribe_status_string(Int32(st.rawValue)))]); return }
        active = true
        emitted = 0
    }

    func publish() {
        guard let s = Parakeet.session else { return }
        var t = transcribe_stream_text()
        transcribe_stream_text_init(&t)
        guard transcribe_stream_get_text(s, &t) == TRANSCRIBE_OK else { return }
        let bytes = { (p: UnsafePointer<CChar>?, n: UInt64) -> Data in p.map { Data(bytes: $0, count: Int(n)) } ?? Data() }
        let committed = bytes(t.committed_text, t.committed_text_bytes)
        if committed.count > emitted, let text = String(data: committed.suffix(from: emitted), encoding: .utf8) {
            emitted = committed.count
            emit("final", ["text": text])
        }
        let tentative = String(data: bytes(t.tentative_text, t.tentative_text_bytes), encoding: .utf8) ?? ""
        if tentative != pending { pending = tentative; emit("pending", ["text": tentative]) }
    }

    /// The last moment heard between utterances, for one starting again before the session stops feeding.
    var ring: [Float] = []
    func feed(_ pcm: [Float]) {
        guard !pcm.isEmpty else { return }
        if !active {
            ring.append(contentsOf: pcm)
            if ring.count > Session.PREROLL { ring.removeFirst(ring.count - Session.PREROLL) }
            return
        }
        guard let s = Parakeet.session else { return }
        let st = pcm.withUnsafeBufferPointer { transcribe_stream_feed(s, $0.baseAddress, Int32(pcm.count), nil) }
        if st != TRANSCRIBE_OK { emit("error", ["code": "engine", "message": String(cString: transcribe_status_string(Int32(st.rawValue)))]); active = false; return }
        publish()
    }
    func speech() {
        guard !active else { return }
        begin()
        let r = ring
        ring = []
        if active { feed(r) }
    }
    func pause() {
        guard active, let s = Parakeet.session else { return }
        _ = transcribe_stream_finalize(s, nil)
        publish()
        active = false
        ring = []
        if !pending.isEmpty { pending = ""; emit("pending", ["text": ""]) }
    }
    func finish(_ done: @escaping () -> Void) {
        pause()
        if let s = Parakeet.session { transcribe_stream_reset(s) }
        done()
    }
}
#endif

// MARK: - A session: a source, its pause detector and an engine

final class Session: @unchecked Sendable {
    let work = DispatchQueue(label: "dictation.work")
    let source: Source
    let silenceMs: Double
    var engine: Engine?
    var backlog: [[Float]] = []
    var ended = false
    var ending: String?
    // The pause detector: loudness against a floor that follows the room, in 20 ms frames.
    var floor: Float = 0.003
    var speaking = false, heard = false
    var quietMs = 0.0, sinceSpeechMs = 0.0
    var pausesSaid = Set<Int>()
    var open = false, preroll: [Float] = [], feeding: [Float] = []
    var level: Float = 0, levelMs = 0.0
    var onEnd: (() -> Void)?

    init(source: Source, silence: Double) {
        self.source = source
        silenceMs = silence * 1000
    }

    /// Listen at once, the audio kept until the engine is ready (`warm`: the engine first, as a test of its latency).
    func start(warm: Bool = false, make: @escaping () async throws -> Engine) {
        let listen = { [self] () -> Bool in
            do {
                try source.start { [weak self] pcm in self?.work.async { self?.audio(pcm) } }
            } catch let f as Failure {
                fail(f); return false
            } catch {
                fail(Failure(code: "mic", message: error.localizedDescription)); return false
            }
            emit("start")
            return true
        }
        if !warm && !listen() { return }
        Task {
            do {
                let e = try await make()
                work.async { [self] in
                    guard !ended else { return e.finish {} }
                    engine = e
                    for pcm in backlog { process(pcm) }
                    backlog = []
                    if let reason = ending { ending = nil; end(reason) }
                    if warm { _ = listen() }
                }
            } catch let f as Failure {
                work.async { self.fail(f) }
            } catch {
                work.async { self.fail(Failure(code: "engine", message: error.localizedDescription)) }
            }
        }
    }

    func fail(_ f: Failure) {
        emit("error", ["code": f.code, "message": f.message])
        end("error", flush: false)
    }

    /// Audio arrives: its level now (for the indicator), the rest once the engine is ready.
    func audio(_ pcm: [Float]) {
        guard !ended, !pcm.isEmpty else { return }
        var sum: Float = 0
        for x in pcm { sum += x * x }
        level = max(level, (sum / Float(pcm.count)).squareRoot())
        levelMs += Double(pcm.count) / RATE * 1000
        if levelMs >= 100 {
            let db = 20 * log10(max(level, 1e-6))
            emit("level", ["v": (min(1, max(0, (db + 60) / 50)) * 100).rounded() / 100])
            level = 0; levelMs = 0
        }
        if engine == nil { backlog.append(pcm) } else { process(pcm) }
    }

    func process(_ pcm: [Float]) {
        var i = 0
        let frame = Int(RATE * 0.02)
        while i < pcm.count {
            let n = min(frame, pcm.count - i)
            let f = pcm[i..<(i + n)]
            i += n
            var sum: Float = 0
            for x in f { sum += x * x }
            let rms = (sum / Float(n)).squareRoot()
            let ms = Double(n) / RATE * 1000
            if rms < floor { floor = max(rms, 0.0005) } else { floor += (rms - floor) * 0.002 }
            if rms > max(floor * 3, 0.006) {
                quietMs = 0
                sinceSpeechMs = 0
                if !speaking {
                    speaking = true
                    heard = true
                    pausesSaid = []
                    emit("speech")
                    engine?.speech()
                    if !open {
                        open = true
                        feeding = preroll
                        preroll = []
                    }
                }
            } else {
                quietMs += ms
                sinceSpeechMs += ms
                // (a breath inside a word isn't a pause)
                if speaking && quietMs >= 250 { speaking = false }
            }
            if open { feeding.append(contentsOf: f) } else {
                preroll.append(contentsOf: f)
                if preroll.count > Session.PREROLL { preroll.removeFirst(preroll.count - Session.PREROLL) }
            }
            for p in [700, 2000] where heard && quietMs >= Double(p) && !pausesSaid.contains(p) {
                pausesSaid.insert(p)
                if p == 700 {
                    flush()
                    engine?.pause()
                }
                emit("pause", ["ms": p])
            }
            if open && quietMs >= 1000 { flush(); open = false }
        }
        flush()
        if silenceMs > 0 && sinceSpeechMs >= silenceMs && !speaking { end("silence") }
    }
    static let PREROLL = Int(RATE * 0.4)
    func flush() {
        if !feeding.isEmpty { engine?.feed(feeding); feeding = [] }
    }

    /// Stop listening; what was heard becomes final (unless cancelled), then `end`.
    func end(_ reason: String, flush: Bool = true) {
        guard !ended else { return }
        // (stopped while the engine is still loading: what was said is heard first)
        if flush && engine == nil && !backlog.isEmpty { source.stop(); ending = reason; return }
        ended = true
        source.stop()
        let finish = { [self] in
            emit("end", ["reason": reason])
            onEnd?()
        }
        if flush, let e = engine { e.finish { self.work.async(execute: finish) } } else { finish() }
    }
    func stop(_ reason: String) { work.async { self.end(reason, flush: reason != "cancel") } }
}

// MARK: - Commands

func makeEngine(_ cmd: [String: Any]) -> () async throws -> Engine {
    let engine = cmd["engine"] as? String ?? "apple"
    let language = cmd["language"] as? String ?? ""
    let model = cmd["model"] as? String ?? ""
    return {
        if engine == "parakeet" {
            #if PARAKEET
            return try Parakeet(model: model)
            #else
            throw Failure(code: "unsupported", message: "This build has no Parakeet")
            #endif
        }
        guard #available(macOS 26.0, *) else { throw Failure(code: "unsupported", message: "Apple's dictation needs macOS 26") }
        return try await Apple(language: language)
    }
}

func check(_ language: String) async -> [String: Any] {
    var o: [String: Any] = [:]
    #if PARAKEET
    o["parakeet"] = true
    #else
    o["parakeet"] = false
    #endif
    if #available(macOS 26.0, *) {
        let loc = await Apple.locale(language)
        o["apple"] = loc != nil
        if let loc { o["locale"] = loc.identifier }
    } else {
        o["apple"] = false
    }
    return o
}

var current: Session?

func handle(_ cmd: [String: Any]) {
    switch cmd["cmd"] as? String {
    case "start":
        let begin = {
            sessionId = cmd["id"] as? Int ?? 0
            started = Date()
            // (a file instead of the microphone: a test of the app, heard as if said, then stopped as if by the user)
            var s: Session!
            let source: Source = (cmd["file"] as? String).map { f in FileSource(URL(fileURLWithPath: f), fast: false) { s.stop("stop") } } ?? Microphone()
            s = Session(source: source, silence: cmd["silence"] as? Double ?? 10)
            current = s
            s.onEnd = { DispatchQueue.main.async { if current === s { current = nil } } }
            s.start(make: makeEngine(cmd))
        }
        // (the one under way ends first, its last events its own)
        guard let old = current else { return begin() }
        current = nil
        old.onEnd = { DispatchQueue.main.async(execute: begin) }
        old.stop("cancel")
    case "stop": current?.stop("stop")
    case "cancel": current?.stop("cancel")
    case "check":
        let language = cmd["language"] as? String ?? ""
        Task { emit("engines", await check(language)) }
    default: break
    }
}

let args = Array(CommandLine.arguments.dropFirst())
func arg(_ name: String) -> String? { args.firstIndex(of: name).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil } }

if let file = arg("--file") {
    // A test: the file through the same session, then out.
    var cmd: [String: Any] = ["engine": arg("--engine") ?? "apple", "language": arg("--language") ?? "", "model": arg("--model") ?? ""]
    cmd["cmd"] = "start"
    var session: Session!
    let src = FileSource(URL(fileURLWithPath: file), fast: args.contains("--fast")) { session.stop("stop") }
    session = Session(source: src, silence: 0)
    session.onEnd = { exit(0) }
    session.start(warm: args.contains("--warm"), make: makeEngine(cmd))
    dispatchMain()
}

emit("ready")
Thread.detachNewThread {
    while let line = readLine() {
        guard let d = line.data(using: .utf8), let cmd = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
        DispatchQueue.main.async { handle(cmd) }
    }
    // (stdin closed: the app is gone, and the microphone with it)
    DispatchQueue.main.async {
        guard let s = current else { exit(0) }
        s.onEnd = { exit(0) }
        s.stop("cancel")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(0) }
    }
}
dispatchMain()
