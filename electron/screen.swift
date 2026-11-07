// The screen helper (electron/screen.ts): the dictation and Talk keys (ink while one is held), the app in front, other
// apps' fields and text (Accessibility), and the display's picture. JSON lines in and out; stdin closing ends it.
import AppKit
import ApplicationServices
import ScreenCaptureKit

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

// ---------- the dictation keys: down and up, on its own thread (a slow request never holds the key)

/** The dictation keys the helper asked for, by keycode: others aren't told. */
let keysLock = NSLock()
var watching = Set<Int64>()
func watched(_ code: Int64) -> Bool { keysLock.lock(); defer { keysLock.unlock() }; return watching.contains(code) }

let MODS: [Int64: CGEventFlags] = [59: .maskControl, 62: .maskControl, 61: .maskAlternate, 54: .maskCommand]
/** The key's other side's own flag (left Option's for right Option, right Control's for left): held with it, not alone. */
let LEFT: [Int64: UInt64] = [61: 0x20, 54: 0x08, 59: 0x2000, 62: 0x01]
let ANY_MOD: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift, .maskSecondaryFn]
var modHeld = Set<Int64>(), modLive = false
/** Control's and the right modifiers' presses as they are (core/fnkey.ts decides); what follows one says only that it came. */
func tappedMod(_ type: CGEventType, _ e: CGEvent) {
  let code = e.getIntegerValueField(.keyboardEventKeycode)
  guard type == .flagsChanged, let own = MODS[code], watched(code) else {
    if modLive { modLive = false; send(["event": "mod", "other": true]) }
    return
  }
  // (the flag stays while the key's other side is down: a held key's next event is its release)
  let on = e.flags.contains(own) && !modHeld.contains(code)
  let alone = on && modHeld.isEmpty && e.flags.intersection(ANY_MOD).subtracting(own).isEmpty && e.flags.rawValue & (LEFT[code] ?? 0) == 0
  if on { modHeld.insert(code) } else { modHeld.remove(code) }
  modLive = true
  send(["event": "mod", "code": code, "on": on, "alone": alone, "at": DispatchTime.now().uptimeNanoseconds / 1_000_000])
}

var fnDown = false, fnOther = false
func tapped(_ type: CGEventType, _ e: CGEvent) {
  tappedMod(type, e)
  tappedChord(type, e)
  if type == .flagsChanged {
    let on = e.flags.contains(.maskSecondaryFn)
    if e.getIntegerValueField(.keyboardEventKeycode) == 63 {
      if on && !fnDown && watched(63) { fnDown = true; fnOther = false; send(["event": "fn", "down": true]) }
      else if !on && fnDown { fnDown = false; send(["event": "fn", "down": false]) }
    } else if fnDown && !fnOther { fnOther = true; send(["event": "fn", "other": true]) }
  } else if type == .keyDown && fnDown && !fnOther { fnOther = true; send(["event": "fn", "other": true]) }
}

/** Chords: two modifiers held together and nothing else, by name (core/fnkey.ts CHORDS). Let go of one, it's up; another
 *  key or modifier with them, `other` (a shortcut). */
let CHORD_FLAGS: [String: CGEventFlags] = ["control_option": [.maskControl, .maskAlternate], "fn_control": [.maskSecondaryFn, .maskControl]]
/** `spent`: a shortcut took it; it comes on again only once let go (else letting go of the shortcut's key is a new press). */
var chords: [String] = [], chordOn: [String: Bool] = [:], chordSpent = Set<String>()
func tappedChord(_ type: CGEventType, _ e: CGEvent) {
  keysLock.lock(); let names = chords; keysLock.unlock()
  if type == .keyDown {
    for n in names where chordOn[n] == true { chordOn[n] = false; chordSpent.insert(n); send(["event": "chord", "name": n, "other": true]) }
    return
  }
  guard type == .flagsChanged else { return }
  let mods = e.flags.intersection(ANY_MOD)
  for n in names {
    guard let f = CHORD_FLAGS[n] else { continue }
    if !mods.isSuperset(of: f) { chordSpent.remove(n) }
    let on = mods == f && !chordSpent.contains(n), was = chordOn[n] ?? false
    if on == was { continue }
    chordOn[n] = on
    // (when it happened, ms since 1970: a busy app hearing it late still tells a tap from a hold)
    let t = Date().timeIntervalSince1970 * 1000
    if on { send(["event": "chord", "name": n, "on": true, "t": t]) }
    else if mods.isSuperset(of: f) { chordSpent.insert(n); send(["event": "chord", "name": n, "other": true]) }
    else { send(["event": "chord", "name": n, "on": false, "t": t]) }
  }
}

/** Ink: while the helper says (a Talk key held, outside Vaultite), drags are drawn, never reaching the app below; a drag
 *  begun then is the helper's to its release. */
var inkOn = false, inking = false, inkSent = 0.0
/** What the exchange watches meanwhile (its answer showing): a click elsewhere, Esc. Told, never taken. */
var exchange = false
/** Clicks told anyway, for the timeline (helper.ts keeps them only while it's on). */
var clicks = false
var filtering = false
func mouse(_ type: CGEventType, _ e: CGEvent) -> Bool {
  let p = e.location
  if type == .leftMouseDown && inkOn && filtering {
    inking = true
    send(["event": "ink", "phase": "down", "x": p.x, "y": p.y])
    return true
  }
  if type == .leftMouseDragged && inking {
    // (at most a point every 8 ms: smooth enough, and the pipe stays light)
    let now = Date().timeIntervalSince1970
    if now - inkSent >= 0.008 { inkSent = now; send(["event": "ink", "phase": "move", "x": p.x, "y": p.y]) }
    return true
  }
  if type == .leftMouseUp && inking {
    inking = false
    send(["event": "ink", "phase": "up", "x": p.x, "y": p.y])
    return true
  }
  if type == .leftMouseDown && (exchange || clicks) { send(["event": "click", "x": p.x, "y": p.y, "exchange": exchange]) }
  return false
}
var tap: CFMachPort?
/** Started once asked (`fn`): only the menu-bar helper's app hears the key. */
let tapThread = Thread {
  // (a click or a scroll too: Option-click or Control-scroll isn't a key alone; drags for ink)
  let mask = [CGEventType.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .leftMouseDragged, .leftMouseUp, .scrollWheel].reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
  let cb: CGEventTapCallBack = { _, type, e, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput { if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }; return Unmanaged.passUnretained(e) }
    if type == .leftMouseDragged || type == .leftMouseUp { return mouse(type, e) ? nil : Unmanaged.passUnretained(e) }
    if type == .leftMouseDown && mouse(type, e) { return nil }
    if type == .keyDown && exchange && e.getIntegerValueField(.keyboardEventKeycode) == 53 { send(["event": "esc"]) }
    tapped(type, e)
    return Unmanaged.passUnretained(e)
  }
  // (Accessibility lets a filtering tap in, Input Monitoring a listening one, which can't keep ink from the app below;
  // asked again till one is granted)
  while tap == nil {
    tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap, eventsOfInterest: mask, callback: cb, userInfo: nil)
    filtering = tap != nil
    if tap == nil { tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: cb, userInfo: nil) }
    send(["event": "tap", "ok": tap != nil, "ink": filtering])
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
  let a = NSWorkspace.shared.frontmostApplication
  if let a { wake(a.processIdentifier) }
  // (the system-wide answer fails on some Macs and for some apps; the app in front still knows)
  return attr(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) ?? a.flatMap { attr(AXUIElementCreateApplication($0.processIdentifier), kAXFocusedUIElementAttribute) }
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
/** The field a dictation started in, for its words should nothing else take them. */
var kept: AXUIElement?
func focus(keep: Bool = false) -> [String: Any] {
  if keep { kept = nil }
  guard let el = focused() else {
    var m = NSWorkspace.shared.frontmostApplication.map { appInfo($0.processIdentifier) } ?? [:]
    m["field"] = false
    return m
  }
  let pid = pidOf(el)
  var m = appInfo(pid)
  let w = windowOf(el)
  let open = editable(el)
  if keep && open && pid != vaultitePid && !secure(el) { kept = el }
  m["editable"] = open
  m["field"] = open && pid != vaultitePid
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
  if setSelected(el, text) { return ["ok": true, "how": "ax"] }
  paste(text)
  return ["ok": true, "how": "paste"]
}
/** Set as the field's selected text, checked by its value: it needn't be in front. */
func setSelected(_ el: AXUIElement, _ text: String) -> Bool {
  let was: String? = attr(el, kAXValueAttribute)
  guard was != nil, AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, text as CFTypeRef) == .success,
        let now: String = attr(el, kAXValueAttribute), now != was, now.contains(text) else { return false }
  return true
}
/** The kept field: `info`, what precedes its caret; `insert` with it where it is; else `front`, then `paste` once it has the keyboard. */
func keptField(_ what: String, _ text: String) -> [String: Any] {
  guard let el = kept, (attr(el, kAXRoleAttribute) as String?) != nil else { kept = nil; return ["ok": false, "why": "gone"] }
  let pid = pidOf(el)
  switch what {
  case "info":
    var m = appInfo(pid)
    m["ok"] = true
    if let b = before(el) { m["before"] = b }
    return m
  case "insert": return setSelected(el, text) ? ["ok": true, "how": "ax"] : ["ok": false, "why": "front"]
  case "front":
    // (asked of it by Accessibility: macOS may refuse a background process's `activate`)
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    NSRunningApplication(processIdentifier: pid)?.activate()
    if let w = windowOf(el) { AXUIElementPerformAction(w, kAXRaiseAction as CFString) }
    AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    return ["ok": true]
  case "paste":
    // (a field of that window: web apps' fields don't always keep their element when focused again)
    guard let now = focused(), pidOf(now) == pid, editable(now), !secure(now), windowOf(now).flatMap({ wid($0) }) == windowOf(el).flatMap({ wid($0) }) else { return ["ok": false, "why": "not-focused"] }
    paste(text)
    return ["ok": true, "how": "paste"]
  default: return ["ok": false, "why": "unknown"]
  }
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
/** Vaultite's own count (an ask there is about its note, pane or UI: `vaultite`), its window kept on top too; its overlays
 *  and boxes, above those, never do. Leaving them all out named the app behind Vaultite's window as the one asked about. */
func windowAt(_ x: Double, _ y: Double) -> [String: Any] {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return ["window": 0] }
  let p = CGPoint(x: x, y: y)
  guard let w = list.first(where: { w in
    let layer = w[kCGWindowLayer as String] as? Int ?? -1, own = (w[kCGWindowOwnerPID as String] as? Int).map { pid_t($0) == vaultitePid } ?? false
    return (layer == 0 || (own && layer == Int(CGWindowLevelForKey(.floatingWindow)))) && boundsOf(w)?.contains(p) == true && (w[kCGWindowAlpha as String] as? Double ?? 1) > 0
  }) else { return ["window": 0] }
  return describe(w)
}
/** What's under a point (screen points, top-left origin), as Accessibility names it: a desktop icon, a button, a row.
 *  Its words and its parent's, never a password field's; its app. */
func under(_ x: Double, _ y: Double) -> [String: Any] {
  var hit: AXUIElement?
  guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(x), Float(y), &hit) == .success, let el = hit else { return ["ok": false] }
  let pid = pidOf(el)
  if pid == vaultitePid { return ["ok": false, "vaultite": true] }
  var m = appInfo(pid)
  m["ok"] = true
  m["role"] = attr(el, kAXRoleDescriptionAttribute) as String? ?? attr(el, kAXRoleAttribute) as String? ?? ""
  let words = { (e: AXUIElement) -> String in
    if secure(e) { return "" }
    for k in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute] {
      if let v: String = attr(e, k), !v.trimmingCharacters(in: .whitespaces).isEmpty { return String(v.prefix(300)) }
    }
    return ""
  }
  m["label"] = words(el)
  if let parent: AXUIElement = attr(el, kAXParentAttribute) { m["in"] = words(parent) }
  m["frame"] = rectJSON(frame(el))
  return m
}
/** Whether a window in front of window `id` (0: any window) covers a point: a cursor there would point at nothing seen. */
func covered(_ id: Int, _ x: Double, _ y: Double) -> [String: Any] {
  let p = CGPoint(x: x, y: y)
  for w in windowList() {
    if id > 0 && (w[kCGWindowNumber as String] as? Int) == id { return ["covered": false] }
    if (w[kCGWindowAlpha as String] as? Double ?? 1) > 0, boundsOf(w)?.contains(p) == true { return ["covered": true] }
  }
  return ["covered": false]
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

/** The windows the companion's cursor points at (helper.ts asks for them all at once): their moves, resizes and closing,
 *  told as they happen, so the cursor follows a window being dragged. */
var watchers: [pid_t: AXObserver] = [:]
func watchWindows(_ ids: [Int]) {
  for o in watchers.values { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode) }
  watchers = [:]
  let list = windowList()
  for id in ids {
    guard let w = list.first(where: { ($0[kCGWindowNumber as String] as? Int) == id }), let pid = (w[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }),
          pid != vaultitePid, let ax = axWindow(pid, id) else { continue }
    if watchers[pid] == nil {
      var o: AXObserver?
      guard AXObserverCreate(pid, { _, el, n, _ in
        send(["event": "moved", "window": wid(el) ?? 0, "frame": rectJSON(frame(el)), "gone": (n as String) == kAXUIElementDestroyedNotification])
      }, &o) == .success, let o else { continue }
      CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(o), .defaultMode)
      watchers[pid] = o
    }
    for n in [kAXMovedNotification, kAXResizedNotification, kAXUIElementDestroyedNotification] { AXObserverAddNotification(watchers[pid]!, ax, n as CFString, nil) }
  }
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

/** What Accessibility finds near a point of the window there (not ours): buttons, links, text, rows..., each with its
 *  words and frame, nearest first; whole subtrees off the area are skipped. Bounded in elements and time. */
let NEAR_ROLES: Set<String> = ["AXButton", "AXLink", "AXStaticText", "AXTextField", "AXTextArea", "AXHeading", "AXCell", "AXRow", "AXImage", "AXMenuItem",
  "AXMenuBarItem", "AXCheckBox", "AXRadioButton", "AXTab", "AXPopUpButton", "AXComboBox", "AXSearchField", "AXSlider", "AXDisclosureTriangle"]
func near(_ x: Double, _ y: Double, _ r: Double, _ most: Int) -> [String: Any] {
  let p = CGPoint(x: x, y: y), area = CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)
  guard let w = windowList().first(where: { boundsOf($0)?.contains(p) == true && ($0[kCGWindowAlpha as String] as? Double ?? 1) > 0 }),
        let pid = (w[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }), pid != vaultitePid,
        let ax = axWindow(pid, w[kCGWindowNumber as String] as? Int ?? 0) else { return ["ok": false, "elements": []] }
  var found: [(Double, [String: Any])] = [], seen = 0
  let deadline = Date().addingTimeInterval(0.8)
  var stack: [(AXUIElement, Int)] = [(ax, 0)]
  while let (el, depth) = stack.popLast() {
    seen += 1
    if seen > 5000 || Date() > deadline { break }
    if secure(el) { continue }
    let f = frame(el)
    if let f, f.width > 0, f.height > 0, !f.intersects(area) { continue }
    let role: String = attr(el, kAXRoleAttribute) ?? ""
    if let f, f.width > 0, NEAR_ROLES.contains(role) {
      var label = ""
      for k in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute] {
        if let v: String = attr(el, k), !v.trimmingCharacters(in: .whitespaces).isEmpty { label = String(v.prefix(120)); break }
      }
      if !label.isEmpty {
        let dx = max(f.minX - x, 0, x - f.maxX), dy = max(f.minY - y, 0, y - f.maxY)
        found.append((dx * dx + dy * dy, ["role": attr(el, kAXRoleDescriptionAttribute) as String? ?? role, "label": label, "frame": rectJSON(f)]))
      }
    }
    if depth < 60, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) { for k in kids.reversed() { stack.append((k, depth + 1)) } }
  }
  return ["ok": true, "elements": found.sorted { $0.0 < $1.0 }.prefix(most).map { $0.1 }]
}

/** The display under a point (or `crop` of it, screen points), as a PNG at a pixel a point, without the windows asked
 *  (ours: the overlay, the conversation); ScreenCaptureKit's, macOS 14 on. Answers when it's written. */
func shootDisplay(_ x: Double, _ y: Double, _ exclude: [Int], _ file: String, _ crop: CGRect?, _ done: @escaping ([String: Any]) -> Void) {
  guard #available(macOS 14.0, *) else { return done(["ok": false, "why": "macos"]) }
  SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
    guard let content else { return done(["ok": false, "why": err?.localizedDescription ?? "no screen recording"]) }
    let p = CGPoint(x: x, y: y)
    guard let d = content.displays.first(where: { CGDisplayBounds($0.displayID).contains(p) }) ?? content.displays.first else { return done(["ok": false, "why": "no-display"]) }
    let whole = CGDisplayBounds(d.displayID)
    // (a part of it, kept inside it: the source rect is the display's own points, from its top left)
    var b = whole
    if let c = crop?.intersection(whole), !c.isNull, c.width >= 1, c.height >= 1 { b = c }
    let filter = SCContentFilter(display: d, excludingWindows: content.windows.filter { exclude.contains(Int($0.windowID)) })
    let conf = SCStreamConfiguration()
    if b != whole { conf.sourceRect = CGRect(x: b.minX - whole.minX, y: b.minY - whole.minY, width: b.width, height: b.height) }
    conf.width = Int(b.width); conf.height = Int(b.height); conf.showsCursor = false
    SCScreenshotManager.captureImage(contentFilter: filter, configuration: conf) { img, err in
      guard let img else { return done(["ok": false, "why": err?.localizedDescription ?? "no-image"]) }
      let url = URL(fileURLWithPath: file) as CFURL
      guard let dest = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else { return done(["ok": false, "why": "write"]) }
      CGImageDestinationAddImage(dest, img, nil)
      done(CGImageDestinationFinalize(dest) ? ["ok": true, "file": file, "frame": rectJSON(b)] : ["ok": false, "why": "write"])
    }
  }
}

func handle(_ req: [String: Any]) -> [String: Any] {
  let id = req["window"] as? Int ?? 0
  switch req["op"] as? String {
  case "trusted":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: req["prompt"] as? Bool ?? false] as CFDictionary
    return ["trusted": AXIsProcessTrustedWithOptions(opts)]
  case "fn":
    keysLock.lock(); watching = Set((req["keys"] as? [Int] ?? []).map { Int64($0) }); chords = req["chords"] as? [String] ?? []; keysLock.unlock()
    if !tapThread.isExecuting && !tapThread.isFinished { tapThread.start() }
    return ["ok": true]
  case "ink": inkOn = req["on"] as? Bool ?? false; if !inkOn { inking = false }; return ["ok": true, "ink": filtering]
  case "exchange": exchange = req["on"] as? Bool ?? false; return ["ok": true]
  case "clicks": clicks = req["on"] as? Bool ?? false; return ["ok": true]
  case "windows":
    // (on screen, every layer: what a display's picture would show, by whose; metadata only)
    let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return ["windows": all.map { w -> [String: Any] in var m = appInfo(pid_t(w[kCGWindowOwnerPID as String] as? Int ?? 0)); m["window"] = w[kCGWindowNumber as String] as? Int ?? 0; return m }]
  case "near": return near(req["x"] as? Double ?? 0, req["y"] as? Double ?? 0, req["radius"] as? Double ?? 260, req["max"] as? Int ?? 30)
  case "focus": return focus(keep: req["keep"] as? Bool ?? false)
  case "kept": return keptField(req["do"] as? String ?? "", req["text"] as? String ?? "")
  case "insert": return insert(req["text"] as? String ?? "")
  case "front": lastFront = ""; sayFront(); return ["ok": true]
  case "at": return windowAt(req["x"] as? Double ?? 0, req["y"] as? Double ?? 0)
  case "under": return under(req["x"] as? Double ?? 0, req["y"] as? Double ?? 0)
  case "covered": return covered(req["window"] as? Int ?? 0, req["x"] as? Double ?? 0, req["y"] as? Double ?? 0)
  case "watch": watchWindows(req["windows"] as? [Int] ?? []); return ["ok": true]
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
    // (the display's picture comes when it's written: its answer goes then)
    if req["op"] as? String == "display" {
      let c = req["crop"] as? [String: Double]
      let crop = c.flatMap { c in [c["x"], c["y"], c["width"], c["height"]].allSatisfy { $0 != nil } ? CGRect(x: c["x"]!, y: c["y"]!, width: c["width"]!, height: c["height"]!) : nil }
      shootDisplay(req["x"] as? Double ?? 0, req["y"] as? Double ?? 0, req["exclude"] as? [Int] ?? [], req["file"] as? String ?? "", crop) { r in var res = r; res["id"] = req["id"]; send(res) }
      continue
    }
    DispatchQueue.main.sync {
      var res = handle(req)
      res["id"] = req["id"]
      send(res)
    }
  }
  exit(0)
}.start()
RunLoop.main.run()
