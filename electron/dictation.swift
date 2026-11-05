// Live dictation (electron/dictation.ts): the microphone through Apple's recognizer, Parakeet (transcribe.cpp)
// or Soniox's cloud one when a start brings its key, told as JSON lines (web/src/core/dictation.ts' DictationEvent).
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
    /// Dropped unfinished (cancelled): let go of what it holds.
    func cancel()
}
extension Engine { func cancel() {} }

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

    init(language: String, words: [String]) async throws {
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
        // (words it should expect: names, "at Claude")
        if !words.isEmpty { let ctx = AnalysisContext(); ctx.contextualStrings[.general] = words; try? await analyzer.setContext(ctx) }
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
/// Parakeet (parakeet-unified-en-0.6b's GGUF) through transcribe.cpp in two passes, as Hex and Handy get their accuracy:
/// a streaming pass shows the words as they come (pending), then the whole utterance again, offline, is the final text.
final class Parakeet: Engine {
    static var model: OpaquePointer?
    static var session: OpaquePointer?
    static var loaded = ""
    /// One pass is this long at most: a longer run of speech without a pause is settled in parts.
    static let LONGEST = Int(RATE * 25)
    var active = false
    var shown = ""
    /// The utterance's audio, from just before it began, for the second pass.
    var heard: [Float] = []
    /// The last moment heard between utterances, for one starting again before the session stops feeding.
    var ring: [Float] = []

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
            // (silence through both passes once: Metal's kernels built and the weights read in now, not on the first words)
            let quiet = [Float](repeating: 0, count: Int(RATE * 0.6))
            begin()
            if active { _ = quiet.withUnsafeBufferPointer { transcribe_stream_feed(session, $0.baseAddress, Int32(quiet.count), nil) } }
            transcribe_stream_reset(session)
            active = false
            _ = quiet.withUnsafeBufferPointer { transcribe_run(session, $0.baseAddress, Int32(quiet.count), nil) }
        }
    }

    func begin() {
        guard let s = Parakeet.session, let m = Parakeet.model else { return }
        var params = transcribe_stream_params()
        transcribe_stream_params_init(&params)
        // (L, C, R) = 5.6 s / 160 ms / 160 ms: words 320 ms behind the voice (the model card's menu)
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
        heard = []
    }

    /// The streaming pass's words so far, as pending.
    func publish() {
        guard let s = Parakeet.session else { return }
        var t = transcribe_stream_text()
        transcribe_stream_text_init(&t)
        guard transcribe_stream_get_text(s, &t) == TRANSCRIBE_OK else { return }
        let text = { (p: UnsafePointer<CChar>?, n: UInt64) -> String in p.flatMap { String(data: Data(bytes: $0, count: Int(n)), encoding: .utf8) } ?? "" }
        let now = (text(t.committed_text, t.committed_text_bytes) + text(t.tentative_text, t.tentative_text_bytes)).trimmingCharacters(in: .whitespaces)
        if now != shown { shown = now; emit("pending", ["text": now]) }
    }

    func feed(_ pcm: [Float]) {
        guard !pcm.isEmpty else { return }
        if !active {
            ring.append(contentsOf: pcm)
            if ring.count > Session.PREROLL { ring.removeFirst(ring.count - Session.PREROLL) }
            return
        }
        guard let s = Parakeet.session else { return }
        heard.append(contentsOf: pcm)
        let st = pcm.withUnsafeBufferPointer { transcribe_stream_feed(s, $0.baseAddress, Int32(pcm.count), nil) }
        if st != TRANSCRIBE_OK { emit("error", ["code": "engine", "message": String(cString: transcribe_status_string(Int32(st.rawValue)))]); active = false; return }
        publish()
        if heard.count >= Parakeet.LONGEST { commit(); begin() }
    }
    func speech() {
        guard !active else { return }
        begin()
        let r = ring
        ring = []
        if active { feed(r) }
    }
    /// The second pass: the utterance's audio whole, offline, as the final words (the pending ones go).
    func commit() {
        guard active, let s = Parakeet.session else { return }
        transcribe_stream_reset(s)
        active = false
        ring = []
        let audio = heard
        heard = []
        let st = audio.withUnsafeBufferPointer { transcribe_run(s, $0.baseAddress, Int32(audio.count), nil) }
        let text = st == TRANSCRIBE_OK ? (transcribe_full_text(s).map { String(cString: $0) } ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : ""
        if st != TRANSCRIBE_OK { emit("error", ["code": "engine", "message": String(cString: transcribe_status_string(Int32(st.rawValue)))]) }
        if !text.isEmpty { emit("final", ["text": text]) }
        if !shown.isEmpty { shown = ""; emit("pending", ["text": ""]) }
    }
    func pause() { commit() }
    func finish(_ done: @escaping () -> Void) {
        commit()
        done()
    }
}
#endif

/// Soniox's real-time recognizer over a WebSocket (its key from electron/dictation.ts): the audio streams as it's heard,
/// a pause or the stop asks it to finalize. Failing, this Mac's engine (`local`) hears again what it hadn't settled.
final class Soniox: NSObject, Engine, URLSessionWebSocketDelegate, @unchecked Sendable {
    let q = DispatchQueue(label: "dictation.soniox")
    let local: () async throws -> Engine
    let config: String
    var session: URLSession!
    var task: URLSessionWebSocketTask!
    var open = false, closed = false, dead = false
    var queued: [URLSessionWebSocketTask.Message] = []
    /// The audio sent from the last final word on (sample `keptAt` of the stream first): what a fallback hears again.
    var kept: [Float] = [], keptAt = 0, sent = 0, unasked = 0
    var finals = "", shown = "", paused = false
    /// Finalizes asked for, and their <fin>s back.
    var asked = 0, fins = 0
    var finishing: (() -> Void)?
    var fallback: Engine?, falling = false
    var timer: DispatchSourceTimer?, lastSent = Date()

    init(url: URL, key: String, model: String, languages: [String], words: [String], local: @escaping () async throws -> Engine) {
        var start: [String: Any] = ["model": model, "audio_format": "pcm_s16le", "sample_rate": Int(RATE), "num_channels": 1]
        if !languages.isEmpty { start["language_hints"] = languages }
        if !words.isEmpty { start["context"] = ["terms": words] }
        config = (try? JSONSerialization.data(withJSONObject: start)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        self.local = local
        super.init()
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let ops = OperationQueue()
        ops.underlyingQueue = q
        ops.maxConcurrentOperationCount = 1
        session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: ops)
        task = session.webSocketTask(with: req)
        q.async { [self] in
            task.resume()
            receive()
            // (no audio for a while, in a long quiet: Soniox drops a stream that says nothing)
            let t = DispatchSource.makeTimerSource(queue: q)
            t.schedule(deadline: .now() + 10, repeating: 10)
            t.setEventHandler { [weak self] in
                guard let self, self.open, !self.closed, Date().timeIntervalSince(self.lastSent) >= 10 else { return }
                self.send(.string("{\"type\":\"keepalive\"}"))
            }
            t.resume()
            timer = t
        }
    }

    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol p: String?) {
        guard !closed else { return }
        open = true
        send(.string(config))
        for m in queued { send(m) }
        queued = []
    }
    // (the receive loop says it in turn, after what came before it: these only if it doesn't)
    func urlSession(_ s: URLSession, task t: URLSessionTask, didCompleteWithError error: Error?) { droppedSoon() }
    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) { droppedSoon() }
    func droppedSoon() { q.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.dropped() } }
    /// The connection failed or went: why, as the handshake's answer tells.
    func dropped() {
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        fail(status == 401 || status == 403 ? "Soniox refused the key" : open ? "Soniox's connection dropped" : status > 0 ? "Soniox answered \(status)" : "Soniox can't be reached")
    }

    func send(_ m: URLSessionWebSocketTask.Message) {
        guard !closed else { return }
        guard open else { queued.append(m); return }
        lastSent = Date()
        task.send(m) { [weak self] e in if e != nil { self?.droppedSoon() } }
    }
    func receive() {
        task.receive { [weak self] r in
            guard let self else { return }
            self.q.async {
                guard !self.closed else { return }
                switch r {
                case .success(.string(let text)): self.heard(text); self.receive()
                case .success: self.receive()
                case .failure: self.dropped()
                }
            }
        }
    }

    /// A response: final tokens wait for their <fin> (a pause's, the stop's) and settle whole, the rest show pending.
    func heard(_ text: String) {
        guard let d = text.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        if let code = m["error_code"] {
            return fail("Soniox: \(m["error_message"] as? String ?? "error \(code)")")
        }
        var tail = ""
        for t in m["tokens"] as? [[String: Any]] ?? [] {
            let s = t["text"] as? String ?? ""
            if s == "<fin>" || s == "<end>" {
                if s == "<fin>" { fins += 1 }
                settle()
            } else if t["is_final"] as? Bool == true {
                finals += s
                if let end = (t["end_ms"] as? NSNumber)?.intValue { forget(through: end * Int(RATE) / 1000) }
            } else {
                tail += s
            }
        }
        show((finals + tail).trimmingCharacters(in: .whitespaces))
        if let done = finishing, fins >= asked || m["finished"] as? Bool == true {
            settle()
            finishing = nil
            close()
            done()
        }
    }
    func show(_ text: String) { if text != shown { shown = text; emit("pending", ["text": text]) } }
    func settle() {
        let t = finals.trimmingCharacters(in: .whitespaces)
        finals = ""
        if !t.isEmpty { emit("final", ["text": t]) }
        show("")
    }
    /// The audio up to sample `n` is in final words: a fallback needn't hear it.
    func forget(through n: Int) {
        let drop = min(n - keptAt, kept.count)
        if drop > 0 { kept.removeFirst(drop); keptAt += drop }
    }
    func askFinal() {
        guard unasked > 0 else { return }
        unasked = 0
        asked += 1
        send(.string("{\"type\":\"finalize\"}"))
    }

    func feed(_ pcm: [Float]) {
        q.async { [self] in
            if let f = fallback { return f.feed(pcm) }
            guard !dead else { return }
            kept.append(contentsOf: pcm)
            if falling { return }
            sent += pcm.count
            unasked += pcm.count
            var d = Data(count: pcm.count * 2)
            d.withUnsafeMutableBytes { (b: UnsafeMutableRawBufferPointer) in
                let o = b.bindMemory(to: Int16.self)
                for (i, x) in pcm.enumerated() { o[i] = Int16(max(-1, min(1, x)) * 32767).littleEndian }
            }
            send(.data(d))
        }
    }
    func speech() { q.async { [self] in paused = false; fallback?.speech() } }
    func pause() {
        q.async { [self] in
            paused = true
            if let f = fallback { return f.pause() }
            if !falling { askFinal() }
        }
    }
    func finish(_ done: @escaping () -> Void) {
        q.async { [self] in
            if let f = fallback { return f.finish(done) }
            if dead { return done() }
            finishing = done
            if falling { return }
            askFinal()
            if fins >= asked { settle(); finishing = nil; close(); return done() }
            // (Soniox answers a finalize in a few hundred ms; much later, this Mac finishes instead)
            q.asyncAfter(deadline: .now() + 4) { [weak self] in if self?.finishing != nil { self?.fail("Soniox didn't answer in time") } }
        }
    }
    func cancel() { q.async { [self] in close(); fallback?.cancel() } }

    func close() {
        guard !closed else { return }
        closed = true
        timer?.cancel()
        task.cancel(with: .normalClosure, reason: nil)
        session.invalidateAndCancel()
    }

    /// The cloud is gone: what it settled stays, this Mac's engine hears the rest again and goes on.
    func fail(_ why: String) {
        guard !closed, fallback == nil, !falling else { return }
        close()
        settle()
        falling = true
        emit("fallback", ["message": "\(why): dictating on this Mac"])
        Task {
            do {
                let e = try await local()
                q.async { [self] in
                    falling = false
                    fallback = e
                    e.speech()
                    e.feed(kept)
                    kept = []
                    if paused { e.pause() }
                    if let done = finishing { finishing = nil; e.finish(done) }
                }
            } catch {
                let f = error as? Failure
                q.async { [self] in
                    falling = false
                    dead = true
                    kept = []
                    emit("error", ["code": "cloud", "message": "\(why), and this Mac's recognizer couldn't take over: \(f?.message ?? error.localizedDescription)"])
                    if let done = finishing { finishing = nil; done() }
                }
            }
        }
    }
}

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
    /// What the microphone heard, kept for replaying it (the setting Keep the last dictation's audio).
    var recording: AVAudioFile?

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
        if let f = recording, let b = AVAudioPCMBuffer(pcmFormat: mono16k, frameCapacity: AVAudioFrameCount(pcm.count)) {
            b.frameLength = AVAudioFrameCount(pcm.count)
            pcm.withUnsafeBufferPointer { b.floatChannelData![0].update(from: $0.baseAddress!, count: pcm.count) }
            try? f.write(from: b)
        }
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
            recording = nil
            // (`settled`: ms from the stop to the last words, the wait the user feels)
            emit("end", ["reason": reason].merging(stopped.map { ["settled": Int(Date().timeIntervalSince($0) * 1000)] } ?? [:]) { a, _ in a })
            onEnd?()
        }
        if flush, let e = engine { e.finish { self.work.async(execute: finish) } } else { engine?.cancel(); finish() }
    }
    var stopped: Date?
    /// The microphone off at once (the engine may still be catching up), then the end in turn: the last words, `end`.
    func stop(_ reason: String) {
        if stopped == nil { stopped = Date() }
        source.stop()
        work.async { self.end(reason, flush: reason != "cancel") }
    }
}

// MARK: - Commands

func makeEngine(_ cmd: [String: Any]) -> () async throws -> Engine {
    let engine = cmd["engine"] as? String ?? "apple"
    let language = cmd["language"] as? String ?? ""
    let model = cmd["model"] as? String ?? ""
    let words = cmd["words"] as? [String] ?? []
    let here = makeLocal(engine: engine, language: language, model: model, words: words)
    // (the cloud first when its key came: this Mac's engine takes over should it fail)
    if let c = cmd["cloud"] as? [String: Any], let u = (c["url"] as? String).flatMap(URL.init(string:)), let key = c["key"] as? String, !key.isEmpty {
        let languages = c["languages"] as? [String] ?? [], model = c["model"] as? String ?? "stt-rt-v6"
        return { Soniox(url: u, key: key, model: model, languages: languages, words: words, local: here) }
    }
    return here
}

func makeLocal(engine: String, language: String, model: String, words: [String]) -> () async throws -> Engine {
    return {
        if engine == "parakeet" {
            #if PARAKEET
            return try Parakeet(model: model)
            #else
            throw Failure(code: "unsupported", message: "This build has no Parakeet")
            #endif
        }
        guard #available(macOS 26.0, *) else { throw Failure(code: "unsupported", message: "Apple's dictation needs macOS 26") }
        return try await Apple(language: language, words: words)
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
            s = Session(source: source, silence: cmd["silence"] as? Double ?? 0)
            if let path = cmd["record"] as? String, !path.isEmpty {
                try? FileManager.default.removeItem(atPath: path)
                s.recording = try? AVAudioFile(forWriting: URL(fileURLWithPath: path), settings: mono16k.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
            }
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
    var cmd: [String: Any] = ["engine": arg("--engine") ?? "apple", "language": arg("--language") ?? "", "model": arg("--model") ?? "",
                              "words": (arg("--words") ?? "").split(separator: ",").map(String.init)]
    cmd["cmd"] = "start"
    // (`--cloud '{"url":…,"key":…}'`: Soniox's, or a stand-in for it)
    if let c = arg("--cloud"), let d = c.data(using: .utf8) { cmd["cloud"] = try? JSONSerialization.jsonObject(with: d) }
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
