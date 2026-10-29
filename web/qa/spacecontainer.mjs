// A workspace's container in the desktop app (Electron, plugins/core/web-viewer/containers.ts destination): a page opened
// in no container goes to its workspace's (Work), unless its site always opens in another (Personal) or it was opened in
// one (explicit); without one, the workspace's own logins. WRITES the throwaway vault only (Workspaces on, a slot file).
//   node web/qa/spacecontainer.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-spacecontainer-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "300"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Here</title><p id=who>here</p>") })
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const p = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : {}
fs.writeFileSync(plugins, JSON.stringify({ ...p, enabled: [...(p.enabled ?? []).filter((x) => x !== "workspaces"), "workspaces"] }, null, 2))
const slot = path.join(VAULT, ".vaultite/plugins/workspaces/1.json")
fs.mkdirSync(path.dirname(slot), { recursive: true })
fs.writeFileSync(slot, JSON.stringify({ name: "Office", container: "work" }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
  const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
  const open = async (to) => { await ui({ action: "open", path: to, newTab: true }); await wait(500) }
  const visible = () => app.evaluate(({ BaseWindow, session }) => {
    const w = BaseWindow.getAllWindows()[0]
    const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
    if (!v) return null
    const parts = ["persist:web", "persist:web-c-work", "persist:web-c-personal"]
    return { url: v.webContents.getURL(), partition: parts.find((x) => session.fromPartition(x) === v.webContents.session) ?? "?" }
  })
  const shownIn = (q, partition) => until(async () => { const v = await visible(); return v?.url.endsWith(q) && v.partition === partition }, 15000)
  await setting({ containers: [{ id: "personal", name: "Personal", color: "blue" }, { id: "work", name: "Work", color: "orange" }] })
  await wait(800)

  await open(`view:web/${SITE}/?space`)
  check("a page opened in no container goes to its workspace's (Work)", await shownIn("?space", "persist:web-c-work"), await visible())
  await open(`view:web/@personal/${SITE}/?explicit`)
  check("one opened in a container stays there", await shownIn("?explicit", "persist:web-c-personal"), await visible())
  await setting({ containers: [{ id: "personal", name: "Personal", color: "blue", sites: ["127.0.0.1"] }, { id: "work", name: "Work", color: "orange" }] })
  await wait(800)
  await open(`view:web/${SITE}/?rule`)
  check("a site that always opens in Personal goes there, over the workspace's", await shownIn("?rule", "persist:web-c-personal"), await visible())
  await setting({ containers: [{ id: "personal", name: "Personal", color: "blue" }, { id: "work", name: "Work", color: "orange" }] })
  await fetch(`${origin}/api/workspaces/1`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ container: null }) })
  await wait(1500)
  await open(`view:web/${SITE}/?none`)
  check("without one, the workspace's own logins", await shownIn("?none", "persist:web"), await visible())
} finally {
  await app.close().catch(() => {})
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
