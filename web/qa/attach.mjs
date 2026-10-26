// The desktop app on a vault an always-on server here serves (core/serving.ts): its window attaches (electron/host.ts),
// through restarts, and answers for another machine's server. WRITES: the throwaway vault only.
//   node web/qa/attach.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-attach-"))
const RUN = path.join(TMP, "run"), OTHER = path.join(TMP, "run-other")
fs.mkdirSync(RUN)
fs.mkdirSync(OTHER)
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "machines", "web-viewer"])], disabled: (on.disabled ?? []).filter((x) => x !== "machines") }))

/** A server on the vault, as the service runs one (TMPDIR: which machine it's on). */
async function serve(port, tmpdir, local) {
  const p = testServer({ stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(TMP, local), HOST: "127.0.0.1", PORT: String(port), VAULTITE_DESKTOP: "", TMPDIR: tmpdir, XDG_RUNTIME_DIR: tmpdir } })
  let out = ""
  p.stdout.on("data", (d) => { out += d })
  p.stderr.on("data", (d) => { out += d })
  await until(() => /vaultite: vault read/.test(out), 60000)
  return p
}
const PORT = 20000 + Math.floor(Math.random() * 20000)
const ORIGIN = `http://127.0.0.1:${PORT}`
let server = await serve(PORT, RUN, "local")
const op = async (base, id, params) => {
  const r = await fetch(`${base}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}
const self = () => fetch(`${ORIGIN}/api/machines/self`).then((r) => r.json())

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, TMPDIR: RUN, XDG_RUNTIME_DIR: RUN, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "app-local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
check("the window is the running server's, not one of its own", new URL(win.url()).origin === ORIGIN, win.url())
check("… and the app started none", fs.readdirSync(process.platform === "darwin" ? RUN : path.join(RUN, "vaultite")).filter((f) => f.startsWith("vaultite-serves-")).length === 1 && !fs.existsSync(path.join(TMP, "app-local")))
await until(async () => (await self()).desktop === true, 15000)
check("the server has the app's browser now (Machines: desktop, standalone)", (await self()).desktop === true && (await self()).standalone === true)

const opened = await op(ORIGIN, "open", { url: `${ORIGIN}/api/machines/self` })
check("an agent's tab opens through the server", typeof opened?.tab === "number", opened)
const listed = async () => (await op(ORIGIN, "tabs"))
check("… and is listed", Array.isArray(await listed()) && (await listed()).some((t) => t.tab === opened.tab), await listed())
const busy = await fetch(`${ORIGIN}/api/machines/desktop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "agent:busy" }) }).then((r) => r.json())
check("an agent at work: the browser says it's busy (updates wait)", busy.value?.busy === true && typeof busy.value.why === "string", busy)
const desk = (args) => fetch(`${ORIGIN}/api/machines/desktop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "agent:busy", args }) }).then((r) => r.json())
await op(ORIGIN, "ask", { tab: opened.tab, reason: "Sign in, then Done" })
const [forApp, forServer] = [await desk([]), await desk(["server"])]
check("a pending ask holds the app's restart, the server's only while agents act", /waits on the user/.test(forApp.value?.why ?? "") && !/waits on the user/.test(forServer.value?.why ?? ""), [forApp, forServer])

server.kill("SIGTERM")
await new Promise((r) => server.once("exit", r))
server = await serve(PORT, RUN, "local")
await until(async () => (await self()).desktop === true, 20000)
const after = await listed()
check("the server restarted: the app attaches again, the agent's tab still there", Array.isArray(after) && after.some((t) => t.tab === opened.tab), after)
await until(async () => await win.locator("[role=tree]").count() > 0, 20000)
check("… and the window's page came back", await win.locator("[role=tree]").count() > 0)

// ---------- a server on another machine (another TMPDIR): this always-on machine's browser answers it ----------
const OTHER_PORT = PORT + 1
fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/machines"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/machines/data.json"), JSON.stringify({ machines: [
  { id: "home", label: "Home", url: ORIGIN }, { id: "away", label: "Away", url: `http://127.0.0.1:${OTHER_PORT}` }] }))
const other = await serve(OTHER_PORT, OTHER, "local-other")
const relayed = await op(`http://127.0.0.1:${OTHER_PORT}`, "tabs")
check("another machine's agents get this one's browser", Array.isArray(relayed) && relayed.some((t) => t.tab === opened.tab), relayed)
other.kill()

await app.close()
await until(async () => (await self()).desktop === false, 10000)
check("the app quit: the server has no browser, and keeps serving", (await self()).desktop === false)
server.kill()
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* a server still writing its folder */ }
await done()
