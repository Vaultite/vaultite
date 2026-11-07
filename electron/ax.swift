// What screen.swift and takeover.swift share (compiled into each, swiftbuild.ts): JSON lines out, Accessibility reads,
// and an element's words: one naming, so what the screen helper lists, take-over finds again by those words.
import AppKit
import ApplicationServices

/** A window's number (CGWindowID): the one private call, as AeroSpace makes; the Accessibility API has no ids. */
@_silgen_name("_AXUIElementGetWindow") func axWindowID(_ el: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError
func wid(_ w: AXUIElement) -> Int? { var id: CGWindowID = 0; return axWindowID(w, &id) == .success && id != 0 ? Int(id) : nil }

/** Vaultite's main process (the helper's parent): its windows (the vault's, the overlay) are never another app's. */
let vaultitePid = getppid()

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
func actionNames(_ el: AXUIElement) -> [String] { var a: CFArray?; return AXUIElementCopyActionNames(el, &a) == .success ? (a as? [String] ?? []) : [] }
func settable(_ el: AXUIElement, _ name: String) -> Bool { var b: DarwinBoolean = false; return AXUIElementIsAttributeSettable(el, name as CFString, &b) == .success && b.boolValue }
func secure(_ el: AXUIElement) -> Bool { (attr(el, kAXSubroleAttribute) as String?) == "AXSecureTextField" }
func roleOf(_ el: AXUIElement) -> String { attr(el, kAXRoleDescriptionAttribute) as String? ?? attr(el, kAXRoleAttribute) as String? ?? "" }

/** Chromium and Electron build their tree only when asked (AXManualAccessibility), as VoiceOver's apps do. */
var awoken = Set<pid_t>()
func wake(_ pid: pid_t) {
  if awoken.contains(pid) { return }
  awoken.insert(pid)
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXManualAccessibility" as CFString, kCFBooleanTrue)
}
/** An app's AX window with number `id`. */
func axWindow(_ pid: pid_t, _ id: Int) -> AXUIElement? {
  wake(pid)
  let ws: [AXUIElement] = attr(AXUIElementCreateApplication(pid), kAXWindowsAttribute) ?? []
  return ws.first { wid($0) == id }
}

/** The first words a text inside `el` says, `depth` levels down at most. */
func innerText(_ el: AXUIElement, _ depth: Int) -> String {
  guard depth > 0, let kids: [AXUIElement] = attr(el, kAXChildrenAttribute) else { return "" }
  for k in kids.prefix(8) {
    if (attr(k, kAXRoleAttribute) as String?) == "AXStaticText", let v: String = attr(k, kAXValueAttribute) ?? attr(k, kAXTitleAttribute), !v.trimmingCharacters(in: .whitespaces).isEmpty { return String(v.prefix(120)) }
    let t = innerText(k, depth - 1)
    if !t.isEmpty { return t }
  }
  return ""
}
/** An element's words: its title, description, value, help or placeholder; a row or cell says them in a text inside it
 *  (named by them, so the row is what's found and selected). */
func label(_ el: AXUIElement, role: String? = nil) -> String {
  for k in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXHelpAttribute, kAXPlaceholderValueAttribute] {
    if let v: String = attr(el, k), !v.trimmingCharacters(in: .whitespaces).isEmpty { return String(v.prefix(120)) }
  }
  return ["AXRow", "AXCell"].contains(role ?? attr(el, kAXRoleAttribute) as String? ?? "") ? innerText(el, 3) : ""
}
