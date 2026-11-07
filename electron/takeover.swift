// Take-over (electron/takeover.ts): elements pressed or set through Accessibility, clicks, typing and keys, and a
// guard telling when the user stops it (a click, Esc) or has their hands on the mouse or keys. JSON lines in and out.
// A request naming a `pid` and `window` acts behind the user's windows: in that window only, the pointer theirs.
import AppKit
import ApplicationServices
import ScreenCaptureKit

// (ax.swift: sending, Accessibility reads, an element's words as the screen helper lists them)
_ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1)
/** Marks the events we post, so the guard (and nothing else) tells them from the user's. */
let MARK: Int64 = 0x5641554C54


// ---------- finding an element again: the window under its frame, walked for the one with that frame and words

func windowUnder(_ p: CGPoint) -> (pid: pid_t, id: Int)? {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
  for w in list where (w[kCGWindowLayer as String] as? Int) == 0 && (w[kCGWindowAlpha as String] as? Double ?? 1) > 0 {
    guard let b = w[kCGWindowBounds as String] as? NSDictionary, let r = CGRect(dictionaryRepresentation: b), r.contains(p) else { continue }
    return (pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0), w[kCGWindowNumber as String] as? Int ?? 0)
  }
  return nil
}
func close(_ a: CGRect, _ b: CGRect) -> Bool { abs(a.minX - b.minX) <= 4 && abs(a.minY - b.minY) <= 4 && abs(a.width - b.width) <= 4 && abs(a.height - b.height) <= 4 }
/** The element at `want` (a near() list's frame) with its words, else the one there with that frame, else what's hit at
 *  its middle. Bounded in elements and time, as near() is. */
func find(_ want: CGRect, _ words: String, _ role: String) -> AXUIElement? {
  let mid = CGPoint(x: want.midX, y: want.midY)
  // (behind: its window, though another covers that point)
  if let (pid, id) = behind.map({ (pid: $0.pid, id: Int($0.window)) }) ?? windowUnder(mid), pid != vaultitePid, let w = axWindow(pid, id) {
    var byFrame: AXUIElement?, seen = 0
    let deadline = Date().addingTimeInterval(0.8)
    var stack: [(AXUIElement, Int)] = [(w, 0)]
    while let (el, depth) = stack.popLast() {
      seen += 1
      if seen > 6000 || Date() > deadline { break }
      let f = frame(el)
      if let f, f.width > 0, f.height > 0, !f.insetBy(dx: -4, dy: -4).intersects(want) { continue }
      if let f, close(f, want) {
        if !words.isEmpty && label(el) == words && (role.isEmpty || roleOf(el) == role || (attr(el, kAXRoleAttribute) as String?) == role) { return el }
        if byFrame == nil && (words.isEmpty || label(el) == words) { byFrame = el }
      }
      if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
    }
    if let byFrame { return byFrame }
  }
  if let b = behind { return hitIn(b, mid) }
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(mid.x), Float(mid.y), &hit) == .success, let el = hit, pidOf(el) != vaultitePid else { return nil }
  return el
}
/** The element itself or the nearest of its parents (3 up) that does `action`: a button's text is pressed as its button. */
func doer(_ el: AXUIElement, _ action: String) -> AXUIElement? {
  var e: AXUIElement? = el
  for _ in 0..<4 {
    guard let x = e else { return nil }
    if actionNames(x).contains(action) { return x }
    e = attr(x, kAXParentAttribute)
  }
  return nil
}
func target(_ req: [String: Any]) -> AXUIElement? {
  if req["focused"] as? Bool == true {
    if let b = behind { return attr(AXUIElementCreateApplication(b.pid), kAXFocusedUIElementAttribute) }
    if let el: AXUIElement = attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) { return el }
    // (the system-wide one isn't always told: the app in front's own)
    guard let a = NSWorkspace.shared.frontmostApplication else { return nil }
    return attr(AXUIElementCreateApplication(a.processIdentifier), kAXFocusedUIElementAttribute)
  }
  if let b = behind, let words = req["find"] as? String { return findWords(b, words, req["role"] as? String ?? "") }
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
  m["actions"] = actionNames(el)
  m["valueSettable"] = settable(el, kAXValueAttribute)
  if let v: NSNumber = attr(el, kAXValueAttribute), ["AXCheckBox", "AXRadioButton", "AXSwitch"].contains(m["role"] as? String ?? "") { m["checked"] = v.intValue != 0 }
  // (its state, read back after a step: whether it did what it meant)
  if let b: Bool = attr(el, "AXExpanded") { m["expanded"] = b } else if m["role"] as? String == "AXDisclosureTriangle", let v: NSNumber = attr(el, kAXValueAttribute) { m["expanded"] = v.intValue != 0 }
  if let b: Bool = attr(el, kAXSelectedAttribute) { m["selected"] = b }
  if let b: Bool = attr(el, kAXEnabledAttribute), !b { m["disabled"] = true }
  if !secure(el), let v: String = attr(el, kAXValueAttribute) { m["value"] = String(v.prefix(200)) }
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
func halted() -> Bool { if behind != nil { return false }; guardLock.lock(); defer { guardLock.unlock() }; return stopped != nil }
/** Why a step with the pointer or the keys can't go on now: stopped ("user"), or their hands on it ("busy"). */
func interrupted() -> String? { if behind != nil { return nil }; guardLock.lock(); defer { guardLock.unlock() }; return stopped != nil ? "user" : busy ? "busy" : nil }
func setGuard(_ on: Bool, grace: Double, rest: Double) {
  guardLock.lock()
  guarding = on; stopped = nil; busy = false; moved = 0; lastActive = 0; modsHeld = false; keysStep = false; home = nil; theirsSince = false
  graceUntil = CFAbsoluteTimeGetCurrent() + grace / 1000
  if rest > 0 { restMs = rest }
  guardLock.unlock()
}

// ---------- posting: the pointer (gliding from where it is), clicks, typing, keys, the wheel; each marked ours

let source = CGEventSource(stateID: .privateState)
func post(_ e: CGEvent?) {
  guard let e else { return }
  e.setIntegerValueField(.eventSourceUserData, value: MARK)
  if let b = behind { postBehind(e, b); return }
  e.post(tap: .cghidEventTap)
}
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
  if let b = behind { return clickBehind(p, count, right, b) }
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
  if let b = behind { return hitIn(b, p).flatMap { el in frame(el).map { (el, $0) } } }
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
func pointRefused(_ p: CGPoint) -> String? {
  if let b = behind { return windowFrame(b.window)?.contains(p) == true ? nil : "outside" }
  return windowUnder(p)?.pid == vaultitePid ? "vaultite" : nil
}
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

// ---------- behind: one app's window, though others cover it; its pointer and keys sent to that app alone, so the
// user's pointer, front app and typing stay theirs. Recipes ported from Cua (MIT, (c) 2025 Cua AI, Inc., trycua/cua):
// SkyLight's focus-without-raise record and pid-routed mouse events stamped with their window.

typealias Behind = (pid: pid_t, window: UInt32)
var behind: Behind?
let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY | RTLD_GLOBAL)
func skyFn<T>(_ name: String, _ t: T.Type) -> T? { dlsym(sky, name).map { unsafeBitCast($0, to: t) } }
let slPostToPid = skyFn("SLEventPostToPid", (@convention(c) (pid_t, CGEvent) -> Void).self)
let slWindowLocation = skyFn("CGEventSetWindowLocation", (@convention(c) (CGEvent, CGPoint) -> Void).self)
let slIntField = skyFn("SLEventSetIntegerValueField", (@convention(c) (CGEvent, UInt32, Int64) -> Void).self)
let slPostRecord = skyFn("SLPSPostEventRecordTo", (@convention(c) (UnsafeRawPointer, UnsafePointer<UInt8>) -> Int32).self)
let slConnection = skyFn("CGSMainConnectionID", (@convention(c) () -> UInt32).self)
let slWindowOwner = skyFn("SLSGetWindowOwner", (@convention(c) (UInt32, UInt32, UnsafeMutablePointer<UInt32>) -> Int32).self)
let slConnectionPSN = skyFn("SLSGetConnectionPSN", (@convention(c) (UInt32, UnsafeMutableRawPointer) -> Int32).self)
let slSetAuth = skyFn("SLEventSetAuthenticationMessage", (@convention(c) (CGEvent, AnyObject) -> Void).self)
let objcSend = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend").map { unsafeBitCast($0, to: (@convention(c) (AnyClass, Selector, UnsafeMutableRawPointer, Int32, UInt32) -> Unmanaged<AnyObject>?).self) }
let canBehind = slPostToPid != nil && slWindowLocation != nil && slIntField != nil && slPostRecord != nil && slConnection != nil && slWindowOwner != nil && slConnectionPSN != nil
/** Its window made key inside its app, the app neither activated nor raised (the user's front app isn't told). */
func focusBehind(_ b: Behind) {
  guard let slPostRecord, let slConnection, let slWindowOwner, let slConnectionPSN else { return }
  var owner: UInt32 = 0, psn = [UInt8](repeating: 0, count: 8)
  guard slWindowOwner(slConnection(), b.window, &owner) == 0, owner != 0, slConnectionPSN(owner, &psn) == 0 else { return }
  var r = [UInt8](repeating: 0, count: 0xF8)
  r[0x04] = 0xF8; r[0x08] = 0x0D; r[0x8A] = 0x01
  withUnsafeBytes(of: b.window.littleEndian) { for i in 0..<4 { r[0x3C + i] = $0[i] } }
  _ = psn.withUnsafeBytes { slPostRecord($0.baseAddress!, r) }
}
/** Keys need WindowServer's authentication message to reach Chromium-like apps (macOS 15 and later). */
func authenticate(_ e: CGEvent, _ pid: pid_t) {
  guard let cls = NSClassFromString("SLSEventAuthenticationMessage"), let objcSend, let slSetAuth else { return }
  let sel = NSSelectorFromString("messageWithEventRecord:pid:version:")
  guard class_respondsToSelector(object_getClass(cls), sel) else { return }
  let raw = Unmanaged.passUnretained(e).toOpaque()
  for off in [24, 32, 16] {
    guard let record = raw.load(fromByteOffset: off, as: UnsafeMutableRawPointer?.self) else { continue }
    if let m = objcSend(cls, sel, record, pid, 0) { slSetAuth(e, m.takeUnretainedValue()) }
    return
  }
}
func postBehind(_ e: CGEvent, _ b: Behind) {
  if e.type == .keyDown || e.type == .keyUp { authenticate(e, b.pid) }
  if let slPostToPid { slPostToPid(b.pid, e) } else { e.postToPid(b.pid) }
}
/** A mouse event for its window: phase, click state, the pid and window (Chromium filters on them), one gesture id. */
func mouseBehind(_ t: CGEventType, _ p: CGPoint, _ b: Behind, phase: Int64, clicks: Int64, gesture: Int64, right: Bool) {
  guard let e = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: t, mouseCursorPosition: p, mouseButton: right ? .right : .left), let set = slIntField else { return }
  set(e, 0, phase); set(e, 1, clicks); set(e, 3, right ? 1 : 0); set(e, 7, 3); set(e, 40, Int64(b.pid))
  for f: UInt32 in [51, 91, 92] { set(e, f, Int64(b.window)) }
  set(e, 58, gesture)
  slWindowLocation?(e, p)
  e.flags = []
  post(e)
}
/** A click there: a move to prime its tracking, an off-screen press to open Chromium's user-activation gate, then the
 *  press itself. The pointer never moves. */
func clickBehind(_ p: CGPoint, _ count: Int, _ right: Bool, _ b: Behind) -> String? {
  focusBehind(b)
  pause(50)
  let gesture = Int64(Date().timeIntervalSince1970 * 1000) & 0x7fffffff
  let (down, up): (CGEventType, CGEventType) = right ? (.rightMouseDown, .rightMouseUp) : (.leftMouseDown, .leftMouseUp)
  mouseBehind(.mouseMoved, p, b, phase: 2, clicks: 0, gesture: gesture, right: false)
  pause(15)
  if !right {
    let off = CGPoint(x: -1, y: -1)
    mouseBehind(.leftMouseDown, off, b, phase: 1, clicks: 1, gesture: gesture, right: false); pause(1)
    mouseBehind(.leftMouseUp, off, b, phase: 2, clicks: 1, gesture: gesture, right: false); pause(100)
  }
  for n in 1...max(1, min(count, 2)) {
    mouseBehind(down, p, b, phase: 3, clicks: Int64(n), gesture: gesture, right: right); pause(28)
    mouseBehind(up, p, b, phase: 3, clicks: Int64(n), gesture: gesture, right: right)
    if n < count { pause(80) }
  }
  return nil
}
func windowFrame(_ id: UInt32) -> CGRect? {
  guard let w = (CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]])?.first, let b = w[kCGWindowBounds as String] as? NSDictionary else { return nil }
  return CGRect(dictionaryRepresentation: b)
}
/** What's at `p` in its app, whatever covers it. */
func hitIn(_ b: Behind, _ p: CGPoint) -> AXUIElement? {
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateApplication(b.pid), Float(p.x), Float(p.y), &hit) == .success else { return nil }
  return hit
}
/** Its element showing `words` (and of `role`, when given): the first such, front to back. */
func findWords(_ b: Behind, _ words: String, _ role: String) -> AXUIElement? {
  guard let w = axWindow(b.pid, Int(b.window)) else { return nil }
  let want = words.lowercased().trimmingCharacters(in: .whitespaces)
  var loose: AXUIElement?, seen = 0, stack: [(AXUIElement, Int)] = [(w, 0)]
  let deadline = Date().addingTimeInterval(0.8)
  while let (el, depth) = stack.popLast() {
    seen += 1
    if seen > 6000 || Date() > deadline { break }
    let words = [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXPlaceholderValueAttribute].compactMap { (attr(el, $0) as String?)?.lowercased().trimmingCharacters(in: .whitespaces) }
    if words.contains(want) {
      if role.isEmpty || roleOf(el).lowercased() == role.lowercased() || (attr(el, kAXRoleAttribute) as String?)?.lowercased() == "ax" + role.lowercased() { return el }
      loose = loose ?? el
    }
    if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
  }
  return role.isEmpty ? loose : nil
}
/** An app by its name or bundle id, and its front window: where steps behind go. */
func appWindow(_ name: String) -> [String: Any] {
  let want = name.lowercased()
  let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.processIdentifier != vaultitePid }
  guard let a = apps.first(where: { $0.localizedName?.lowercased() == want || $0.bundleIdentifier?.lowercased() == want })
    ?? apps.first(where: { ($0.localizedName?.lowercased() ?? "").hasPrefix(want) }) else { return ["ok": false, "why": "not-running"] }
  if a.isHidden { return ["ok": false, "why": "hidden", "name": a.localizedName ?? name] }
  let pid = a.processIdentifier, ax = AXUIElementCreateApplication(pid)
  wake(pid)
  let main: AXUIElement? = attr(ax, kAXFocusedWindowAttribute) ?? attr(ax, kAXMainWindowAttribute)
  let onScreen = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowLayer as String] as? Int) == 0 }
  let ids = onScreen.compactMap { $0[kCGWindowNumber as String] as? Int }
  guard let id = main.flatMap(wid).flatMap({ ids.contains($0) ? $0 : nil }) ?? onScreen.first(where: { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) })?[kCGWindowNumber as String] as? Int,
        let f = windowFrame(UInt32(id)) else { return ["ok": false, "why": "no-window", "name": a.localizedName ?? name] }
  // (covered: by how much of its area other windows above it hide, roughly)
  let above = onScreen.prefix { ($0[kCGWindowNumber as String] as? Int) != id }.compactMap { ($0[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0) } }
  let hidden = above.map { $0.intersection(f) }.filter { !$0.isNull }.map { $0.width * $0.height }.max() ?? 0
  var m = appInfo(pid)
  m["ok"] = true; m["window"] = id; m["frame"] = rectJSON(f); m["front"] = a.isActive; m["covered"] = f.width * f.height > 0 ? hidden / (f.width * f.height) : 0
  m["title"] = axWindow(pid, id).flatMap { attr($0, kAXTitleAttribute) as String? } ?? ""
  m["behind"] = canBehind
  return m
}
/** What its window says now, as one string's hash: titles, values, selections and states, front to back. A step's
 *  effect is read back as a change of it. */
func digest(_ b: Behind) -> [String: Any] {
  guard let w = axWindow(b.pid, Int(b.window)) else { return ["ok": false, "why": "gone"] }
  var h = Hasher(), seen = 0, stack: [(AXUIElement, Int)] = [(w, 0)]
  let deadline = Date().addingTimeInterval(0.6)
  while let (el, depth) = stack.popLast() {
    seen += 1
    if seen > 4000 || Date() > deadline { break }
    let want: [String] = [kAXRoleAttribute, kAXTitleAttribute, kAXValueAttribute, kAXSelectedTextRangeAttribute, kAXSelectedAttribute, kAXExpandedAttribute, kAXFocusedAttribute, kAXEnabledAttribute]
    var values: CFArray?
    if AXUIElementCopyMultipleAttributeValues(el, want as CFArray, [], &values) == .success, let vs = values as? [Any] {
      for v in vs { h.combine(String(describing: v).prefix(400)) }
    }
    if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
  }
  return ["ok": true, "digest": String(h.finalize()), "seen": seen]
}
/** Its window's picture, though covered (ScreenCaptureKit), `width` points wide: what its thumbnail shows. */
var shotWindows: [UInt32: SCWindow] = [:]
func shot(_ id: UInt32, _ width: Double) -> [String: Any] {
  guard #available(macOS 14.0, *) else { return ["ok": false, "why": "macos"] }
  let done = DispatchSemaphore(value: 0)
  var res: [String: Any] = ["ok": false, "why": "capture"]
  Task {
    defer { done.signal() }
    do {
      if shotWindows[id] == nil {
        let c = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        shotWindows = Dictionary(c.windows.map { ($0.windowID, $0) }, uniquingKeysWith: { a, _ in a })
      }
      guard let w = shotWindows[id] else { res = ["ok": false, "why": "gone"]; return }
      let conf = SCStreamConfiguration(), scale = min(1, width / max(1, w.frame.width)) * 2
      conf.width = Int(w.frame.width * scale); conf.height = Int(w.frame.height * scale); conf.showsCursor = false
      let img = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: w), configuration: conf)
      guard let jpg = NSBitmapImageRep(cgImage: img).representation(using: .jpeg, properties: [.compressionFactor: 0.72]) else { return }
      res = ["ok": true, "img": "data:image/jpeg;base64," + jpg.base64EncodedString(), "w": img.width, "h": img.height]
    } catch { shotWindows[id] = nil; res = ["ok": false, "why": "capture", "error": "\(error)"] }
  }
  _ = done.wait(timeout: .now() + 3)
  return res
}
func behindOf(_ req: [String: Any]) -> Behind? {
  guard canBehind, let pid = req["pid"] as? Int, let w = req["window"] as? Int, pid > 0, w > 0, pid_t(pid) != vaultitePid else { return nil }
  return (pid_t(pid), UInt32(w))
}

// ---------- requests

func handle(_ req: [String: Any]) -> [String: Any] {
  switch req["op"] as? String ?? "" {
  case "trusted": return ["trusted": AXIsProcessTrusted()]
  case "window": return appWindow(req["app"] as? String ?? "")
  // (a step behind that couldn't be confirmed, done in front instead: its app and window brought forward)
  case "raise":
    guard let b = behind, let a = NSRunningApplication(processIdentifier: b.pid) else { return ["ok": false, "why": "gone"] }
    if let w = axWindow(b.pid, Int(b.window)) { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
    return ["ok": a.activate(options: [])]
  case "digest":
    guard let b = behind else { return ["ok": false, "why": "window"] }
    return digest(b)
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
    if behind != nil { return ["ok": false, "why": "no-scroll"] }
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
    // (a window's picture takes a moment: off the main queue, so the guard and steps don't wait for it)
    if req["op"] as? String == "shot" {
      var res = shot(UInt32(req["window"] as? Int ?? 0), req["width"] as? Double ?? 320)
      res["id"] = req["id"]
      send(res)
      continue
    }
    DispatchQueue.main.sync {
      behind = behindOf(req)
      defer { behind = nil }
      // (keys go to its app's key window: that window made key first, the app left behind)
      if let b = behind, ["key", "type"].contains(req["op"] as? String ?? "") { focusBehind(b); pause(50) }
      var res = handle(req)
      res["id"] = req["id"]
      send(res)
    }
  }
  exit(0)
}.start()
RunLoop.main.run()
