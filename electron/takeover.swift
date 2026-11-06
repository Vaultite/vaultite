// Take-over (electron/takeover.ts): elements pressed or set through Accessibility, clicks, typing and keys, and a
// guard telling when the user moves the mouse or presses a key. JSON lines in and out; stdin closing ends it.
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

// ---------- the user taking it back: any mouse move, click or key that isn't ours

var guarding = false, stopped = false, moved = 0.0
/** Until when a mouse move isn't theirs taking over (their hand coming off Do it); a click or a key still is. */
var graceUntil = 0.0
var guardTap: CFMachPort?
let guardLock = NSLock()
func userDid(_ why: String) {
  guardLock.lock()
  let first = guarding && !stopped
  if first { stopped = true }
  guardLock.unlock()
  if first { send(["event": "user", "why": why]) }
}
func guardStarted() -> Bool {
  if guardTap != nil { return true }
  let types: [CGEventType] = [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .rightMouseDragged, .scrollWheel, .keyDown, .flagsChanged]
  let mask = types.reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
  let ready = DispatchSemaphore(value: 0)
  Thread {
    let cb: CGEventTapCallBack = { _, type, e, _ in
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if guarding, let t = guardTap { CGEvent.tapEnable(tap: t, enable: true) }; return Unmanaged.passUnretained(e) }
      if !guarding || e.getIntegerValueField(.eventSourceUserData) == MARK { return Unmanaged.passUnretained(e) }
      switch type {
      case .mouseMoved, .leftMouseDragged, .rightMouseDragged:
        // (a nudge isn't taking over: a few points' drift from a desk's knock still is ours)
        if CFAbsoluteTimeGetCurrent() < graceUntil { break }
        moved += abs(e.getDoubleValueField(.mouseEventDeltaX)) + abs(e.getDoubleValueField(.mouseEventDeltaY))
        if moved > 6 { userDid("mouse") }
      case .keyDown: userDid(e.getIntegerValueField(.keyboardEventKeycode) == 53 ? "esc" : "key")
      case .flagsChanged: userDid("key")
      default: userDid("mouse")
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
func halted() -> Bool { guardLock.lock(); defer { guardLock.unlock() }; return stopped }

// ---------- posting: the pointer, clicks, typing, keys, the wheel; each marked ours

let source = CGEventSource(stateID: .privateState)
func post(_ e: CGEvent?) { guard let e else { return }; e.setIntegerValueField(.eventSourceUserData, value: MARK); e.post(tap: .cghidEventTap) }
func pause(_ ms: Double) { Thread.sleep(forTimeInterval: ms / 1000) }
func pointer() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }
func moveTo(_ p: CGPoint) { post(CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)) }
func click(_ p: CGPoint, _ count: Int, _ right: Bool) {
  let (down, up, button): (CGEventType, CGEventType, CGMouseButton) = right ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  moveTo(p)
  pause(40)
  for n in 1...max(1, count) {
    for t in [down, up] {
      let e = CGEvent(mouseEventSource: source, mouseType: t, mouseCursorPosition: p, mouseButton: button)
      e?.setIntegerValueField(.mouseEventClickState, value: Int64(n))
      post(e)
      pause(t == down ? 30 : 60)
    }
  }
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
/** Words typed as a person would (a new line is Return, a tab Tab), a few characters an event; stops once they take over. */
func type(_ text: String) -> Bool {
  var chunk: [UniChar] = []
  let flush = {
    guard !chunk.isEmpty else { return }
    for down in [true, false] {
      let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
      e?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
      post(e)
    }
    chunk = []
    pause(12)
  }
  for ch in text {
    if halted() { return false }
    if ch == "\n" || ch == "\r\n" || ch == "\t" { flush(); _ = key(ch == "\t" ? "tab" : "return"); continue }
    let u = Array(String(ch).utf16)
    if chunk.count + u.count > 16 { flush() }
    chunk += u
  }
  flush()
  return !halted()
}
func scroll(_ p: CGPoint, _ dy: Int32, _ dx: Int32) {
  moveTo(p)
  pause(30)
  // (in a few steps, so a page that eases its scroll follows)
  for _ in 0..<4 { post(CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: dy / 4, wheel2: dx / 4, wheel3: 0)); pause(16) }
}
func point(_ req: [String: Any]) -> CGPoint { CGPoint(x: req["x"] as? Double ?? 0, y: req["y"] as? Double ?? 0) }
/** Why the keys can't go where they'd land now (a password field, Vaultite's own window), checked at each step. */
func keysRefused() -> String? {
  guard let el = target(["focused": true]) else { return nil }
  return secure(el) ? "secure" : pidOf(el) == vaultitePid ? "vaultite" : nil
}
/** Why the pointer can't act at `p`: Vaultite's own window there. */
func pointRefused(_ p: CGPoint) -> String? { windowUnder(p)?.pid == vaultitePid ? "vaultite" : nil }

// ---------- requests

func handle(_ req: [String: Any]) -> [String: Any] {
  switch req["op"] as? String ?? "" {
  case "trusted": return ["trusted": AXIsProcessTrusted()]
  case "pointer": let p = pointer(); return ["ok": true, "x": p.x, "y": p.y]
  // (the pointer put back where it was: no event, so nothing below sees a move)
  case "warp": CGWarpMouseCursorPosition(point(req)); CGAssociateMouseAndMouseCursorPosition(1); return ["ok": true]
  case "guard":
    let on = req["on"] as? Bool ?? false
    if on && !guardStarted() { return ["ok": false, "why": "tap"] }
    let grace = on ? (req["grace"] as? Double ?? 0) : 0
    guardLock.lock(); guarding = on; stopped = false; moved = 0; graceUntil = CFAbsoluteTimeGetCurrent() + grace / 1000; guardLock.unlock()
    // (off, it sees nothing: no tap between the user and their apps but while it drives)
    if let t = guardTap { CGEvent.tapEnable(tap: t, enable: on) }
    return ["ok": true]
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
      let named = req["action"] as? String ?? "", action = ["AXPress", "AXShowMenu", "AXConfirm", "AXPick", "AXIncrement", "AXDecrement"].contains(named) ? named
        : req["op"] as? String == "confirm" ? "AXConfirm" : req["op"] as? String == "pick" ? "AXPick" : "AXPress"
      guard let d = doer(el, action) else { return ["ok": false, "why": "no-action", "frame": rectJSON(frame(el))] }
      let ok = AXUIElementPerformAction(d, action as CFString) == .success
      return ["ok": ok, "how": "ax", "frame": rectJSON(frame(d))]
    }
  case "click":
    if halted() { return ["ok": false, "why": "user"] }
    if let no = pointRefused(point(req)) { return ["ok": false, "why": no] }
    click(point(req), req["count"] as? Int ?? 1, req["right"] as? Bool ?? false)
    return ["ok": !halted(), "how": "point"]
  case "hover":
    if let no = pointRefused(point(req)) { return ["ok": false, "why": no] }
    moveTo(point(req)); return ["ok": true, "how": "point"]
  case "scroll":
    if let no = pointRefused(point(req)) { return ["ok": false, "why": no] }
    scroll(point(req), Int32(req["dy"] as? Double ?? 0), Int32(req["dx"] as? Double ?? 0))
    return ["ok": !halted(), "how": "point"]
  case "key":
    if halted() { return ["ok": false, "why": "user"] }
    if let no = keysRefused() { return ["ok": false, "why": no] }
    return key(req["key"] as? String ?? "") ? ["ok": true, "how": "key"] : ["ok": false, "why": "key"]
  case "type":
    if halted() { return ["ok": false, "why": "user"] }
    if let no = keysRefused() { return ["ok": false, "why": no] }
    return type(req["text"] as? String ?? "") ? ["ok": true, "how": "key"] : ["ok": false, "why": "user"]
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
