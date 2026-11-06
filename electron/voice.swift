// The companion's voice out (voice.ts): an answer's pieces in order, a cloud's PCM or this Mac's voice, its level as it
// plays; JSON lines in and out. VOICE_OUT=<file.wav> writes the audio there instead: tests never make a sound.
import AVFoundation
import Foundation

let RATE = 24_000.0
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: RATE, channels: 1, interleaved: false)!

func emit(_ m: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: m), var s = String(data: d, encoding: .utf8) else { return }
  s += "\n"
  FileHandle.standardOutput.write(s.data(using: .utf8)!)
}

/** One piece: its buffers as they come, whether all came (`ended`, and no synthesis still at work). */
final class Piece {
  let n: Int
  var buffers: [AVAudioPCMBuffer] = []
  var scheduled = 0, played = 0
  var ended = false, making = 0
  init(_ n: Int) { self.n = n }
  var complete: Bool { ended && making == 0 }
}

final class Voice: NSObject, AVSpeechSynthesizerDelegate {
  let engine = AVAudioEngine()
  let node = AVAudioPlayerNode()
  var pieces: [Piece] = []
  /** Bumped by a stop: what a buffer stopped then says when it's let go is dropped. */
  var gen = 0
  var running = false, started = Set<Int>()
  /** Where what's scheduled ends, in the player's samples: a piece starts there, or now if it ran dry. */
  var queueEnd: AVAudioFramePosition = 0
  var file: AVAudioFile?
  var idle: Timer?
  var synths: [AVSpeechSynthesizer] = []
  var level: Float = 0, lastLevel = Date.distantPast

  override init() {
    super.init()
    if let out = ProcessInfo.processInfo.environment["VOICE_OUT"], !out.isEmpty {
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: RATE, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]
      file = try? AVAudioFile(forWriting: URL(fileURLWithPath: out), settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    } else {
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buf, _ in self?.metered(buf) }
    }
  }

  func piece(_ n: Int) -> Piece {
    if let p = pieces.first(where: { $0.n == n }) { return p }
    let p = Piece(n)
    // (in their order, whichever came first: a piece made here may be told before the one the cloud made)
    pieces.insert(p, at: pieces.firstIndex(where: { $0.n > n }) ?? pieces.count)
    return p
  }

  /** 16-bit PCM at RATE into the piece's buffers. */
  func pcm(_ n: Int, _ data: Data) {
    let frames = data.count / 2
    guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)) else { return }
    buf.frameLength = AVAudioFrameCount(frames)
    let out = buf.floatChannelData![0]
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      let s = raw.bindMemory(to: Int16.self)
      for i in 0..<frames { out[i] = Float(Int16(littleEndian: s[i])) / 32768 }
    }
    piece(n).buffers.append(buf)
    pump()
  }

  /** The piece's words said by this Mac's voice for `language`: its buffers as the synthesizer writes them. */
  func say(_ n: Int, _ text: String, _ language: String, _ speed: Double) {
    let p = piece(n)
    p.making += 1
    let u = AVSpeechUtterance(string: text)
    u.voice = bestVoice(language)
    u.rate = Float(min(max(Double(AVSpeechUtteranceDefaultSpeechRate) * speed, Double(AVSpeechUtteranceMinimumSpeechRate)), Double(AVSpeechUtteranceMaximumSpeechRate)))
    let synth = AVSpeechSynthesizer()
    synths.append(synth)
    let g = gen
    var converter: AVAudioConverter?
    var done = false
    synth.write(u) { [weak self] buffer in
      DispatchQueue.main.async {
        guard let self, g == self.gen, !done else { return }
        guard let b = buffer as? AVAudioPCMBuffer, b.frameLength > 0 else {
          done = true
          p.making -= 1
          self.synths.removeAll { $0 === synth }
          self.pump()
          return
        }
        if converter == nil || converter!.inputFormat != b.format { converter = AVAudioConverter(from: b.format, to: format) }
        if let c = converter, let out = convert(b, c) { p.buffers.append(out); self.pump() }
      }
    }
  }

  func end(_ n: Int) { piece(n).ended = true; pump() }

  /** All at once: nothing more plays, nothing queued stays. */
  func stop() {
    gen += 1
    for s in synths { s.stopSpeaking(at: .immediate) }
    synths.removeAll()
    pieces.removeAll()
    started.removeAll()
    if running { node.stop() }
    queueEnd = 0
    level = 0
    emit(["type": "stopped"])
    emit(["type": "level", "v": 0])
  }

  /** What's come is scheduled in order: a piece's buffers once every piece before it has all of its own. */
  func pump() {
    for p in pieces {
      while p.scheduled < p.buffers.count {
        let b = p.buffers[p.scheduled]
        p.scheduled += 1
        play(b, p)
      }
      if !p.complete { break }
    }
    finished()
  }

  func play(_ b: AVAudioPCMBuffer, _ p: Piece) {
    let first = !started.contains(p.n)
    if first { started.insert(p.n) }
    let now = Date().timeIntervalSince1970 * 1000
    if let f = file {
      // (a file: heard when it's written)
      if first { emit(["type": "start", "n": p.n, "at": now]) }
      try? f.write(from: b)
      p.played += 1
      var sum: Float = 0
      let d = b.floatChannelData![0]
      for i in 0..<Int(b.frameLength) { sum += d[i] * d[i] }
      emit(["type": "level", "v": shaped(sqrt(sum / Float(max(1, b.frameLength))))])
      return
    }
    if !running {
      do { try engine.start(); running = true } catch { emit(["type": "error", "message": "\(error)"]); return }
    }
    idle?.invalidate(); idle = nil
    if !node.isPlaying { node.play() }
    // (when its first sound will be heard: after what's queued, and the device's latency; the drawing's pen keeps to it)
    let at = node.lastRenderTime.flatMap { node.playerTime(forNodeTime: $0) }?.sampleTime ?? 0, begin = max(queueEnd, at)
    if first { emit(["type": "start", "n": p.n, "at": now + Double(begin - at) / RATE * 1000 + engine.outputNode.presentationLatency * 1000]) }
    queueEnd = begin + AVAudioFramePosition(b.frameLength)
    let g = gen
    node.scheduleBuffer(b, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async { guard let self, g == self.gen else { return }; p.played += 1; self.finished() }
    }
  }

  /** Pieces played to their end are told done; with nothing left, the engine rests a while, then lets the device go. */
  func finished() {
    while let p = pieces.first, p.complete, p.played >= p.buffers.count, p.scheduled >= p.buffers.count {
      pieces.removeFirst()
      started.remove(p.n)
      emit(["type": "done", "n": p.n])
    }
    if pieces.isEmpty {
      if file != nil { return }
      emit(["type": "level", "v": 0])
      if running && idle == nil {
        idle = Timer.scheduledTimer(withTimeInterval: 8, repeats: false) { [weak self] _ in
          guard let self, self.pieces.isEmpty else { return }
          self.node.stop(); self.engine.stop(); self.running = false; self.idle = nil; self.queueEnd = 0
        }
      }
    }
  }

  func metered(_ b: AVAudioPCMBuffer) {
    guard let d = b.floatChannelData?[0] else { return }
    var sum: Float = 0
    for i in 0..<Int(b.frameLength) { sum += d[i] * d[i] }
    let v = shaped(sqrt(sum / Float(max(1, b.frameLength))))
    DispatchQueue.main.async {
      guard !self.pieces.isEmpty else { return }
      let now = Date()
      if now.timeIntervalSince(self.lastLevel) < 0.045 { return }
      self.lastLevel = now
      emit(["type": "level", "v": v])
    }
  }

  /** The file closed (written as it goes: its header once it is let go). */
  func finish() { file = nil }
}

/** A level the eye reads: speech's RMS (about 0.02 to 0.3) spread over 0 to 1. */
func shaped(_ rms: Float) -> Double { Double((min(1, max(0, (20 * log10(max(rms, 1e-5)) + 50) / 40)) * 100).rounded() / 100) }

func convert(_ b: AVAudioPCMBuffer, _ c: AVAudioConverter) -> AVAudioPCMBuffer? {
  let cap = AVAudioFrameCount(Double(b.frameLength) * RATE / b.format.sampleRate) + 64
  guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: cap) else { return nil }
  var given = false
  var err: NSError?
  c.convert(to: out, error: &err) { _, status in
    if given { status.pointee = .noDataNow; return nil }
    given = true
    status.pointee = .haveData
    return b
  }
  return err == nil && out.frameLength > 0 ? out : nil
}

/** This Mac's best voice for `language` (two letters, or a locale): premium, then enhanced, the user's region first. */
func bestVoice(_ language: String) -> AVSpeechSynthesisVoice? {
  let lang = language.lowercased().replacingOccurrences(of: "_", with: "-")
  let base = String(lang.prefix(while: { $0 != "-" }))
  let preferred = Locale.preferredLanguages.map { $0.lowercased() }.filter { $0.hasPrefix(base) }
  let regionDefault: [String: String] = ["pt": "pt-br", "en": "en-us", "es": "es-es", "fr": "fr-fr", "de": "de-de", "it": "it-it"]
  let wanted = lang.contains("-") ? [lang] : preferred + [regionDefault[base] ?? base]
  let all = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased().hasPrefix(base) && !$0.voiceTraits.contains(.isNoveltyVoice) }
  func rank(_ v: AVSpeechSynthesisVoice) -> (Int, Int) {
    let l = v.language.lowercased()
    let region = wanted.firstIndex(where: { l == $0 || l.hasPrefix($0) }) ?? wanted.count
    return (-v.quality.rawValue, region)
  }
  return all.min { a, b in let x = rank(a), y = rank(b); return x.1 != y.1 ? x.1 < y.1 : x.0 < y.0 } ?? AVSpeechSynthesisVoice(language: lang)
}

let voice = Voice()
var speed = 1.0
emit(["type": "ready"])
Thread {
  while let line = readLine() {
    guard let d = line.data(using: .utf8), let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let cmd = m["cmd"] as? String else { continue }
    DispatchQueue.main.async {
      let n = m["n"] as? Int ?? 0
      switch cmd {
      case "pcm": if let b = m["data"] as? String, let data = Data(base64Encoded: b) { voice.pcm(n, data) }
      case "say": voice.say(n, m["text"] as? String ?? "", m["language"] as? String ?? "en", m["speed"] as? Double ?? speed)
      case "end": voice.end(n)
      case "stop": voice.stop()
      case "speed": speed = m["v"] as? Double ?? 1
      case "voices":
        let l = m["language"] as? String ?? "en"
        let v = bestVoice(l)
        emit(["type": "voice", "language": l, "name": v?.name ?? "", "quality": v?.quality.rawValue ?? 0])
      default: break
      }
    }
  }
  DispatchQueue.main.async { voice.finish(); exit(0) }
}.start()
RunLoop.main.run()
