// Chrome extensions in the Browser's pages (the desktop app, Electron), end to end on a throwaway vault with a
// made-up extension (tools/fixtures/web-extension: Page painter) and a page this script serves on 127.0.0.1, so no
// network: added from its folder in the Extensions view, its content script paints the page from the sync area and
// learns its tab from the service worker, its button in the bar shows its badge, a click opens its popup under it,
// which finds the page as the active tab and repaints it by message (closing on Escape); the worker opens a tab and
// lists the windows; its options page opens in a tab; Settings from Brave gives it a Brave profile's (both areas); off,
// the page is left alone; on a Web Store page the bar says it's added; removed, it's gone. Then managed: a copy without
// its key named in this app's policy file is added, always on, with no switch or Remove (and the engine refuses both),
// its pages open at the id Chrome gives its folder, a new container's pages get it too, its content script sends a page
// to its own (as a site blocker does a feed); out of the policy, it's an ordinary one.
// WRITES: the throwaway vault only.
//   node web/qa/extensions.mjs <vault copy>
import { _electron } from "playwright-core"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-extensions-"))
const FIXTURE = path.join(ROOT, "tools/fixtures/web-extension")
const ID = "lkhijjcmmbciijnfgebdecnmdmomgdna" // (its manifest's key's)
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Plain ${req.url}</title><p>A page to paint.</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_TEST_BROWSERS: path.join(TMP, "browsers"), VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const command = async (id) => { await ui({ action: "command", id }); await wait(700) }
const openUrl = async (url) => { await ui({ action: "open", path: `view:web/${url}` }); await wait(500) }

/** The window's native views other than the app: pages and popups, with their address and whether they show. */
const views = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  return w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), visible: v.getVisible(), id: v.webContents.id, bounds: v.getBounds() }))
})
/** Run JavaScript in the view whose address starts with `prefix` (the visible one first). */
const inView = (prefix, code) => app.evaluate(({ BaseWindow }, [prefix, code]) => {
  const w = BaseWindow.getAllWindows()[0]
  const all = w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.webContents.getURL().startsWith(prefix))
  const v = all.find((x) => x.getVisible()) ?? all[0]
  return v ? v.webContents.executeJavaScript(code) : null
}, [prefix, code])
const painted = (prefix = SITE) => inView(prefix, "({ ...document.documentElement.dataset })")

// A made-up Brave profile with the painter's settings (for Settings from Brave, below): each area a LevelDB folder as
// Chromium keeps it, written by a session of their own.
const BRAVE = path.join(TMP, "browsers/brave")
fs.mkdirSync(path.join(BRAVE, "Default"), { recursive: true })
fs.writeFileSync(path.join(BRAVE, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal" } } } }))
for (const [area, items] of [["Sync Extension Settings", { color: "plum" }], ["Local Extension Settings", { seen: "in brave" }]]) {
  const at = path.join(TMP, `area-${area.split(" ")[0]}`)
  await app.evaluate(async ({ session, WebContentsView }, [at, dir, id, items]) => {
    const s = session.fromPath(at)
    await s.extensions.loadExtension(dir)
    const v = new WebContentsView({ webPreferences: { session: s } })
    await v.webContents.loadURL(`chrome-extension://${id}/popup.html`)
    await v.webContents.executeJavaScript(`chrome.storage.local.set(${JSON.stringify(items)})`)
    v.webContents.close()
    s.extensions.removeExtension(id)
  }, [at, FIXTURE, ID, items])
  await wait(500)
  fs.cpSync(path.join(at, "Local Extension Settings", ID), path.join(BRAVE, "Default", area, ID), { recursive: true })
}

// ---------- added from its folder ----------
// (the folder picker answered as if the user chose the fixture)
await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, FIXTURE)
await command("web:extensions")
check("Extensions: a tab, empty", await until(async () => (await win.locator("[data-extensions]").count()) === 1, 10000), await win.locator("main").innerText().catch(() => ""))
await win.locator("[data-ext-file]").click()
check("… Add from a folder lists it, on", await until(async () => (await win.locator(`[data-ext-row="${ID}"] [role=switch][aria-checked=true]`).count()) === 1, 10000),
  await win.locator("[data-extensions]").innerText().catch(() => ""))
check("… by its name", (await win.locator(`[data-ext-row="${ID}"]`).innerText()).includes("Page painter"))

// ---------- a page: the content script, storage, messaging ----------
await openUrl(`${SITE}/one`)
check("its content script ran, with the sync area's colour", await until(async () => (await painted())?.painter === "teal", 15000), [await painted(), await views()])
const pageId = (await views()).find((v) => v.url.startsWith(SITE))?.id
check("… and its tab from the service worker", await until(async () => (await painted())?.painterTab === String(pageId), 10000), [await painted(), pageId])
check("… and its own stylesheet loads in the page", await until(async () => (await painted())?.painterCss === "loaded", 10000), await painted())
check("its button in the bar, badged", await until(async () => (await win.locator(`[data-ext-button="${ID}"]`).innerText()) === "on", 10000),
  await win.locator(`[data-ext-button="${ID}"]`).count())

// ---------- its popup ----------
await win.locator(`[data-ext-button="${ID}"]`).click()
const popup = () => views().then((v) => v.find((x) => x.url.startsWith(`chrome-extension://${ID}/popup.html`)))
check("a click opens its popup", await until(async () => (await popup())?.visible, 10000), await views())
const btn = await win.locator(`[data-ext-button="${ID}"]`).boundingBox()
const pb = (await popup())?.bounds
check("… under its button", pb && btn && Math.abs(pb.y - (btn.y + btn.height + 4)) <= 2 && pb.x + pb.width <= Math.round(btn.x + btn.width) + 1, [pb, btn])
check("… which found the page as the active tab and repainted it", await until(async () => (await painted())?.painter === "orange", 10000), await painted())
check("… the popup says so", (await inView(`chrome-extension://${ID}/popup.html`, "document.getElementById('out').textContent")) === `painted ${SITE}/one`,
  await inView(`chrome-extension://${ID}/popup.html`, "document.getElementById('out').textContent"))
check("… the sync area's change reached the page", (await painted())?.painterSynced === "orange", await painted())
await app.evaluate(({ BaseWindow }, id) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents?.getURL().startsWith(`chrome-extension://${id}/popup.html`))
  v?.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" })
}, ID)
check("Escape closes it", await until(async () => !(await popup()), 5000), await views())

// ---------- tabs and windows, from the service worker ----------
// Ask the service worker from one of the extension's own pages (its options, below).
const ask = (msg) => app.evaluate(async ({ BaseWindow }, [id, msg]) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents?.getURL().startsWith(`chrome-extension://${id}/`))
  return v ? v.webContents.executeJavaScript(`chrome.runtime.sendMessage(${JSON.stringify(msg)})`) : "no extension page"
}, [ID, msg])

// ---------- its options, in a tab ----------
await command("web:extensions")
await win.locator(`[data-ext-row="${ID}"] [aria-label="Page painter options"]`).click()
const options = `chrome-extension://${ID}/options.html`
check("Options opens its page in a tab", await until(async () => (await inView(options, "document.getElementById('color').textContent")) === "colour: orange", 10000), await views())
const listed = await ask({ type: "windows" })
check("the worker lists the window and its tabs", listed?.windows === 1 && listed?.tabs >= 2, listed)
const before = (await views()).length
const opened = await ask({ type: "open", url: `${SITE}/two` })
check("… and opens a tab", opened?.opened === true && await until(async () => (await views()).some((v) => v.url === `${SITE}/two`), 10000), [opened, before, await views()])
check("… whose page it paints too", await until(async () => (await painted(`${SITE}/two`))?.painter === "orange", 10000), await painted(`${SITE}/two`))

// ---------- its settings from Brave ----------
await command("web:extensions")
await win.locator(`[data-ext-more="${ID}"]`).click()
await win.locator("[role=menuitem]", { hasText: "Settings from Brave" }).click()
await win.locator("dialog[open] button", { hasText: "Use them" }).click()
check("Settings from Brave: done, it says", await until(async () => (await win.locator("body").innerText()).includes("Page painter has Brave's settings"), 15000))
await openUrl(`${SITE}/brave`)
check("… its sync area is Brave's", await until(async () => (await painted(`${SITE}/brave`))?.painter === "plum", 15000), await painted(`${SITE}/brave`))
// (the options tab open before was the extension's last run: a page of this one)
await openUrl(`${options}?brave`)
const seen = () => inView(`${options}?brave`, "chrome.storage.local.get('seen').then((r) => r.seen)")
check("… and its local area", await until(async () => (await seen()) === "in brave", 10000), await seen())

// ---------- the Web Store's page ----------
await app.evaluate(({ session }) => {
  session.fromPartition("persist:web").protocol.handle("https", () => new Response("<!doctype html><title>Page painter - Chrome Web Store</title><p>store", { headers: { "content-type": "text/html" } }))
})
await openUrl(`https://chromewebstore.google.com/detail/page-painter/${ID}`)
check("a Web Store page of one added: the bar says so", await until(async () => (await win.locator(`[data-ext-store="${ID}"]`).innerText().catch(() => "")) === "Added to Vaultite", 10000),
  await win.locator("[data-ext-store]").count())
await openUrl(`https://chromewebstore.google.com/detail/other/${"a".repeat(32)}`)
check("… of another: Add to Vaultite", await until(async () => (await win.locator(`[data-ext-store="${"a".repeat(32)}"]`).innerText().catch(() => "")) === "Add to Vaultite", 10000))

// ---------- off, then removed ----------
await command("web:extensions")
await win.locator(`[data-ext-row="${ID}"] [role=switch]`).click()
check("off: its switch", await until(async () => (await win.locator(`[data-ext-row="${ID}"] [role=switch][aria-checked=false]`).count()) === 1, 10000))
await openUrl(`${SITE}/three`)
await until(async () => (await views()).some((v) => v.url === `${SITE}/three` && v.visible), 10000)
await wait(1500)
check("… a page is left alone", !(await painted(`${SITE}/three`))?.painter, await painted(`${SITE}/three`))
check("… and the bar has no button", (await win.locator(`[data-ext-button="${ID}"]`).count()) === 0)
await command("web:extensions")
await win.locator(`[data-ext-more="${ID}"]`).click()
await win.locator("[role=menuitem]", { hasText: "Remove" }).click()
await win.locator("dialog[open] button", { hasText: "Remove" }).click()
check("removed: gone from the list", await until(async () => (await win.locator(`[data-ext-row="${ID}"]`).count()) === 0, 10000))
check("… and from this Mac", await until(() => !fs.existsSync(path.join(TMP, "userData/extensions", ID)), 5000))

// ---------- managed by this Mac ----------
// (this app's policy file, as its owner writes it in the terminal: the app looks at it every few seconds)
const POLICY = path.join(TMP, "userData/managed-extensions.json"), KEYLESS = path.join(TMP, "keyless")
fs.cpSync(FIXTURE, KEYLESS, { recursive: true })
const { key: _key, ...bare } = JSON.parse(fs.readFileSync(path.join(KEYLESS, "manifest.json"), "utf8"))
fs.writeFileSync(path.join(KEYLESS, "manifest.json"), JSON.stringify(bare))
// (Chrome's id for an unpacked folder without a key: its path's hash)
const MID = [...crypto.createHash("sha256").update(KEYLESS).digest("hex").slice(0, 32)].map((c) => "abcdefghijklmnop"[parseInt(c, 16)]).join("")
fs.writeFileSync(POLICY, JSON.stringify({ extensions: [KEYLESS, "/nowhere/an-extension"] }))
await command("web:extensions")
const row = win.locator(`[data-ext-row="${MID}"]`)
check("managed: the policy adds it, always on", await until(async () => (await row.locator("[data-ext-managed]").count()) === 1, 20000),
  await win.locator("[data-extensions]").innerText().catch(() => ""))
check("… said to be this Mac's, with no switch", (await row.innerText()).includes("Managed by this Mac") && (await row.locator("[role=switch]").count()) === 0, await row.innerText())
check("… what it couldn't add is said", await until(async () => (await win.locator("[data-ext-problem]").innerText().catch(() => "")).includes("/nowhere/an-extension"), 5000))
await win.locator(`[data-ext-more="${MID}"]`).click()
await win.locator("[role=menuitem]").first().waitFor({ timeout: 5000 })
const items = await win.locator("[role=menuitem]").allInnerTexts()
check("… its menu has no Remove", !items.some((t) => t.includes("Remove")), items)
await win.keyboard.press("Escape")
const refused = await win.evaluate((id) => Promise.all([window.vaultite.web.engine("ext:on", id, false), window.vaultite.web.engine("ext:remove", id)]
  .map((p) => p.then(() => "done", () => "refused"))), MID)
check("… and the engine refuses turning it off or removing it", refused.every((r) => r === "refused"), refused)
await openUrl(`chrome-extension://${MID}/options.html`)
check("… its own pages open at its folder's id", await until(async () => (await inView(`chrome-extension://${MID}/options.html`, "document.getElementById('color').textContent"))?.startsWith("colour"), 10000),
  await views())
await setting({ containers: [{ id: "lab", name: "Lab", color: "teal" }] })
await openUrl(`@lab/${SITE}/four`)
check("… a new container's pages get it too", await until(async () => !!(await painted(`${SITE}/four`))?.painter, 15000), [await painted(`${SITE}/four`), await views()])
await openUrl(`@lab/${SITE}/stop`)
const stopped = () => inView(`chrome-extension://${MID}/stop.html`, "document.getElementById('stopped').textContent")
check("… which sends a page to its own, as a site blocker does", await until(async () => (await stopped()) === `stopped ${SITE}/stop (${MID})`, 15000), [await stopped(), await views()])
fs.writeFileSync(POLICY, JSON.stringify({ extensions: [] }))
await command("web:extensions")
check("out of the policy: an ordinary one, with its switch", await until(async () => (await row.locator("[role=switch][aria-checked=true]").count()) === 1, 20000), await row.innerText().catch(() => ""))

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
