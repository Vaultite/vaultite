// The helper's cursor (electron/helper.ts draw) in plain Node, Electron and the native parts stood in: one cursor between
// the window and the screen. tools/test/vault/helper.ts runs it: node --experimental-test-module-mocks tools/test/helperdraw.ts
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { mock } from "node:test"
import { pathToFileURL } from "node:url"
import { WebSocketServer, type WebSocket } from "ws"

const ROOT = path.resolve(import.meta.dirname, "../..")
const at = (f: string) => pathToFileURL(path.join(ROOT, "electron", f)).href
type Pt = { x: number; y: number }
type Item = { name: string; sx: number; sy: number; from?: Pt; leaving?: boolean; docked?: boolean }
type Scene = { agents: Item[]; idle: Item | null }
const scenes: Scene[] = []
const display = { id: 1, bounds: { x: 0, y: 0, width: 1600, height: 1000 }, workArea: { x: 0, y: 25, width: 1600, height: 975 } }
mock.module(pathToFileURL(fs.realpathSync(path.join(ROOT, "node_modules/electron/index.js"))).href, { exports: {
  app: { on() {}, getName: () => "Vaultite", getPath: () => os.tmpdir(), getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {}, isPackaged: false },
  Menu: { buildFromTemplate() {} }, Notification: class { static isSupported() { return false } }, nativeImage: {}, shell: {}, Tray: class {},
  screen: { getCursorScreenPoint: () => ({ x: 500, y: 500 }), getDisplayMatching: () => display, getDisplayNearestPoint: () => display, getAllDisplays: () => [display] },
} })
mock.module(at("overlay.ts"), { exports: { showOverlay: (_b: string, s?: Scene) => { if (s) scenes.push(JSON.parse(JSON.stringify(s))) }, overlayActs() {} } })
mock.module(at("screen.ts"), { exports: { onScreenEvent() {}, screenAsk: async () => ({}), startScreen: async () => {}, stopScreen() {}, windowShot: async () => null, regionShot: async () => null,
  fnUsage: async () => null, dictationAuto: async () => null, dictationHotKey: async () => null } })
mock.module(at("dictation.ts"), { exports: { dictate: async () => ({ ok: true }), dictating: () => false, stopFor() {}, dictationEngines: async () => ({}) } })

// (the server: settings, and the companion's socket)
let agent: Record<string, unknown> = { name: "Claude", tint: "orange", state: "watching", t: Date.now(), path: "Notes/A.md", line: 3 }
let sock: WebSocket | null = null
const srv = http.createServer((_q, res) => { res.setHeader("Content-Type", "application/json"); res.end("{}") })
const wss = new WebSocketServer({ noServer: true })
srv.on("upgrade", (req, s, h) => wss.handleUpgrade(req, s, h, (ws) => { sock = ws; ws.send(JSON.stringify({ t: "state", mode: "pair", name: "Claude", agents: [agent], notes: [] })) }))
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
const port = (srv.address() as { port: number }).port
const setAgent = (a: Record<string, unknown>) => {
  agent = Object.fromEntries(Object.entries({ ...agent, ...a }).filter(([, v]) => v !== undefined))
  sock!.send(JSON.stringify({ t: "agent", agent }))
}

// (the vault's window at 100, 50 on screen, its cursor drawn at 200, 300 in it, going to 400, 300: the arrow's box is 3, 2 off)
let windowShown = true
const homeWindow = () => windowShown
  ? { page: { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => [["Claude", 197, 298, 397, 298]] }, bounds: { x: 100, y: 50, width: 1200, height: 800 }, zoom: 1 }
  : null
process.env.VAULTITE_QUIET = "1"
const helper = await import(at("helper.ts"))
await helper.startHelper({ home: () => ({ port, path: "/vault", name: "Vault" }), homeWindow, openHome() {}, focusedPage: () => null, event() {}, prefs: () => ({}), setPrefs() {}, quit() {}, icon: "" })
const H = (globalThis as unknown as { vaultiteHelper: { heard: (m: object) => void; stub: (op: string, v: object) => void; scene: () => Scene | null } }).vaultiteHelper

let fails = 0
const check = (name: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(info)}`}`) }
async function until(fn: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return fn()
}
const claude = () => scenes.map((s) => s.agents.find((a) => a.name === "Claude")).filter((a): a is Item => !!a)
const idles = () => scenes.map((s) => s.idle).filter((i): i is Item => !!i)
const front = (vaultite: boolean) => H.heard({ event: "front", bundle: vaultite ? "app.vaultite" : "com.example.mail", name: "x", title: "t", window: 5, vaultite })

await until(() => !!sock)
front(true)
await until(() => scenes.length > 0)
check("helper draw: in a note, Vaultite in front: nothing on screen", !H.scene()!.agents.length && !H.scene()!.idle, H.scene())

scenes.length = 0
setAgent({ path: undefined, line: undefined, sx: 800, sy: 500 })
await until(() => claude().length > 0)
check("helper draw: its place going out to another app, it comes from where the window drew it, never first elsewhere",
  claude()[0]?.from?.x === 300 && claude()[0]?.from?.y === 350 && claude()[0]?.sx === 800, claude().slice(0, 2))

scenes.length = 0
setAgent({ sx: undefined, sy: undefined, path: "Notes/A.md", line: 9 })
await until(() => claude().some((a) => a.sx === 500))
check("helper draw: back into a note, it glides to where the window draws it, fading", claude().length > 0 && claude().every((a) => a.leaving) && claude().at(-1)?.sy === 350, claude())
check("helper draw: then it's gone from the screen", await until(() => !H.scene()!.agents.length), H.scene())

scenes.length = 0
front(false)
await until(() => idles().length > 0)
check("helper draw: they go to another app: the companion waiting comes out of the window's cursor", idles()[0]?.from?.x === 300 && idles()[0]?.docked === true, idles()[0])
scenes.length = 0
front(true)
await until(() => idles().some((i) => i.sx === 500))
check("helper draw: back in Vaultite, the waiting one glides into the window's cursor, fading", idles().every((i) => i.leaving), idles())
check("helper draw: then it's gone", await until(() => !H.scene()!.idle), H.scene())

front(false)
await until(() => !!H.scene()!.idle && !H.scene()!.idle!.from)
const dot = H.scene()!.idle!
scenes.length = 0
setAgent({ path: undefined, line: undefined, sx: 900, sy: 600 })
await until(() => claude().length > 0)
const first = scenes.find((s) => s.agents.length)!
check("helper draw: waiting, then pointing at a point: one cursor, coming from the waiting one", first.agents[0].from?.x === dot.sx && !first.idle, { dot, first })
scenes.length = 0
setAgent({ sx: undefined, sy: undefined, path: "Notes/A.md" })
await until(() => idles().length > 0)
const back = scenes.find((s) => s.idle)!
check("helper draw: pointing, then back in a note while they're elsewhere: the waiting one comes from the cursor, which goes at once",
  back.idle!.from?.x === 900 && !back.agents.length, back)

await until(() => !H.scene()!.idle!.from)
const dot2 = H.scene()!.idle!
H.stub("window", { window: 9, bundle: "com.example.mail", name: "Mail", title: "Inbox", frame: { x: 200, y: 100, width: 800, height: 600 } })
scenes.length = 0
setAgent({ path: undefined, app: "com.example.mail" })
await until(() => claude().some((a) => a.sx === 600))
check("helper draw: waiting, then an app's window found a moment later: first where it waited, then by the window's title bar",
  claude()[0]?.sx === dot2.sx && claude().at(-1)?.sy === 112, { dot2, seen: claude() })
H.heard({ event: "moved", window: 9, frame: { x: 300, y: 150, width: 800, height: 600 } })
check("helper draw: that window dragged, the cursor follows it at once", H.scene()!.agents[0]?.sx === 700 && H.scene()!.agents[0]?.sy === 162, H.scene()!.agents[0])

front(true)
setAgent({ app: undefined, path: "Notes/A.md" })
await until(() => !H.scene()!.agents.length)
windowShown = false
scenes.length = 0
setAgent({ path: undefined, sx: 50, sy: 60 })
await until(() => claude().length > 0)
check("helper draw: with no window on screen, it appears where it is at once", claude()[0]?.sx === 50 && !claude()[0]?.from, claude()[0])

helper.stopHelper()
srv.close()
process.exit(fails ? 1 : 0)
