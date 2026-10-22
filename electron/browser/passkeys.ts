// Passkeys from a phone (Electron has no WebAuthn UI: a page's request would wait forever). The page hands it here
// (passkeys-preload.cjs), the window shows a QR code, the phone answers over hybrid.ts. macOS: ble.swift hears it.
import { app, ipcMain, type IpcMainInvokeEvent, type Session } from "electron"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { eachPage, eachSession, handle, tell, type EnginePage } from "./engine.ts"
import { newKey, publicOf, qrText, run, type Progress } from "./hybrid.ts"
import { prepareCreate, prepareGet, readCreate, readGet, WebAuthnError, type Prepared } from "./webauthn.ts"

const PRELOAD = fileURLToPath(new URL("./passkeys-preload.cjs", import.meta.url))
const SWIFT = fileURLToPath(new URL("./ble.swift", import.meta.url))
/** How long a request waits for the phone: the page's own timeout, but never so short there's no time to scan. */
const MIN_MS = 120_000, MAX_MS = 600_000

/** What the window shows over a page while its request waits (`state` "done": nothing). */
type State = Progress | "bluetooth-off" | "bluetooth-denied" | "unavailable" | "done"
type Ask = { n: number; page: EnginePage; abort: AbortController; qr: string; site: string; create: boolean }
/** The request each page waits on, by the page's id: one at a time, as in a browser. */
const asks = new Map<number, Ask>()
let lastAsk = 0

const pages = new Map<number, EnginePage>() // by their contents' id
const sessions = new Set<Session>()
if (process.platform === "darwin") {
  eachPage((p) => {
    const id = p.wc.id
    pages.set(id, p)
    // (gone, or off to another page: its request ends with it)
    const stop = () => asks.get(p.id)?.abort.abort(new WebAuthnError("NotAllowedError", "The page went away."))
    p.wc.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) stop() })
    p.wc.once("destroyed", () => { stop(); pages.delete(id) })
  })
  eachSession((s) => {
    sessions.add(s)
    s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
  })
}

const show = (a: Ask, state: State) => tell(a.page.win, { type: "engine:passkey", id: a.page.id, tab: a.page.tab(), ask: a.n, state,
  qr: state === "scan" ? a.qr : "", site: a.site, create: a.create })

ipcMain.handle("vaultite:passkey", async (e, kind: unknown, json: unknown) => {
  try {
    return JSON.stringify({ ok: await request(e, kind, json) })
  } catch (err) {
    const w = err instanceof WebAuthnError ? err : new WebAuthnError("NotAllowedError", "The operation either timed out or was not allowed.")
    if (!(err instanceof WebAuthnError)) console.error("vaultite: a passkey request failed:", err)
    return JSON.stringify({ error: { name: w.name, message: w.message } })
  }
})
// (the page's AbortSignal)
ipcMain.on("vaultite:passkey:cancel", (e) => {
  const p = pages.get(e.sender.id)
  if (p) asks.get(p.id)?.abort.abort(new WebAuthnError("AbortError", "The operation was aborted."))
})
/** The user's Cancel over the page. */
handle("passkey:cancel", (win, n) => {
  for (const a of asks.values()) if (a.n === n && a.page.win === win) a.abort.abort(new WebAuthnError("NotAllowedError", "The user cancelled."))
})

async function request(e: IpcMainInvokeEvent, kind: unknown, json: unknown) {
  const p = pages.get(e.sender.id)
  // (a page's own frame only, never a frame in it: its origin is the page's, from Chromium, never from the page)
  if (!p || !sessions.has(e.sender.session) || !e.senderFrame || e.senderFrame !== e.sender.mainFrame) throw new WebAuthnError("NotAllowedError", "Passkeys work in a page's own frame only.")
  if (!p.visible()) throw new WebAuthnError("NotAllowedError", "The document is not focused.")
  if (asks.has(p.id)) throw new WebAuthnError("OperationError", "A request is already pending.")
  if (typeof json !== "string" || json.length > 64_000) throw new WebAuthnError("TypeError", "Bad options.")
  let options: unknown
  try { options = JSON.parse(json) } catch { throw new WebAuthnError("TypeError", "Bad options.") }
  const origin = e.senderFrame.origin
  const prepared: Prepared = kind === "create" ? prepareCreate(options, origin) : prepareGet(options, origin)
  const secret = crypto.randomBytes(16), identity = newKey()
  const a: Ask = { n: ++lastAsk, page: p, abort: new AbortController(), site: prepared.rpId, create: kind === "create",
    qr: qrText({ identity: publicOf(identity, true), secret, type: prepared.type }) }
  asks.set(p.id, a)
  const asked = (options as { timeout?: unknown }).timeout
  const ms = Math.min(MAX_MS, Math.max(MIN_MS, typeof asked === "number" && Number.isFinite(asked) ? asked : 300_000))
  const timer = setTimeout(() => a.abort.abort(new WebAuthnError("NotAllowedError", "The operation either timed out or was not allowed.")), ms)
  try {
    const answer = await run({ secret, identity, command: prepared.command, signal: a.abort.signal, progress: (s) => show(a, s),
      adverts: (on) => listen(on, (s) => show(a, s)) })
    return kind === "create" ? readCreate(answer, prepared) : readGet(answer, prepared)
  } finally {
    clearTimeout(timer)
    asks.delete(p.id)
    show(a, "done")
  }
}

// ---------- Bluetooth: ble.swift, running while some request listens ----------

type Listener = { advert: (a: Uint8Array) => void; state: (s: State) => void }
const listeners = new Set<Listener>()
let ble: ChildProcess | null = null
let bleState: State | null = null

function listen(advert: Listener["advert"], state: Listener["state"]) {
  const l = { advert, state }
  listeners.add(l)
  if (bleState && bleState !== "scan") state(bleState)
  if (!ble) void start()
  return () => {
    listeners.delete(l)
    if (!listeners.size && ble) { ble.stdin?.end(); ble = null; bleState = null }
  }
}

async function start() {
  let bin: string
  try { bin = await binary() } catch (e) {
    console.error("vaultite:", (e as Error).message)
    for (const l of listeners) l.state("unavailable")
    return
  }
  if (!listeners.size || ble) return
  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] })
  ble = child
  child.on("error", () => { if (ble === child) { ble = null; for (const l of listeners) l.state("unavailable") } })
  child.on("exit", () => { if (ble === child) ble = null })
  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    if (ble !== child) return
    if (line.startsWith("advert ")) {
      const a = Buffer.from(line.slice(7), "hex")
      for (const l of listeners) l.advert(a)
    } else if (line.startsWith("state ")) {
      const s = line.slice(6)
      bleState = s === "on" ? "scan" : s === "off" ? "bluetooth-off" : s === "unauthorized" ? "bluetooth-denied" : "unavailable"
      for (const l of listeners) l.state(bleState)
    }
  })
}

/** The listener's binary, compiled from its source the first time (and after it changes), as electron/apps.ts does. */
async function binary() {
  const src = fs.readFileSync(SWIFT)
  const out = path.join(app.getPath("userData"), "bin", `ble-${crypto.createHash("sha1").update(src).digest("hex").slice(0, 12)}`)
  if (fs.existsSync(out)) return out
  fs.mkdirSync(path.dirname(out), { recursive: true })
  // (built beside it, then moved in: a build cut off midway never leaves a binary that's reused)
  const tmp = `${out}.${process.pid}`
  await new Promise<void>((ok, fail) => execFile("/usr/bin/swiftc", ["-O", SWIFT, "-o", tmp], { timeout: 300_000 }, (e, _o, err) =>
    e ? fail(new Error(`Couldn't build the Bluetooth listener for passkeys (it needs Xcode's Command Line Tools): ${err || e.message}`)) : ok()))
  fs.renameSync(tmp, out)
  return out
}
