// Sharing from any machine (plugins/core/share/machines.ts): three servers, as the M1 (on the internet), an M4 (the same
// vault, not on the internet) and a mini PC (a vault of its own). The M4's shares are the M1's, served there; the mini
// PC's are its own, their links at the M1's address, which passes their guests on (pages, edits, live state, sockets).
// Starts the servers itself.
//   node web/qa/sharemachines.mjs <vault copy>
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { freePort, qa, until } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], browser, check, watch, done } = await qa(import.meta.url)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-sharemachines-"))
const ports = { m1: await freePort(), m4: await freePort(), minipc: await freePort() }, pubPort = await freePort()
const at = (id) => `http://127.0.0.1:${ports[id]}/`, PUB = `http://127.0.0.1:${pubPort}`
const vaults = Object.fromEntries(Object.keys(ports).map((id) => [id, path.join(tmp, id)]))
const machines = [{ id: "m1", label: "M1", url: at("m1").slice(0, -1) }, { id: "m4", label: "M4", url: at("m4").slice(0, -1) }, { id: "minipc", label: "Mini PC", url: at("minipc").slice(0, -1) }]
const put = (id, rel, text) => { fs.mkdirSync(path.dirname(path.join(vaults[id], rel)), { recursive: true }); fs.writeFileSync(path.join(vaults[id], rel), text) }
for (const id of Object.keys(ports)) {
  const v = vaults[id]
  fs.cpSync(VAULT, v, { recursive: true })
  const m = path.join(v, ".vaultite/plugins/machines")
  fs.mkdirSync(m, { recursive: true })
  fs.writeFileSync(path.join(m, "data.json"), JSON.stringify({ machines }))
  fs.writeFileSync(path.join(m, "vault.json"), JSON.stringify({ id: id === "minipc" ? "qa-sharemachines-other" : "qa-sharemachines-vault" }))
  const pj = path.join(v, ".vaultite/plugins.json"), on = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, "utf8")) : {}
  fs.writeFileSync(pj, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "machines"])], disabled: (on.disabled ?? []).filter((x) => x !== "machines") }))
}
for (const id of ["m1", "m4"]) put(id, "Theory/Intervals.md", "# Intervals\n\nA third up from C is E.\n")
put("minipc", "Studio/Session.md", "# Session\n\nOnly on the mini PC: MINIPC_WORDS.\n")
put("minipc", "Studio/Duel.html", `<!doctype html><html><head><title>Duel</title></head><body><script type="module">
window.room = await vau.shared(); window.__ready = true
</script></body></html>`)
const locals = Object.fromEntries(Object.keys(ports).map((id) => [id, path.join(tmp, `local-${id}`)]))
for (const l of Object.values(locals)) fs.mkdirSync(l, { recursive: true })
fs.writeFileSync(path.join(locals.m1, "config.json"), JSON.stringify({ mcp: { public: { url: PUB, port: pubPort } } }))
const procs = Object.keys(ports).map((id) => [ports[id], testServer({ stdio: "ignore", env: { ...process.env, PORT: String(ports[id]), HOST: "127.0.0.1", VAULTITE_VAULT: vaults[id], VAULTITE_LOCAL: locals[id] } })])
const stop = () => {
  for (const [port, proc] of procs) {
    if (proc.exitCode === null) proc.kill()
    try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
    spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
}
/** An op on a machine, as its owner's vau. */
const op = async (id, name, body = {}) => {
  const r = await fetch(`${at(id)}api/ops/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error, status: r.status }
}
const config = (id) => { try { return JSON.parse(fs.readFileSync(path.join(locals[id], "config.json"), "utf8")) } catch { return {} } }
const kept = (id) => Object.values(config(id).share?.shares ?? {})
const guestOpen = async (link, label, viewport = { width: 1200, height: 800 }) => {
  const ctx = await browser.newContext({ viewport })
  const page = watch(await ctx.newPage(), { label })
  // (once again if the first try missed: a busy machine can be slow to say what it shares)
  for (let i = 0; i < 2; i++) {
    await page.goto(link)
    if (await until(() => page.evaluate(() => location.hash === "#view/folder" && !!document.querySelector("[data-folder-view]")), 30_000)) break
  }
  return { ctx, page, base: `${PUB}${new URL(page.url()).pathname}` }
}

try {
  for (const id of Object.keys(ports)) await until(async () => (await fetch(`${at(id)}api/machines/self`)).ok, 60_000, 250)
  // (each knows the others are up before sharing)
  await until(async () => (await op("m4", "share.list")).length !== undefined && (await (await fetch(`${at("m4")}api/state`)).json()).shareLinks, 60_000, 1000)

  // The M4, not on the internet, shares a folder of the vault: the M1 keeps the share and serves it.
  const made = await op("m4", "share.create", { folder: "Theory", guest: "Ada Lovelace", role: "edit", days: 7 })
  check("the M4 makes a link, at the M1's address", String(made.link).startsWith(`${PUB}/s/`), made)
  check("...kept by the M1, not the M4", kept("m1").some((s) => s.guest === "Ada Lovelace" && !s.via) && !kept("m4").length, [kept("m1"), kept("m4")])
  const lists = [await op("m4", "share.list"), await op("m1", "share.list")]
  check("both list it, the same share", lists.every((l) => l.length === 1 && l[0].id === made.id), lists)
  const state = await (await fetch(`${at("m4")}api/state`)).json()
  check("the M4's tree marks the folder shared", state.sharedFolders?.Theory?.[0]?.guest === "Ada Lovelace", state.sharedFolders)
  const ada = await guestOpen(made.link, "M4's guest")
  check("its guest opens the folder, served by the M1", await until(() => ada.page.evaluate(() => document.body.innerText.includes("Intervals")), 20_000))
  const up = await op("m4", "share.update", { id: made.id, role: "comment" })
  check("the M4 changes the share's role there", up.role === "comment" && kept("m1")[0]?.role === "comment", [up, kept("m1")])
  const off = await op("m4", "share.revoke", { id: made.id })
  check("...and turns it off there", off.id === made.id && !kept("m1").length, kept("m1"))
  check("...its guest's link stops", (await fetch(`${ada.base}api/state`, { headers: { cookie: (await ada.ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).status === 401)
  await ada.ctx.close()

  // The mini PC, a vault of its own: it keeps the share, the link is the M1's, which passes its guest on.
  const mine = await op("minipc", "share.create", { folder: "Studio", guest: "Bob Baker", role: "edit", days: 7 })
  check("the mini PC makes a link at the M1's address", String(mine.link).startsWith(`${PUB}/s/`), mine)
  check("...kept on the mini PC, passed on by the M1", kept("minipc").some((s) => s.guest === "Bob Baker" && s.via === "m1") && !kept("m1").length, [kept("minipc"), kept("m1")])
  const phone = await guestOpen(mine.link, "mini PC's guest, phone", { width: 390, height: 844 })
  check("its guest opens the mini PC's folder through the M1, on a phone", await until(() => phone.page.evaluate(() => document.body.innerText.includes("Session")), 20_000))
  await phone.ctx.close()
  const bob = await guestOpen(mine.link, "mini PC's guest")
  await bob.page.goto(`${bob.base}#file/${encodeURIComponent("Session.md")}`)
  const ed = bob.page.locator(".cm-content").first()
  await ed.waitFor({ timeout: 30_000 })
  check("...reads its note", await until(async () => (await ed.innerText()).includes("MINIPC_WORDS"), 10_000))
  await ed.click()
  await bob.page.keyboard.press("ControlOrMeta+End")
  await bob.page.keyboard.type("\nBob was here.")
  const file = path.join(vaults.minipc, "Studio/Session.md")
  check("...and their edit lands on the mini PC, as theirs", await until(() => fs.readFileSync(file, "utf8").includes("Bob was here."), 15_000)
    && (await op("minipc", "provenance.blame", { path: "Studio/Session.md" })).runs?.some((r) => r.guest && r.text.includes("Bob was here")), fs.readFileSync(file, "utf8"))

  // A page's live state, the guest through the M1 and the owner on the mini PC.
  const frameOf = (p) => until(async () => {
    const f = p.frames().find((x) => x.url().includes("frame=1") && x.url().includes("Duel.html"))
    return f && (await f.evaluate(() => window.__ready)) ? f : null
  }, 30_000, 250)
  const ownerCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const owner = watch(await ownerCtx.newPage(), { label: "mini PC's owner" })
  await owner.goto(`${at("minipc")}#file/${encodeURIComponent("Studio/Duel.html")}`)
  await bob.page.goto("about:blank"); await bob.page.goto(`${bob.base}#file/${encodeURIComponent("Duel.html")}`)
  const [po, pg] = [await frameOf(owner), await frameOf(bob.page)]
  check("the page has both, the guest through the M1", !!po && !!pg && await until(async () => (await po.evaluate(() => window.room.people.map((x) => x.name).join())).includes("Bob Baker"), 10_000),
    await po?.evaluate(() => window.room.people))
  await pg.evaluate(() => window.room.set("bob", 1))
  await po.evaluate(() => window.room.set("owner", 1))
  check("...each sees the other's sets", await until(async () => (await po.evaluate(() => window.room.state.bob)) === 1 && (await pg.evaluate(() => window.room.state.owner)) === 1, 10_000))

  // Nothing else passes: an id no machine keeps, the relay itself to anyone but the owner, a path that isn't a guest's.
  const nowhere = await fetch(`${PUB}/s/${"A".repeat(11)}/`)
  const relay = (headers) => fetch(`${at("minipc")}api/share/relay`, { headers: { "x-share-path": `/s/${mine.id}/`, ...headers } })
  const [proxied, notGuest, ok] = [await relay({ "x-forwarded-for": "203.0.113.9" }), await fetch(`${at("minipc")}api/share/relay`, { headers: { "x-share-path": "/api/state" } }), await relay({})]
  check("an unknown share is nobody's; the relay answers only its owner, and only for guests' paths", nowhere.status === 403 && proxied.status === 403 && notGuest.status === 400 && ok.status === 403,
    [nowhere.status, proxied.status, notGuest.status, ok.status])
  check("the M1 lists none of the mini PC's shares (they're its own)", !(await op("m1", "share.list")).length)

  // Turned off on the mini PC: its guest's page goes offline, the link opens nothing.
  await op("minipc", "share.revoke", { id: mine.id })
  check("revoked on the mini PC, the guest's page goes offline", await until(() => pg.evaluate(() => window.room.online === false), 10_000))
  check("...and the M1 passes nothing on for it", (await fetch(`${bob.base}api/state`, { headers: { cookie: (await bob.ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).status === 401)
  await bob.ctx.close(); await ownerCtx.close()
} finally {
  stop()
}
await done()
