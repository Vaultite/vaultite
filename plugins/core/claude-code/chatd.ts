import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { codeOf, Host, listen, relayed } from "./chathost.ts"
import { holdRoot } from "../../../core/update/lease.ts"

const SOCK = process.argv[2]
if (!SOCK) { console.error("usage: chatd.ts <socket path> [<its files' path>]"); process.exit(2) }
const FILES = process.argv[3] || SOCK
const WIN = process.platform === "win32"
const SELF = fileURLToPath(import.meta.url)
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
void holdRoot(SELF, "chatd")

const sdk = await import("@anthropic-ai/claude-agent-sdk")
const { fromJSONSchema } = await import("zod")

const host = new Host({ query: sdk.query, mcp: relayed(sdk.createSdkMcpServer, fromJSONSchema) }, log)

const stale = () => !fs.existsSync(SELF)
const code = codeOf(path.dirname(SELF))

let served: ReturnType<typeof listen> | null = null
async function start() {
  const net = await import("node:net")
  const taken = await new Promise<boolean>((r) => {
    const probe = net.connect(SOCK)
    probe.on("connect", () => { probe.destroy(); r(true) })
    probe.on("error", () => r(false))
  })
  if (taken) { log("another one answers here: exiting"); process.exit(0) }
  const s = served = listen(host, SOCK, { log, hello: () => ({ file: SELF, stale: stale(), code }) })
  try { fs.writeFileSync(`${FILES}.pid`, `${process.pid}\n`) } catch {}
  log(`listening on ${SOCK} (pid ${process.pid})`)
  let alone = Date.now()
  setInterval(() => {
    if (s.conns() && !stale()) alone = Date.now()
    if (host.size || (Date.now() - alone < 60_000 && !stale())) return
    log(stale() ? "its files are gone: exiting" : "nothing left: exiting")
    for (const f of [...(WIN ? [] : [SOCK]), `${FILES}.pid`]) try { fs.rmSync(f, { force: true }) } catch {}
    process.exit(0)
  }, 15_000)
}
await start()

process.on("SIGHUP", () => {})
process.on("SIGINT", () => {})
process.on("SIGTERM", () => { void served?.stop(); host.close(); setTimeout(() => process.exit(0), 300) })
process.on("uncaughtException", (e) => log("uncaught:", e))
process.on("unhandledRejection", (e) => log("unhandled:", e))
