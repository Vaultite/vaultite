// The helper over the screen (electron/helper.ts) in plain Node, Electron and the native parts stood in: the companion
// summoned, one cursor between window and screen, nothing at rest. node --experimental-test-module-mocks tools/test/helperdraw.ts
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
type Item = { name: string; sx: number; sy: number; from?: Pt; leaving?: boolean; state?: string; words?: string; follow?: boolean; aim?: { id: string; x: number; y: number } }
type Scene = { agents: Item[]; summon: Item | null; ink: { strokes: Pt[][] } | null }
const scenes: Scene[] = []
let pointer = { x: 500, y: 500 }
const display = { id: 1, bounds: { x: 0, y: 0, width: 1600, height: 1000 }, workArea: { x: 0, y: 25, width: 1600, height: 975 } }
mock.module(pathToFileURL(fs.realpathSync(path.join(ROOT, "node_modules/electron/index.js"))).href, { exports: {
  app: { on() {}, getName: () => "Vaultite", getPath: () => os.tmpdir(), getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {}, isPackaged: false },
  Menu: { buildFromTemplate() {} }, Notification: class { static isSupported() { return false } }, nativeImage: { createFromPath: () => ({ setTemplateImage() {}, isEmpty: () => true }) }, shell: {}, Tray: class {},
  screen: { getCursorScreenPoint: () => pointer, getDisplayMatching: () => display, getDisplayNearestPoint: () => display, getAllDisplays: () => [display] },
} })
type Acts = { open: (name: string, at: Pt) => void }
type PanelActs = { send: (name: string, text: string) => void; closed: (name: string) => void }
let acts: Acts | null = null, panelActs: PanelActs | null = null
const panels: { name: string; at: Pt; items: { id: string; kind: string }[]; how: string; focus: boolean }[] = []
let panelShown = false, closed = 0, following = false
mock.module(at("overlay.ts"), { exports: { showOverlay: (_b: string, s?: Scene) => { if (s) scenes.push(JSON.parse(JSON.stringify(s))) }, overlayActs: (a: Acts) => { acts = a },
  onPanel: (a: PanelActs) => { panelActs = a }, openPanel: (_b: string, at: Pt, d: { name: string; items: []; how: string }, focus = true) => { panelShown = true; panels.push({ ...d, at, focus }) }, panelData() {},
  panelOpen: () => (panelShown ? panels.at(-1)?.name ?? null : null), panelFocused: () => false, panelMenuClosed() {}, closePanel() { if (panelShown) { panelShown = false; closed++; panelActs?.closed("Claude") } },
  ownWindows: () => [], panelBounds: () => (panelShown ? { x: 600, y: 300, width: 300, height: 160 } : null),
  showDrawing() {}, drawingActs() {}, endDrawing() {}, followPointer: (on: boolean) => { following = on }, panelAvoid() {} } })
mock.module(at("screen.ts"), { exports: { onScreenEvent() {}, screenAsk: async () => ({}), startScreen: async () => {}, stopScreen() {}, windowShot: async () => null, displayShot: async () => null,
  fnUsage: async () => null } })
// (the recognizer: what it heard, given when it's stopped)
type Sink = { tell: (e: Record<string, unknown>) => void }
let heardWords = "what's this?"
mock.module(at("dictation.ts"), { exports: { dictate: async (sink: Sink) => { sink.tell({ type: "start" }); return { ok: true } }, dictating: () => false,
  stopFor: (sink: Sink, cancel = false) => setTimeout(() => { if (!cancel && heardWords) sink.tell({ type: "final", text: heardWords }); sink.tell({ type: "end", reason: cancel ? "cancel" : "stop" }) }, 5),
  dictationEngines: async () => ({}) } })

// (the server: settings, and the companion's socket)
let agent: Record<string, unknown> = { name: "Claude", tint: "orange", state: "watching", t: Date.now(), path: "Notes/A.md", line: 3 }
let sock: WebSocket | null = null
const posted: { url: string; body: string }[] = []
const srv = http.createServer((q, res) => {
  let body = ""
  q.on("data", (c) => { body += c })
  q.on("end", () => { posted.push({ url: q.url ?? "", body }); res.setHeader("Content-Type", "application/json"); res.end("{}") })
})
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
const hp: Record<string, unknown> = {}
await helper.startHelper({ home: () => ({ port, path: "/vault", name: "Vault" }), homeWindow, openHome() {}, focusedPage: () => null, event() {}, prefs: () => hp, setPrefs: (x: object) => Object.assign(hp, x), quit() {}, icon: "" })
type MenuItem = { label?: string; sublabel?: string; type?: string; enabled?: boolean; click?: () => void }
const H = (globalThis as unknown as { vaultiteHelper: { heard: (m: object) => void; stub: (op: string, v: object) => void; scene: () => Scene | null; asked: () => Record<string, unknown>[]; badge: () => string
  menu: () => MenuItem[] } }).vaultiteHelper

let fails = 0
const check = (name: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(info)}`}`) }
async function until(fn: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return fn()
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const claude = () => scenes.map((s) => s.agents.find((a) => a.name === "Claude")).filter((a): a is Item => !!a)
const front = (vaultite: boolean, bundle = "com.example.mail") => H.heard({ event: "front", bundle: vaultite ? "app.vaultite" : bundle, name: "x", title: "t", window: 5, vaultite })
const chord = (on: boolean) => H.heard({ event: "chord", name: "control_option", on })
const asks = () => H.asked().filter((m) => m.kind === "ask" || m.kind === "point")

await until(() => !!sock)
front(true)
await until(() => scenes.length > 0)
check("helper draw: in a note, Vaultite in front: nothing on screen", !H.scene()!.agents.length && !H.scene()!.summon, H.scene())
front(false)
await wait(80)
check("helper draw: another app in front, the companion idle: still nothing (no cursor at rest)", !H.scene()!.agents.length && !H.scene()!.summon && !H.scene()!.ink, H.scene())

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

H.stub("window", { window: 9, bundle: "com.example.mail", name: "Mail", title: "Inbox", frame: { x: 200, y: 100, width: 800, height: 600 } })
setAgent({ path: undefined, app: "com.example.mail" })
await until(() => claude().some((a) => a.sx === 600))
check("helper draw: pointing at an app's window, by its title bar once found", H.scene()!.agents[0]?.sx === 600 && H.scene()!.agents[0]?.sy === 112, H.scene()!.agents[0])
H.heard({ event: "moved", window: 9, frame: { x: 300, y: 150, width: 800, height: 600 } })
check("helper draw: that window dragged, the cursor follows it at once", H.scene()!.agents[0]?.sx === 700 && H.scene()!.agents[0]?.sy === 162, H.scene()!.agents[0])
H.stub("covered", { covered: true })
front(false)
check("helper draw: its window covered by one in front (Vaultite's, another app's), it isn't drawn, pointing at nothing seen", await until(() => !H.scene()!.agents.length), H.scene())
H.stub("covered", { covered: false })
front(false)
check("helper draw: uncovered again, it's back", await until(() => H.scene()!.agents.length === 1), H.scene())
front(true)
setAgent({ app: undefined, path: "Notes/A.md" })
await until(() => !H.scene()!.agents.length)
windowShown = false
scenes.length = 0
setAgent({ path: undefined, sx: 50, sy: 60 })
await until(() => claude().length > 0)
check("helper draw: with no window on screen, it appears where it is at once", claude()[0]?.sx === 50 && !claude()[0]?.from, claude()[0])
setAgent({ sx: undefined, sy: undefined, path: "Notes/A.md" })
await until(() => !H.scene()!.agents.length)

// ---------- summoned: hold ⌃⌥, speak and draw, let go
front(false)
const win = { window: 9, bundle: "com.example.mail", name: "Mail", title: "Inbox", frame: { x: 200, y: 100, width: 800, height: 600 } }
H.stub("at", win)
H.stub("window", win)
H.stub("near", { ok: true, elements: [{ role: "button", label: "Send", frame: { x: 480, y: 470, width: 60, height: 24 } }] })
H.stub("under", { ok: true, bundle: "com.example.mail", name: "Mail", role: "button", label: "Send" })
H.stub("text", { ok: true, text: "Inbox\nSend" })
pointer = { x: 500, y: 480 }
chord(true)
await wait(40)
check("summoned: a shortcut's press shows nothing at first (⌃⌥→ is a window manager's)", !H.scene()!.summon, H.scene()!.summon)
check("summoned: held, its cursor comes beside the pointer, listening, riding with it (the overlay fed the pointer)",
  await until(() => H.scene()!.summon?.state === "listening" && H.scene()!.summon?.sx === 524 && !!H.scene()!.summon?.follow) && following, [H.scene()!.summon, following])
H.heard({ event: "ink", phase: "down", x: 470, y: 470 })
for (let i = 1; i <= 10; i++) H.heard({ event: "ink", phase: "move", x: 470 + i * 6, y: 470 + (i % 2) })
H.heard({ event: "ink", phase: "up", x: 530, y: 471 })
pointer = { x: 530, y: 471 }
check("summoned: a drag while held is ink, drawn as it goes, the cursor beside it", await until(() => (H.scene()!.ink?.strokes[0]?.length ?? 0) >= 10 && H.scene()!.summon?.sx === 554), H.scene())
await wait(300)
chord(false)
check("summoned: let go, it thinks there", await until(() => H.scene()!.summon?.state === "thinking"), H.scene()!.summon)
const ask = await until(() => asks().length > 0) ? asks()[0] : null
check("summoned: what was said goes, about the point let go at: the window there, what's under and near it, what was drawn",
  ask?.kind === "ask" && ask.text === "what's this?" && ask.window === 9 && ask.sx === 530 && ask.sy === 471 && (ask.near as { id: string }[])?.[0]?.id === "a1" &&
  (ask.ink as { shape: string }[])?.[0]?.shape === "underline" && /Send/.test(String(ask.under)), ask)
const box = panels.at(-1) as { focus: boolean; at: Pt; hint?: string } | undefined
check("summoned: its answer's box opens by it, its field saying how to reply, not taking the keyboard", box?.focus === false && box.at.x === 554 && /tap ⌃⌥ to type, hold to talk/.test(box.hint ?? ""), box)
scenes.length = 0
setAgent({ path: undefined, line: undefined, app: "com.example.mail", window: 9, state: "thinking" })
await wait(80)
check("summoned: one cursor through the exchange, the summoned one, thinking; its place where it was asked is no pointing",
  !claude().length && scenes.at(-1)!.summon?.state === "thinking" && !scenes.at(-1)!.summon?.aim, scenes.at(-1))
setAgent({ sx: 496, sy: 482, frame: { x: 480, y: 470, width: 60, height: 24 } })
check("summoned: pointing at an element, it's told to fly there", await until(() => H.scene()!.summon?.aim?.x === 496 && H.scene()!.summon?.aim?.y === 482) && !claude().length, H.scene()!.summon)
setAgent({ state: "watching", t: Date.now() })
check("summoned: its turn done, it rides on, waiting", await until(() => H.scene()!.summon?.state === "watching"), H.scene()!.summon)
sock!.send(JSON.stringify({ t: "said", said: [{ id: "ask-1", kind: "ask", by: "user", agent: "Claude", text: "what's this?", t: Date.now(), seen: true }, { id: "s1", kind: "say", agent: "Claude", text: "The Send button.", t: Date.now() }] }))
await wait(50)
check("summoned: its words go in the box, seen there", H.asked().some((m) => m.t === "saw" && JSON.stringify(m.ids) === '["s1"]'), H.asked().slice(-3))
H.heard({ event: "click", x: 700, y: 350 })
check("summoned: a click in its box keeps it", closed === 0)
H.heard({ event: "click", x: 50, y: 50 })
check("summoned: a click elsewhere ends the exchange: the box closes, the cursor goes, the pointer no longer fed", closed === 1 && !H.scene()!.ink && !H.scene()!.summon && !following, closed)
setAgent({ state: "watching", t: Date.now() - 7000 })
check("summoned: done there, idle and its words gone, its cursor leaves the screen", await until(() => H.asked().some((m) => m.t === "home" && m.agent === "Claude")), H.asked().slice(-3))

// ---------- a tap, a shortcut, nothing said
const before = asks().length
setAgent({ app: undefined, window: undefined, path: "Notes/A.md" })
chord(true)
await wait(60)
chord(false)
check("tapped: its box opens at the pointer, taking the keyboard, nothing sent", await until(() => panels.at(-1)?.focus === true && panelShown) && asks().length === before, panels.at(-1))
H.heard({ event: "esc" })
check("tapped: Esc closes it", !panelShown)
await wait(400)
chord(true)
await wait(150)
H.heard({ event: "chord", name: "control_option", other: true })
await wait(100)
check("a shortcut (another key with it): nothing goes, its cursor goes", asks().length === before && !H.scene()!.summon, H.scene()!.summon)
heardWords = ""
chord(true)
await wait(400)
chord(false)
await wait(100)
check("held with nothing said nor drawn: nothing goes", asks().length === before && !H.scene()!.summon, asks())
heardWords = "and this?"

// ---------- unread: a badge on the menu bar icon; a bubble clicked opens its conversation
sock!.send(JSON.stringify({ t: "said", said: [{ id: "s1", kind: "say", agent: "Claude", text: "The Send button.", t: 1, seen: true }] }))
check("unread: all its words seen, no badge", await until(() => H.badge() === ""), H.badge())
sock!.send(JSON.stringify({ t: "said", said: [{ id: "s1", kind: "say", agent: "Claude", text: "The Send button.", t: 1, seen: true }, { id: "s2", kind: "say", agent: "Claude", text: "Later.", t: 2 }] }))
check("unread: its words not seen are a badge on the menu bar icon", await until(() => H.badge() === "1"), H.badge())
acts!.open("Claude", { x: 600, y: 470 })
check("a bubble clicked: its conversation opens by it, what was said", panels.at(-1)?.name === "Claude" && !!panels.at(-1)?.items.some((n) => n.id === "s2") && panels.at(-1)?.focus === true, panels.at(-1))
panelActs!.send("Claude", "and this row?")
await until(() => asks().some((m) => m.text === "and this row?"))
const typed = asks().find((m) => m.text === "and this row?")
check("an ask typed there is about where it was opened, to it", typed?.agent === "Claude" && typed?.window === 9 && typed?.app === "com.example.mail", typed)

// ---------- jobs: what it handed off, in the menu bar (running, done, needs you), a notification as one ends
const job = (state: string, unseen = false) => ({ id: "d1", title: "Compare the flights", state, link: "view:claude-session/abc", unseen, at: Date.now() })
const jobItem = () => H.menu().find((i) => i.label === "Compare the flights")
const notices = () => H.asked().filter((m) => m.notice === "job")
sock!.send(JSON.stringify({ t: "jobs", jobs: [job("running")] }))
check("jobs: one at work is in the menu bar's Jobs, saying so; the list as first heard tells nothing", await until(() => jobItem()?.sublabel === "Working") && !notices().length && H.badge() === "1", [jobItem(), notices()])
sock!.send(JSON.stringify({ t: "jobs", jobs: [job("done", true)] }))
check("jobs: once it's done, a notification, and the badge counts it till it's opened", await until(() => notices().length === 1 && H.badge() === "2") && notices()[0].state === "done" &&
  /, new$/.test(jobItem()?.sublabel ?? ""), [notices(), H.badge(), jobItem()])
jobItem()!.click!()
check("jobs: clicked, it opens in Vaultite, its tab, and it's no longer news", await until(() => posted.some((p) => p.url === "/api/ops/ui.open" && JSON.parse(p.body).path === "view:claude-session/abc")) &&
  H.asked().some((m) => m.t === "job-seen" && JSON.stringify(m.ids) === '["d1"]'), posted.slice(-2))
sock!.send(JSON.stringify({ t: "jobs", jobs: [{ ...job("needs you"), id: "d2", title: "Book it" }, job("done")] }))
await wait(50)
check("jobs: one that comes to need them isn't news unless it was at work before; needing them, it goes first", notices().length === 1 && H.menu().find((i) => i.label === "Book it")?.sublabel === "Needs you" &&
  H.menu().findIndex((i) => i.label === "Book it") < H.menu().findIndex((i) => i.label === "Compare the flights") && H.badge() === "1", [notices(), H.menu().map((i) => i.label)])

helper.stopHelper()
srv.close()
process.exit(fails ? 1 : 0)
