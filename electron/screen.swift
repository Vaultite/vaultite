// The screen helper (electron/screen.ts): the fn key, the app in front, and other apps' fields and text, through the
// Accessibility API. JSON lines in and out; stdin closing ends it.
import AppKit
import ApplicationServices

/** A window's number (CGWindowID), as appwindows.swift gets it. */
@_silgen_name("_AXUIElementGetWindow") func axWindowID(_ el: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError
func wid(_ w: AXUIElement) -> Int? { var id: CGWindowID = 0; return axWindowID(w, &id) == .success && id != 0 ? Int(id) : nil }

/** Vaultite's main process (the helper's parent): its windows (the vault's, the overlay) are never another app's. */
let vaultitePid = getppid()
_ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1)

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
  return ["bundle": a?.bundleIdentifier ?? "", "name": a?.localizedName ?? "", "pid": Int(pid)]
}

// ---------- fn: down and up, on its own thread (a slow request never holds the key)

var fnDown = false, fnOther = false
func tapped(_ type: CGEventType, _ e: CGEvent) {
  if type == .flagsChanged {
    let on = e.flags.contains(.maskSecondaryFn)
    if e.getIntegerValueField(.keyboardEventKeycode) == 63 {
      if on && !fnDown { fnDown = true; fnOther = false; send(["event": "fn", "down": true]) }
      else if !on && fnDown { fnDown = false; send(["event": "fn", "down": false]) }
    } else if fnDown && !fnOther { fnOther = true; send(["event": "fn", "other": true]) }
  } else if type == .keyDown && fnDown && !fnOther { fnOther = true; send(["event": "fn", "other": true]) }
}
var tap: CFMachPort?
/** Started once asked (`fn`): only the menu-bar helper's app hears the key. */
let tapThread = Thread {
  let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue) | CGEventMask(1 << CGEventType.keyDown.rawValue)
  let cb: CGEventTapCallBack = { _, type, e, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if let t = tap { CGEvent.tapEnable(tap: t, enable: true) } }
    else { tapped(type, e) }
    return Unmanaged.passUnretained(e)
  }
  // (Accessibility lets a filtering tap in, Input Monitoring a listening one; asked again till one is granted)
  while tap == nil {
    tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: cb, userInfo: nil)
      ?? CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: cb, userInfo: nil)
    send(["event": "tap", "ok": tap != nil])
    if tap == nil { Thread.sleep(forTimeInterval: 5) }
  }
  let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
  CGEvent.tapEnable(tap: tap!, enable: true)
  CFRunLoopRun()
}

// ---------- the app in front, and its focused window's title (metadata only)

var lastFront = ""
var frontObserver: AXObserver?
func sayFront() {
  guard let a = NSWorkspace.shared.frontmostApplication else { return }
  let app = AXUIElementCreateApplication(a.processIdentifier)
  let win: AXUIElement? = attr(app, kAXFocusedWindowAttribute)
  var m = appInfo(a.processIdentifier)
  m["title"] = win.flatMap { attr($0, kAXTitleAttribute) as String? } ?? ""
  m["window"] = win.flatMap { wid($0) } ?? 0
  m["vaultite"] = a.processIdentifier == vaultitePid
  let key = "\(m["bundle"]!)|\(m["title"]!)|\(m["window"]!)"
  if key == lastFront { return }
  lastFront = key
  m["event"] = "front"
  send(m)
}
func watchFront(_ pid: pid_t) {
  if let o = frontObserver { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode) }
  frontObserver = nil
  var o: AXObserver?
  guard AXObserverCreate(pid, { _, _, _, _ in sayFront() }, &o) == .success, let o else { return }
  let app = AXUIElementCreateApplication(pid)
  for n in [kAXFocusedWindowChangedNotification, kAXTitleChangedNotification, kAXMainWindowChangedNotification] { AXObserverAddNotification(o, app, n as CFString, nil) }
  CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode)
  frontObserver = o
}

// ---------- fields: where words go, and putting them there

let TEXT_ROLES: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
/** Chromium and Electron build their tree only when asked (AXManualAccessibility), as VoiceOver's apps do. */
var awoken = Set<pid_t>()
func wake(_ pid: pid_t) {
  if awoken.contains(pid) { return }
  awoken.insert(pid)
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString, kCFBooleanTrue)
}
func focused() -> AXUIElement? {
  if let a = NSWorkspace.shared.frontmostApplication { wake(a.processIdentifier) }
  return attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute)
}
func settable(_ el: AXUIElement, _ name: String) -> Bool { var b: DarwinBoolean = false; return AXUIElementIsAttributeSettable(el, name as CFString, &b) == .success && b.boolValue }
func editable(_ el: AXUIElement) -> Bool {
  let role: String = attr(el, kAXRoleAttribute) ?? ""
  if TEXT_ROLES.contains(role) { return true }
  // (a web page's contenteditable, Google Docs' hidden field, a code editor)
  if (attr(el, "AXEditableAncestor") as AXUIElement?) != nil { return true }
  return settable(el, kAXSelectedTextAttribute) || (role != "AXWindow" && settable(el, kAXValueAttribute) && settable(el, kAXSelectedTextRangeAttribute))
}
func secure(_ el: AXUIElement) -> Bool { (attr(el, kAXSubroleAttribute) as String?) == "AXSecureTextField" }
func windowOf(_ el: AXUIElement) -> AXUIElement? { attr(el, kAXWindowAttribute) }
/** The text before the caret (what the words join to), when the field tells it. */
func before(_ el: AXUIElement) -> String? {
  guard let value: String = attr(el, kAXValueAttribute), let rv: AXValue = attr(el, kAXSelectedTextRangeAttribute) else { return nil }
  var r = CFRange(); AXValueGetValue(rv, .cfRange, &r)
  let ns = value as NSString, at = min(max(0, r.location), ns.length)
  return ns.substring(with: NSRange(location: max(0, at - 40), length: at - max(0, at - 40)))
}
func focus() -> [String: Any] {
  guard let el = focused() else {
    var m = NSWorkspace.shared.frontmostApplication.map { appInfo($0.processIdentifier) } ?? [:]
    m["field"] = false
    return m
  }
  let pid = pidOf(el)
  var m = appInfo(pid)
  let w = windowOf(el)
  m["field"] = editable(el) && pid != vaultitePid
  m["secure"] = secure(el)
  m["role"] = attr(el, kAXRoleAttribute) as String? ?? ""
  m["frame"] = rectJSON(frame(el))
  m["window"] = w.flatMap { wid($0) } ?? 0
  m["title"] = w.flatMap { attr($0, kAXTitleAttribute) as String? } ?? ""
  m["vaultite"] = pid == vaultitePid
  if !secure(el), let b = before(el) { m["before"] = b }
  return m
}

/** Words into the focused field: set as its selected text (checked by its value), else pasted with the clipboard put
 *  back after, as Wispr Flow does. Never into a password field. */
func insert(_ text: String) -> [String: Any] {
  guard let el = focused(), editable(el) else { return ["ok": false, "why": "no-field"] }
  if secure(el) { return ["ok": false, "why": "secure"] }
  let was: String? = attr(el, kAXValueAttribute)
  if was != nil, AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success,
     let now: String = attr(el, kAXValueAttribute), now != was, now.contains(text) {
    return ["ok": true, "how": "ax"]
  }
  paste(text)
  return ["ok": true, "how": "paste"]
}
func paste(_ text: String) {
  let pb = NSPasteboard.general
  let saved: [[NSPasteboard.PasteboardType: Data]] = (pb.pasteboardItems ?? []).map { item in
    var d: [NSPasteboard.PasteboardType: Data] = [:]
    for t in item.types { if let v = item.data(forType: t) { d[t] = v } }
    return d
  }
  pb.clearContents()
  // (marked transient and auto-generated: clipboard managers leave it out of their history)
  pb.setString(text, forType: .string)
  pb.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
  pb.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.AutoGeneratedType"))
  let mine = pb.changeCount
  let src = CGEventSource(stateID: .combinedSessionState)
  for down in [true, false] {
    let e = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: down)
    e?.flags = .maskCommand
    e?.post(tap: .cghidEventTap)
  }
  // (put back once the app has read it; not if something else was copied meanwhile)
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
    guard pb.changeCount == mine else { return }
    pb.clearContents()
    let items = saved.map { d -> NSPasteboardItem in let i = NSPasteboardItem(); for (t, v) in d { i.setData(v, forType: t) }; return i }
    if !items.isEmpty { pb.writeObjects(items) }
  }
}

// ---------- windows: which is where, and their text

/** On-screen windows front to back (CGWindowList): numbers, owners, bounds; not Vaultite's own. */
func windowList() -> [[String: Any]] {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.filter { ($0[kCGWindowLayer as String] as? Int) == 0 }
}
func boundsOf(_ w: [String: Any]) -> CGRect? {
  guard let b = w[kCGWindowBounds as String] as? NSDictionary else { return nil }
  return CGRect(dictionaryRepresentation: b)
}
/** An app's AX window with number `id`. */
func axWindow(_ pid: pid_t, _ id: Int) -> AXUIElement? {
  wake(pid)
  let ws: [AXUIElement] = attr(AXUIElementCreateApplication(pid), kAXWindowsAttribute) ?? []
  return ws.first { wid($0) == id }
}
func describe(_ w: [String: Any]) -> [String: Any] {
  let pid = pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0), id = w[kCGWindowNumber as String] as? Int ?? 0
  var m = appInfo(pid)
  m["window"] = id
  m["frame"] = rectJSON(boundsOf(w))
  m["title"] = axWindow(pid, id).flatMap { attr($0, kAXTitleAttribute) as String? } ?? ""
  m["vaultite"] = pid == vaultitePid
  return m
}
/** The topmost window under a point (screen points, top-left origin): what the companion's cursor was dropped on. */
func windowAt(_ x: Double, _ y: Double) -> [String: Any] {
  guard let w = windowList().first(where: { boundsOf($0)?.contains(CGPoint(x: x, y: y)) == true && ($0[kCGWindowOwnerPID as String] as? Int).map { pid_t($0) != vaultitePid } ?? false && ($0[kCGWindowAlpha as String] as? Double ?? 1) > 0 }) else { return ["window": 0] }
  return describe(w)
}
func windowInfo(_ id: Int) -> [String: Any] {
  guard let w = windowList().first(where: { ($0[kCGWindowNumber as String] as? Int) == id }) else { return ["window": 0] }
  return describe(w)
}

func runningApp(_ name: String) -> NSRunningApplication? {
  NSRunningApplication.runningApplications(withBundleIdentifier: name).first
    ?? NSWorkspace.shared.runningApplications.first { $0.localizedName?.lowercased() == name.lowercased() }
}
/** The window asked for (its number), else the focused one of an app (bundle id or name), else of the app in front. */
func target(_ id: Int, _ bundle: String = "") -> (AXUIElement, pid_t)? {
  if id > 0 {
    guard let w = windowList().first(where: { ($0[kCGWindowNumber as String] as? Int) == id }),
          let pid = (w[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }), let ax = axWindow(pid, id) else { return nil }
    return (ax, pid)
  }
  guard let a = bundle.isEmpty ? NSWorkspace.shared.frontmostApplication : runningApp(bundle) else { return nil }
  wake(a.processIdentifier)
  guard let w: AXUIElement = attr(AXUIElementCreateApplication(a.processIdentifier), kAXFocusedWindowAttribute) else { return nil }
  return (w, a.processIdentifier)
}

/** What a window says, depth first: its texts, fields (never a password's), headings, buttons and links, one a line;
 *  `find`: instead, the first element saying it, and its frame. Bounded in elements and time. */
func walk(_ root: AXUIElement, max: Int, find: String?) -> (text: String, found: CGRect?) {
  var lines: [String] = [], size = 0, seen = 0
  let deadline = Date().addingTimeInterval(1.5), needle = find?.lowercased()
  var stack: [(AXUIElement, Int)] = [(root, 0)]
  while let (el, depth) = stack.popLast() {
    seen += 1
    if seen > 6000 || Date() > deadline || size > max { break }
    let role: String = attr(el, kAXRoleAttribute) ?? ""
    if secure(el) { continue }
    var says: [String] = []
    for a in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
      if let s: String = attr(el, a), !s.isEmpty, !says.contains(s) { says.append(s) }
    }
    if let n = needle {
      if says.contains(where: { $0.lowercased().contains(n) }), let f = frame(el), f.width > 0 { return ("", f) }
    } else if !says.isEmpty, ["AXStaticText", "AXTextField", "AXTextArea", "AXHeading", "AXButton", "AXLink", "AXCell", "AXMenuItem", "AXCheckBox", "AXRadioButton", "AXTab", "AXWebArea", "AXComboBox", "AXSearchField"].contains(role) {
      let line = says.joined(separator: " — ")
      // (a button's label is its text's too: said once)
      if lines.last != line { lines.append(line); size += line.count + 1 }
    }
    if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
  }
  let text = lines.joined(separator: "\n")
  return (String(text.prefix(max)), nil)
}

func handle(_ req: [String: Any]) -> [String: Any] {
  let id = req["window"] as? Int ?? 0
  switch req["op"] as? String {
  case "trusted":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: req["prompt"] as? Bool ?? false] as CFDictionary
    return ["trusted": AXIsProcessTrustedWithOptions(opts)]
  case "fn":
    if !tapThread.isExecuting && !tapThread.isFinished { tapThread.start() }
    return ["ok": true]
  case "focus": return focus()
  case "insert": return insert(req["text"] as? String ?? "")
  case "front": lastFront = ""; sayFront(); return ["ok": true]
  case "at": return windowAt(req["x"] as? Double ?? 0, req["y"] as? Double ?? 0)
  case "window":
    // (by its number, else an app's focused window)
    if id == 0, let (w, _) = target(0, req["bundle"] as? String ?? ""), let n = wid(w) { return windowInfo(n) }
    return windowInfo(id)
  case "text", "find":
    guard let (w, pid) = target(id, req["bundle"] as? String ?? "") else { return ["ok": false, "why": "no-window"] }
    var m = appInfo(pid)
    m["window"] = wid(w) ?? 0
    m["title"] = attr(w, kAXTitleAttribute) as String? ?? ""
    m["frame"] = rectJSON(frame(w))
    let r = walk(w, max: req["max"] as? Int ?? 20_000, find: req["op"] as? String == "find" ? req["text"] as? String ?? "" : nil)
    if req["op"] as? String == "find" { m["found"] = rectJSON(r.found) } else { m["text"] = r.text }
    m["ok"] = true
    return m
  default: return ["error": "unknown op"]
  }
}

NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { n in
  guard let a = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
  watchFront(a.processIdentifier)
  sayFront()
}
if let a = NSWorkspace.shared.frontmostApplication { watchFront(a.processIdentifier) }
DispatchQueue.main.async { sayFront() }
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
