// The capture helper (electron/recorder.ts): one display's video in memory as one-second fMP4 segments, a ring or held
// from a recording's start, saved as a clip cropped to the user's box only when asked. JSON lines in and out.
import AVFoundation
import AppKit
import CoreImage
import ScreenCaptureKit

func send(_ obj: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}
let epochOffset: Double = { Date().timeIntervalSince1970 - CMClockGetTime(CMClockGetHostTimeClock()).seconds }()
/** A host-clock time as ms since 1970: what the app's Date.now() says. */
func epochMs(_ t: CMTime) -> Double { (t.seconds + epochOffset) * 1000 }

struct Segment { let data: Data; let start: Double; let end: Double }

@available(macOS 14.0, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate, AVAssetWriterDelegate {
  let q = DispatchQueue(label: "capture")
  var stream: SCStream?
  var writer: AVAssetWriter?
  var input: AVAssetWriterInput?
  var initSegment: Data?
  var segments: [Segment] = []
  /** How long a ring keeps (ms); a hold keeps everything from `holdFrom` on (a recording). */
  var ringMs = 25_000.0
  var holdFrom: Double?
  var display: CGRect = .zero
  var displayID: CGDirectDisplayID = 0
  var scale = 2.0
  var started = false
  var lastPts = CMTime.invalid
  var lastFrameAt = 0.0
  var lastBuffer: CMSampleBuffer?
  var bytes: Int { segments.reduce(0) { $0 + $1.data.count } }

  func start(at p: CGPoint, exclude: [Int], bundles: [String], ring: Double, done: @escaping ([String: Any]) -> Void) {
    ringMs = ring
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
      guard let content else { return done(["ok": false, "why": err?.localizedDescription ?? "no screen recording"]) }
      guard let d = content.displays.first(where: { CGDisplayBounds($0.displayID).contains(p) }) ?? content.displays.first else { return done(["ok": false, "why": "no-display"]) }
      self.q.async {
        if self.stream != nil && self.displayID == d.displayID { self.refilter(content, exclude, bundles); return done(self.status()) }
        self.teardown()
        self.displayID = d.displayID
        self.display = CGDisplayBounds(d.displayID)
        let mode = CGDisplayCopyDisplayMode(d.displayID)
        self.scale = mode.map { Double($0.pixelWidth) / Double($0.width) } ?? 2
        let conf = SCStreamConfiguration()
        // (even sizes: H.264 wants them)
        conf.width = Int(self.display.width * self.scale) & ~1
        conf.height = Int(self.display.height * self.scale) & ~1
        conf.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        conf.queueDepth = 6
        conf.showsCursor = true
        conf.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        let s = SCStream(filter: self.filter(content, d, exclude, bundles), configuration: conf, delegate: self)
        do { try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.q) } catch { return done(["ok": false, "why": error.localizedDescription]) }
        self.stream = s
        s.startCapture { err in
          if let err { self.q.async { self.teardown() }; return done(["ok": false, "why": err.localizedDescription]) }
          self.q.async { done(self.status()) }
        }
      }
    }
  }
  func filter(_ c: SCShareableContent, _ d: SCDisplay, _ exclude: [Int], _ bundles: [String]) -> SCContentFilter {
    // (the overlay's windows never, nor private apps': asked again as the app in front changes)
    SCContentFilter(display: d, excludingWindows: c.windows.filter { exclude.contains(Int($0.windowID)) || bundles.contains($0.owningApplication?.bundleIdentifier ?? "") })
  }
  func refilter(_ c: SCShareableContent, _ exclude: [Int], _ bundles: [String]) {
    guard let s = stream, let d = c.displays.first(where: { $0.displayID == displayID }) else { return }
    s.updateContentFilter(filter(c, d, exclude, bundles))
  }
  func status() -> [String: Any] {
    ["ok": true, "on": stream != nil, "display": ["x": display.minX, "y": display.minY, "width": display.width, "height": display.height], "scale": scale,
     "kept": segments.count, "bytes": bytes, "from": segments.first?.start ?? 0, "holding": holdFrom != nil]
  }

  func stream(_ s: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sb.isValid, let att = (CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
          let raw = att[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete, CMSampleBufferGetImageBuffer(sb) != nil else { return }
    feed(sb)
  }
  func feed(_ sb: CMSampleBuffer) {
    let pts = CMSampleBufferGetPresentationTimeStamp(sb)
    if !started {
      let w = AVAssetWriter(contentType: UTType(AVFileType.mp4.rawValue)!)
      w.outputFileTypeProfile = .mpeg4AppleHLS
      w.preferredOutputSegmentInterval = CMTime(seconds: 1, preferredTimescale: 600)
      w.initialSegmentStartTime = pts
      w.delegate = self
      let px = Double(CVPixelBufferGetWidth(CMSampleBufferGetImageBuffer(sb)!) * CVPixelBufferGetHeight(CMSampleBufferGetImageBuffer(sb)!))
      let settings: [String: Any] = [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: CVPixelBufferGetWidth(CMSampleBufferGetImageBuffer(sb)!), AVVideoHeightKey: CVPixelBufferGetHeight(CMSampleBufferGetImageBuffer(sb)!),
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: Int(px * 1.2), AVVideoMaxKeyFrameIntervalDurationKey: 1, AVVideoAllowFrameReorderingKey: false, AVVideoExpectedSourceFrameRateKey: 30]]
      let i = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
      i.expectsMediaDataInRealTime = true
      guard w.canAdd(i) else { return }
      w.add(i)
      guard w.startWriting() else { return }
      w.startSession(atSourceTime: pts)
      writer = w; input = i; started = true
    }
    // (a still screen sends few frames: the last one is sent again each half second, so a segment always ends)
    lastBuffer = sb
    lastFrameAt = Date().timeIntervalSince1970
    append(sb, at: pts)
  }
  func append(_ sb: CMSampleBuffer, at pts: CMTime) {
    guard let i = input, i.isReadyForMoreMediaData, lastPts == .invalid || pts > lastPts else { return }
    if pts == CMSampleBufferGetPresentationTimeStamp(sb) { if i.append(sb) { lastPts = pts }; return }
    var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: pts, decodeTimeStamp: .invalid)
    var copy: CMSampleBuffer?
    if CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy) == noErr, let copy, i.append(copy) { lastPts = pts }
  }
  /** Each half second with no new frame, the last one again: a still screen's segments still close on time. */
  func tick() {
    q.async {
      guard self.started, let sb = self.lastBuffer, Date().timeIntervalSince1970 - self.lastFrameAt >= 0.5 else { return }
      self.lastFrameAt = Date().timeIntervalSince1970
      self.append(sb, at: CMClockGetTime(CMClockGetHostTimeClock()))
    }
  }

  func assetWriter(_ w: AVAssetWriter, didOutputSegmentData data: Data, segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
    q.async {
      if segmentType == .initialization { self.initSegment = data; return }
      guard let r = segmentReport?.trackReports.first else { return }
      let start = epochMs(r.earliestPresentationTimeStamp), end = epochMs(r.earliestPresentationTimeStamp + r.duration)
      self.segments.append(Segment(data: data, start: start, end: end))
      self.prune()
    }
  }
  func prune() {
    let newest = segments.last?.end ?? 0
    // (held: from the recording's start on, else the ring's length; never more than 3 minutes either way)
    let from = holdFrom.map { $0 - 1500 } ?? newest - ringMs
    segments.removeAll { $0.end < max(from, newest - 180_000) }
  }

  func stream(_ s: SCStream, didStopWithError error: Error) {
    q.async { if self.stream === s { self.teardown() }; send(["event": "stopped", "why": error.localizedDescription]) }
  }
  func teardown() {
    stream?.stopCapture { _ in }
    stream = nil
    input?.markAsFinished()
    writer?.cancelWriting()
    writer = nil; input = nil; initSegment = nil; segments = []; started = false; lastPts = .invalid; lastBuffer = nil
  }

  /** What was kept between `from` and `to` (ms since 1970), cropped to the box as it was then (`boxes`: when it changed,
   *  screen points), as an MP4 at `file`, with a frame at each change beside it. */
  func save(from: Double, to: Double, boxes: [(t: Double, r: CGRect)], file: String, frames: String, done: @escaping ([String: Any]) -> Void) {
    // (what's being written now closes first: the last second is in it)
    q.asyncAfter(deadline: .now() + 1.1) {
      guard let head = self.initSegment else { return done(["ok": false, "why": "nothing kept"]) }
      let picked = self.segments.filter { $0.end > from && $0.start < to }
      guard let first = picked.first, let last = picked.last else { return done(["ok": false, "why": "nothing kept then"]) }
      let raw = URL(fileURLWithPath: file + ".raw.mp4")
      var all = head
      for s in picked { all.append(s.data) }
      do { try all.write(to: raw) } catch { return done(["ok": false, "why": "write"]) }
      let display = self.display, scale = self.scale
      Task {
        let r = await export(raw: raw, out: URL(fileURLWithPath: file), clipFrom: max(from, first.start) , clipTo: min(to, last.end), keptFrom: first.start, boxes: boxes, display: display, scale: scale, frames: frames)
        try? FileManager.default.removeItem(at: raw)
        done(r)
      }
    }
  }
}

/** The box at time `t` (ms since 1970): the last one set by then. */
func boxAt(_ boxes: [(t: Double, r: CGRect)], _ t: Double) -> CGRect { (boxes.last { $0.t <= t } ?? boxes.first!).r }

@available(macOS 14.0, *)
func export(raw: URL, out: URL, clipFrom: Double, clipTo: Double, keptFrom: Double, boxes: [(t: Double, r: CGRect)], display: CGRect, scale: Double, frames: String) async -> [String: Any] {
  let asset = AVURLAsset(url: raw)
  guard let track = try? await asset.loadTracks(withMediaType: .video).first, let range = try? await track.load(.timeRange) else { return ["ok": false, "why": "unreadable"] }
  let size = (try? await track.load(.naturalSize)) ?? CGSize(width: display.width * scale, height: display.height * scale)
  // (the kept segments start at the track's start: the clip is its part from `clipFrom`)
  let startIn = range.start + CMTime(seconds: max(0, (clipFrom - keptFrom) / 1000), preferredTimescale: 600)
  let length = CMTime(seconds: max(0.2, (clipTo - clipFrom) / 1000), preferredTimescale: 600)
  let comp = AVMutableComposition()
  guard let ct = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
        (try? ct.insertTimeRange(CMTimeRange(start: startIn, duration: CMTimeMinimum(length, range.end - startIn)), of: track, at: .zero)) != nil else { return ["ok": false, "why": "compose"] }
  // (in pixels of the video, the box at its first: later boxes are scaled into it)
  let k = size.width / display.width
  func px(_ r: CGRect) -> CGRect {
    let c = r.intersection(display).offsetBy(dx: -display.minX, dy: -display.minY)
    // (CoreImage's origin is bottom left)
    return CGRect(x: c.minX * k, y: size.height - c.maxY * k, width: c.width * k, height: c.height * k).integral
  }
  let first = px(boxAt(boxes, clipFrom))
  guard first.width >= 8, first.height >= 8 else { return ["ok": false, "why": "the box is off the display"] }
  let render = CGSize(width: Double(Int(first.width) & ~1), height: Double(Int(first.height) & ~1))
  let vc = try? await AVMutableVideoComposition.videoComposition(with: comp) { req in
    let t = clipFrom + req.compositionTime.seconds * 1000, b = px(boxAt(boxes, t))
    let s = min(render.width / max(1, b.width), render.height / max(1, b.height))
    let img = req.sourceImage.cropped(to: b).transformed(by: CGAffineTransform(translationX: -b.minX, y: -b.minY).concatenating(CGAffineTransform(scaleX: s, y: s)))
    req.finish(with: img.composited(over: CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: render))), context: nil)
  }
  guard let vc else { return ["ok": false, "why": "compose"] }
  vc.renderSize = render
  vc.frameDuration = CMTime(value: 1, timescale: 30)
  try? FileManager.default.removeItem(at: out)
  guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality) else { return ["ok": false, "why": "export"] }
  ex.videoComposition = vc
  do { try await ex.export(to: out, as: .mp4) } catch { return ["ok": false, "why": "export: \(error.localizedDescription)"] }
  let shots = await keyFrames(URL(fileURLWithPath: out.path), dir: frames)
  return ["ok": true, "file": out.path, "ms": Int(length.seconds * 1000), "width": Int(render.width), "height": Int(render.height), "frames": shots]
}

/** Frames where the picture changes (read small, every quarter second), the first and last always; at most 12, the
 *  biggest changes kept. Named by their time in the clip. */
@available(macOS 14.0, *)
func keyFrames(_ url: URL, dir: String) async -> [[String: Any]] {
  let a = AVURLAsset(url: url)
  guard let d = try? await a.load(.duration), d.seconds > 0 else { return [] }
  // (looked at small, every quarter second; only the frames kept are made whole)
  let g = AVAssetImageGenerator(asset: a), whole = AVAssetImageGenerator(asset: a)
  for x in [g, whole] { x.requestedTimeToleranceBefore = .zero; x.requestedTimeToleranceAfter = .zero; x.appliesPreferredTrackTransform = true }
  g.maximumSize = CGSize(width: 160, height: 160)
  var times: [Double] = stride(from: 0.0, to: d.seconds, by: 0.25).map { $0 }
  times.append(max(0, d.seconds - 0.05))
  var last: [UInt8]? = nil
  var picked: [(t: Double, change: Double)] = []
  for t in times {
    guard let img = try? await g.image(at: CMTime(seconds: t, preferredTimescale: 600)).image else { continue }
    let small = tiny(img)
    let change = last.map { differ($0, small) } ?? 1
    if change > 0.012 || t == times.first || t == times.last { picked.append((t, change)); last = small }
  }
  if picked.count > 12 {
    let ends = [picked.first!, picked.last!]
    let mid = picked.dropFirst().dropLast().sorted { $0.change > $1.change }.prefix(10)
    picked = (ends + mid).sorted { $0.t < $1.t }
  }
  try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
  var out: [[String: Any]] = []
  for f in picked {
    let file = (dir as NSString).appendingPathComponent(String(format: "%.1fs.png", f.t))
    guard let img = try? await whole.image(at: CMTime(seconds: f.t, preferredTimescale: 600)).image, let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: file) as CFURL, "public.png" as CFString, 1, nil) else { continue }
    CGImageDestinationAddImage(dest, img, nil)
    if CGImageDestinationFinalize(dest) { out.append(["t": Int(f.t * 1000), "file": file]) }
  }
  return out
}
/** How much two small pictures differ, 0 to 1. */
func differ(_ a: [UInt8], _ b: [UInt8]) -> Double {
  var sum = 0
  for i in 0..<min(a.count, b.count) { sum += abs(Int(a[i]) - Int(b[i])) }
  return Double(sum) / Double(max(1, a.count)) / 255
}
/** A picture as 32×20 grey levels. */
func tiny(_ img: CGImage) -> [UInt8] {
  let w = 32, h = 20
  var px = [UInt8](repeating: 0, count: w * h)
  px.withUnsafeMutableBytes { buf in
    guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return }
    ctx.interpolationQuality = .medium
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  }
  return px
}

func rect(_ v: Any?) -> CGRect? {
  guard let o = v as? [String: Any], let x = o["x"] as? Double, let y = o["y"] as? Double, let w = o["width"] as? Double, let h = o["height"] as? Double else { return nil }
  return CGRect(x: x, y: y, width: w, height: h)
}

guard #available(macOS 14.0, *) else { send(["event": "unavailable", "why": "macos"]); exit(0) }
let rec = Recorder()
Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in rec.tick() }
Thread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
    let id = req["id"] ?? NSNull()
    let reply = { (r: [String: Any]) in var m = r; m["id"] = id; send(m) }
    switch req["op"] as? String {
    case "start":
      rec.start(at: CGPoint(x: req["x"] as? Double ?? 0, y: req["y"] as? Double ?? 0), exclude: req["exclude"] as? [Int] ?? [], bundles: req["bundles"] as? [String] ?? [], ring: req["ring"] as? Double ?? 25_000, done: reply)
    case "hold":
      // (a recording: from `from` on, nothing is let go; null lets go again)
      rec.q.async { rec.holdFrom = req["from"] as? Double; rec.prune(); reply(rec.status()) }
    case "status": rec.q.async { reply(rec.status()) }
    case "save":
      let boxes = (req["boxes"] as? [[String: Any]] ?? []).compactMap { b -> (t: Double, r: CGRect)? in guard let t = b["t"] as? Double, let r = rect(b["rect"]) else { return nil }; return (t, r) }
      guard !boxes.isEmpty else { reply(["ok": false, "why": "no box"]); continue }
      rec.save(from: req["from"] as? Double ?? 0, to: req["to"] as? Double ?? Date().timeIntervalSince1970 * 1000, boxes: boxes, file: req["file"] as? String ?? "", frames: req["frames"] as? String ?? "", done: reply)
    case "stop": rec.q.async { rec.teardown(); reply(["ok": true]) }
    default: reply(["ok": false, "why": "unknown op"])
    }
  }
  exit(0)
}.start()
RunLoop.main.run()
