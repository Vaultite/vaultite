// App windows' helper (electron/apps.ts): moves other apps' windows with the Accessibility API. JSON lines in and out;
// stdin closing (the app quit or crashed) gives every window back.
import AppKit
import ApplicationServices

/** A window's number (CGWindowID): the one private call, as AeroSpace makes; the Accessibility API has no ids. */
@_silgen_name("_AXUIElementGetWindow") func axWindowID(_ el: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError
func wid(_ w: AXUIElement) -> Int? { var id: CGWindowID = 0; return axWindowID(w, &id) == .success && id != 0 ? Int(id) : nil }

/** A window taken for a tab: where it was before, to give it back there; `made`: asked of the app for the tab (none was
 *  free), so closing the tab closes it rather than leaving an empty window behind. */
struct Held { let pid: pid_t; let bundle: String; let win: AXUIElement; let original: CGRect; let made: Bool }
var held: [Int: Held] = [:]
/** Held windows on another desktop (Space) than the one shown, as last told. */
var away = Set<Int>()
/** Apps' icons as PNG data URLs, drawn once. */
var icons: [String: String] = [:]
/** Per app with a window held: its observer (windows made, closed, retitled). */
var observers: [pid_t: AXObserver] = [:]
/** Apps being given a window by `adopt` (opened, or asked for one), how many times at once: the window that comes isn't
 *  news. */
var adopting: [String: Int] = [:]
/** Vaultite itself (the helper's parent): never offered nor taken, as its own window would chase itself behind itself. */
let vaultite = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier
// An app that's hung answers no AX call: 2 s each, not macOS's 6, as every request waits behind them.
_ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 2)

func send(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func attr<T>(_ el: AXUIElement, _ name: String) -> T? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success else { return nil }
  return v as? T
}
func frame(_ w: AXUIElement) -> CGRect {
  var p = CGPoint.zero, s = CGSize.zero
  if let v: AXValue = attr(w, kAXPositionAttribute) { AXValueGetValue(v, .cgPoint, &p) }
  if let v: AXValue = attr(w, kAXSizeAttribute) { AXValueGetValue(v, .cgSize, &s) }
  return CGRect(origin: p, size: s)
}
func title(_ w: AXUIElement) -> String { attr(w, kAXTitleAttribute) ?? "" }
func setPos(_ w: AXUIElement, _ p: CGPoint) { var p = p; AXUIElementSetAttributeValue(w, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &p)!) }
func setSize(_ w: AXUIElement, _ s: CGSize) { var s = s; AXUIElementSetAttributeValue(w, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &s)!) }
/** Moved, sized, moved again (a window at the screen's edge can't grow until moved), with AXEnhancedUserInterface off
 *  meanwhile, as Rectangle does: on, some apps animate every change. */
func setFrame(_ pid: pid_t, _ w: AXUIElement, _ r: CGRect) {
  let app = AXUIElementCreateApplication(pid)
  let enhanced: Bool = attr(app, "AXEnhancedUserInterface") ?? false
  if enhanced { AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
  setPos(w, r.origin); setSize(w, r.size); setPos(w, r.origin)
  if enhanced { AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) }
}
func rect(_ x: Any?) -> CGRect? {
  guard let d = x as? [String: Any], let x = d["x"] as? Double, let y = d["y"] as? Double,
        let w = d["width"] as? Double, let h = d["height"] as? Double else { return nil }
  return CGRect(x: x, y: y, width: w, height: h)
}
func rectJSON(_ r: CGRect) -> [String: Any] { ["x": r.minX, "y": r.minY, "width": r.width, "height": r.height] }

func running(_ bundle: String) -> NSRunningApplication? {
  NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first { !$0.isTerminated }
}
/** Its window server level: 0 is an app's ordinary windows; floating ones (picture in picture, panels) are above. */
func level(_ id: Int) -> Int? {
  let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(id)) as? [[String: Any]]
  return info?.first?[kCGWindowLayer as String] as? Int
}
/** The app's windows at the ordinary level on every desktop, by number (the Accessibility API sees only this one's). */
func everywhere(_ pid: pid_t) -> Set<Int> {
  let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
  return Set(all.compactMap { w in
    (w[kCGWindowOwnerPID as String] as? pid_t) == pid && (w[kCGWindowLayer as String] as? Int) == 0 ? w[kCGWindowNumber as String] as? Int : nil
  })
}
/** A window a tab can hold: a standard one at the ordinary level. Picture in picture says it's standard too, but floats
 *  and isn't in its app's windows. */
func ordinary(_ w: AXUIElement) -> Bool {
  (attr(w, kAXSubroleAttribute) as String?) == (kAXStandardWindowSubrole as String) && wid(w).flatMap(level) == 0
}
/** The app's ordinary windows (on the current Space: all the Accessibility API sees), its main one first. */
func windows(_ pid: pid_t) -> [AXUIElement] {
  let app = AXUIElementCreateApplication(pid)
  let all = ((attr(app, kAXWindowsAttribute) as [AXUIElement]?) ?? []).filter(ordinary)
  guard let main: AXUIElement = attr(app, kAXMainWindowAttribute) else { return all }
  return all.filter { CFEqual($0, main) } + all.filter { !CFEqual($0, main) }
}

/** Installed apps (the Applications folders, a level down too: Utilities), for the picker. */
func installed() -> [[String: Any]] {
  let fm = FileManager.default
  var dirs = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities"]
  dirs.append((NSHomeDirectory() as NSString).appendingPathComponent("Applications"))
  var seen = Set<String>(), out: [[String: Any]] = []
  for d in dirs {
    for name in (try? fm.contentsOfDirectory(atPath: d)) ?? [] where name.hasSuffix(".app") {
      let path = (d as NSString).appendingPathComponent(name)
      guard let b = Bundle(path: path)?.bundleIdentifier, b != vaultite, !seen.contains(b) else { continue }
      seen.insert(b)
      out.append(["bundle": b, "name": String(name.dropLast(4)), "path": path])
    }
  }
  return out
}

/** An app's icon, 64 px, for its tabs and the picker. */
func icon(_ bundle: String) -> String? {
  if let s = icons[bundle] { return s }
  guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle),
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSWorkspace.shared.icon(forFile: url.path).draw(in: NSRect(x: 0, y: 0, width: 64, height: 64))
  NSGraphicsContext.restoreGraphicsState()
  guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
  icons[bundle] = "data:image/png;base64," + png.base64EncodedString()
  return icons[bundle]
}

func gone(_ id: Int) {
  away.remove(id)
  guard held.removeValue(forKey: id) != nil else { return }
  send(["event": "gone", "wid": id])
}

/** Whether a held window is on the desktop shown (the Accessibility API lists only those). */
func here(_ h: Held) -> Bool { windows(h.pid).contains { CFEqual($0, h.win) } }
/** Tell which held windows left the desktop shown or came back (another desktop chosen, or the window moved to one). */
func checkSpaces() {
  for (id, h) in held {
    let off = !here(h)
    guard off != away.contains(id) else { continue }
    if off { away.insert(id) } else { away.remove(id) }
    send(["event": "here", "wid": id, "here": !off])
  }
}

let observerCallback: AXObserverCallback = { _, el, note, _ in
  let n = note as String
  if n == kAXUIElementDestroyedNotification as String {
    // (a destroyed element has no number any more: whichever held window no longer answers)
    for (id, h) in held where (attr(h.win, kAXRoleAttribute) as String?) == nil { gone(id) }
  } else if n == kAXTitleChangedNotification as String, let id = wid(el), held[id] != nil {
    send(["event": "title", "wid": id, "title": title(el)])
  } else if n == kAXFocusedWindowChangedNotification as String {
    var pid: pid_t = 0
    AXUIElementGetPid(el, &pid)
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { front(pid) }
  } else if n == kAXWindowCreatedNotification as String, let id = wid(el), held[id] == nil {
    var pid: pid_t = 0
    AXUIElementGetPid(el, &pid)
    guard let b = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier, adopting[b] == nil else { return }
    // News only of a window `adopt` would take (one of the app's ordinary windows here), once it's listed
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      guard held[id] == nil, windows(pid).contains(where: { wid($0) == id }) else { return }
      send(["event": "window", "bundle": b, "wid": id, "title": title(el)])
    }
  }
}
/** An app came in front (a link opened in it, ⌘Tab, its Dock icon) or one with a window held chose another of its
 *  windows: news of its focused window, so a tab that has it is shown (one not shown since the app opened holds none). */
func front(_ pid: pid_t) {
  guard let w: AXUIElement = attr(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute), let id = wid(w) else { return }
  send(["event": "front", "wid": id])
}
/** Hear about the app's windows: made (a new one: maybe a new tab), focused, retitled, closed. */
func observe(_ pid: pid_t, _ win: AXUIElement) {
  if observers[pid] == nil {
    var obs: AXObserver?
    guard AXObserverCreate(pid, observerCallback, &obs) == .success, let obs else { return }
    for n in [kAXWindowCreatedNotification, kAXFocusedWindowChangedNotification] { AXObserverAddNotification(obs, AXUIElementCreateApplication(pid), n as CFString, nil) }
    CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
    observers[pid] = obs
  }
  for n in [kAXUIElementDestroyedNotification, kAXTitleChangedNotification] { AXObserverAddNotification(observers[pid]!, win, n as CFString, nil) }
}

/** Take a window of the app: `want` if it's still there, else one not held (opening the app, or asking it for a window,
 *  when there's none), remembering where it was. */
func adopt(_ bundle: String, want: Int?, launch: Bool) async -> [String: Any] {
  if bundle == vaultite { return ["ok": false, "why": "self"] }
  if let want, let h = held[want], h.bundle == bundle, (attr(h.win, kAXRoleAttribute) as String?) != nil {
    return ["ok": true, "wid": want, "title": title(h.win)]
  }
  adopting[bundle, default: 0] += 1
  defer { adopting[bundle]! -= 1; if adopting[bundle] == 0 { adopting[bundle] = nil } }
  var app = running(bundle)
  let launched = app == nil
  let cfg = NSWorkspace.OpenConfiguration()
  cfg.activates = false
  if app == nil {
    guard launch, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) else { return ["ok": false, "why": "missing"] }
    app = try? await NSWorkspace.shared.openApplication(at: url, configuration: cfg)
  }
  guard let app else { return ["ok": false, "why": "missing"] }
  let pick = { () -> AXUIElement? in
    let ws = windows(app.processIdentifier)
    return ws.first { wid($0) == want } ?? ws.first { w in wid(w).map { held[$0] == nil } ?? false }
  }
  var w = pick()
  // Its window is on another desktop: left there (asking the app for one would make an empty window each time)
  if let want, w.map({ wid($0) != want }) ?? true, everywhere(app.processIdentifier).contains(want), !launched {
    return ["ok": false, "why": "space"]
  }
  // None free: reopened as the Dock does (an app with its windows closed makes one)
  let before = w == nil ? everywhere(app.processIdentifier) : []
  if w == nil, let url = app.bundleURL { _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: cfg) }
  // (a running app makes its window within a second; one just launched may take a while to show its first)
  for _ in 0..<(launched ? 75 : 15) where w == nil {
    try? await Task.sleep(nanoseconds: 200_000_000)
    w = pick()
  }
  guard let win = w, let id = wid(win) else { return ["ok": false, "why": "window"] }
  if (attr(win, kAXMinimizedAttribute) as Bool?) == true { AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanFalse) }
  if app.isHidden { app.unhide() }
  // (made for the tab only if it wasn't there before it was asked for: never one of the user's windows)
  held[id] = Held(pid: app.processIdentifier, bundle: bundle, win: win, original: frame(win), made: !before.isEmpty && !before.contains(id))
  observe(app.processIdentifier, win)
  return ["ok": true, "wid": id, "title": title(win)]
}

/** Over `to`; an app that won't be that small is kept inside the host window (`bound`), under its other parts. */
func place(_ id: Int, _ to: CGRect, _ bound: CGRect?) -> [String: Any] {
  guard let h = held[id] else { return ["ok": false, "why": "window"] }
  // (on another desktop: left there; macOS has no call to bring another app's window over)
  guard here(h) else { away.insert(id); return ["ok": true, "here": false] }
  away.remove(id)
  // (already there, as a tab shown again finds it: not moved, which some apps answer by laying out again)
  var got = frame(h.win)
  if abs(got.minX - to.minX) >= 0.5 || abs(got.minY - to.minY) >= 0.5 || abs(got.width - to.width) >= 0.5 || abs(got.height - to.height) >= 0.5 {
    setFrame(h.pid, h.win, to)
    got = frame(h.win)
  }
  if let b = bound, got.width > to.width + 1 || got.height > to.height + 1 {
    let x = max(b.minX, min(to.minX, b.maxX - got.width)), y = max(b.minY, min(to.minY, b.maxY - got.height))
    setPos(h.win, CGPoint(x: x, y: y))
    got = frame(h.win)
  }
  return ["ok": true, "frame": rectJSON(got)]
}

/** Out of sight, as AeroSpace hides windows: the main screen's bottom right corner (macOS keeps a pixel on screen). */
func park(_ id: Int) {
  guard let h = held[id], let screen = NSScreen.screens.first?.frame else { return }
  setPos(h.win, CGPoint(x: screen.maxX - 1, y: screen.maxY - 1))
}

/** Given back where it was; one made for the tab is closed instead, unless it's to be kept (the tab stays: its vault
 *  window closed, the app quit, or it took one on this desktop). */
func release(_ id: Int, keep: Bool) {
  guard let h = held.removeValue(forKey: id) else { return }
  away.remove(id)
  setFrame(h.pid, h.win, h.original)
  if h.made && !keep { _ = close(h.win) }
}
/** As its close button does: the app may ask first (unsaved changes), the window back where it was. */
func close(_ w: AXUIElement) -> Bool {
  guard let button: AXUIElement = attr(w, kAXCloseButtonAttribute) else { return false }
  return AXUIElementPerformAction(button, kAXPressAction as CFString) == .success
}

func handle(_ req: [String: Any]) async -> [String: Any] {
  let bundle = req["bundle"] as? String ?? "", id = req["wid"] as? Int ?? 0
  switch req["op"] as? String ?? "" {
  case "trusted":
    let prompt = req["prompt"] as? Bool ?? false
    return ["trusted": AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary)]
  case "apps":
    let open = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular && $0.bundleIdentifier != nil && $0.bundleIdentifier != vaultite }
    let trusted = AXIsProcessTrusted()
    return ["installed": installed(), "running": open.map { a -> [String: Any] in
      let ws = trusted ? windows(a.processIdentifier).compactMap { w in wid(w).map { ["wid": $0, "title": title(w)] as [String: Any] } } : []
      return ["bundle": a.bundleIdentifier!, "name": a.localizedName ?? a.bundleIdentifier!, "pid": a.processIdentifier, "windows": ws]
    }]
  case "adopt":
    guard AXIsProcessTrusted() else { return ["ok": false, "why": "trust"] }
    return await adopt(bundle, want: id == 0 ? nil : id, launch: req["launch"] as? Bool ?? true)
  case "place":
    guard let to = rect(req["rect"]) else { return ["ok": false, "why": "rect"] }
    return place(id, to, rect(req["bound"]))
  case "front": return ["bundle": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""]
  case "park": park(id); return ["ok": true]
  case "raise":
    if let h = held[id], here(h) { AXUIElementPerformAction(h.win, kAXRaiseAction as CFString) }
    return ["ok": true]
  case "focus":
    // (on another desktop only when asked: activating the app would take the user there)
    guard let h = held[id] else {
      if req["go"] as? Bool == true, let app = running(bundle) { app.activate() }
      return ["ok": false]
    }
    guard req["go"] as? Bool == true || here(h) else { return ["ok": false, "why": "space"] }
    NSRunningApplication(processIdentifier: h.pid)?.activate()
    AXUIElementPerformAction(h.win, kAXRaiseAction as CFString)
    return ["ok": true]
  case "release": release(id, keep: req["keep"] as? Bool ?? false); return ["ok": true]
  case "close":
    guard let h = held[id] else { return ["ok": false] }
    release(id, keep: true)
    return ["ok": close(h.win)]
  case "icons":
    var out: [String: String] = [:]
    for b in req["bundles"] as? [String] ?? [] { out[b] = icon(b) ?? "" }
    return ["icons": out]
  default: return ["error": "unknown op"]
  }
}

NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { n in
  guard let a = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
  observers.removeValue(forKey: a.processIdentifier)
  for (id, h) in held where h.pid == a.processIdentifier { gone(id) }
}
NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { n in
  guard let a = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication, a.bundleIdentifier != vaultite else { return }
  front(a.processIdentifier)
}
NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { checkSpaces() }
}
// (and now and then: a window dragged to another desktop in Mission Control says nothing)
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in checkSpaces() }
// Requests are read off the main thread and handled on it, one at a time, in order; but `adopt`, which may wait seconds
// for a window to come, lets the others (other tabs' windows) go on meanwhile. All are finished before it exits.
Thread {
  let pending = DispatchGroup()
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
    let done = DispatchSemaphore(value: 0)
    pending.enter()
    Task { @MainActor in
      var res = await handle(req)
      res["id"] = req["id"]
      send(res)
      done.signal()
      pending.leave()
    }
    if req["op"] as? String != "adopt" { done.wait() }
  }
  pending.wait()
  DispatchQueue.main.async {
    for id in Array(held.keys) { release(id, keep: true) }
    exit(0)
  }
}.start()
RunLoop.main.run()
