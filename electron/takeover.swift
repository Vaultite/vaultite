// Take-over (electron/takeover.ts): elements pressed or set through Accessibility, clicks, typing and keys, and a
// guard telling when the user stops it (a click, Esc) or has their hands on the mouse or keys. JSON lines in and out.
import AppKit
import ApplicationServices

@_silgen_name("_AXUIElementGetWindow") func axWindowID(_ el: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError
func wid(_ w: AXUIElement) -> Int? { var id: CGWindowID = 0; return axWindowID(w, &id) == .success && id != 0 ? Int(id) : nil }

/** Vaultite's main process (our parent): its windows are never acted in here. */
let vaultitePid = getppid()
_ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1)
/** Marks the events we post, so the guard (and nothing else) tells them from the user's. */
let MARK: Int64 = 0x5641554C54

let out = NSLock()
func send(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
  out.lock(); FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!); out.unlock()
}
func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
  return v as? T
}
func frame(_ el: AXUIElement) -> CGRect? {
  var p = CGPoint.zero, s = CGSize.zero
  guard let pv: AXValue = attr(el, kAXPositionAttribute), let sv: AXValue = attr(el, kAXSizeAttribute) else { return nil }
  AXValueGetValue(pv, .cgPoint, &p); AXValueGetValue(sv, .cgSize, &s)
  return CGRect(origin: p, size: s)
}
func rectJSON(_ r: CGRect?) -> Any { guard let r else { return NSNull() }; return ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height] }
func pidOf(_ el: AXUIElement) -> pid_t { var p: pid_t = 0; AXUIElementGetPid(el, &p); return p }
func appInfo(_ pid: pid_t) -> [String: Any] {
  let a = NSRunningApplication(processIdentifier: pid)
  return ["bundle": a?.bundleIdentifier ?? "", "name": a?.localizedName ?? "", "pid": Int(pid), "vaultite": pid == vaultitePid]
}
func actions(_ el: AXUIElement) -> [String] { var a: CFArray?; return AXUIElementCopyActionNames(el, &a) == .success ? (a as? [String] ?? []) : [] }
func settable(_ el: AXUIElement, _ name: String) -> Bool { var b: DarwinBoolean = false; return AXUIElementIsAttributeSettable(el, name as CFString, &b) == .success && b.boolValue }
func secure(_ el: AXUIElement) -> Bool { (attr(el, kAXSubroleAttribute) as String?) == "AXSecureTextField" }
/** Its words as screen.swift's near() names it (so an element listed there is found again by them). */
func label(_ el: AXUIElement) -> String {
  for k in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute] {
    if let v: String = attr(el, k), !v.trimmingCharacters(in: .whitespaces).isEmpty { return String(v.prefix(120)) }
  }
  return ""
}
func roleOf(_ el: AXUIElement) -> String { attr(el, kAXRoleDescriptionAttribute) as String? ?? attr(el, kAXRoleAttribute) as String? ?? "" }
/** Chromium and Electron build their tree only when asked, as screen.swift wakes them. */
var woken = Set<pid_t>()
func wake(_ pid: pid_t) {
  if woken.contains(pid) { return }
  woken.insert(pid)
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString, kCFBooleanTrue)
}

// ---------- finding an element again: the window under its frame, walked for the one with that frame and words

func windowUnder(_ p: CGPoint) -> (pid: pid_t, id: Int)? {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
  for w in list where (w[kCGWindowLayer as String] as? Int) == 0 && (w[kCGWindowAlpha as String] as? Double ?? 1) > 0 {
    guard let b = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b), r.contains(p) else { continue }
    return (pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0), w[kCGWindowNumber as String] as? Int ?? 0)
  }
  return nil
}
func axWindow(_ pid: pid_t, _ id: Int) -> AXUIElement? {
  wake(pid)
  let ws: [AXUIElement] = attr(AXUIElementCreateApplication(pid), kAXWindowsAttribute) ?? []
  return ws.first { wid($0) == id }
}
func close(_ a: CGRect, _ b: CGRect) -> Bool { abs(a.minX - b.minX) <= 4 && abs(a.minY - b.minY) <= 4 && abs(a.width - b.width) <= 4 && abs(a.height - b.height) <= 4 }
/** The element at `want` (a near() list's frame) with its words, else the one there with that frame, else what's hit at
 *  its middle. Bounded in elements and time, as near() is. */
func find(_ want: CGRect, _ words: String, _ role: String) -> AXUIElement? {
  let mid = CGPoint(x: want.midX, y: want.midY)
  if let (pid, id) = windowUnder(mid), pid != vaultitePid, let w = axWindow(pid, id) {
    var byFrame: AXUIElement?, seen = 0
    let deadline = Date().addingTimeInterval(0.8)
    var stack: [(AXUIElement, Int)] = [(w, 0)]
    while let (el, depth) = stack.popLast() {
      seen += 1
      if seen > 6000 || Date() > deadline { break }
      let f = frame(el)
      if let f, f.width > 0, f.height > 0, !f.insetBy(dx: -4, dy: -4).intersects(want) { continue }
      if let f, close(f, want) {
        if !words.isEmpty && label(el) == words && (role.isEmpty || roleOf(el) == role) { return el }
        if byFrame == nil && (words.isEmpty || label(el) == words) { byFrame = el }
      }
      if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
    }
    if let byFrame { return byFrame }
  }
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(mid.x), Float(mid.y), &hit) == .success, let el = hit, pidOf(el) != vaultitePid else { return nil }
  return el
}
/** The element itself or the nearest of its parents (3 up) that does `action`: a button's text is pressed as its button. */
func doer(_ el: AXUIElement, _ action: String) -> AXUIElement? {
  var e: AXUIElement? = el
  for _ in 0..<4 {
    guard let x = e else { return nil }
    if actions(x).contains(action) { return x }
    e = attr(x, kAXParentAttribute)
  }
  return nil
}
func target(_ req: [String: Any]) -> AXUIElement? {
  if req["focused"] as? Bool == true {
    if let el: AXUIElement = attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) { return el }
    // (the system-wide one isn't always told: the app in front's own)
    guard let a = NSWorkspace.shared.frontmostApplication else { return nil }
    return attr(AXUIElementCreateApplication(a.processIdentifier), kAXFocusedUIElementAttribute)
  }
  guard let f = req["frame"] as? [String: Double], let x = f["x"], let y = f["y"], let w = f["width"], let h = f["height"] else { return nil }
  return find(CGRect(x: x, y: y, width: w, height: h), req["label"] as? String ?? "", req["role"] as? String ?? "")
}
func describe(_ el: AXUIElement) -> [String: Any] {
  var m = appInfo(pidOf(el))
  m["ok"] = true
  m["role"] = attr(el, kAXRoleAttribute) as String? ?? ""
  m["roleName"] = roleOf(el)
  m["subrole"] = attr(el, kAXSubroleAttribute) as String? ?? ""
  m["secure"] = secure(el)
  m["label"] = secure(el) ? "" : label(el)
  m["frame"] = rectJSON(frame(el))
  m["actions"] = actions(el)
  m["valueSettable"] = settable(el, kAXValueAttribute)
  if let v: NSNumber = attr(el, kAXValueAttribute), ["AXCheckBox", "AXRadioButton", "AXSwitch"].contains(m["role"] as? String ?? "") { m["checked"] = v.intValue != 0 }
  if let w: AXUIElement = attr(el, kAXWindowAttribute) { m["window"] = wid(w) ?? 0; m["title"] = attr(w, kAXTitleAttribute) as String? ?? "" }
  // (in a web page: its fields don't hear a value set from outside, so words are typed there)
  var up: AXUIElement? = el, web = false
  for _ in 0..<40 {
    guard let u = up else { break }
    if (attr(u, kAXRoleAttribute) as String?) == "AXWebArea" { web = true; if let url: URL = attr(u, kAXURLAttribute) { m["url"] = url.absoluteString }; break }
    up = attr(u, kAXParentAttribute)
  }
  m["web"] = web
  // (the page or document its window shows: a private site is never acted on)
  if m["url"] == nil, let w: AXUIElement = attr(el, kAXWindowAttribute), let doc: String = attr(w, kAXDocumentAttribute) { m["url"] = doc }
  return m
}

// ---------- the user, while it drives: a click or Esc stops it, so does typing where it types; their mouse or other
// keys only mark their hands busy (`busy`, then `rested` once still), and a step needing the pointer or keys waits

var guarding = false, stopped: String? = nil
/** Their hands on the mouse or keys, since when; small moves add up (`moved`) before they count. */
var busy = false, lastActive = 0.0, moved = 0.0, lastNudge = 0.0, modsHeld = false, resting = false
/** How long still they must be before a step goes on (ms), and whether the step now types (their typing then stops it). */
var restMs = 1000.0, keysStep = false
/** Until when a mouse move isn't theirs taking over (their hand coming off Do it). */
var graceUntil = 0.0
/** Their pointer as they left it (given back when it's done), and whether they've moved it since it last moved it. */
var home: CGPoint? = nil, theirsSince = false
var guardTap: CFMachPort?
let guardLock = NSLock()
let restQueue = DispatchQueue(label: "takeover.rest")
func userStop(_ why: String) {
  guardLock.lock()
  let first = guarding && stopped == nil
  if first { stopped = why }
  guardLock.unlock()
  if first { send(["event": "user", "why": why]) }
}
func active(_ why: String, mouse: Bool) {
  guardLock.lock()
  guard guarding, stopped == nil else { guardLock.unlock(); return }
  lastActive = CFAbsoluteTimeGetCurrent()
  if mouse { theirsSince = true }
  let first = !busy, schedule = !resting
  busy = true; resting = true
  guardLock.unlock()
  if first { send(["event": "busy", "why": why]) }
  if schedule { restCheck(after: restMs) }
}
func restCheck(after ms: Double) {
  restQueue.asyncAfter(deadline: .now() + ms / 1000) {
    guardLock.lock()
    let quiet = (CFAbsoluteTimeGetCurrent() - lastActive) * 1000
    let rested = guarding && busy && !modsHeld && quiet >= restMs
    var again: Double? = nil
    if rested { busy = false; moved = 0; resting = false }
    else if guarding && busy { again = modsHeld ? 200 : max(50, restMs - quiet) }
    else { resting = false }
    guardLock.unlock()
    if rested { send(["event": "rested"]) }
    if let again { restCheck(after: again) }
  }
}
func guardStarted() -> Bool {
  if guardTap != nil { return true }
  let types: [CGEventType] = [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel, .keyDown, .flagsChanged]
  let mask = types.reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
  let ready = DispatchSemaphore(value: 0)
  Thread {
    let cb: CGEventTapCallBack = { _, type, e, _ in
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if guarding, let t = guardTap { CGEvent.tapEnable(tap: t, enable: true) }; return Unmanaged.passUnretained(e) }
      if !guarding || e.getIntegerValueField(.eventSourceUserData) == MARK { return Unmanaged.passUnretained(e) }
      switch type {
      case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
        let now = CFAbsoluteTimeGetCurrent()
        if now < graceUntil { break }
        // (a nudge isn't their hand on it: a few points' drift from a desk's knock still is ours)
        guardLock.lock()
        if (now - lastNudge) * 1000 > restMs { moved = 0 }
        lastNudge = now
        moved += abs(e.getDoubleValueField(.mouseEventDeltaX)) + abs(e.getDoubleValueField(.mouseEventDeltaY))
        let over = moved > 6
        guardLock.unlock()
        if over { active("mouse", mouse: true) }
      case .scrollWheel: active("mouse", mouse: true)
      case .leftMouseDown, .rightMouseDown, .otherMouseDown: userStop("click")
      case .keyDown:
        if e.getIntegerValueField(.keyboardEventKeycode) == 53 { userStop("esc"); break }
        // (typing while it types goes where it types: theirs; a shortcut, or a key while it points, only waits)
        guardLock.lock(); let into = keysStep; guardLock.unlock()
        if into && e.flags.intersection([.maskCommand, .maskControl]).isEmpty { userStop("typing") } else { active("keys", mouse: false) }
      case .flagsChanged:
        guardLock.lock(); modsHeld = !e.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty; guardLock.unlock()
        active("keys", mouse: false)
      default: break
      }
      return Unmanaged.passUnretained(e)
    }
    // (Accessibility lets a filtering tap in, which passes everything on; a listening one needs Input Monitoring)
    guardTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .defaultTap, eventsOfInterest: mask, callback: cb, userInfo: nil)
      ?? CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly, eventsOfInterest: mask, callback: cb, userInfo: nil)
    ready.signal()
    guard let t = guardTap else { return }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(nil, t, 0), .commonModes)
    CGEvent.tapEnable(tap: t, enable: true)
    CFRunLoopRun()
  }.start()
  // (macOS may ask on the main thread before it answers: never waited on forever)
  _ = ready.wait(timeout: .now() + 3)
  return guardTap != nil
}
func halted() -> Bool { guardLock.lock(); defer { guardLock.unlock() }; return stopped != nil }
/** Why a step with the pointer or the keys can't go on now: stopped ("user"), or their hands on it ("busy"). */
func interrupted() -> String? { guardLock.lock(); defer { guardLock.unlock() }; return stopped != nil ? "user" : busy ? "busy" : nil }
func setGuard(_ on: Bool, grace: Double, rest: Double) {
  guardLock.lock()
  guarding = on; stopped = nil; busy = false; moved = 0; lastActive = 0; modsHeld = false; keysStep = false; home = nil; theirsSince = false
  graceUntil = CFAbsoluteTimeGetCurrent() + grace / 1000
  if rest > 0 { restMs = rest }
  guardLock.unlock()
}

// ---------- posting: the pointer (gliding from where it is), clicks, typing, keys, the wheel; each marked ours

let source = CGEventSource(stateID: .privateState)
func post(_ e: CGEvent?) { guard let e else { return }; e.setIntegerValueField(.eventSourceUserData, value: MARK); e.post(tap: .cghidEventTap) }
func pause(_ ms: Double) { Thread.sleep(forTimeInterval: ms / 1000) }
func pointer() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func moveTo(_ p: CGPoint) { post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)) }
/** The pointer glides from where it is to `to` (seen going, never a jump); false when their hands came on it on the way.
 *  Their pointer as they left it is kept to give back (`own`: not when it's the giving back). */
func glide(_ to: CGPoint, own: Bool = true) -> Bool {
  let from = pointer()
  if own { guardLock.lock(); if home == nil || theirsSince { home = from }; theirsSince = false; guardLock.unlock() }
  let dist = hypot(to.x - from.x, to.y - from.y)
  let n = dist < 2 ? 1 : max(2, Int(min(320, 90 + dist * 0.25) / 8))
  for i in 1...n {
    if interrupted() != nil { return false }
    let t = Double(i) / Double(n), k = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    moveTo(CGPoint(x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k))
    if i < n { pause(8) }
  }
  return true
}
/** nil once clicked; else why not (their hands came on it first: nothing pressed). */
func click(_ p: CGPoint, _ count: Int, _ right: Bool) -> String? {
  let (down, up, button): (CGEventType, CGEventType, CGMouseButton) = right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  if !glide(p) { return interrupted() ?? "busy" }
  pause(40)
  if let no = interrupted() { return no }
  for n in 1...max(1, count) {
    for t in [down, up] {
      let e = CGEvent(mouseEventSource: source, mouseType: t, mouseCursorPosition: p, mouseButton: button)
      e?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
      post(e)
      pause(t == down ? 30 : 60)
    }
  }
  return nil
}
let KEYS: [String: CGKeyCode] = ["return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
  "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "left": 123, "right": 124, "down": 125, "up": 126,
  "arrowleft": 123, "arrowright": 124, "arrowdown": 125, "arrowup": 126,
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16,
  "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
  "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50]
let FLAGS: [String: CGEventFlags] = ["cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand, "shift": .maskShift,
  "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate, "ctrl": .maskControl, "control": .maskControl]
/** A key with its modifiers ("Enter", "cmd+s"); false: a name we don't know. */
func key(_ combo: String) -> Bool {
  let parts = combo.lowercased().split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }
  guard let name = parts.last, let code = KEYS[name] else { return false }
  var flags: CGEventFlags = []
  for m in parts.dropLast() { guard let f = FLAGS[m] else { return false }; flags.insert(f) }
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
    e?.flags = flags
    post(e)
    pause(25)
  }
  return true
}
/** Words typed as a person would (a new line is Return, a tab Tab), a few characters an event, till their hands come on
 *  it: how much went (UTF-16 units, so the rest is typed from there), and why it stopped (nil: all of it). */
func type(_ text: String) -> (typed: Int, why: String?) {
  var chunk: [UniChar] = [], sent = 0
  let flush = {
    guard !chunk.isEmpty else { return }
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
      e?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      post(e)
    }
    sent += chunk.count
    chunk = []
    pause(12)
  }
  for ch in text {
    if let no = interrupted() { return (sent, no) }
    if ch == "\n" || ch == "\r\n" || ch == "\t" { flush(); _ = key(ch == "\t" ? "tab" : "return"); sent += ch.utf16.count; continue }
    let u = Array(String(ch).utf16)
    if chunk.count + u.count > 16 { flush() }
    chunk += u
  }
  flush()
  return (sent, interrupted())
}
/** The element at `p` and its frame (what's seen there: told apart before and after a scroll). */
func hitAt(_ p: CGPoint) -> (AXUIElement, CGRect)? {
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(p.x), Float(p.y), &hit) == .success, let el = hit, pidOf(el) != vaultitePid,
        let f = frame(el) else { return nil }
  return (el, f)
}
/** Scrolled through Accessibility: the scroll area at `p` (or one up from what's there) moved by its bar; nil when
 *  there's none to move that way (a web page's), "end" when it's already at its end. */
func scrollAX(_ p: CGPoint, _ dy: Double) -> String? {
  guard var e = hitAt(p)?.0 else { return nil }
  for _ in 0..<14 {
    if (attr(e, kAXRoleAttribute) as String?) == kAXScrollAreaRole, let bar: AXUIElement = attr(e, kAXVerticalScrollBarAttribute),
       settable(bar, kAXValueAttribute), let v: NSNumber = attr(bar, kAXValueAttribute), let area = frame(e) {
      let contents: [AXUIElement] = attr(e, kAXContentsAttribute) ?? [], tall = contents.compactMap { frame($0)?.height }.max() ?? 0
      guard tall > area.height + 1 else { return "end" }
      let to = min(1, max(0, v.doubleValue - dy / (tall - area.height)))
      if abs(to - v.doubleValue) < 0.0005 { return "end" }
      _ = AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, NSNumber(value: to))
      let now: NSNumber? = attr(bar, kAXValueAttribute)
      return now.map { abs($0.doubleValue - v.doubleValue) > 0.0001 } == true ? "ok" : nil
    }
    guard let up: AXUIElement = attr(e, kAXParentAttribute) else { return nil }
    e = up
  }
  return nil
}
/** The wheel at `p` (gliding there first), or where their pointer is (nil: it doesn't move); nil once done, else why not. */
func scroll(_ p: CGPoint?, _ dy: Int32, _ dx: Int32) -> String? {
  if let p, !glide(p) { return interrupted() ?? "busy" }
  pause(30)
  // (in a few steps, so a page that eases its scroll follows)
  for _ in 0..<8 {
    if let no = interrupted() { return no }
    post(CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy / 8, wheel2: dx / 8, wheel3: 0)); pause(16)
  }
  return nil
}
func point(_ req: [String: Any]) -> CGPoint { CGPoint(x: req["x"] as? Double ?? 0, y: req["y"] as? Double ?? 0) }
/** Why the keys can't go where they'd land now (a password field, Vaultite's own window), checked at each step. */
func keysRefused() -> String? {
  guard let el = target(["focused": true]) else { return nil }
  return secure(el) ? "secure" : pidOf(el) == vaultitePid ? "vaultite" : nil
}
/** Why the pointer can't act at `p`: Vaultite's own window there. */
func pointRefused(_ p: CGPoint) -> String? { windowUnder(p)?.pid == vaultitePid ? "vaultite" : nil }
/** Its press through Accessibility: `action` on it or a parent, else (a list's row, a sidebar's item) selecting it. */
func pressed(_ el: AXUIElement, _ action: String) -> [String: Any] {
  if let d = doer(el, action) { return ["ok": AXUIElementPerformAction(d, action as CFString) == .success, "how": "ax", "frame": rectJSON(frame(d))] }
  if action == "AXPress" {
    var e: AXUIElement? = el
    for _ in 0..<4 {
      guard let x = e else { break }
      if settable(x, kAXSelectedAttribute) {
        let ok = AXUIElementSetAttributeValue(x, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success && (attr(x, kAXSelectedAttribute) as Bool?) == true
        return ["ok": ok, "how": "ax", "frame": rectJSON(frame(x))]
      }
      e = attr(x, kAXParentAttribute)
    }
  }
  return ["ok": false, "why": "no-action", "frame": rectJSON(frame(el))]
}

// ---------- requests

func handle(_ req: [String: Any]) -> [String: Any] {
  switch req["op"] as? String ?? "" {
  case "trusted": return ["trusted": AXIsProcessTrusted()]
  case "pointer": let p = pointer(); return ["ok": true, "x": p.x, "y": p.y]
  case "guard":
    let on = req["on"] as? Bool ?? false
    if on && !guardStarted() { return ["ok": false, "why": "tap"] }
    setGuard(on, grace: on ? (req["grace"] as? Double ?? 0) : 0, rest: req["rest"] as? Double ?? 0)
    // (off, it sees nothing: no tap between the user and their apps but while it drives)
    if let t = guardTap { CGEvent.tapEnable(tap: t, enable: on) }
    return ["ok": true]
  // (the step now types, or not: their typing then is into its field, and stops it)
  case "expect": guardLock.lock(); keysStep = req["keys"] as? Bool ?? false; guardLock.unlock(); return ["ok": true]
  // (done: their pointer glides back where they left it, unless they've had it since; then the guard goes off)
  case "release":
    guardLock.lock(); let back = (req["back"] as? Bool ?? false) && !theirsSince && !busy && stopped == nil ? home : nil; guardLock.unlock()
    let went = back.map { hypot($0.x - pointer().x, $0.y - pointer().y) >= 2 && glide($0, own: false) } ?? false
    setGuard(false, grace: 0, rest: 0)
    if let t = guardTap { CGEvent.tapEnable(tap: t, enable: false) }
    return ["ok": true, "back": went]
  case "probe":
    guard let el = target(req) else { return ["ok": false, "why": "gone"] }
    return describe(el)
  case "press", "confirm", "focus", "set", "pick":
    if halted() { return ["ok": false, "why": "user"] }
    guard let el = target(req) else { return ["ok": false, "why": "gone"] }
    if pidOf(el) == vaultitePid { return ["ok": false, "why": "vaultite"] }
    if secure(el) { return ["ok": false, "why": "secure"] }
    switch req["op"] as? String {
    case "focus":
      let ok = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
      return ["ok": ok, "how": "ax", "frame": rectJSON(frame(el))]
    case "set":
      // (a native field takes its value; a web page's often doesn't see it: answered, so the caller types instead)
      guard settable(el, kAXValueAttribute) else { return ["ok": false, "why": "not-settable"] }
      let value = req["value"] as? String ?? ""
      _ = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
      let ok = AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, value as CFTypeRef) == .success && (attr(el, kAXValueAttribute) as String?) == value
      return ["ok": ok, "how": "ax", "frame": rectJSON(frame(el))]
    default:
      let named = req["action"] as? String ?? "", action = ["AXPress", "AXShowMenu", "AXConfirm", "AXPick", "AXIncrement", "AXDecrement", "AXOpen"].contains(named) ? named
        : req["op"] as? String == "confirm" ? "AXConfirm" : req["op"] as? String == "pick" ? "AXPick" : "AXPress"
      return pressed(el, action)
    }
  case "click":
    if let no = interrupted() { return ["ok": false, "why": no] }
    if let no = pointRefused(point(req)) { return ["ok": false, "why": no] }
    if let no = click(point(req), req["count"] as? Int ?? 1, req["right"] as? Bool ?? false) { return ["ok": false, "why": no] }
    return ["ok": true, "how": "point"]
  case "hover":
    if let no = interrupted() { return ["ok": false, "why": no] }
    if let no = pointRefused(point(req)) { return ["ok": false, "why": no] }
    return glide(point(req)) ? ["ok": true, "how": "point"] : ["ok": false, "why": interrupted() ?? "busy"]
  case "scroll":
    if halted() { return ["ok": false, "why": "user"] }
    // (where it's asked, else where their pointer is: it scrolls what they look at, the pointer staying theirs)
    let at = req["x"] != nil ? point(req) : nil, p = at ?? pointer(), dy = req["dy"] as? Double ?? 0
    if let no = pointRefused(p) { return ["ok": false, "why": no] }
    let ax = req["dx"] as? Double ?? 0 == 0 ? scrollAX(p, dy) : nil
    if ax == "ok" { return ["ok": true, "how": "ax"] }
    if ax == "end" { return ["ok": true, "how": "ax", "moved": false] }
    if let no = interrupted() { return ["ok": false, "why": no] }
    // (what's seen there before and after: a scroll that moved nothing says so)
    let probes = [p, CGPoint(x: p.x, y: p.y - 120), CGPoint(x: p.x, y: p.y + 120)].compactMap(hitAt)
    if let no = scroll(at, Int32(dy), Int32(req["dx"] as? Double ?? 0)) { return ["ok": false, "why": no] }
    pause(250)
    let moved = probes.isEmpty ? nil : probes.contains { el, was in frame(el).map { abs($0.minY - was.minY) >= 1 || abs($0.minX - was.minX) >= 1 } ?? true }
    return ["ok": true, "how": "point", "moved": moved as Any? ?? NSNull()]
  case "key":
    if let no = interrupted() { return ["ok": false, "why": no] }
    if let no = keysRefused() { return ["ok": false, "why": no] }
    return key(req["key"] as? String ?? "") ? ["ok": true, "how": "key"] : ["ok": false, "why": "key"]
  case "type":
    if let no = interrupted() { return ["ok": false, "why": no] }
    if let no = keysRefused() { return ["ok": false, "why": no] }
    let (typed, why) = type(req["text"] as? String ?? "")
    return why == nil ? ["ok": true, "how": "key"] : ["ok": false, "why": why!, "typed": typed]
  default: return ["error": "unknown op"]
  }
}

Thread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
    DispatchQueue.main.sync {
      var res = handle(req)
      res["id"] = req["id"]
      send(res)
    }
  }
  exit(0)
}.start()
RunLoop.main.run()
