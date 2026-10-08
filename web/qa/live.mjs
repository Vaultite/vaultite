// Live updates: files changed on disk behind the app's back (as Claude or another editor would) show up without a
// reload, within about a second: the file tree (new, renamed, deleted), an open editor (and typing while a change
// arrives: both kept; a change in two places around the cursor leaves it where it was; lines added above what's being
// read don't move it; moved through the API while typing: the tab follows and the typing is saved there; renamed on
// disk: the unsaved edits are offered back), a dashboard (its text, a block drawn from the store, a table embed), an artifact (its data, and
// its own file) and a file deleted while open. Also that the page never reloaded, the socket reconnects, and the store
// (refreshed by patches) is the server's state after all that.
// WRITES to the vault (everything under "Qa live/", plus Dashboards/Qa live.md and Books/Qa live book.md, removed at
// the end): throwaway server only.
//   node web/qa/live.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, done } = await qa(import.meta.url)
const abs = (p) => `${VAULT}/${p}`
const read = (p) => readFileSync(abs(p), "utf8")
const write = (p, t) => { mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), t) }
const out = { errs: [], ms: {} }
/** Poll until fn() is truthy (up to ms); how long it took, or null. */
async function until(fn, ms = 4000) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await fn().catch(() => false)) return Date.now() - t; await wait(50) }
  return null
}
const cleanup = () => {
  for (const p of ["Qa live", "Qa live 2", "Dashboards/Qa live.md", "Books/Qa live book.md"]) rmSync(abs(p), { recursive: true, force: true })
}
cleanup()
write("Qa live/Note.md", "First line.\n\nSecond line.\n\nThird line.\n")
write("Qa live/Table.csv", "name,n\na,1\nb,2\n")
write("Qa live/Page.html", `<!doctype html><html><head><title>Qa live page</title></head><body><h1 id="h">Version one</h1>
<p id="n">...</p><script>
async function draw() { const rows = await vau.csv("Table.csv"); document.getElementById("n").textContent = "Rows: " + rows.length }
draw(); vau.on("change", draw)
</script></body></html>\n`)
write("Dashboards/Qa live.md", "---\ntype: dashboard\nicon: book\ntint: learning\n---\n\nLive count one.\n\n```block-books\n```\n\n![[Qa live/Table.csv]]\n")
await wait(800)

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
// Keep every WebSocket the app makes, to close one under it.
await ctx.addInitScript(() => {
  const WS = window.WebSocket
  window.__qaSockets = []
  window.WebSocket = class extends WS { constructor(...a) { super(...a); window.__qaSockets.push(this) } }
})
const page = await ctx.newPage()
page.on("pageerror", (e) => out.errs.push(String(e)))
page.on("console", (m) => m.type() === "error" && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text()) && out.errs.push(m.text()))
const shot = (name) => page.screenshot({ path: `${OUT}live-${name}.png` })
const openFile = async (p) => { await page.goto(`${B}#file/${encodeURIComponent(p)}`); await wait(1500) }
await page.goto(B); await wait(1500)
await page.evaluate(() => { window.__qaMarker = 1 })
const marker = () => page.evaluate(() => window.__qaMarker === 1)
const tree = page.locator("aside [role=tree]")
const inTree = (name) => tree.locator("button", { hasText: new RegExp(`^${name}$`) }).count()

// ---------- the file tree ----------
// By path: Dashboards/Qa live.md has the same name, and the open page's folder (Dashboards) is revealed above it.
if (!await inTree("Note")) await tree.locator('[data-tree-path="Qa live"] > button').first().click()
await wait(300)
check("tree: the folder made on disk is there", await inTree("Note") > 0)
write("Qa live/Made on disk.md", "Hello.\n")
out.ms.treeNew = await until(async () => await inTree("Made on disk") > 0)
check("tree: a file made on disk appears", out.ms.treeNew !== null, out.ms.treeNew)
renameSync(abs("Qa live/Made on disk.md"), abs("Qa live/Renamed on disk.md"))
out.ms.treeRename = await until(async () => await inTree("Renamed on disk") > 0 && await inTree("Made on disk") === 0)
check("tree: a file renamed on disk follows", out.ms.treeRename !== null, out.ms.treeRename)
rmSync(abs("Qa live/Renamed on disk.md"))
out.ms.treeDelete = await until(async () => await inTree("Renamed on disk") === 0)
check("tree: a file deleted on disk goes", out.ms.treeDelete !== null, out.ms.treeDelete)

// ---------- an open editor ----------
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Qa live/Note.md"); await wait(1500)
await page.evaluate(() => { window.__qaMarker = 1 })
const content = () => page.locator(".cm-content").first().innerText()
write("Qa live/Note.md", read("Qa live/Note.md") + "\nAdded on disk.\n")
out.ms.editor = await until(async () => (await content()).includes("Added on disk."))
check("editor: a change on disk shows in the open file", out.ms.editor !== null, await content())
// typing while a change arrives on another line: both kept, in the editor and on disk
await page.locator(".cm-line", { hasText: "First line." }).first().click(); await page.keyboard.press("End")
await page.keyboard.type(" Typed", { delay: 40 })
write("Qa live/Note.md", read("Qa live/Note.md").replace("Third line.", "Third line, edited on disk."))
await page.keyboard.type(" here.", { delay: 40 })
await until(async () => read("Qa live/Note.md").includes("Typed here.") && (await content()).includes("edited on disk"), 5000)
await wait(1200)
const disk = read("Qa live/Note.md"), shown = await content()
check("editor: typing during a disk change keeps both, on disk", disk.includes("First line. Typed here.") && disk.includes("Third line, edited on disk.") && disk.includes("Added on disk."), disk)
check("editor: and on screen", shown.includes("First line. Typed here.") && shown.includes("Third line, edited on disk."), shown)
check("editor: no conflict banner", await page.locator("text=/changed on disk|Keep mine|Keep theirs/i").count() === 0)
// changed in two places at once, above and below the cursor: the cursor stays in its line and the next letter lands there
await page.locator(".cm-line", { hasText: "Second line." }).first().click(); await page.keyboard.press("End"); await wait(900)
write("Qa live/Note.md", read("Qa live/Note.md").replace("First line.", "First line, above.").replace("Added on disk.", "Added on disk, below."))
await until(async () => (await content()).includes("below."))
await page.keyboard.type("!", { delay: 40 }); await wait(1200)
check("editor: two changes on disk around the cursor leave it where it was", read("Qa live/Note.md").includes("Second line.!"), read("Qa live/Note.md"))
// lines added above what's being read (not typing): it stays where it is on screen
write("Qa live/Note.md", Array.from({ length: 120 }, (_, i) => `Paragraph ${i}.`).join("\n\n") + "\n"); await wait(1500)
await page.evaluate(() => document.activeElement?.blur())
await page.locator("#main-scroll").evaluate((s) => s.scrollTo(0, 3000)); await wait(400)
const where = (t) => page.evaluate((t) => { const l = [...document.querySelectorAll(".cm-line")].find((e) => e.textContent === t); return l ? Math.round(l.getBoundingClientRect().top) : null }, t)
const seen = await page.evaluate(() => [...document.querySelectorAll(".cm-line")].find((e) => e.getBoundingClientRect().top > 300 && e.textContent.trim()).textContent)
const y0 = await where(seen)
write("Qa live/Note.md", "Inserted above.\n\nAnd again.\n\n" + read("Qa live/Note.md"))
await until(async () => (await content()).includes("Inserted above."))
await wait(300)
check("editor: lines added above what's being read don't move it", y0 !== null && Math.abs((await where(seen)) - y0) <= 1, [seen, y0, await where(seen)])
await shot("editor")

// ---------- a dashboard ----------
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Dashboards/Qa live.md"); await wait(2000)
const main = page.locator("#main-scroll")
check("dashboard: drawn", await main.locator("text=Live count one.").count() > 0)
write("Dashboards/Qa live.md", read("Dashboards/Qa live.md").replace("Live count one.", "Live count two."))
out.ms.dashText = await until(async () => await main.locator("text=Live count two.").count() > 0)
check("dashboard: its text follows the file", out.ms.dashText !== null)
write("Books/Qa live book.md", "---\ntype: book\nauthor: Bob Lee\nstatus: reading\n---\n\n```block-book\n```\n")
out.ms.dashBlock = await until(async () => await main.locator("text=Qa live book").count() > 0)
check("dashboard: a block drawn from the store follows (a book made on disk)", out.ms.dashBlock !== null)
write("Qa live/Table.csv", read("Qa live/Table.csv") + "zeta row,3\n")
out.ms.dashTable = await until(async () => await main.locator("text=zeta row").count() > 0)
check("dashboard: a table embed follows its CSV", out.ms.dashTable !== null)
await shot("dashboard")

// ---------- an artifact ----------
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Qa live/Page.html"); await wait(2500)
const frame = page.frameLocator("#main-scroll iframe").first()
const rows = () => frame.locator("#n").innerText()
check("artifact: drawn from its CSV", (await rows().catch(() => "")) === "Rows: 3", await rows().catch((e) => String(e)))
write("Qa live/Table.csv", read("Qa live/Table.csv") + "d,4\n")
out.ms.artifactData = await until(async () => (await rows()) === "Rows: 4")
check("artifact: told when its CSV changes (vau.on change)", out.ms.artifactData !== null, await rows().catch(() => ""))
write("Qa live/Page.html", read("Qa live/Page.html").replace("Version one", "Version two"))
out.ms.artifactSelf = await until(async () => (await frame.locator("#h").innerText()) === "Version two")
check("artifact: reloads when its own file changes", out.ms.artifactSelf !== null)
await shot("artifact")

// ---------- deleted while open ----------
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Qa live/Note.md"); await wait(1500)
rmSync(abs("Qa live/Note.md"))
out.ms.deleted = await until(async () => await page.locator("text=isn't in the vault any more").count() > 0)
check("a file deleted while open says so", out.ms.deleted !== null)
write("Qa live/Note.md", "Back again.\n")
out.ms.back = await until(async () => (await content()).includes("Back again."))
check("and opens again when it's back", out.ms.back !== null)

// ---------- moved while typing ----------
// Through the API (an AI, `vau`): the tab follows the file and what was typed is saved there.
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Qa live/Note.md"); await wait(1500)
await page.locator(".cm-line", { hasText: "Back again." }).first().click(); await page.keyboard.press("End")
await page.keyboard.type(" Typed, then moved.", { delay: 20 })
await fetch(`${B}api/file/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: "Qa live/Note.md", to: "Qa live 2/Moved note.md" }) })
out.ms.moved = await until(async () => (await page.evaluate(() => decodeURIComponent(location.hash))).includes("Qa live 2/Moved note.md"))
await until(async () => read("Qa live 2/Moved note.md").includes("Typed, then moved."), 3000)
check("a file moved through the API while typing: its tab follows", out.ms.moved !== null, await page.evaluate(() => location.hash))
check("…and what was typed is saved there", read("Qa live 2/Moved note.md").includes("Back again. Typed, then moved."), read("Qa live 2/Moved note.md"))
// On disk (mv): nothing says where it went, so the edits not saved yet are offered back.
await page.locator(".cm-line", { hasText: "Typed, then moved." }).first().click(); await page.keyboard.press("End")
await page.keyboard.type(" And again.", { delay: 20 })
renameSync(abs("Qa live 2/Moved note.md"), abs("Qa live 2/Renamed by hand.md"))
const offer = page.locator("[data-sonner-toast]", { hasText: "before your last edits were saved" })
out.ms.lost = await until(async () => await offer.count() > 0)
check("a file renamed on disk while typing: the unsaved edits are offered back", out.ms.lost !== null)
if (out.ms.lost !== null) { await offer.locator("button", { hasText: "Save them" }).click(); await wait(1200) }
check("…and saved where the file was", (() => { try { return read("Qa live 2/Moved note.md").includes("And again.") } catch { return false } })())
write("Qa live/Note.md", "Back again.\n")
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, "Qa live/Note.md"); await wait(1500)

// ---------- the socket ----------
// Closed under it (like a phone waking up, or the server restarting), with a change made while it's down: it
// reconnects, and the change it missed still arrives (the server's version differs, so everything is checked).
await page.evaluate(() => window.__qaSockets.at(-1).close())
write("Qa live/Note.md", "Back again.\n\nWhile the socket was down.\n")
out.ms.missed = await until(async () => (await content()).includes("While the socket was down."), 6000)
check("a change made while disconnected arrives after it reconnects", out.ms.missed !== null)
out.sockets = await page.evaluate(() => window.__qaSockets.length)
check("it reconnected (a new socket)", out.sockets >= 2, out.sockets)
write("Qa live/Note.md", "Back again.\n\nAfter the socket test.\n")
out.ms.afterSocket = await until(async () => (await content()).includes("After the socket test."))
check("and is live again", out.ms.afterSocket !== null)

// ---------- the store ----------
// It follows by patches (GET /api/state?since=<v>): after all of the above it's the server's state, key by key, and an
// optimistic change the server never made (a write that failed) is gone after the next refresh.
const store = () => page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].getStore())
const serverStore = async () => { const { config: _c, vaultPlugins: _v, appearance: _a, ...s } = await (await fetch(new URL("api/state", B))).json(); return s }
await wait(1500)
const [mine, theirs] = [await store(), await serverStore()]
const differ = Object.keys(theirs).filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(theirs[k]))
check("the store is the server's state", !differ.length && Object.keys(mine).length === Object.keys(theirs).length, differ)
await page.evaluate(() => globalThis.__vaultite.modules["@vaultite"].mutate((s) => ({ ...s, books: [] })))
write("Qa live/Note.md", "Back again.\n\nAfter the optimistic change.\n")
out.ms.undone = await until(async () => (await store()).books.length === theirs.books.length)
check("an optimistic change the server didn't make is gone after the next refresh", out.ms.undone !== null)
check("the page never reloaded", await marker())

check("no errors", !out.errs.length, out.errs)
await browser.close()
cleanup()
console.log(JSON.stringify(out, null, 1))
await done()
