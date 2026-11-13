//   versions scan <file or folder>...   one JSON line per file that has some: {"path", "versions": [{id, at, from}]}
//   versions read <file>                {"versions": [{id, at, from, text}]} (text null when it isn't UTF-8 or is over 5 MB)
//   versions resolve <file> <id>...     {"resolved": n}
import CryptoKit
import Foundation

let skip: Set<String> = [".git", "node_modules", ".Trash", ".DocumentRevisions-V100"]
let maxText = 5 * 1024 * 1024

func fail(_ why: String) -> Never {
  FileHandle.standardError.write((why + "\n").data(using: .utf8)!)
  exit(1)
}

func say(_ o: Any) {
  guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.withoutEscapingSlashes]) else { return }
  FileHandle.standardOutput.write(d)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func idOf(_ v: NSFileVersion) -> String {
  guard let d = try? NSKeyedArchiver.archivedData(withRootObject: v.persistentIdentifier, requiringSecureCoding: false) else { return "" }
  return SHA256.hash(data: d).prefix(8).map { String(format: "%02x", $0) }.joined()
}

func info(_ v: NSFileVersion) -> [String: Any] {
  ["id": idOf(v), "at": Int(((v.modificationDate ?? Date()).timeIntervalSince1970 * 1000).rounded()), "from": v.localizedNameOfSavingComputer ?? ""]
}

func conflicts(_ u: URL) -> [NSFileVersion] {
  NSFileVersion.unresolvedConflictVersionsOfItem(at: u) ?? []
}

let args = CommandLine.arguments.dropFirst()
guard let mode = args.first else { fail("usage: versions scan|read|resolve <path>...") }
let rest = Array(args.dropFirst())
let fm = FileManager.default

switch mode {
case "scan":
  for p in rest {
    let root = URL(fileURLWithPath: p)
    var dir: ObjCBool = false
    guard fm.fileExists(atPath: root.path, isDirectory: &dir) else { continue }
    if !dir.boolValue {
      let vs = conflicts(root)
      if !vs.isEmpty { say(["path": root.path, "versions": vs.map(info)]) }
      continue
    }
    guard let walk = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey]) else { continue }
    for case let u as URL in walk {
      let keys = try? u.resourceValues(forKeys: [.isRegularFileKey, .isDirectoryKey])
      if keys?.isDirectory == true {
        if skip.contains(u.lastPathComponent) { walk.skipDescendants() }
        continue
      }
      guard keys?.isRegularFile == true else { continue }
      let vs = conflicts(u)
      if !vs.isEmpty { say(["path": u.path, "versions": vs.map(info)]) }
    }
  }
case "read":
  guard let p = rest.first else { fail("usage: versions read <file>") }
  let out: [[String: Any]] = conflicts(URL(fileURLWithPath: p)).map { v in
    var o = info(v)
    let size = (try? v.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    if size <= maxText, let d = try? Data(contentsOf: v.url), let s = String(data: d, encoding: .utf8) { o["text"] = s } else { o["text"] = NSNull() }
    return o
  }
  say(["versions": out])
case "resolve":
  guard let p = rest.first else { fail("usage: versions resolve <file> <id>...") }
  let ids = Set(rest.dropFirst())
  let u = URL(fileURLWithPath: p)
  var n = 0
  var err: NSError?
  // Apple asks that a change to a file's versions be coordinated.
  NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: u, options: [], error: &err) { at in
    for v in conflicts(at) where ids.contains(idOf(v)) {
      v.isResolved = true
      n += 1
    }
  }
  if let e = err { fail(e.localizedDescription) }
  // iCloud lists a resolved version for a moment after.
  for _ in 0..<50 where conflicts(u).contains(where: { ids.contains(idOf($0)) }) { Thread.sleep(forTimeInterval: 0.1) }
  say(["resolved": n])
default:
  fail("usage: versions scan|read|resolve <path>...")
}
