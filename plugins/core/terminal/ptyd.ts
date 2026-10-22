// The terminal's own keeper of shells: a detached Node process holding each pty and a headless xterm.js of its screen,
// so shells outlive the server and a returning page gets a picture of the screen (newline JSON over a Unix socket).
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { IPty } from "node-pty"
import type { Terminal as Headless } from "@xterm/headless"
import type { SerializeAddon as Serializer } from "@xterm/addon-serialize"
import { REPLY, watcher } from "./osc7501.ts"

const SOCK = process.argv[2]
if (!SOCK) { console.error("usage: ptyd.ts <socket path>"); process.exit(2) }
const V = 1
const SCROLLBACK = 10000 // lines the headless terminal keeps when the server doesn't say (its setting `scrollback`)

const require = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
const ptyDir = path.dirname(require.resolve("node-pty/package.json"))
/** Its prebuilt spawn-helper can arrive without the exec bit (npm skips install scripts, `npm ci` again): posix_spawnp
 *  fails. Fixed at the start, and again when a shell doesn't start. */
function fixHelper() {
  for (const sub of [`prebuilds/${process.platform}-${process.arch}`, "build/Release"]) {
    const helper = path.join(ptyDir, sub, "spawn-helper")
    try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755) } catch { /* not there */ }
  }
}
fixHelper()
/** Its own files are gone (the checkout moved): node-pty runs spawn-helper by its path there, so no shell can start.
 *  It retires once it holds none, and the server starts another. */
const stale = () => !fs.existsSync(SELF) || !fs.existsSync(ptyDir)
const pty = require("node-pty") as typeof import("node-pty")
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless")
const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize")

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

type Conn = { sock: net.Socket; session: Shell | null; ready: boolean; send: (m: object) => void; status?: boolean }
type Shell = {
  id: string; pty: IPty; term: Headless; ser: Serializer; created: number; activity: number; spare: boolean
  title: string; attached: Set<Conn>
  /** Output read while the headless terminal still parses the last piece: written (and passed on) as one. */
  queued: string; parsing: boolean
  /** Its program's OSC 7501 (osc7501.ts): the probe answered here, reports taken out of its output and kept. */
  status: ReturnType<typeof watcher>; told?: ReturnType<typeof setTimeout>
}
const shells = new Map<string, Shell>()
const conns = new Set<Conn>()

/** The screen and its whole history, for a page that comes back. */
const picture = (s: Shell) => s.ser.serialize({ scrollback: s.term.options.scrollback })

/** Passed on to the attached connections that have their picture (one that's waiting for it has this in it). */
function forward(s: Shell, d: string) {
  for (const c of s.attached) if (c.ready) c.send({ t: "data", d })
}

/** Output into the headless terminal, then on once parsed. While a piece is being parsed what follows waits and goes as
 *  one: a burst arrives in the pty's 30-byte reads, and one message each would cost every hop more than the bytes. */
function output(s: Shell, d: string) {
  if (s.parsing) { s.queued += d; return }
  s.parsing = true
  s.term.write(d, () => {
    forward(s, d)
    s.parsing = false
    const next = s.queued
    s.queued = ""
    if (next) output(s, next)
  })
}

/** Its records changed: the connections that follow them hear what they say now (a burst in one message). */
function statusChanged(s: Shell) {
  s.told ??= setTimeout(() => {
    s.told = undefined
    if (shells.get(s.id) !== s) return
    for (const c of conns) if (c.status) c.send({ t: "status", id: s.id, ...s.status.records.said() })
  }, 50)
}
// (VAULTITE_TRACE_7501: each report and probe in the log, to see what a program says)
const TRACE = !!process.env.VAULTITE_TRACE_7501

/** node-pty couldn't open a pseudo-terminal: on a Mac, usually all of them are taken (kern.tty.ptmx_max, 511). */
const noPty = (e: unknown) => /posix_openpt|openpty|forkpty/.test(String((e as Error)?.message ?? e))
function outOfPtys(id: string, e: unknown) {
  const held = shells.size
  log("create", id, `failed: no pseudo-terminal left (this keeper holds ${held} shells)`, e)
  return new Error(`the machine has no pseudo-terminal left (this keeper holds ${held} shells): end some terminals or tmux sessions (${(e as Error).message})`)
}

function create(m: Record<string, unknown>) {
  const id = String(m.id ?? "")
  if (!id) throw new Error("no id")
  if (shells.has(id)) throw new Error(`there's already a shell '${id}'`)
  const cols = Number(m.cols) || 80, rows = Number(m.rows) || 24
  const spawn = () => pty.spawn(String(m.file), (m.args as string[]) ?? [], {
    name: "xterm-256color", cols, rows, cwd: String(m.cwd || process.env.HOME || "/"), env: (m.env as Record<string, string>) ?? {},
  })
  let p: IPty
  try { p = spawn() } catch (e) {
    if (stale()) {
      log("create", id, "failed: this keeper's files are gone", e)
      // (RETIRING in the message: the server waits for this one to go, then asks the next: backend.ts)
      if (retire()) throw new Error(`RETIRING: this keeper's files are gone (${SELF}): ask the next one`)
      throw new Error(`this keeper's files are gone (${SELF}), and it still holds shells: ${(e as Error).message}`)
    }
    if (noPty(e)) throw outOfPtys(id, e)
    fixHelper()
    try { p = spawn() } catch (e2) { throw noPty(e2) ? outOfPtys(id, e2) : e2 }
  }
  const term = new Terminal({ cols, rows, scrollback: Number(m.scrollback) > 0 ? Number(m.scrollback) : SCROLLBACK, allowProposedApi: true })
  const ser = new SerializeAddon()
  term.loadAddon(ser as never)
  // The probe is answered as it's read, before what follows it (Claude Code's primary DA, which the headless terminal
  // or a page answers later): a DA answer first would say the protocol isn't spoken here.
  const status = watcher(() => {
    if (TRACE) log("7501", s.id, "probe answered")
    try { p.write(REPLY) } catch { /* ended */ }
  })
  const s: Shell = { id, pty: p, term, ser, created: Date.now(), activity: Date.now(), spare: !!m.spare, title: "", attached: new Set(), status,
    queued: "", parsing: false }
  term.onTitleChange((t) => { s.title = t })
  // Its answers to the programs' questions, only while no page is there to answer.
  term.onData((d) => { if (!s.attached.size) try { p.write(d) } catch { /* ended */ } })
  p.onData((raw) => {
    s.activity = Date.now()
    if (TRACE && raw.includes("\x1b]7501;")) for (const m of raw.matchAll(/\x1b\]7501;([^\x07\x1b]*)/g)) log("7501", s.id, JSON.stringify(m[1]))
    const { out: d, changed } = status.feed(raw)
    if (changed) statusChanged(s)
    if (d) output(s, d)
  })
  p.onExit(({ exitCode, signal }) => {
    // After what it printed last has been passed on (what waits to be parsed goes in first).
    if (s.queued) { const last = s.queued; s.queued = ""; term.write(last, () => forward(s, last)) }
    term.write("", () => {
      if (shells.get(s.id) === s) shells.delete(s.id)
      for (const c of s.attached) { c.send({ t: "exit", code: exitCode, signal: signal ?? 0 }); c.session = null }
      s.attached.clear()
      term.dispose()
      idleCheck()
    })
  })
  shells.set(id, s)
  log("create", id, s.spare ? "(spare)" : "", p.pid)
}

/** The screen and `lines` above it as text, a wrapped line joined to the one before, trailing blank lines left out. */
function screen(s: Shell, lines: number) {
  const b = s.term.buffer.active
  const out: string[] = []
  for (let y = Math.max(0, b.length - Math.max(lines, s.term.rows) * 2); y < b.length; y++) {
    const line = b.getLine(y)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && out.length) out[out.length - 1] += text; else out.push(text)
  }
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.slice(-lines).join("\n")
}

/** The terminal's foreground process group (what runs in front in it): Linux's /proc, else ps; 0 when unknown. */
function foreground(pid: number) {
  try {
    if (process.platform !== "linux") return Math.max(0, Number(execFileSync("ps", ["-o", "tpgid=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim()) || 0)
    const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), f = st.slice(st.lastIndexOf(")") + 2).split(" ")
    const tpgid = Number(f[5])
    return tpgid > 0 ? tpgid : 0
  } catch { return 0 }
}
/** What ran in front in an ended terminal and is still there 5 s after the hangup (an agent busy with a request may sit
 *  on SIGHUP): SIGTERM, then SIGKILL. Jobs sent to the background (nohup) are another group's, and left alone. */
function reap(pgid: number) {
  const alive = () => { try { process.kill(-pgid, 0); return true } catch { return false } }
  setTimeout(() => {
    if (!alive()) return
    try { process.kill(-pgid, "SIGTERM") } catch { /* gone */ }
    setTimeout(() => { if (alive()) try { process.kill(-pgid, "SIGKILL") } catch { /* gone */ } }, 5000).unref()
  }, 5000).unref()
}

// (Linux names it by its path, /bin/bash, from /proc: a Mac by its name)
function process_(s: Shell) { try { return path.basename(s.pty.process) } catch { return "" } }

function handle(c: Conn, m: Record<string, unknown>): Record<string, unknown> | null | undefined {
  const shell = (id: unknown) => {
    const s = shells.get(String(id ?? ""))
    if (!s) throw new Error(`there's no shell '${id}'`)
    return s
  }
  switch (m.op) {
    case "hello": return { v: V, pid: process.pid, file: SELF, stale: stale(), status: true }
    // This connection hears every shell's OSC 7501 records as they change ({t: "status", id, seen, status}).
    case "status": c.status = true; return {}
    // Its program ended (the server sees its shell at the prompt again): working and blocked records go.
    case "status-drop": { const s = shell(m.id); if (s.status.records.drop()) statusChanged(s); return {} }
    // Whether this process (its shells with it: macOS asks of the app that started it) can read a folder: the vault, which
    // macOS may let the app read and not a keeper an older build started. (Off the event loop: a prompt waits for its answer.)
    case "access":
      fs.promises.readdir(String(m.path)).then(() => c.send({ re: m.re, ok: true }), (e: NodeJS.ErrnoException) => c.send({ re: m.re, ok: false, code: e.code ?? "" }))
      return null
    case "create": create(m); return {}
    case "rename": {
      const s = shell(m.id), to = String(m.to ?? "")
      if (!to || shells.has(to)) throw new Error(`can't rename to '${to}'`)
      shells.delete(s.id); s.id = to; s.spare = false; shells.set(to, s)
      return {}
    }
    case "kill": {
      const s = shell(m.id)
      const fg = typeof m.signal === "string" ? 0 : foreground(s.pty.pid)
      try { s.pty.kill(typeof m.signal === "string" ? m.signal : "SIGHUP") } catch { /* ended */ }
      if (fg) reap(fg)
      return {}
    }
    case "list": return {
      sessions: [...shells.values()].map((s) => ({ id: s.id, pid: s.pty.pid, process: process_(s), created: s.created, activity: s.activity,
        attached: s.attached.size, title: s.title, cols: s.term.cols, rows: s.term.rows, spare: s.spare, said: s.status.records.said() })),
    }
    case "screen": { const s = shell(m.id); return { text: screen(s, Math.max(1, Math.min(s.term.options.scrollback ?? SCROLLBACK, Number(m.lines) || 50))) } }
    case "attach": {
      const s = shell(m.id)
      if (c.session) c.session.attached.delete(c)
      c.session = s; c.ready = false
      s.attached.add(c)
      s.term.write("", () => {
        if (c.session !== s) return
        c.send({ re: m.re, cols: s.term.cols, rows: s.term.rows })
        c.ready = true
      })
      return null
    }
    case "snapshot": {
      const s = c.session
      if (!s) throw new Error("not attached")
      s.term.write("", () => c.send({ re: m.re, data: picture(s) }))
      return null
    }
    case "input": {
      // To the attached shell, or (`id`: typing into one from outside, vau terminal send) that one.
      const s = m.id !== undefined ? shell(m.id) : c.session
      if (!s) return undefined
      s.activity = Date.now()
      // `paste` (vau terminal send, a long text, its markers taken out): bracketed when the program asked for that, so it
      // takes it whole rather than in the pty's pieces.
      const text = Buffer.from(String(m.b64 ?? ""), "base64")
      const data = m.paste && s.term.modes.bracketedPasteMode ? `\x1b[200~${text.toString("utf8")}\x1b[201~` : text
      try { s.pty.write(data as unknown as string) } catch { /* ended */ }
      return undefined
    }
    case "resize": {
      const s = c.session
      if (!s) return undefined
      const cols = Math.max(2, Math.min(1000, Number(m.cols) || 80)), rows = Math.max(1, Math.min(500, Number(m.rows) || 24))
      if (cols === s.term.cols && rows === s.term.rows) return undefined
      try { s.pty.resize(cols, rows) } catch { /* ended */ }
      s.term.resize(cols, rows)
      for (const o of s.attached) if (o !== c) o.send({ t: "size", cols, rows })
      return undefined
    }
    default: throw new Error(`unknown op '${m.op}'`)
  }
}

// ---------- the socket

let lastConn = Date.now()
/** No shells besides spare ones, and nobody connected for a minute: the spares end, and so does this. */
function idleCheck() {
  if (stale()) { retire(); return }
  if (conns.size) return
  if (Date.now() - lastConn < 60_000) return
  for (const s of shells.values()) if (s.spare) try { s.pty.kill("SIGHUP") } catch { /* ended */ }
  if ([...shells.values()].some((s) => !s.spare)) return
  if (shells.size) return // (spares on their way out: next time)
  log("nothing left: exiting")
  server.close()
  for (const f of [SOCK, `${SOCK}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
  process.exit(0)
}

let retiring = false
/** A stale keeper holding only spares makes way: frees its socket path at once, ends its spares and exits. False while
 *  it holds shells (it keeps them and tries again each idleCheck). */
function retire() {
  if (retiring) return true
  if ([...shells.values()].some((s) => !s.spare)) return false
  retiring = true
  log(`retiring: this keeper's files are gone (${SELF})`)
  for (const s of shells.values()) try { s.pty.kill("SIGHUP") } catch { /* ended */ }
  for (const f of [SOCK, `${SOCK}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
  server.close()
  // (after the answer that says so has gone out)
  setTimeout(() => { for (const c of conns) c.sock.destroy(); process.exit(0) }, 200)
  return true
}

const server = net.createServer((sock) => {
  const c: Conn = {
    sock, session: null, ready: false,
    send: (msg) => { if (!sock.destroyed) sock.write(JSON.stringify(msg) + "\n") },
  }
  conns.add(c)
  lastConn = Date.now()
  let buf = ""
  sock.setEncoding("utf8")
  sock.on("data", (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      let m: Record<string, unknown>
      try { m = JSON.parse(line) } catch { continue }
      try {
        const out = handle(c, m)
        // (null: it answers later itself)
        if (m.re !== undefined && out !== null) c.send({ re: m.re, ...out })
      } catch (e) {
        if (m.re !== undefined) c.send({ re: m.re, error: (e as Error).message })
      }
    }
  })
  const gone = () => {
    if (!conns.delete(c)) return
    c.session?.attached.delete(c)
    c.session = null
    lastConn = Date.now()
  }
  sock.on("close", gone)
  sock.on("error", gone)
})

/** Another one already answers at this path: leave it be. A stale socket file (one that ended badly) is removed. */
function start() {
  const probe = net.connect(SOCK)
  probe.on("connect", () => { probe.destroy(); log("another one answers here: exiting"); process.exit(0) })
  probe.on("error", () => {
    try { fs.rmSync(SOCK, { force: true }) } catch { /* none */ }
    fs.mkdirSync(path.dirname(SOCK), { recursive: true })
    server.listen(SOCK, () => {
      try { fs.chmodSync(SOCK, 0o600) } catch { /* the folder is the user's anyway */ }
      try { fs.writeFileSync(`${SOCK}.pid`, `${process.pid}\n`) } catch { /* only for stopping it by hand */ }
      log(`listening on ${SOCK} (v${V}, pid ${process.pid})`)
    })
  })
}
server.on("error", (e) => { log("server:", e); process.exit(1) })
start()
setInterval(idleCheck, 15_000)
// The server going away isn't this one's business; only a SIGTERM (or SIGKILL) ends it, with its shells.
process.on("SIGHUP", () => {})
process.on("SIGINT", () => {})
process.on("SIGTERM", () => {
  for (const s of shells.values()) try { s.pty.kill("SIGHUP") } catch { /* ended */ }
  for (const f of [SOCK, `${SOCK}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
  setTimeout(() => process.exit(0), 300)
})
process.on("uncaughtException", (e) => log("uncaught:", e))
// (the keeper ending would end every shell: a failed promise is logged too)
process.on("unhandledRejection", (e) => log("unhandled:", e))
