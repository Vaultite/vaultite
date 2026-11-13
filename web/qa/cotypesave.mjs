// A note typed in from two windows while an agent writes it: when one window goes, the other's saves lose nothing.
// The owner's two windows, the owner's and a guest's, a guest's alone. Starts its own server on a copy of the vault.
//   node web/qa/cotypesave.mjs <vault copy>
// Paths: plugins/core/companion/cotype.ts, editor/Editor.tsx, components/FileView.tsx, core/autosave.ts, plugins/core/share
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { freePort, qa, until } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], browser, check, watch, done } = await qa(import.meta.url)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-cotypesave-"))
const [port, pubPort] = [await freePort(), await freePort()]
const B = `http://127.0.0.1:${port}/`, PUB = `http://127.0.0.1:${pubPort}`
const V = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local"), F = "Lighthouse"
fs.cpSync(VAULT, V, { recursive: true })
fs.mkdirSync(path.join(V, ".vaultite/plugins/machines"), { recursive: true })
fs.writeFileSync(path.join(V, ".vaultite/plugins/machines/data.json"), JSON.stringify({ machines: [] }))
fs.mkdirSync(LOCAL, { recursive: true })
fs.writeFileSync(path.join(LOCAL, "config.json"), JSON.stringify({ mcp: { public: { url: PUB, port: pubPort } } }))
fs.mkdirSync(path.join(V, F), { recursive: true })
for (const n of ["Two windows", "With a guest", "Guest alone"]) fs.writeFileSync(path.join(V, F, `${n}.md`), `# ${n}\n\nThe keeper's log.\n`)
const read = (n) => fs.readFileSync(path.join(V, F, `${n}.md`), "utf8")

const server = testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: V, VAULTITE_LOCAL: LOCAL } })
const stop = () => {
  if (server.exitCode === null) server.kill()
  try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
}
const op = async (id, body) => { const j = await (await fetch(`${B}api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli" }, body: JSON.stringify(body) })).json(); return j.result ?? j }
const append = (n, line) => op("file.write", { path: `${F}/${n}.md`, text: `${read(n)}\n${line}\n` })
const typeTop = async (p, s) => { await p.locator(".cm-line", { hasText: "The keeper's log." }).click(); await p.keyboard.press("Home"); await p.keyboard.type(s) }
const shows = (p, s) => until(() => p.evaluate((s) => !!document.querySelector(".cm-content")?.textContent?.includes(s), s), 15_000)
const kept = async (n, ...lines) => !(await until(() => !lines.every((l) => read(n).includes(l)), 3000))
const bound = new WeakSet()
const opened = async (ctx, url, label) => {
  const p = watch(await ctx.newPage(), { label })
  p.on("websocket", (ws) => ws.on("framereceived", (f) => { if (/"t":"y-state"/.test(String(f.payload)) && /"u":"/.test(String(f.payload))) bound.add(p) }))
  await p.goto(url)
  await p.locator(".cm-content").first().waitFor({ timeout: 30_000 })
  return p
}
const together = (...ps) => until(() => ps.every((p) => bound.has(p)), 15_000)

try {
  await until(async () => (await fetch(`${B}api/state`)).ok, 60_000, 250)
  const ownerCtx = await browser.newContext({ viewport: { width: 1200, height: 850 } })
  const at = (n) => `${B}#file/${encodeURIComponent(`${F}/${n}.md`)}`

  let n = "Two windows"
  const watcher = await opened(ownerCtx, at(n), "watcher")
  let typist = await opened(ownerCtx, at(n), "typist")
  check("two windows type together", await together(typist, watcher))
  await typeTop(typist, "Fog at dawn. ")
  await until(() => read(n).includes("Fog at dawn."), 10_000)
  await append(n, "Lamp checked by the agent.")
  check("two windows: the agent's line reaches both", await shows(typist, "Lamp checked by the agent.") && await shows(watcher, "Lamp checked by the agent."))
  check("...and what the other typed reaches the one that watches", await shows(watcher, "Fog at dawn."))
  await typist.close({ runBeforeUnload: true })
  check("two windows: the one left alone saves nothing over the other's typing or the agent's line", await kept(n, "Fog at dawn.", "Lamp checked by the agent."), read(n))
  await watcher.close({ runBeforeUnload: true })
  check("...nor once it goes too", await kept(n, "Fog at dawn.", "Lamp checked by the agent."), read(n))

  const { link } = await op("share.create", { folder: F, guest: "Ada Park", role: "edit", days: 1 })
  const guestCtx = await browser.newContext({ viewport: { width: 1200, height: 850 } })
  const landing = watch(await guestCtx.newPage(), { label: "guest" })
  await landing.goto(link)
  await until(() => landing.evaluate(() => !!document.querySelector("[data-folder-view]")), 30_000)
  const gat = (n) => `${PUB}${new URL(landing.url()).pathname}#file/${encodeURIComponent(`${n}.md`)}`
  await landing.close()
  n = "With a guest"
  const owner = await opened(ownerCtx, at(n), "owner")
  let guest = await opened(guestCtx, gat(n), "guest")
  check("owner and guest type together", await together(guest, owner))
  await typeTop(guest, "Ada saw a ship. ")
  await until(() => read(n).includes("Ada saw a ship."), 10_000)
  await append(n, "Lamp checked by the agent.")
  check("owner and guest: the agent's line reaches both", await shows(guest, "Lamp checked by the agent.") && await shows(owner, "Lamp checked by the agent."))
  await guest.close({ runBeforeUnload: true })
  check("owner and guest: the guest goes, and the owner's window saves nothing over the guest's line or the agent's", await kept(n, "Ada saw a ship.", "Lamp checked by the agent."), read(n))
  await owner.close({ runBeforeUnload: true })
  check("...nor once it goes too", await kept(n, "Ada saw a ship.", "Lamp checked by the agent."), read(n))

  n = "Guest alone"
  guest = await opened(guestCtx, gat(n), "guest-alone")
  await append(n, "Lamp checked by the agent.")
  check("a guest alone: the write reaches the open note", await shows(guest, "Lamp checked by the agent."))
  await typeTop(guest, "Ada saw a ship. ")
  await guest.close({ runBeforeUnload: true })
  check("...and their last typing, saved as the page goes, keeps it", await until(() => read(n).includes("Ada saw a ship."), 10_000) && await kept(n, "Ada saw a ship.", "Lamp checked by the agent."), read(n))
  await Promise.all([ownerCtx, guestCtx].map((c) => c.close()))
} finally {
  stop()
}
await done()
