// A real trackpad pinch for web/qa/pinch.mjs: the window server's own gesture events (kCGSEventGesture with the magnify
// subtype: the private fields tools like BetterTouchTool post), at a point of the screen, as macOS routes them.
//   pinch <x> <y> <scale> [--rest]   (--rest: the pointer stays where it is, no move first)
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 4, let x = Double(args[1]), let y = Double(args[2]), let scale = Double(args[3]), scale > 0 else {
  FileHandle.standardError.write("pinch <x> <y> <scale> [--rest]\n".data(using: .utf8)!)
  exit(2)
}
let at = CGPoint(x: x, y: y), steps = 24

let gesture = CGEventType(rawValue: 29)!
let hidType = CGEventField(rawValue: 110)!, zoom = CGEventField(rawValue: 113)!, phase = CGEventField(rawValue: 132)!
// IOHIDEventType's zoom, and a gesture's start and end; CGSGesturePhase's began, changed and ended
let kZoom: Int64 = 8, kStarted: Int64 = 61, kEnded: Int64 = 62
let began: Int64 = 1, changed: Int64 = 2, ended: Int64 = 4

func post(_ hid: Int64, _ by: Double = 0, _ p: Int64 = 0) {
  let e = CGEvent(source: nil)!
  e.type = gesture
  e.location = at
  e.setIntegerValueField(hidType, value: hid)
  if hid == kZoom { e.setDoubleValueField(zoom, value: by); e.setIntegerValueField(phase, value: p) }
  e.post(tap: .cghidEventTap)
}

if !args.contains("--rest") {
  CGWarpMouseCursorPosition(at)
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: at, mouseButton: .left)?.post(tap: .cghidEventTap)
  usleep(150_000)
}
// (each step the same factor, as fingers moving evenly: a magnification m makes the scale 1 + m times what it was)
let per = pow(scale, 1.0 / Double(steps)) - 1
post(kStarted)
post(kZoom, 0, began)
usleep(12_000)
for _ in 0..<steps { post(kZoom, per, changed); usleep(12_000) }
post(kZoom, 0, ended)
post(kEnded)
