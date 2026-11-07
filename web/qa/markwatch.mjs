// The companion's marks over a real window (electron/markwatch.ts): the real screen helper samples the screen under them,
// a throwaway window of its own changes under them. It takes the screen a minute, so by hand:
// VAULTITE_QA_REAL=1 VAULTITE_QA_LIVE=1 node web/qa/markwatch.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, keepAwake, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the screen helper is a Mac's")
if (process.env.VAULTITE_QA_REAL !== "1") await skip("it takes the screen: VAULTITE_QA_REAL=1 runs it")
keepAwake(240)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-marks-"))

// ---------- its window: a page and a Send button, changed by a line on stdin (page2, move, hide)
const SRC = path.join(TMP, "board.swift"), BIN = path.join(TMP, "Board.app", "Contents", "MacOS")
fs.mkdirSync(BIN, { recursive: true })
fs.writeFileSync(path.join(TMP, "Board.app", "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.qa.board</string><key>CFBundleName</key><string>Board</string><key>CFBundleExecutable</key><string>Board</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`)
fs.writeFileSync(SRC, `import AppKit
let a = CommandLine.arguments, top = NSScreen.screens[0].frame.height
let box = NSRect(x: Double(a[1])!, y: top - Double(a[2])! - Double(a[4])!, width: Double(a[3])!, height: Double(a[4])!)
class D: NSObject, NSApplicationDelegate {
  var w: NSWindow!, page: NSTextField!, send: NSButton!
  func applicationDidFinishLaunching(_ n: Notification) {
    w = NSWindow(contentRect: box, styleMask: [.borderless], backing: .buffered, defer: false)
    w.backgroundColor = .white; w.level = .floating
    page = NSTextField(labelWithString: "Inbox\\nMilk, eggs, bread\\nCall the plumber\\nLighthouse review")
    page.font = .boldSystemFont(ofSize: 28); page.textColor = .black; page.frame = NSRect(x: 20, y: 120, width: box.width - 40, height: 170)
    send = NSButton(title: "Send", target: nil, action: nil); send.isBordered = false; send.wantsLayer = true
    send.layer!.backgroundColor = NSColor.systemBlue.cgColor; send.layer!.cornerRadius = 8
    send.attributedTitle = NSAttributedString(string: "Send", attributes: [.foregroundColor: NSColor.white, .font: NSFont.boldSystemFont(ofSize: 18)])
    send.frame = NSRect(x: 40, y: 40, width: 120, height: 40)
    w.contentView!.addSubview(page); w.contentView!.addSubview(send); w.orderFrontRegardless()
    FileHandle.standardInput.readabilityHandler = { h in
      let s = String(data: h.availableData, encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        for l in s.split(separator: "\\n") {
          if l == "page2" { self.w.backgroundColor = NSColor(white: 0.12, alpha: 1); self.page.textColor = .white; self.page.stringValue = "Settings\\nAccount  Privacy\\nNotifications\\nAbout this Mac" }
          if l == "move" { self.send.frame.origin.y += 80 }
          if l == "hide" { self.send.removeFromSuperview() }
          print("did \\(l)"); fflush(stdout)
        }
      }
    }
    print("ready"); fflush(stdout)
  }
}
let app = NSApplication.shared; app.setActivationPolicy(.accessory)
let d = D(); app.delegate = d; app.run()
`)
execFileSync("swiftc", ["-o", path.join(BIN, "Board"), SRC])
const boards = []
/** A board at x, y (screen points, from the top left), w by h. */
async function board(x, y, w, h) {
  const p = spawn(path.join(BIN, "Board"), [x, y, w, h].map(String), { stdio: ["pipe", "pipe", "ignore"] })
  let out = ""
  p.stdout.on("data", (b) => { out += b })
  boards.push(p)
  await until(() => out.includes("ready"), 10000)
  await wait(400)
  return { p, say: async (l) => { const n = out.length; p.stdin.write(`${l}\n`); await until(() => out.slice(n).includes(`did ${l}`), 3000); await wait(150) } }
}

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_QA_SCREEN: "1", VAULTITE_USER_DATA: process.env.MARKS_USER_DATA ?? path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await until(() => app.windows().find((w) => !w.url().includes("screen.html") && /127\.0\.0\.1/.test(w.url())), 120000, 500)
await win.waitForSelector("[role=tree]", { timeout: 120000 })
const port = new URL(win.url()).port
await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (!w.webContents?.getURL().includes("screen.html")) w.setPosition(-3000, -3000) })
await wait(1500)
const op = (name, body) => fetch(`http://127.0.0.1:${port}/api/ops/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
/** The companion's layer up now: its marks' ids and boxes. */
const layer = () => app.evaluate(() => globalThis.vaultiteHelper?.layers?.() ?? null)
const watched = () => app.evaluate(() => globalThis.vaultiteHelper?.watched?.().map((a) => `${a.mark}${a.on ? " on " + a.on.anchor.label : ""}`) ?? null)
const marks = async () => (await layer())?.flatMap((d) => d.marks.filter((m) => !m.gone).map((m) => m.id)) ?? []
const draw = (ms) => op("companion.draw", { as: "Claude", marks: ms })

// ---------- a ring that lives till the screen changes, round part of a page: the page changes, it fades
{
  const b = await board(200, 160, 520, 320)
  const r = await draw([{ type: "ring", id: "page", life: "screen", at: [220, 180, 400, 160] }])
  check("a ring that lives till the screen changes is drawn", !!r && (await until(async () => (await marks()).includes("page"), 4000)), r)
  console.log("watched", await watched())
  await wait(2500)
  check("…and stays while the page under it holds still", (await marks()).includes("page"), await marks())
  await b.say("page2")
  check("…the page under it changes: it fades", await until(async () => !(await marks()).includes("page"), 5000), await layer())
  await op("companion.clear", { as: "Claude" })
  b.p.kill()
}
// ---------- the page changes as soon as it's drawn (the ask's own click lands): it still fades
{
  const b = await board(200, 160, 520, 320)
  await draw([{ type: "ring", id: "soon", life: "screen", at: [220, 180, 400, 160] }])
  await wait(300)
  await b.say("page2")
  check("a page that changes just as the ring comes: it fades too", await until(async () => !(await marks()).includes("soon"), 6000), await layer())
  await op("companion.clear", { as: "Claude" })
  b.p.kill()
}
// ---------- a window comes over a ring: it fades
{
  const b = await board(200, 160, 520, 320)
  await draw([{ type: "ring", id: "under", life: "screen", at: [220, 180, 400, 160] }])
  await wait(2500)
  const cover = await board(150, 120, 640, 420)
  await cover.say("page2")
  check("a window over a ring's page: it fades", await until(async () => !(await marks()).includes("under"), 6000), await layer())
  await op("companion.clear", { as: "Claude" })
  cover.p.kill(); b.p.kill()
}
// ---------- a ring on a thing whose words change in place (the page's text the last ask found): it fades
{
  const b = await board(200, 160, 520, 320)
  const near = await app.evaluate((_e) => globalThis.vaultiteHelper.near(400, 260))
  const text = near.find((t) => /Inbox/.test(t.label)) ?? near.find((t) => t.frame.width > 300 && t.frame.height > 100)
  check("the last ask found the page's text", !!text, near.map((t) => `${t.role} ${t.label} ${JSON.stringify(t.frame)}`))
  const f = text?.frame ?? { x: 220, y: 200, width: 480, height: 170 }
  await draw([{ type: "ring", id: "text", life: "screen", at: [f.x, f.y, f.width, f.height] }])
  await until(async () => (await marks()).includes("text"), 4000)
  console.log("watched", await watched())
  await wait(1500)
  await b.say("page2")
  check("a ring on a thing whose page changed under it, the thing still there: it fades", await until(async () => !(await marks()).includes("text"), 6000), await layer())
  await op("companion.clear", { as: "Claude" })
  b.p.kill()
}
// ---------- a ring on a thing (the Send button the last ask found): it moves, the ring follows; it goes, the ring fades
{
  const b = await board(200, 160, 520, 320)
  const near = await app.evaluate((_e) => globalThis.vaultiteHelper.near(300, 420))
  const send = near.find((t) => t.label === "Send")
  check("the last ask found the button", !!send, near.map((t) => `${t.role} ${t.label}`))
  const f = send?.frame ?? { x: 240, y: 400, width: 120, height: 40 }
  await draw([{ type: "ring", id: "send", at: [f.x, f.y, f.width, f.height] }])
  await until(async () => (await marks()).includes("send"), 4000)
  console.log("watched", await watched())
  await wait(1500)
  const y0 = (await layer())?.[0]?.marks.find((m) => m.id === "send")?.at
  await b.say("move")
  const followed = await until(async () => { const at = (await layer())?.[0]?.marks.find((m) => m.id === "send")?.at; return at && JSON.stringify(at) !== JSON.stringify(y0) ? at : null }, 6000)
  check("its thing moves: the ring follows it", !!followed && (await marks()).includes("send"), { y0, followed, layer: await layer() })
  await wait(2500)
  check("…and stays on it once it's there", (await marks()).includes("send"), await layer())
  await b.say("hide")
  check("its thing goes: the ring fades", await until(async () => !(await marks()).includes("send"), 6000), await layer())
  await op("companion.clear", { as: "Claude" })
  b.p.kill()
}
await app.close()
for (const p of boards) p.kill()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
