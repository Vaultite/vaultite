// The terminal server: a detached Node process owning the app's terminals whole (host.ts), so they outlive the app's
// server: pty, screen and history, meta, OSC 7501, size, clients, how each ended. Its socket speaks protocol.ts.
import fs from "node:fs"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { lineReader } from "../lines.ts"
import { host, ptyDir, type Conn } from "./host.ts"
import { PROTOCOL } from "./protocol.ts"
import { holdRoot } from "../../../../core/update/lease.ts"

const SOCK = process.argv[2]
if (!SOCK) { console.error("usage: termd.ts <socket path> [<its files' path>]"); process.exit(2) }
/** Where its .pid goes (`${FILES}.pid`): the socket's path, or beside a pipe's (which isn't a file). */
const FILES = process.argv[3] || SOCK
const WIN = process.platform === "win32"
const SELF = fileURLToPath(import.meta.url)

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
// (run from a code root in the app's store: kept while it lives, as it outlives the app and its updates)
void holdRoot(SELF, "termd")
/** Its own files are gone (the checkout moved): node-pty runs spawn-helper by its path there, so no shell can start.
 *  It retires once it holds none, and the app's server starts another. */
const stale = () => !fs.existsSync(SELF) || !fs.existsSync(ptyDir)

const h = host({ log, pid: process.pid, file: SELF, stale, retire: () => retire(), changed: () => idleCheck() })

let lastConn = Date.now()
/** No terminals besides spare ones, and nobody connected for a minute: the spares end, and so does this. */
function idleCheck() {
  h.trimEnded()
  if (stale()) { retire(); return }
  if (h.connections) return
  if (Date.now() - lastConn < 60_000) return
  for (const s of h.sessions.values()) if (s.spare) s.driver.kill()
  if (h.sessions.size) return // (spares on their way out: next time)
  log("nothing left: exiting")
  server.close()
  removeFiles()
  process.exit(0)
}

let retiring = false
/** A stale server holding only spares makes way: frees its socket path at once, ends its spares and exits. False while
 *  it holds terminals (it keeps them and tries again each idleCheck). */
function retire() {
  if (retiring) return true
  if ([...h.sessions.values()].some((s) => !s.spare)) return false
  retiring = true
  log(`retiring: this server's files are gone (${SELF})`)
  h.killAll()
  removeFiles()
  server.close()
  // (after the answer that says so has gone out)
  setTimeout(() => { for (const s of sockets) s.destroy(); process.exit(0) }, 200)
  return true
}

const sockets = new Set<net.Socket>()
const server = net.createServer((sock) => {
  const c: Conn = {
    session: null, ready: false,
    send: (msg) => { if (!sock.destroyed) sock.write(JSON.stringify(msg) + "\n") },
    backlog: () => sock.writableLength,
  }
  const conn = h.connect(c)
  sockets.add(sock)
  lastConn = Date.now()
  sock.setEncoding("utf8")
  sock.on("data", lineReader((line) => {
    if (!line.trim()) return
    let m: Record<string, unknown>
    try { m = JSON.parse(line) } catch { return }
    conn.take(m)
  }))
  sock.on("drain", () => conn.drained())
  const gone = () => { if (sockets.delete(sock)) { conn.gone(); lastConn = Date.now() } }
  sock.on("close", gone)
  sock.on("error", gone)
})

/** Its socket file (not a pipe: Windows removes that with it) and pid file. */
function removeFiles() {
  for (const f of [...(WIN ? [] : [SOCK]), `${FILES}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
}

/** Another one already answers at this path: leave it be. A stale socket file (one that ended badly) is removed. */
function start() {
  const probe = net.connect(SOCK)
  probe.on("connect", () => { probe.destroy(); log("another one answers here: exiting"); process.exit(0) })
  probe.on("error", () => {
    if (!WIN) {
      try { fs.rmSync(SOCK, { force: true }) } catch { /* none */ }
      fs.mkdirSync(path.dirname(SOCK), { recursive: true })
    }
    server.listen(SOCK, () => {
      if (!WIN) try { fs.chmodSync(SOCK, 0o600) } catch { /* the folder is the user's anyway */ }
      // (on Windows it's also what says one runs: backend.ts looks for it rather than open the pipe)
      try { fs.writeFileSync(`${FILES}.pid`, `${process.pid}\n`) } catch { /* only for stopping it by hand */ }
      log(`listening on ${SOCK} (v${PROTOCOL}, pid ${process.pid})`)
    })
  })
}
server.on("error", (e) => { log("server:", e); process.exit(1) })
start()
setInterval(idleCheck, 15_000)
// The app's server going away isn't this one's business; only a SIGTERM (or SIGKILL) ends it, with its terminals.
process.on("SIGHUP", () => {})
process.on("SIGINT", () => {})
process.on("SIGTERM", () => {
  h.killAll()
  removeFiles()
  setTimeout(() => process.exit(0), 300)
})
process.on("uncaughtException", (e) => log("uncaught:", e))
// (this server ending would end every terminal: a failed promise is logged too)
process.on("unhandledRejection", (e) => log("unhandled:", e))
