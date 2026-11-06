// The companion's voice out (voice.ts): an answer's pieces in order, a cloud's PCM or this Mac's voice, its level as it
// plays; JSON lines in and out. VOICE_OUT=<file.wav> writes the audio there instead: tests never make a sound.
import AVFoundation
import CoreAudio
import Foundation

let RATE = 24_000.0
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: RATE, channels: 1, interleaved: false)!

func emit(_ m: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: m), var s = String(data: d, encoding: .utf8) else { return }
  s += "\n"
  FileHandle.standardOutput.write(s.data(using: .utf8)!)
}

/** One piece: its buffers as they come, whether all came (`ended`, and no synthesis still at work); `starts`, where each
 *  one scheduled begins in the player's samples. */
final class Piece {
  let n: Int
  var buffers: [AVAudioPCMBuffer] = []
  var starts: [AVAudioFramePosition] = []
  var scheduled = 0, played = 0
  var ended = false, making = 0
  /** It gives way to what follows (a realtime voice's few words before the answer): once the next piece has audio, it
   *  plays out if it ends within this many seconds, else it ends at its next pause. */
  var yields: Double?
  init(_ n: Int) { self.n = n }
  var complete: Bool { ended && making == 0 }
  /** Where each of its buffers begins, the unscheduled ones following on from the last scheduled. */
  func positions(from start: AVAudioFramePosition) -> [AVAudioFramePosition] {
    var at = starts.first ?? start
    return buffers.enumerated().map { i, b in
      if i < starts.count { at = starts[i] }
      defer { at += AVAudioFramePosition(b.frameLength) }
      return at
    }
  }
}

/** How far back it says again after its output went away (what the device had but never played), at most and at least:
 *  from the quietest moment between, a gap between words. */
let REWIND_MAX = 0.9, REWIND_MIN = 0.25
/** A piece giving way ends at its quietest moment this soon (s), fading out, then a breath before the next. */
let GIVE_MIN = 0.04, GIVE_MAX = 0.2, FADE = 0.04, BREATH = 0.08

final class Voice: NSObject, AVSpeechSynthesizerDelegate {
  var engine = AVAudioEngine()
  var node = AVAudioPlayerNode()
  var pieces: [Piece] = []
  /** Pieces played to their end, or cut: what still comes of one is dropped. */
  var gone = Set<Int>()
  /** Bumped by a stop: what a buffer stopped then says when it's let go is dropped. */
  var gen = 0
  var running = false, started = Set<Int>()
  /** Where what's scheduled ends, in the player's samples: a piece starts there, or now if it ran dry. */
  var queueEnd: AVAudioFramePosition = 0
  var file: AVAudioFile?
  var idle: Timer?
  var synths: [AVSpeechSynthesizer] = []
  var level: Float = 0, lastLevel = Date.distantPast
  /** Where its output went away (the player's samples then), as it settles before it's played again. */
  var lostAt: AVAudioFramePosition?, settling: DispatchWorkItem?
  var device: AudioObjectID = 0, configWatch: NSObjectProtocol?

  override init() {
    super.init()
    if let out = ProcessInfo.processInfo.environment["VOICE_OUT"], !out.isEmpty {
      let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: RATE, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false]
      file = try? AVAudioFile(forWriting: URL(fileURLWithPath: out), settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    } else {
      build()
      watchOutput()
    }
  }

  /** Its engine, new: one started before the output changed under it plays into nothing. */
  func build() {
    if let w = configWatch { NotificationCenter.default.removeObserver(w) }
    engine = AVAudioEngine()
    node = AVAudioPlayerNode()
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    engine.mainMixerNode.installTap(onBus: 0, bufferSize: 1024, format: nil) { [weak self] buf, _ in self?.metered(buf) }
    configWatch = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in self?.outputChanged("its engine's output changed") }
  }

  /** The output device (the default one), its rate and its streams: Bluetooth headphones switch profile after the
   *  microphone closes (a call's, then music's), and what was playing went to the old one, unheard. */
  func watchOutput() {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, .main) { [weak self] _, _ in self?.watchDevice(); self?.outputChanged("another output device") }
    watchDevice()
  }
  func watchDevice() {
    var id = AudioObjectID(0), size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr, id != device, id != 0 else { return }
    device = id
    for sel in [kAudioDevicePropertyNominalSampleRate, kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyStreams] {
      var a = AudioObjectPropertyAddress(mSelector: sel, mScope: sel == kAudioDevicePropertyNominalSampleRate ? kAudioObjectPropertyScopeGlobal : kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
      // (one gone as the default: what it says no longer matters)
      AudioObjectAddPropertyListenerBlock(id, &a, .main) { [weak self] _, _ in if self?.device == id { self?.outputChanged("its output device changed") } }
    }
  }

  /** The output changed: where it stopped being heard is kept now; once it settles (changes come in a burst), a new
   *  engine plays on from a little before there. */
  func outputChanged(_ why: String) {
    if lostAt == nil && !pieces.isEmpty { lostAt = position() }
    settling?.cancel()
    let w = DispatchWorkItem { [weak self] in self?.reroute(why) }
    settling = w
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: w)
  }

  /** Where it is in the player's samples: rendered so far (a file: written). */
  func position() -> AVAudioFramePosition {
    if file != nil || !running { return queueEnd }
    return node.lastRenderTime.flatMap { node.playerTime(forNodeTime: $0) }?.sampleTime ?? queueEnd
  }

  func reroute(_ why: String) {
    settling = nil
    let at = lostAt ?? position()
    lostAt = nil
    gen += 1
    idle?.invalidate(); idle = nil
    if file == nil {
      if running { node.stop(); engine.stop() }
      running = false
      build()
    }
    queueEnd = file == nil ? 0 : queueEnd
    guard let p = pieces.first(where: { !$0.starts.isEmpty }) else { return }
    // (said again from a gap between words a little before it went: the next pieces start over as they are)
    let from = quiet(p, before: at)
    emit(["type": "rerouted", "why": why, "again": (Double(max(0, at - from)) / RATE * 100).rounded() / 100])
    resume(from: from)
  }

  /** Its pieces scheduled again from `from` (in the samples they were scheduled at): what's before it is played, the
   *  piece it falls in goes on from there, the rest start over; `trim`, a piece that ends at a point instead (fading
   *  out, then a breath), what it had or still gets after it dropped. */
  func resume(from: AVAudioFramePosition, trim: (Piece, AVAudioFramePosition)? = nil) {
    if let (y, end) = trim { cut(y, at: end) }
    for q in pieces {
      var k = 0
      while k < q.starts.count, q.starts[k] + AVAudioFramePosition(q.buffers[k].frameLength) <= from { k += 1 }
      if k < q.starts.count, q.starts[k] < from, let tail = slice(q.buffers[k], from: AVAudioFrameCount(from - q.starts[k])) { q.buffers[k] = tail }
      q.starts.removeSubrange(min(k, q.starts.count)...)
      q.scheduled = k
      q.played = k
    }
    pump()
  }

  /** `y`'s audio up to `end` alone, its last moment faded, a breath after it; it takes no more. */
  func cut(_ y: Piece, at end: AVAudioFramePosition) {
    let at = y.positions(from: queueEnd)
    var kept: [AVAudioPCMBuffer] = [], starts: [AVAudioFramePosition] = []
    for (i, b) in y.buffers.enumerated() where at[i] < end {
      let keep = min(AVAudioFramePosition(b.frameLength), end - at[i])
      guard let part = keep < AVAudioFramePosition(b.frameLength) ? head(b, AVAudioFrameCount(keep)) : b else { continue }
      kept.append(part)
      if i < y.starts.count { starts.append(y.starts[i]) }
    }
    if let last = kept.last, let d = last.floatChannelData?[0] {
      let n = min(Int(last.frameLength), Int(FADE * RATE))
      for i in 0..<n { d[Int(last.frameLength) - n + i] *= Float(n - i) / Float(n) }
    }
    if !kept.isEmpty, let gap = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(BREATH * RATE)) {
      gap.frameLength = gap.frameCapacity
      memset(gap.floatChannelData![0], 0, Int(gap.frameLength) * MemoryLayout<Float>.size)
      kept.append(gap)
    }
    y.buffers = kept
    y.starts = starts
    y.ended = true
    y.yields = nil
    gone.insert(y.n)
  }

  /** The piece giving way, now that what follows has audio: it ends with its words when they end soon (the silence
   *  after them left out), else at its next pause. */
  func give(_ y: Piece) {
    let grace = y.yields ?? 0
    y.yields = nil
    let pos = y.positions(from: queueEnd)
    guard let lastAt = pos.last, let last = y.buffers.last else { y.ended = true; gone.insert(y.n); return pump() }
    let end = lastAt + AVAudioFramePosition(last.frameLength)
    // (a file has written all it got: it only takes no more)
    if file != nil || !running { cut(y, at: file != nil ? end : (y.starts.first ?? 0)); return pump() }
    let now = position(), words = spokenEnd(y, positions: pos) ?? now
    let at = words - now <= AVAudioFramePosition(grace * RATE) ? max(now, words + AVAudioFramePosition(FADE * RATE))
      : quietest(y, from: min(end, now + AVAudioFramePosition(GIVE_MIN * RATE)), to: min(end, now + AVAudioFramePosition(GIVE_MAX * RATE)), positions: pos)
    if at >= end && y.ended { gone.insert(y.n); return pump() }
    gen += 1
    node.stop()
    queueEnd = 0
    resume(from: now, trim: (y, at))
  }

  /** Where `p`'s last sound ends (its samples), past it only silence; nil if it's all silence. */
  func spokenEnd(_ p: Piece, positions at: [AVAudioFramePosition]) -> AVAudioFramePosition? {
    for (i, b) in p.buffers.enumerated().reversed() {
      guard let d = b.floatChannelData?[0] else { continue }
      var f = Int(b.frameLength) - 1
      while f >= 0, abs(d[f]) < 0.01 { f -= 1 }
      if f >= 0 { return at[i] + AVAudioFramePosition(f + 1) }
    }
    return nil
  }

  /** The quietest 10 ms of `p`'s audio between two points (its samples), the first one found from `from` on. */
  func quietest(_ p: Piece, from: AVAudioFramePosition, to: AVAudioFramePosition, positions at: [AVAudioFramePosition]) -> AVAudioFramePosition {
    let win = AVAudioFramePosition(RATE / 100)
    var best = from, low = Float.infinity, t = from
    while t <= to {
      var sum: Float = 0, count = 0
      for (i, b) in p.buffers.enumerated() {
        let s = at[i], e = s + AVAudioFramePosition(b.frameLength)
        guard e > t, s < t + win, let d = b.floatChannelData?[0] else { continue }
        for f in max(t, s)..<min(t + win, e) { let v = d[Int(f - s)]; sum += v * v; count += 1 }
      }
      if count > 0, sum / Float(count) < low { low = sum / Float(count); best = t }
      t += win
    }
    return best
  }

  /** The quietest moment of `p`'s audio between REWIND_MAX and REWIND_MIN before `at` (10 ms windows). */
  func quiet(_ p: Piece, before at: AVAudioFramePosition) -> AVAudioFramePosition {
    let lo = max(p.starts[0], at - AVAudioFramePosition(REWIND_MAX * RATE)), hi = max(lo, at - AVAudioFramePosition(REWIND_MIN * RATE)), win = AVAudioFramePosition(RATE / 100)
    var best = hi, low = Float.infinity
    var t = hi
    while t >= lo {
      var sum: Float = 0, count = 0
      for (i, b) in p.buffers.prefix(p.starts.count).enumerated() {
        let s = p.starts[i], e = s + AVAudioFramePosition(b.frameLength)
        guard e > t, s < t + win, let d = b.floatChannelData?[0] else { continue }
        for f in max(t, s)..<min(t + win, e) { let v = d[Int(f - s)]; sum += v * v; count += 1 }
      }
      if count > 0, sum / Float(count) < low { low = sum / Float(count); best = t }
      t -= win
    }
    return best
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
    if gone.contains(n) { return }
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
    if gone.contains(n) { return }
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

  func end(_ n: Int) { if gone.contains(n) { return }; piece(n).ended = true; pump() }

  /** All at once: nothing more plays, nothing queued stays. */
  func stop() {
    gen += 1
    lostAt = nil
    for s in synths { s.stopSpeaking(at: .immediate) }
    synths.removeAll()
    pieces.removeAll()
    started.removeAll()
    gone.removeAll()
    if running { node.stop() }
    queueEnd = file == nil ? 0 : queueEnd
    level = 0
    emit(["type": "stopped"])
    emit(["type": "level", "v": 0])
  }

  /** What's come is scheduled in order: a piece's buffers once every piece before it has all of its own. */
  func pump() {
    if let y = pieces.first(where: { $0.yields != nil }), pieces.contains(where: { $0.n > y.n && !$0.buffers.isEmpty }) { return give(y) }
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
      p.starts.append(queueEnd)
      queueEnd += AVAudioFramePosition(b.frameLength)
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
    p.starts.append(begin)
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
      gone.insert(p.n)
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

/** `b`'s first `n` frames, a buffer of its own. */
func head(_ b: AVAudioPCMBuffer, _ n: AVAudioFrameCount) -> AVAudioPCMBuffer? {
  guard n > 0, let out = AVAudioPCMBuffer(pcmFormat: b.format, frameCapacity: n), let src = b.floatChannelData?[0], let dst = out.floatChannelData?[0] else { return nil }
  out.frameLength = min(n, b.frameLength)
  for i in 0..<Int(out.frameLength) { dst[i] = src[i] }
  return out
}

/** `b` from frame `from` on, a buffer of its own. */
func slice(_ b: AVAudioPCMBuffer, from: AVAudioFrameCount) -> AVAudioPCMBuffer? {
  guard from < b.frameLength, let out = AVAudioPCMBuffer(pcmFormat: b.format, frameCapacity: b.frameLength - from), let src = b.floatChannelData?[0], let dst = out.floatChannelData?[0] else { return nil }
  out.frameLength = b.frameLength - from
  for i in 0..<Int(out.frameLength) { dst[i] = src[Int(from) + i] }
  return out
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
      case "yield": if !voice.gone.contains(n) { voice.piece(n).yields = m["grace"] as? Double ?? 0.4; voice.pump() }
      case "stop": voice.stop()
      // (as its output device changing does: tests)
      case "reroute": voice.outputChanged("asked")
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
