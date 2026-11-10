// A page hears what changed between reading the vault's state and its live socket connecting (/api/state's `live`
// mark, core/live.ts' hello), as it hears what changed while its socket was down: the socket is held while a file is
// made, then let go. Starts its own throwaway server; writes only its sandbox.
//   node web/qa/livestart.mjs
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, launch, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"
const { check, done, watch } = await qa(import.meta.url, { chrome: false })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-livestart-"))
const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", path.join(tmp, "vault")], { encoding: "utf8" })
if (made.status !== 0) { console.error(`livestart: couldn't make the sandbox\n${made.stderr || made.stdout}`); process.exit(1) }
const port = await freePort()
let log = ""
const server = testServer({ cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: path.join(tmp, "vault"), VAULTITE_LOCAL: path.join(tmp, "local") } })
server.stdout.on("data", (b) => { log += b })
server.stderr.on("data", (b) => { log += b })
const base = `http://127.0.0.1:${port}/`
let up = false
for (let i = 0; i < 120 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${base}api/state`)).ok } catch { await wait(250) } }
async function stop() {
  if (server.exitCode === null) { server.kill(); await new Promise((r) => server.once("exit", r)) }
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  fs.rmSync(tmp, { recursive: true, force: true })
}
if (!up) { console.error(`livestart: the server didn't start\n${log.slice(-2000)}`); await stop(); process.exit(1) }

/** A new note at the vault's top, through the API (as an agent's write: told on the live socket). */
const make = (name) => fetch(`${base}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: `${name}.md`, text: `# ${name}\n` }) })

const browser = await launch()
try {
  const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage())
  // The live socket, each connect held until let go (then passed to the server); `drop` ends the one up.
  let letGo = null, up = null
  const held = () => new Promise((r) => { letGo = r })
  let gate = held()
  await page.routeWebSocket(/\/api\/events(\?.*)?$/, async (ws) => {
    await gate
    up = ws.connectToServer()
  })
  const listed = (name) => page.locator(`[data-tree-path="${name}.md"]`).count()

  await page.goto(base)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 30000 })
  await page.waitForSelector('[data-tree-path="Start here.md"]', { timeout: 15000 })
  await make("Made before the socket")
  await wait(1000) // (told by the server's live events, before the socket connects)
  check("held: the page doesn't show it yet", (await listed("Made before the socket")) === 0)
  const first = letGo
  gate = held()
  first()
  check("a change between the state's read and the socket connecting is shown once it connects", await until(async () => (await listed("Made before the socket")) > 0, 8000))

  // Back from away (a phone waking: its socket gone, changes made meanwhile): the same way.
  await until(() => up, 5000)
  up.close()
  await wait(300)
  await make("Made while away")
  await wait(1000)
  check("away: not shown while the socket is down", (await listed("Made while away")) === 0)
  letGo()
  check("away: shown once it's back", await until(async () => (await listed("Made while away")) > 0, 5000)) // (before the 10 s poll a page down falls back on)
} finally {
  await browser.close()
  await stop()
}
await done()
