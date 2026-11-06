// Dictation across real apps: the real screen helper, throwaway windows of its own, speech from a file (never played).
// It takes the screen a minute, so by hand: VAULTITE_QA_REAL=1 node web/qa/dictation-apps.mjs <vault copy> [video dir]
import { _electron } from "playwright-core"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, VIDEOS], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
if (process.env.VAULTITE_QA_REAL !== "1") await skip("it takes the screen: VAULTITE_QA_REAL=1 runs it")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-apps-"))
const AUDIO = path.join(TMP, "said.wav"), RAW = path.join(TMP, "said.aiff")
execFileSync("say", ["-o", RAW, "Remember to call the plumber about the kitchen sink, and ask whether the part they ordered has come in yet, because the leak is getting worse and the landlord wants it fixed before the weekend."])
execFileSync("afconvert", [RAW, AUDIO, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])

// ---------- its windows: a backdrop, so nothing else of the screen shows, and two fields, each saying its text to a file
const SRC = path.join(TMP, "field.swift"), BIN = path.join(TMP, "Field.app", "Contents", "MacOS")
fs.mkdirSync(BIN, { recursive: true })
fs.writeFileSync(path.join(TMP, "Field.app", "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.qa.field</string><key>CFBundleName</key><string>Field</string><key>CFBundleExecutable</key><string>Field</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`)
fs.writeFileSync(SRC, `import AppKit
let a = CommandLine.arguments, name = a[1], box = NSRect(x: Double(a[2])!, y: Double(a[3])!, width: Double(a[4])!, height: Double(a[5])!), out = a[6]
class D: NSObject, NSApplicationDelegate, NSTextViewDelegate {
  var w: NSWindow!
  func applicationDidFinishLaunching(_ n: Notification) {
    w = NSWindow(contentRect: box, styleMask: [.titled], backing: .buffered, defer: false)
    w.title = name
    let t = NSTextView(frame: w.contentView!.bounds); t.string = name + ":"; t.font = .systemFont(ofSize: 20); t.delegate = self; t.textContainerInset = NSSize(width: 12, height: 12)
    t.isEditable = !out.isEmpty; w.contentView!.addSubview(t); w.makeKeyAndOrderFront(nil); w.makeFirstResponder(t)
    t.setSelectedRange(NSRange(location: t.string.utf16.count, length: 0)); NSApp.activate(ignoringOtherApps: true)
  }
  func textDidChange(_ n: Notification) { try? (n.object as! NSTextView).string.write(toFile: out, atomically: true, encoding: .utf8) }
}
let app = NSApplication.shared; app.setActivationPolicy(.regular)
let bar = NSMenu(), item = NSMenuItem(), edit = NSMenu(title: "Edit"); bar.addItem(item); edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"); item.submenu = edit; app.mainMenu = bar
let d = D(); app.delegate = d; app.run()
`)
execFileSync("swiftc", ["-o", path.join(BIN, "Field"), SRC])
const osa = (s) => execFileSync("osascript", ["-e", s], { encoding: "utf8" }).trim()
const frontWas = osa('tell application "System Events" to get name of first process whose frontmost is true')
const windows = []
const open = async (name, x, y, w, h, editable = true) => { const out = editable ? path.join(TMP, `${name}.txt`) : ""; const p = spawn(path.join(BIN, "Field"), [name, x, y, w, h, out].map(String), { stdio: "ignore" }); windows.push(p); await wait(900); return { p, read: () => { try { return fs.readFileSync(out, "utf8") } catch { return "" } } } }
const toFront = (p) => osa(`tell application "System Events" to set frontmost of (first process whose unix id is ${p.pid}) to true`)
const front = () => osa('tell application "System Events" to get name of first process whose frontmost is true')
const display = JSON.parse(execFileSync("swift", ["-e", 'import AppKit; let f = NSScreen.main!.frame; print("[\\(Int(f.width)),\\(Int(f.height))]")'], { encoding: "utf8" }))

fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "dictation"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "dictation", "data.json"), JSON.stringify({ engine: "apple", language: "en-US" }))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_QA_SCREEN: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
await wait(1500)
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
const tap = async () => { for (const on of [true, false]) { await helper((h, o) => h.heard({ event: "chord", name: "fn_control", on: o }), on); await wait(60) } }
const pill = () => helper((h) => h.scene()?.pill ?? null)
const words = () => until(async () => { await seen(); const p = await pill(); return p && !p.hint && (`${p.text} ${p.pending ?? ""}`).trim().split(" ").length >= 3 }, 30000, 50)
const landed = () => until(async () => { const p = await pill(); return !p || p.hint }, 60000, 100)
const hint = async () => { const p = await pill(); return p?.hint ? p.text : "" }
/** The screen a few seconds, out of sight of no one: only its own windows show. */
const SECS = 30
const film = (name) => { if (!VIDEOS) return null; fs.mkdirSync(VIDEOS, { recursive: true }); const f = path.join(TMP, `${name}.mov`); const p = spawn("screencapture", ["-v", "-x", "-V", String(SECS), f], { stdio: "ignore" }); return { name, f, p, at: Date.now() } }
/** Filmed till now: the recording runs its length, then only that much of it is kept. */
const cut = async (v) => {
  if (!v) return
  const kept = (Date.now() - v.at) / 1000
  await new Promise((r) => (v.p.exitCode === null ? v.p.once("exit", r) : r()))
  if (fs.existsSync(v.f)) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", v.f, "-t", kept.toFixed(1), "-an", "-vf", "scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", path.join(VIDEOS, `${v.name}.mp4`)])
}
// (a scripted copy's windows are see-through, so no test shows; filmed, its overlay is what's shown)
const seen = () => VIDEOS ? app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith("/screen.html")) w.setOpacity(1) }) : null

try {
  const [W, H] = display
  await open("Backdrop", 0, 0, W, H, false)
  const draft = await open("Draft", 110, H - 380, 560, 220), mail = await open("Mail", W - 690, 170, 560, 220)
  toFront(draft.p)
  await wait(500)

  // ---------- begun in one app's field; moved to another's while talking: they land there
  let v = film("dictation-into-the-field-in-front")
  await wait(900)
  await tap()
  check("begun in a field: the words in the box", await words(), await pill())
  await wait(1500)
  toFront(mail.p)
  await landed()
  check("moved to another app's field: its words land there", await until(() => mail.read().split(" ").length > 3, 5000) && !draft.read(), { mail: mail.read().length, draft: draft.read().length })
  check("…joined after what was there", /^Mail: \S/.test(mail.read()), mail.read().slice(0, 12))
  await wait(2800)
  await cut(v)

  // ---------- moved somewhere with no field: they go back where it began, that app left behind
  toFront(draft.p)
  await wait(500)
  v = film("dictation-back-where-it-began")
  await wait(900)
  await tap()
  await words()
  await wait(1500)
  osa('tell application "Finder" to activate')
  await landed()
  check("moved where there's no field: back in the one it began in", await until(() => draft.read().split(" ").length > 3, 5000), draft.read().length)
  check("…and it says so", (await hint()).startsWith("Back in"), await hint())
  check("…the app in front stays in front", front() === "Finder", front())
  await wait(2800)
  await cut(v)

  // ---------- begun in a note in Vaultite's own window, its words inline; another app, the same session in the box; stopped
  // there, they land in that app's field
  fs.writeFileSync(path.join(VAULT, "Trip.md"), "# Trip\n\nTo pack:\n")
  await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Trip.md")}` })
  await win.waitForSelector("[data-pane] .cm-content")
  // (Playwright keeps a page thinking it has focus: off, so its real blur comes)
  const cdp = await win.context().newCDPSession(win)
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false })
  await app.evaluate(({ BaseWindow }, [x, y, w, h]) => {
    const b = BaseWindow.getAllWindows().find((o) => o.webContents && !o.webContents.getURL().includes("/screen.html"))
    // (a scripted copy's window is see-through and never focused: this one is shown, for real)
    delete b.focus; delete b.show
    b.setOpacity(1); b.setIgnoreMouseEvents(false); b.setBounds({ x, y, width: w, height: h }); b.show(); b.focus(); b.webContents.focus()
  }, [110, 90, 640, 520])
  check("the window has the keyboard", await until(() => win.evaluate(() => document.hasFocus()), 5000))
  await win.locator("[data-pane] .cm-line", { hasText: "To pack:" }).click()
  await win.keyboard.press("End")
  const inPage = () => win.evaluate(() => !!document.querySelector(".dictation-pill:not([data-hint])"))
  const noteText = () => win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
  v = film("dictation-from-a-note-to-another-app")
  await wait(900)
  await tap()
  check("in a note: its own session, inline, no box", await until(inPage, 8000) && !(await pill()))
  check("…the words dimmed at the cursor", await until(() => win.evaluate(() => !!document.querySelector(".cm-dictation-pending")?.textContent), 15000, 50))
  await wait(1000)
  const mailWas = mail.read().length
  toFront(mail.p)
  check("another app, its real blur: the same session, in the box", await until(async () => !!(await pill()) && !(await inPage()), 5000), await pill())
  await seen()
  await landed()
  check("…landing in that app's field", await until(() => mail.read().length > mailWas, 5000), mail.read().length - mailWas)
  check("…what settled before it left stayed in the note", !/undefined/.test(await noteText()))
  await wait(2800)
  await cut(v)
  await app.evaluate(({ BaseWindow }) => { const b = BaseWindow.getAllWindows().find((o) => o.webContents && !o.webContents.getURL().includes("/screen.html")); b.setOpacity(0); b.setIgnoreMouseEvents(true) })

  // ---------- that field gone too: the inbox
  toFront(draft.p)
  await wait(500)
  const inbox = () => { const d = path.join(VAULT, "Inbox"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".md")).length : 0 }, was = inbox()
  await tap()
  await words()
  osa('tell application "Finder" to activate')
  draft.p.kill()
  await landed()
  check("its field closed meanwhile: kept in the inbox", await until(() => inbox() === was + 1, 5000), inbox())
} finally {
  for (const p of windows) p.kill()
  await app.close().catch(() => {})
  try { osa(`tell application "${frontWas}" to activate`) } catch { /* it closed */ }
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
