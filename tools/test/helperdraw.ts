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
type Scene = { agents: Item[]; summon: Item | null }
const scenes: Scene[] = []
let pointer = { x: 500, y: 500 }
const display = { id: 1, bounds: { x: 0, y: 0, width: 1600, height: 1000 }, workArea: { x: 0, y: 25, width: 1600, height: 975 } }
/** What the window's pages send the main process (ipcMain), by channel. */
const ipc = new Map<string, (e: { sender: unknown }, m?: unknown) => void>()
/** The app's own folder (its logs, the log of presses), apart from anything real. */
const USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), "vau-helperdraw-"))
mock.module(pathToFileURL(fs.realpathSync(path.join(ROOT, "node_modules/electron/index.js"))).href, { exports: {
  app: { on() {}, getName: () => "Vaultite", getPath: () => USERDATA, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {}, isPackaged: false, getPreferredSystemLanguages: () => ["en-US"] },
  clipboard: { writeText() {} }, Menu: { buildFromTemplate() {} }, ipcMain: { on: (ch: string, fn: (e: { sender: unknown }, m?: unknown) => void) => { ipc.set(ch, fn) }, removeAllListeners() {} }, Notification: class { static isSupported() { return false } }, nativeImage: { createFromPath: () => ({ setTemplateImage() {}, isEmpty: () => true }) }, shell: {}, Tray: class {},
  screen: { getCursorScreenPoint: () => pointer, getDisplayMatching: () => display, getDisplayNearestPoint: () => display, getAllDisplays: () => [display] },
} })
type Acts = { open: (name: string, at: Pt) => void }
type PanelActs = { send: (name: string, text: string) => void; closed: (name: string) => void }
let acts: Acts | null = null, panelActs: PanelActs | null = null
const panels: { name: string; at: Pt; items: { id: string; kind: string }[]; how: string; focus: boolean }[] = []
let panelShown = false, closed = 0, following = false, fed: ((p: Pt, t: number) => void) | null = null
mock.module(at("overlay.ts"), { exports: { showOverlay: (_b: string, s?: Scene) => { if (s) scenes.push(JSON.parse(JSON.stringify(s))) }, overlayActs: (a: Acts) => { acts = a },
  onPanel: (a: PanelActs) => { panelActs = a }, openPanel: (_b: string, at: Pt, d: { name: string; items: []; how: string }, focus = true) => { panelShown = true; panels.push({ ...d, at, focus }) }, panelData() {},
  panelOpen: () => (panelShown ? panels.at(-1)?.name ?? null : null), panelFocused: () => false, panelMenuClosed() {}, closePanel() { if (panelShown) { panelShown = false; closed++; panelActs?.closed("Claude") } },
  ownWindows: () => [], panelBounds: () => (panelShown ? { x: 600, y: 300, width: 300, height: 160 } : null),
  showDrawing() {}, dropDrawings() {}, drawingActs() {}, watchLayers() {}, penSounds() {}, drawingUp: () => false, endDrawing() {}, cue() {}, followPointer: (on: boolean, moved?: (p: Pt, t: number) => void) => { following = on; fed = on ? moved ?? null : null }, panelAvoid() {} } })
// (take-over: its windows and native part, apart: tools/test/vault/takeover.ts has its rules)
mock.module(at("takeover.ts"), { exports: { takeoverHeard() {}, takeoverEnded() {}, takeoverClick: () => false, takeoverDriving: () => false, takeoverCaption: () => null, takeoverBehind: () => null, stopTakeover() {} } })
mock.module(at("screen.ts"), { exports: { onScreenEvent() {}, screenAsk: async () => ({}), startScreen: async () => {}, stopScreen() {}, windowShot: async () => null, displayShot: async () => null,
  fnUsage: async () => null } })
// (the recognizer: what it heard, given when it's stopped)
type Sink = { tell: (e: Record<string, unknown>) => void }
let heardWords = "what's this?"
// (`sttDrops`: the recognizer's socket drops mid-press; `finishMs`: how long its last words take once stopped)
let sttDrops: boolean | string = false, finishMs = 5
// (`micBt`: the mic it hears with is a Bluetooth one, held open after; each release of it)
let micBt = false
const releases: number[] = []
mock.module(at("dictation.ts"), { exports: { freeFor() {}, handOver: () => false, onRoam() {}, dictate: async (sink: Sink) => {
  sink.tell({ type: "start" })
  const drops = sttDrops
  if (drops) setTimeout(() => { if (typeof drops === "string") sink.tell({ type: "final", text: drops }); sink.tell({ type: "error", code: "socket", message: "the connection closed" }); sink.tell({ type: "end", reason: "error" }) }, 60)
  return { ok: true, ...(micBt ? { mic: { uid: "pods", name: "Alice's AirPods", bluetooth: true, why: "the system's input (set)", fallback: [] } } : {}) }
}, dictating: () => false,
  stopFor: (sink: Sink, cancel = false) => { const words = heardWords; setTimeout(() => { if (!cancel && words) sink.tell({ type: "final", text: words }); sink.tell({ type: "end", reason: cancel ? "cancel" : "stop" }) }, finishMs) },
  dictationEngines: async () => ({}), expectedWords: () => ({ terms: [], replacements: [] }), onDictating: () => () => {}, onAudioDevices: () => () => {}, releaseMic: () => { releases.push(Date.now()) } } })

// (the server: settings, and the companion's socket)
let agent: Record<string, unknown> = { name: "Claude", tint: "orange", state: "watching", t: Date.now(), path: "Notes/A.md", line: 3 }
let sock: WebSocket | null = null
const posted: { url: string; body: string }[] = []
const srv = http.createServer((q, res) => {
  let body = ""
  q.on("data", (c) => { body += c })
  // (the user's dictation keys: fn and right Option, as in a real vault; the companion's Talk key its default, ⌃⌥)
  q.on("end", () => { posted.push({ url: q.url ?? "", body }); res.setHeader("Content-Type", "application/json"); res.end(/plugin\/dictation/.test(body) ? '{"keys":["fn","right_option"],"fn":true}' : "{}") })
})
const wss = new WebSocketServer({ noServer: true })
srv.on("upgrade", (req, s, h) => wss.handleUpgrade(req, s, h, (ws) => { sock = ws; ws.send(JSON.stringify({ t: "state", mode: "pair", name: "Claude", agents: [agent], notes: [] })) }))
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
const port = (srv.address() as { port: number }).port
const setAgent = (a: Record<string, unknown>) => {
  agent = Object.fromEntries(Object.entries({ ...agent, ...a }).filter(([, v]) => v !== undefined))
  sock!.send(JSON.stringify({ t: "agent", agent }))
}

// (the vault's window at 100, 50 on screen, its cursor drawn at 200, 300 in it, going to 400, 300: the arrow's box is 3, 2 off;
// asked what's at a point of it, its page says `placeHere`, a pane's row, and keeps what it was sent)
let windowShown = true, placeHere: Record<string, unknown> | null = { pane: "p1", row: 4, under: "npm test", title: "Terminal" }
const homePage = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => [["Claude", 197, 298, 397, 298]], got: [] as { ch: string; m: unknown }[],
  send(ch: string, m: { id: number; x: number; y: number }) { this.got.push({ ch, m }); if (ch === "vaultite:place-at") setTimeout(() => ipc.get("vaultite:place")?.({ sender: homePage }, { id: m.id, place: placeHere }), 5) } }
const homeWindow = () => windowShown ? { page: homePage, bounds: { x: 100, y: 50, width: 1200, height: 800 }, zoom: 1 } : null
process.env.VAULTITE_QUIET = "1"
const helper = await import(at("helper.ts"))
const hp: Record<string, unknown> = {}
/** The vault window's page while it has the keyboard (null: another app's in front): what the helper sends it. */
let focused: { isDestroyed: () => boolean; send: (ch: string, m: unknown) => void; got: unknown[] } | null = null
await helper.startHelper({ home: () => ({ port, path: "/vault", name: "Vault" }), homeWindow, openHome() {}, focusedPage: () => focused, event() {}, prefs: () => hp, setPrefs: (x: object) => Object.assign(hp, x), quit() {}, icon: "" })
type MenuItem = { label?: string; sublabel?: string; type?: string; enabled?: boolean; click?: () => void }
const H = (globalThis as unknown as { vaultiteHelper: { heard: (m: object) => void; presses: () => Record<string, unknown>[]; stub: (op: string, v: object) => void; scene: () => Scene | null; asked: () => Record<string, unknown>[]; badge: () => string
  spoken: () => Record<string, unknown>[]
  menu: () => MenuItem[] } }).vaultiteHelper

let fails = 0
const check = (name: string, ok: boolean, info?: unknown) => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(info)}`}`) }
async function until(fn: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end;) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)) }
  return fn()
}
// (a key's moves carry when they happened, as the native tap's do: held is the waits since it went down, so a slow
// runner's late timer never turns a tap into a hold)
let downAt = 0, heldMs = 0
const wait = (ms: number) => { heldMs += ms; return new Promise((r) => setTimeout(r, ms)) }
const claude = () => scenes.map((s) => s.agents.find((a) => a.name === "Claude")).filter((a): a is Item => !!a)
const front = (vaultite: boolean, bundle = "com.example.mail") => H.heard({ event: "front", bundle: vaultite ? "app.vaultite" : bundle, name: "x", title: "t", window: 5, vaultite })
const chord = (on: boolean) => {
  if (on) { downAt = Math.max(Date.now(), downAt + heldMs); heldMs = 0 }
  H.heard({ event: "chord", name: "control_option", on, t: on ? downAt : downAt + heldMs })
}
const asks = () => H.asked().filter((m) => m.kind === "ask" || m.kind === "point")

await until(() => !!sock)
front(true)
await until(() => scenes.length > 0)
check("helper draw: in a note, Vaultite in front: nothing on screen", !H.scene()!.agents.length && !H.scene()!.summon, H.scene())
front(false)
await wait(80)
check("helper draw: another app in front, the companion idle: still nothing (no cursor at rest)", !H.scene()!.agents.length && !H.scene()!.summon, H.scene())

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
// (the pointer moved while held: the overlay's feed tells the helper each move, its trail)
const feed = fed as ((p: Pt, t: number) => void) | null
for (let i = 0; i <= 10; i++) feed?.({ x: 470 + i * 6, y: 470 + (i % 2) }, Date.now() - 200 + i * 16)
pointer = { x: 530, y: 471 }
check("summoned: held, the pointer's moves are its trail (the overlay draws it from its feed), the cursor beside it", !!feed && await until(() => H.scene()!.summon?.sx === 554), H.scene())
await wait(300)
chord(false)
check("summoned: let go, it thinks there", await until(() => H.scene()!.summon?.state === "thinking"), H.scene()!.summon)
const ask = await until(() => asks().length > 0) ? asks()[0] : null
check("summoned: what was said goes, about the point let go at: the window there, what's under and near it, what was drawn",
  ask?.kind === "ask" && ask.text === "what's this?" && ask.window === 9 && ask.sx === 530 && ask.sy === 471 && (ask.near as { id: string }[])?.[0]?.id === "a1" &&
  (ask.ink as { shape: string }[])?.[0]?.shape === "underline" && /Send/.test(String(ask.under)), ask)
const cues = () => H.asked().flatMap((m) => ("cue" in m ? [m.cue] : []))
check("summoned: soft cues as it came and as it was let go with words (a scripted copy plays none)", cues().join() === "listen,sent", cues())
const panelsBefore = panels.length
check("summoned: an ask by voice gets no box: its answer is spoken by its cursor", !panelShown && panels.length === panelsBefore, panels.at(-1))
check("summoned: while it rides with the pointer, the windows are told (they draw no cursor of its, no arrow at work)", H.asked().some((m) => m.t === "riding" && m.agent === "Claude"), H.asked().filter((m) => m.t === "riding"))
sock!.send(JSON.stringify({ t: "note", note: { id: "s0", kind: "say", agent: "Claude", text: "That's the Send button.", t: Date.now() } }))
check("summoned: its answer coming, a soft cue", await until(() => cues().join() === "listen,sent,answer"), cues())
await wait(3800)
check("summoned: its voice never came: still no box (only a tap of the key opens one)", !panelShown && panels.length === panelsBefore, panels.at(-1))
scenes.length = 0
setAgent({ path: undefined, line: undefined, app: "com.example.mail", window: 9, state: "thinking" })
await wait(80)
check("summoned: one cursor through the exchange, the summoned one, thinking; its place where it was asked is no pointing",
  !claude().length && scenes.at(-1)!.summon?.state === "thinking" && !scenes.at(-1)!.summon?.aim, scenes.at(-1))
setAgent({ sx: 496, sy: 482, frame: { x: 480, y: 470, width: 60, height: 24 } })
check("summoned: pointing at an element, it's told to fly there", await until(() => H.scene()!.summon?.aim?.x === 496 && H.scene()!.summon?.aim?.y === 482) && !claude().length, H.scene()!.summon)
windowShown = true
setAgent({ app: undefined, window: undefined, sx: undefined, sy: undefined, frame: undefined, pane: "p1", row: 4 })
check("summoned: pointing at a pane in Vaultite's window, it flies where the window would draw it, no cursor of the window's", await until(() => H.scene()!.summon?.aim?.x === 500 && H.scene()!.summon?.aim?.y === 350) && !claude().length, H.scene()!.summon)
setAgent({ pane: undefined, row: undefined, app: "com.example.mail", window: 9 })
setAgent({ state: "watching", t: Date.now() })
check("summoned: its turn done, it rides on, waiting", await until(() => H.scene()!.summon?.state === "watching"), H.scene()!.summon)
// (a tap of the key mid-exchange: its box, its words and the field)
chord(true)
await wait(60)
chord(false)
check("summoned: a tap of the key opens its box after all", await until(() => panelShown), panels.at(-1))
sock!.send(JSON.stringify({ t: "said", said: [{ id: "ask-1", kind: "ask", by: "user", agent: "Claude", text: "what's this?", t: Date.now(), seen: true }, { id: "s1", kind: "say", agent: "Claude", text: "The Send button.", t: Date.now() }] }))
await wait(50)
check("summoned: its words go in the box, seen there", H.asked().some((m) => m.t === "saw" && JSON.stringify(m.ids) === '["s1"]'), H.asked().slice(-3))
H.heard({ event: "click", x: 700, y: 350 })
check("summoned: a click in its box keeps it", closed === 0)
H.heard({ event: "click", x: 50, y: 50 })
check("summoned: a click elsewhere, nothing being said: the box closes, the exchange ends, the pointer no longer fed", closed === 1 && !H.scene()!.summon && !following, closed)
check("summoned: …and the windows are told it no longer rides", await until(() => H.asked().filter((m) => m.t === "riding").at(-1)?.agent === ""), H.asked().filter((m) => m.t === "riding"))
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
check("held with nothing said nor drawn: nothing goes, but its cursor says it didn't catch that, with a soft cue",
  asks().length === before && H.scene()!.summon?.state === "missed" && /didn't catch that/i.test(String((H.scene()!.summon as { missed?: string })?.missed)) && H.asked().at(-1)?.cue === "missed", [asks().length - before, H.scene()!.summon, H.asked().slice(-2)])
const lastEnd = () => H.presses().filter((l) => l.ev === "end").at(-1)
check("…and the press is logged: down, the recognizer, let go, what it heard, and why it went nowhere",
  lastEnd()?.outcome === "missed" && /nothing heard/.test(String(lastEnd()?.why)) && ["down", "stt", "stt-start", "up", "stt-end"].every((ev) => H.presses().some((l) => l.press === lastEnd()?.press && l.ev === ev)), H.presses().slice(-8))
check("…then its cursor goes", await until(() => !H.scene()!.summon, 3500), H.scene()!.summon)
// (the recognizer's connection drops mid-press: said so, never a silent nothing)
sttDrops = true
chord(true)
await wait(300)
chord(false)
check("the recognizer drops mid-press: its cursor says it didn't catch that, the press logged with the error", await until(() => H.scene()!.summon?.state === "missed") &&
  H.presses().some((l) => l.press === lastEnd()?.press && l.ev === "stt-error" && l.code === "socket") && lastEnd()?.outcome === "missed", H.presses().slice(-6))
const moves = (id: unknown) => H.presses().filter((l) => l.press === id && l.ev === "state").map((l) => `${l.to}`).join()
check("…its phases are in the press's log, from held to closed: none left halfway", await until(() => moves(lastEnd()?.press) === "failed,missed,closed", 3500), H.presses().slice(-6))
// (it drops after some words, still held: nothing goes while held, what was heard goes once let go)
sttDrops = "half of it"
const dropAsks = asks().length
chord(true)
await wait(300)
check("the recognizer stops after some words, still held: its cursor says so, nothing sent yet",
  H.scene()!.summon?.state === "missed" && /stopped hearing/i.test(String((H.scene()!.summon as { missed?: string })?.missed)) && asks().length === dropAsks, [H.scene()!.summon, asks().length - dropAsks])
chord(false)
check("…let go, what it heard goes", await until(() => asks().at(-1)?.text === "half of it"), asks().slice(-2))
sttDrops = false
H.heard({ event: "esc" })
await until(() => !H.scene()!.summon, 3500)
// (pressed again as the last press's words are still being finished: both go, in order, none swallowed)
heardWords = "first one"
finishMs = 500
chord(true)
await wait(300)
chord(false)
await wait(80)
chord(true)
await wait(30)
heardWords = "second one"
finishMs = 5
check("pressed again while the last words are still coming: it listens again (not swallowed)", await until(() => H.scene()!.summon?.state === "listening", 1500), H.scene()!.summon)
await wait(400)
chord(false)
check("…and both asks go, in order", await until(() => asks().some((m) => m.text === "second one")) && asks().findIndex((m) => m.text === "first one") < asks().findIndex((m) => m.text === "second one") &&
  asks().findIndex((m) => m.text === "first one") >= 0, asks().slice(-3).map((m) => m.text))
H.heard({ event: "esc" })
await wait(300)
heardWords = "and this?"

// ---------- in a Vaultite window: the same companion over the screen, the page never told the key (one companion);
// the ask says what the page has there (a pane's row)
await wait(400)
focused = { isDestroyed: () => false, send(ch, m) { if (ch === "vaultite:fn") this.got.push(m) }, got: [] }
front(true)
const vwin = { window: 3, bundle: "app.vaultite", name: "Vaultite", title: "Vault", vaultite: true, frame: { x: 100, y: 50, width: 1200, height: 800 } }
H.stub("at", vwin)
const mailUnder = { ok: true, bundle: "com.example.mail", name: "Mail", role: "button", label: "Send" }
H.stub("under", { ok: true, vaultite: true })
const asked0 = asks().length
scenes.length = 0
chord(true)
check("in Vaultite's window: a held ⌃⌥ summons the companion at the pointer, listening, the page told nothing", await until(() => H.scene()!.summon?.state === "listening") && !focused.got.length, [H.scene()!.summon, focused.got])
heardWords = "what's running here?"
await wait(300)
chord(false)
const inWin = await until(() => asks().some((m) => m.text === "what's running here?")) ? asks().at(-1)! : null
check("…let go, one ask goes, about what the page has under the pointer (its pane and row) and the display's point, no app",
  asks().length === asked0 + 1 && inWin?.pane === "p1" && inWin?.row === 4 && inWin?.under === "npm test" && inWin?.sx === 530 && !inWin?.app && homePage.got.some((g) => g.ch === "vaultite:place-at" && (g.m as Pt).x === 430 && (g.m as Pt).y === 421), [inWin, homePage.got])
check("…one cursor all along: the summoned one, no other drawn on screen, the page told nothing", !focused.got.length && scenes.every((x) => !x.agents.some((a) => a.name === "Claude")), [focused.got, scenes.filter((x) => x.agents.length)])

// ---------- its voice goes on to its end: only the Talk key, Esc or a new ask stop it
const stops = () => H.spoken().filter((m) => m.cmd === "stop").length
const voiced = (id: string, text: string) => sock!.send(JSON.stringify({ t: "note", note: { id, kind: "say", agent: "Claude", text, t: Date.now(), answers: { t: Date.now(), voice: true } } }))
setAgent({ state: "thinking", t: Date.now() })
voiced("v1", "That's your test run, still going. It's on the second suite now.")
check("voice: its answer to a spoken ask is said aloud", await until(() => H.spoken().some((m) => m.cmd === "say" && /test run/.test(String(m.text)))), H.spoken().slice(-3))
const sound = H.presses().filter((l) => l.ev === "sound").at(-1)
check("voice: …its first sound is in the press's log: whose voice, how long after the key was let go", sound?.press === H.presses().filter((l) => l.ev === "end" && l.outcome === "sent").at(-1)?.press &&
  sound?.by === "mac" && typeof sound.afterUp === "number" && sound.afterUp >= 0, H.presses().slice(-4))
let stopped = stops()
H.heard({ event: "click", x: 50, y: 50 })
front(false)
H.heard({ event: "front", bundle: "com.example.notes", name: "Notes", title: "n", window: 11, vaultite: false })
await wait(100)
check("voice: a click elsewhere or another app in front doesn't stop it, and its cursor stays", stops() === stopped && !!H.scene()!.summon, [stops(), H.scene()!.summon])
voiced("v1", "That's your test run, still going. It's on the second suite now. Want the failures?")
check("voice: …its words still come and are said", await until(() => H.spoken().some((m) => m.cmd === "say" && /failures/.test(String(m.text)))), H.spoken().slice(-3))
H.heard({ event: "esc" })
check("voice: Esc stops it at once, and the exchange ends", stops() > stopped && await until(() => !H.scene()!.summon), [stops(), H.scene()!.summon])
// (barge-in: the key pressed mid-answer stops it, and it listens for the next ask)
H.stub("at", win)
H.stub("under", mailUnder)
chord(true)
await wait(300)
chord(false)
await until(() => asks().length > asked0 + 1)
setAgent({ state: "thinking", t: Date.now() })
voiced("v2", "It's the Send button. It sends the draft.")
await until(() => H.spoken().some((m) => m.cmd === "say" && /Send button/.test(String(m.text))))
stopped = stops()
chord(true)
check("voice: the Talk key pressed mid-answer stops it, and it listens for the next ask", stops() > stopped && await until(() => H.scene()!.summon?.state === "listening"), [stops(), H.scene()!.summon])
heardWords = "and that one?"
await wait(300)
chord(false)
await until(() => asks().some((m) => m.text === "and that one?"))
voiced("v3", "That one archives it. Swipe left to undo.")
await until(() => H.spoken().some((m) => m.cmd === "say" && /archives/.test(String(m.text))))
stopped = stops()
acts!.open("Claude", { x: 600, y: 470 })
panelActs!.send("Claude", "and the third?")
check("voice: a new ask (typed in its box) stops what it's saying", await until(() => stops() > stopped), stops())
H.heard({ event: "esc" })
await until(() => !H.scene()!.summon)
setAgent({ state: "watching", t: Date.now() })
// (said to its end, its turn over: its cursor leaves a moment on, no Esc needed; heard through a Bluetooth mic, held open
// till then so the headset keeps its profile)
micBt = true
chord(true)
await wait(300)
chord(false)
await until(() => H.scene()!.summon?.state === "thinking")
setAgent({ state: "thinking", t: Date.now() })
await wait(1300)
check("mic: a Bluetooth mic stays open past the press while its answer is worked on", !releases.length, releases)
voiced("v4", "Yes, it's done.")
const saidAt = Date.now()
setAgent({ state: "watching", t: Date.now() })
check("voice: said to its end and its turn over, its cursor stays a moment, then leaves", !!H.scene()!.summon && await until(() => !H.scene()!.summon, 4000), H.scene()!.summon)
check("mic: …and is released a moment after the answer is said, in the press's log with its mic", await until(() => releases.length === 1, 3000) && releases[0] - saidAt >= 900 &&
  H.presses().some((l) => l.ev === "stt" && l.mic === "Alice's AirPods" && l.bluetooth === true) && H.presses().some((l) => l.ev === "mic-release"), [releases, saidAt, H.presses().filter((l) => /^mic/.test(String(l.ev)))])
micBt = false
heardWords = "and this?"
// (⌃⌥ in every order, either Option, let go either way, as the screen helper's tap tells it: right Option is a dictation
// key, Control and left Option aren't watched; a chord is told as such)
const CTRL = 59, ROPT = 61, LOPT = 58
type Key = "ctrl" | "ropt" | "lopt"
const held = new Set<Key>()
let live = false
/** One key pressed or let go, as screen.swift sends it: a watched key's own event (alone or not), else "something
 *  else" once a watched one was heard; then the chord's state. */
function press(k: Key, on: boolean) {
  const code = { ctrl: CTRL, ropt: ROPT, lopt: LOPT }[k]
  if (on) held.add(k); else held.delete(k)
  if (code === ROPT) { live = true; H.heard({ event: "mod", code, on, alone: on && held.size === 1, at: Date.now() }) }
  else if (live) { live = false; H.heard({ event: "mod", other: true }) }
  const chordOn = held.has("ctrl") && (held.has("ropt") || held.has("lopt")) && held.size === 2
  if (chordOn !== chordWas) H.heard({ event: "chord", name: "control_option", on: chordOn })
  chordWas = chordOn
}
let chordWas = false
const orders: [string, [Key, boolean, number][]][] = [
  ["⌃ then right ⌥, ⌥ let go first", [["ctrl", true, 30], ["ropt", true, 600], ["ropt", false, 30], ["ctrl", false, 300]]],
  ["⌃ then right ⌥, ⌃ let go first", [["ctrl", true, 30], ["ropt", true, 600], ["ctrl", false, 30], ["ropt", false, 300]]],
  ["right ⌥ then ⌃ at once", [["ropt", true, 60], ["ctrl", true, 600], ["ropt", false, 30], ["ctrl", false, 300]]],
  ["right ⌥, a moment, then ⌃", [["ropt", true, 320], ["ctrl", true, 600], ["ctrl", false, 30], ["ropt", false, 300]]],
  ["⌃ then left ⌥", [["ctrl", true, 30], ["lopt", true, 600], ["lopt", false, 30], ["ctrl", false, 300]]],
  ["left ⌥ then ⌃", [["lopt", true, 30], ["ctrl", true, 600], ["ctrl", false, 30], ["lopt", false, 300]]],
]
/** Whether a dictation press reached the page and wasn't taken back (a down with no "other" after it). */
const dictated = (got: unknown[]) => { let open = false; for (const m of got as { down?: boolean; other?: boolean }[]) { if (m.down === true) open = true; else if (m.other) open = false } return open }
for (const [name, steps] of orders) {
  // (in a window: its page gets nothing of the companion's press, nor a dictation left started; the companion listens)
  focused = { isDestroyed: () => false, send(ch, m) { if (ch === "vaultite:fn") this.got.push(m) }, got: [] }
  const inBefore = asks().length
  for (const [k, on, after] of steps) { press(k, on); await wait(after); if (on && held.size === 2) check(`⌃⌥ in a window (${name}): the companion listens at the pointer`, await until(() => H.scene()!.summon?.state === "listening", 1000), H.scene()!.summon) }
  check(`⌃⌥ in a window (${name}): one ask to the companion, the page told nothing of it, no dictation left started`, await until(() => asks().length === inBefore + 1) &&
    !focused.got.some((m) => "talk" in (m as object)) && !dictated(focused.got), [focused.got, asks().length - inBefore])
  H.heard({ event: "esc" })
  await wait(300)
  // (outside the app: the companion comes at the pointer; no field gets words)
  focused = null
  const before = asks().length
  for (const [k, on, after] of steps) { press(k, on); await wait(after); if (on && held.size === 2) check(`⌃⌥ outside the app (${name}): the companion listens at the pointer`, await until(() => H.scene()!.summon?.state === "listening", 1000), H.scene()!.summon) }
  check(`⌃⌥ outside the app (${name}): what was said goes to the companion, once`, await until(() => asks().length === before + 1), asks().slice(-1))
  H.heard({ event: "esc" })
  await wait(300)
}
// (spoken, no box; a tap of the key opens it: its last words and the reply field)
heardWords = "what's the time zone here?"
chord(true)
await wait(400)
chord(false)
await until(() => asks().some((m) => m.text === "what's the time zone here?"))
const tapBefore = panels.length
sock!.send(JSON.stringify({ t: "said", said: [{ id: "s9", kind: "say", agent: "Claude", text: "It's Lisbon time.", t: Date.now() }] }))
await wait(300)
chord(true)
await wait(60)
chord(false)
const tapped = await until(() => panels.length > tapBefore && panelShown) ? panels.at(-1)! : null
check("spoken, a tap of the key opens its box after all: its last words and the field, to type in", !!tapped && tapped.focus && tapped.items.some((n) => n.id === "s9"), tapped)
H.heard({ event: "esc" })
await wait(300)
focused = null
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

// ---------- jobs: what it handed off, in the menu bar (working, ready for review, needs you), a notification as one ends
const job = (state: string, unseen = false) => ({ id: "j1", title: "Compare the flights", state, link: "view:terminal/claude-abc", unseen, at: Date.now(), where: "M4, site, Personal, Claude Code",
  now: "Reading the fares", took: "2 min", result: "1 file changed, +3 -0" })
const jobItem = () => H.menu().find((i) => i.label === "Compare the flights")
const notices = () => H.asked().filter((m) => m.notice === "job")
sock!.send(JSON.stringify({ t: "jobs", jobs: [job("working")] }))
check("jobs: one at work is in the menu bar's Jobs, saying so, where and what it does now; the list as first heard tells nothing",
  await until(() => jobItem()?.sublabel === "Working · 2 min\nM4, site, Personal, Claude Code\nReading the fares") && !notices().length && H.badge() === "1" &&
  H.menu().some((i) => i.label === "Jobs (1 working)"), [jobItem(), notices()])
sock!.send(JSON.stringify({ t: "jobs", jobs: [job("ready for review", true)] }))
check("jobs: once it's ready for review the badge counts it till it's opened, with no notification (job_news: quiet); its diff shown",
  await until(() => H.badge() === "2") && !notices().length && /^Ready for review, new · 2 min\n.*\n1 file changed/.test(jobItem()?.sublabel ?? ""), [notices(), H.badge(), jobItem()])
jobItem()!.click!()
check("jobs: clicked, it opens its job in Vaultite (its terminal, resumed if closed), and it's no longer news", await until(() => posted.some((p) => p.url === "/api/ops/companion.job-open" && JSON.parse(p.body).id === "j1")) &&
  H.asked().some((m) => m.t === "job-seen" && JSON.stringify(m.ids) === '["j1"]'), posted.slice(-2))
sock!.send(JSON.stringify({ t: "jobs", jobs: [{ ...job("needs you"), id: "j2", title: "Book it" }, job("done")] }))
await wait(50)
check("jobs: one that comes to need them isn't news unless it was at work before; needing them, it goes first", !notices().length && /^Needs you/.test(H.menu().find((i) => i.label === "Book it")?.sublabel ?? "") &&
  H.menu().findIndex((i) => i.label === "Book it") < H.menu().findIndex((i) => i.label === "Compare the flights") && H.badge() === "1" &&
  H.menu().some((i) => i.label === "Jobs (1 needs you)"), [notices(), H.menu().map((i) => i.label)])
sock!.send(JSON.stringify({ t: "jobs", jobs: [{ ...job("working"), id: "j3", title: "Ask me" }] }))
await wait(50)
sock!.send(JSON.stringify({ t: "jobs", jobs: [{ ...job("needs you"), id: "j3", title: "Ask me" }] }))
check("jobs: one at work that comes to need them is a notification", await until(() => notices().length === 1 && notices()[0].state === "needs you"), notices())

// ---------- its voice: a stop silences audio streamed from elsewhere too (the realtime voice's), nothing left saying
{
  const { companionVoice } = await import(at("voice.ts"))
  const rec: Record<string, unknown>[] = []
  const cv = companionVoice({ port: () => null, prefs: () => ({ mode: "auto", provider: "auto", name: "", eleven: { voice: "", model: "" }, speed: 1 }), hints: () => ["en"], level: () => {},
    record: (m: Record<string, unknown>) => void rec.push(m) })
  cv.stream().pcm(Buffer.alloc(480))
  cv.stop()
  check("voice: a stop silences the realtime voice's streamed audio too, and nothing is left to say (its cursor isn't held)", rec.some((m) => m.cmd === "stop") && !cv.saying(), rec)
  // (the realtime voice's few words, then the answer, held till its route: it goes after them, which give way to it)
  rec.length = 0
  const ack = cv.stream()
  ack.pcm(Buffer.alloc(480)); ack.yield(0.4)
  cv.hold(); cv.begin("", "en", true); cv.text("n1", "Sure. That's the Send button."); cv.end("n1")
  await wait(30)
  const heldBack = !rec.some((m) => m.cmd === "say") && cv.saying()
  cv.through()
  await wait(30)
  const acked = rec.find((m) => m.cmd === "pcm")?.n as number, says = rec.filter((m) => m.cmd === "say")
  check("voice: an answer held for the realtime voice's route waits, then plays after its few words (numbered after them), which give way, none of it stopped",
    heldBack && says.length === 2 && says.every((m) => (m.n as number) > acked) && rec.some((m) => m.cmd === "yield" && m.n === acked && m.grace === 0.4) && !rec.some((m) => m.cmd === "stop"), rec)
  // (the realtime voice answered alone: the answer held goes unsaid, its words go on)
  cv.stop(); rec.length = 0
  const alone = cv.stream()
  alone.pcm(Buffer.alloc(480))
  cv.hold(); cv.begin("", "en", true); cv.text("n2", "Hello there, how can I help."); cv.end("n2")
  await wait(30)
  cv.drop()
  alone.end()
  await wait(30)
  check("voice: dropped, the answer held is never said, and the realtime voice's words aren't stopped", !rec.some((m) => m.cmd === "say" || m.cmd === "stop") && !cv.saying(), rec)
}

helper.stopHelper()
srv.close()
process.exit(fails ? 1 : 0)
