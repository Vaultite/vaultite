// Taking over an older terminal server's terminals (protocol 1: ptyd.ts, the keeper before), held through it and mirrored
// here (screen, OSC 7501, end), so an upgrade keeps them whole; once its last one ends it's let go, and it exits.
import net from "node:net"
import { lineReader } from "../lines.ts"
import type { Said } from "../osc7501.ts"
import { PROTOCOL } from "./protocol.ts"
import { type Driver, Session } from "./host.ts"

type Msg = Record<string, unknown>
/** One connection to the older server: requests answered in stream order, and the messages between them. */
type Wire = { sock: net.Socket; send(m: Msg): void; ask(m: Msg, ms?: number): Promise<Msg>; call(m: Msg, fn: (a: Msg) => void): void; on(fn: (m: Msg) => void): void }
function connect(socket: string): Promise<Wire> {
  return new Promise((ok, fail) => {
    const sock = net.connect(socket)
    let seq = 0
    const waiting = new Map<number, (m: Msg) => void>(), heard = new Set<(m: Msg) => void>()
    sock.setEncoding("utf8")
    sock.on("data", lineReader((line) => {
      let m: Msg
      try { m = JSON.parse(line) } catch { return }
      const w = typeof m.re === "number" ? waiting.get(m.re) : undefined
      if (w) { waiting.delete(m.re as number); w(m) } else for (const fn of heard) fn(m)
    }))
    const close = () => { for (const w of waiting.values()) w({ error: "it went away" }); waiting.clear() }
    sock.on("close", close)
    sock.once("error", fail)
    sock.once("connect", () => {
      sock.removeListener("error", fail)
      sock.on("error", close)
      ok({
        sock,
        send: (m) => { if (!sock.destroyed) sock.write(JSON.stringify(m) + "\n") },
        ask: (m, ms = 5000) => new Promise((resolve, reject) => {
          const re = ++seq
          const timer = setTimeout(() => { waiting.delete(re); reject(new Error(`it didn't answer ${m.op}`)) }, ms)
          waiting.set(re, (a) => { clearTimeout(timer); if (typeof a.error === "string") reject(new Error(a.error)); else resolve(a) })
          sock.write(JSON.stringify({ ...m, re }) + "\n")
        }),
        // (its answer as it arrives, between the messages around it: a promise's would come after the next ones)
        call: (m, fn) => { const re = ++seq; waiting.set(re, fn); sock.write(JSON.stringify({ ...m, re }) + "\n") },
        on: (fn) => { heard.add(fn) },
      })
    })
  })
}

type Kit = {
  around: ConstructorParameters<typeof Session>[0]
  sessions: Map<string, Session>
  dropStatus: WeakMap<Session, () => void>
}

type Listed = { id: string; pid?: number; process?: string; created?: number; title?: string; cols?: number; rows?: number; spare?: boolean; said?: Said }

/** How long before terminals it couldn't take over are tried again (a minute, then two... at most ten), for as long as
 *  they run there: given up on, they'd keep the older server running, unseen. */
const retryIn = (tries: number) => Math.min(60_000 * (tries + 1), 600_000)

/** adopt(socket): the older server there's terminals, taken over (the ids now held through it). Asked again while it
 *  runs, the same answer. */
export function adopter(k: Kit) {
  const going = new Map<string, Promise<string[]>>()
  const adopt = (socket: string, scrollback: number, tries = 0): Promise<string[]> => {
    if (!socket) return Promise.reject(new Error("which server? give its socket"))
    let p = going.get(socket)
    if (!p) {
      p = adoptFrom(k, socket, scrollback, tries, () => {
        // (one it couldn't take over, a snapshot too slow on a loaded machine, still runs there)
        setTimeout(() => void adopt(socket, scrollback, tries + 1).catch(() => {}), retryIn(tries)).unref()
      })
      going.set(socket, p)
      p.catch(() => {}).finally(() => { if (going.get(socket) === p) going.delete(socket) })
    }
    return p
  }
  return adopt
}

async function adoptFrom(k: Kit, socket: string, scrollback: number, tries: number, failed: () => void): Promise<string[]> {
  let ctl: Wire
  try { ctl = await connect(socket) } catch { return [] } // (none runs there)
  const mine = new Map<string, Session>()
  const procs = new Map<string, string>()
  let via: number, listed: Listed[]
  try {
    const hello = await ctl.ask({ op: "hello" })
    if (Number(hello.v) >= PROTOCOL) throw new Error(`the server at ${socket} speaks protocol ${hello.v}, not an older one`)
    via = Number(hello.pid) || 0
    // Its terminals' OSC 7501 as they change (it answers their probes itself), and what runs in each, asked every 2 s.
    ctl.on((m) => { if (m.t === "status" && typeof m.id === "string") mine.get(m.id)?.status({ seen: !!m.seen, status: (m.status ?? null) as Said["status"] }) })
    ctl.send({ op: "status" })
    listed = ((await ctl.ask({ op: "list" })).sessions ?? []) as Listed[]
  } catch (e) { ctl.sock.destroy(); throw e }
  const poll = setInterval(() => {
    ctl.ask({ op: "list" }).then((r) => { for (const x of (r.sessions ?? []) as Listed[]) { procs.set(x.id, x.process ?? ""); const s = mine.get(x.id); if (s && x.title && !s.title) s.title = x.title } }, () => {})
  }, 2000)
  const done = (said = "") => {
    if (mine.size) return
    clearInterval(poll)
    ctl.sock.destroy()
    if (said) k.around.log(said, socket)
    k.around.changed?.()
  }
  ctl.sock.on("close", () => clearInterval(poll))
  let missed = 0
  for (const x of listed) {
    // (its ready shells were the app's spares: a new one is made here)
    if (x.spare || x.id.startsWith("vauspare-")) { await ctl.ask({ op: "kill", id: x.id }).catch(() => {}); continue }
    if (k.sessions.has(x.id)) continue
    try {
      const s = await adoptOne(k, socket, ctl, x, via, scrollback, procs, 15_000 * (tries + 1))
      mine.set(x.id, s)
      s.meta = { ...s.meta }
      const end = s.ended.bind(s)
      s.ended = (exit) => { end(exit); if (mine.delete(x.id)) done("adopted: none left at") }
    } catch (e) { missed++; k.around.log("adopt", x.id, "failed:", e) }
  }
  k.around.log(`adopted ${mine.size} from ${socket} (pid ${via})${missed ? `, ${missed} not yet` : ""}`)
  done()
  if (missed) failed()
  return [...mine.keys()]
}

async function adoptOne(k: Kit, socket: string, ctl: Wire, x: Listed, via: number, scrollback: number, procs: Map<string, string>, snapshotMs: number) {
  const w = await connect(socket)
  // (`abandoned`: not taken over after all: it still runs there, so its connection closing isn't its end)
  let s: Session | null = null, pictured = false, abandoned = false
  const early: Msg[] = []
  const take = (m: Msg) => {
    if (m.t === "data" && typeof m.d === "string") { if (pictured) s!.output(m.d) }
    else if (m.t === "size") { s!.term.resize(Number(m.cols) || s!.term.cols, Number(m.rows) || s!.term.rows) }
    else if (m.t === "exit") { s!.ended({ code: Number(m.code) || 0, signal: Number(m.signal) || 0 }); w.sock.destroy() }
  }
  w.on((m) => { if (!s) early.push(m); else take(m) })
  w.sock.on("close", () => { if (!abandoned) s?.ended({ code: 0, signal: 0, lost: true }) })
  let a: Msg
  try { a = await w.ask({ op: "attach", id: x.id }) } catch (e) { w.sock.destroy(); throw e }
  procs.set(x.id, x.process ?? "")
  const driver: Driver = {
    pid: x.pid ?? 0,
    via,
    write: (d) => w.send({ op: "input", b64: Buffer.from(d as string).toString("base64") }),
    resize: (cols, rows) => w.send({ op: "resize", cols, rows }),
    kill: (signal) => ctl.send({ op: "kill", id: x.id, ...(signal ? { signal } : {}) }),
    pause: () => w.sock.pause(),
    resume: () => w.sock.resume(),
    process: () => procs.get(x.id) ?? "",
  }
  s = new Session(k.around, { id: x.id, driver, shell: x.process ?? "", cwd: "", command: "", cols: Number(a.cols) || 80, rows: Number(a.rows) || 24, scrollback, spare: false, created: x.created })
  s.title = x.title ?? ""
  if (x.said) s.said = x.said
  k.dropStatus.set(s, () => ctl.send({ op: "status-drop", id: x.id }))
  k.sessions.set(x.id, s)
  for (const m of early.splice(0)) take(m)
  // Its picture has everything it showed until now (what came before it is in it), then what it prints from there on.
  const sess = s
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("it didn't answer snapshot")), snapshotMs)
    w.call({ op: "snapshot" }, (pic) => {
      clearTimeout(timer)
      if (typeof pic.error === "string") return fail(new Error(pic.error))
      sess.term.write(String(pic.data ?? ""))
      pictured = true
      ok()
    })
  }).catch((e) => {
    abandoned = true
    if (k.sessions.get(x.id) === sess) k.sessions.delete(x.id)
    w.sock.destroy()
    sess.term.dispose()
    throw e
  })
  return s
}
