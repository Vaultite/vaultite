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
/** A Windows pipe isn't a file: its .pid goes beside FILES. */
const FILES = process.argv[3] || SOCK
const WIN = process.platform === "win32"
const SELF = fileURLToPath(import.meta.url)

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
// node-pty's ptys aren't close-on-exec: on Linux this one inherits those its starter held, and would keep them (and
// their shells' hangup) for as long as it runs. macOS' libuv spawns closing them.
if (process.platform === "linux") {
  for (const f of fs.readdirSync("/proc/self/fd")) {
    const fd = Number(f)
    if (fd <= 2) continue
    try { if (/^\/dev\/(ptmx|pts\/)/.test(fs.readlinkSync(`/proc/self/fd/${f}`))) fs.closeSync(fd) } catch { /* gone */ }
  }
}
void holdRoot(SELF, "termd")
/** node-pty runs spawn-helper by its path in the checkout: once that moved, no shell can start. */
const stale = () => !fs.existsSync(SELF) || !fs.existsSync(ptyDir)

const h = host({ log, pid: process.pid, file: SELF, stale, retire: () => retire(), changed: () => idleCheck() })

let lastConn = Date.now()
const LIVE = /-vaultite\.sock$/.test(path.basename(FILES))
const ORPHANED = Number(process.env.VAULTITE_TERMD_ORPHANED) || 60 * 60_000
let ending = false
function idleCheck() {
  h.trimEnded()
  if (stale()) { if (!retire() && orphaned()) endOrphans(); return }
  if (h.connections) return
  if (Date.now() - lastConn < 60_000) return
  for (const s of h.sessions.values()) if (s.spare) s.driver.kill()
  if (h.sessions.size) return
  log("nothing left: exiting")
  server.close()
  removeFiles()
  process.exit(0)
}

function orphaned() {
  const now = Date.now()
  return !LIVE && !ending && !h.connections && now - lastConn > ORPHANED &&
    [...h.sessions.values()].every((s) => !s.attached.size && now - s.activity > ORPHANED)
}
function endOrphans() {
  ending = true
  log(`ending ${h.sessions.size} terminals nobody used for an hour: this server's files are gone and its app with them`)
  h.killAll()
}

let retiring = false
function retire() {
  if (retiring) return true
  if ([...h.sessions.values()].some((s) => !s.spare)) return false
  retiring = true
  log(`retiring: this server's files are gone (${SELF})`)
  h.killAll()
  removeFiles()
  server.close()
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

/** Windows removes a pipe with its server. */
function removeFiles() {
  for (const f of [...(WIN ? [] : [SOCK]), `${FILES}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
}

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
      try { fs.writeFileSync(`${FILES}.pid`, `${process.pid}\n`) } catch { /* only for stopping it by hand */ }
      log(`listening on ${SOCK} (v${PROTOCOL}, pid ${process.pid})`)
    })
  })
}
server.on("error", (e) => { log("server:", e); process.exit(1) })
start()
setInterval(idleCheck, 15_000)
let tick = performance.now()
setInterval(() => {
  const now = performance.now(), late = now - tick - 1000
  tick = now
  if (late < 2000) return
  log(`its loop was held up ${Math.round(late)} ms`)
  h.trouble("", `its loop was held up ${(late / 1000).toFixed(1)} s: every terminal it holds waited meanwhile`)
}, 1000).unref()
process.on("SIGHUP", () => {})
process.on("SIGINT", () => {})
process.on("SIGTERM", () => {
  h.killAll()
  removeFiles()
  setTimeout(() => process.exit(0), 300)
})
process.on("uncaughtException", (e) => log("uncaught:", e))
process.on("unhandledRejection", (e) => log("unhandled:", e))
