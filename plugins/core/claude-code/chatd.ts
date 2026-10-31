// The chat sessions' keeper: a detached Node process hosting Claude Code sessions through the Agent SDK (chathost.ts),
// so a turn running survives the server restarting or a deploy, as the terminal keeper's shells do (terminal/ptyd.ts).
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { Host, listen, type ToolDef } from "./chathost.ts"

const SOCK = process.argv[2]
if (!SOCK) { console.error("usage: chatd.ts <socket path> [<its files' path>]"); process.exit(2) }
const FILES = process.argv[3] || SOCK
const WIN = process.platform === "win32"
const SELF = fileURLToPath(import.meta.url)
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

const sdk = await import("@anthropic-ai/claude-agent-sdk")
const { fromJSONSchema } = await import("zod")

/** A relayed tool's parameters as the SDK takes them (zod, from the JSON Schema the server gives). */
const shapeOf = (schema: ToolDef["schema"]) => Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => {
  const z = fromJSONSchema(s as Parameters<typeof fromJSONSchema>[0])
  return [k, schema.required?.includes(k) ? z : z.optional()]
}))

const host = new Host({
  query: sdk.query,
  mcp: (name, tools) => sdk.createSdkMcpServer({ name, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: shapeOf(t.schema),
    handler: async (args: unknown) => (await t.run(args)) as Awaited<ReturnType<Parameters<typeof sdk.tool>[3]>> })) }),
}, log)

/** Its own files are gone (the checkout moved): it makes way once it holds no session, and the server starts another. */
const stale = () => !fs.existsSync(SELF)

/** Another one already answers at this path: leave it be. */
async function start() {
  const net = await import("node:net")
  const taken = await new Promise<boolean>((r) => {
    const probe = net.connect(SOCK)
    probe.on("connect", () => { probe.destroy(); r(true) })
    probe.on("error", () => r(false))
  })
  if (taken) { log("another one answers here: exiting"); process.exit(0) }
  const served = listen(host, SOCK, { log, hello: () => ({ file: SELF, stale: stale() }) })
  try { fs.writeFileSync(`${FILES}.pid`, `${process.pid}\n`) } catch { /* only for stopping it by hand */ }
  log(`listening on ${SOCK} (pid ${process.pid})`)
  // No session and nobody connected for a minute (or its files gone and no session): it ends.
  let alone = Date.now()
  setInterval(() => {
    if (served.conns() && !stale()) alone = Date.now()
    if (host.size || (Date.now() - alone < 60_000 && !stale())) return
    log(stale() ? "its files are gone: exiting" : "nothing left: exiting")
    for (const f of [...(WIN ? [] : [SOCK]), `${FILES}.pid`]) try { fs.rmSync(f, { force: true }) } catch { /* gone */ }
    process.exit(0)
  }, 15_000)
}
await start()

// The server going away isn't its business; a SIGTERM ends it, with its sessions (each saved in its transcript).
process.on("SIGHUP", () => {})
process.on("SIGINT", () => {})
process.on("SIGTERM", () => { host.close(); setTimeout(() => process.exit(0), 300) })
process.on("uncaughtException", (e) => log("uncaught:", e))
process.on("unhandledRejection", (e) => log("unhandled:", e))
