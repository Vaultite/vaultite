// The Browser's containers in the desktop app (Electron), end to end on a throwaway vault, against a made-up site this
// script serves on 127.0.0.1 (a cookie login): a tab in Work (persist:web-c-work) signed in, the same site in Personal
// isn't, nor in no container; the bar shows the tab's container (a chip inside the address; the active tab tinted
// with appearance tabTint); a site set to always open in Work goes there from a
// plain link; the container menu moves a tab to another and only chooses (every row led by its icon), containers are
// added and deleted in Sites, deleting clearing its logins; switching web tabs is never see-through. A link from another
// app opens in a web tab. A page playing sound shows a speaker on its tab, the bar's button mutes it and the tab's
// speaker unmutes it; a video keeps its speaker through a quiet scene, till it pauses.
// WRITES: the throwaway vault only.
//   node web/qa/containers.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-containers-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- a made-up site with a cookie login ----------
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", SITE)
  const who = /(?:^|; )who=([^;]+)/.exec(req.headers.cookie ?? "")?.[1]
  const headers = { "Content-Type": "text/html; charset=utf-8" }
  if (u.pathname === "/login") headers["Set-Cookie"] = `who=${u.searchParams.get("u")}; Path=/; Max-Age=3600`
  res.writeHead(200, headers)
  // (a second of tone, then silence: a video's quiet scene, past Chromium's 2s of audible)
  if (u.pathname === "/quiet") return res.end(`<!doctype html><title>Quiet</title><script>const r = 8000, n = r * 30, b = new ArrayBuffer(44 + n * 2), d = new DataView(b), str = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0))); str(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, r, true); d.setUint32(28, r * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, n * 2, true); for (let i = 0; i < r; i++) d.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 20 / r) * 40, true); window.player = new Audio(URL.createObjectURL(new Blob([b], { type: "audio/wav" }))); player.play()</script>`)
  if (u.pathname === "/sound") return res.end(`<!doctype html><title>Sound</title><script>const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = 20; const g = c.createGain(); g.gain.value = 0.001; o.connect(g).connect(c.destination); o.start()</script>`)
  res.end(`<!doctype html><title>Who</title><p id="who">${u.pathname === "/login" ? "signed in" : `who:${who ?? "nobody"}`}</p>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}`

// ---------- the app ----------
// (a muted copy plays nothing, so no page is audible: sound on, the test page's tone too low and deep to hear)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_SOUND: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const open = async (to) => { await ui({ action: "open", path: to, newTab: true }); await wait(500) }

/** The visible web page: its address, what it says, and its session's partition. */
const visible = () => app.evaluate(async ({ BaseWindow, session }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  if (!v) return null
  const parts = ["persist:web", "persist:web-c-work", "persist:web-c-personal", "persist:web-c-shop"]
  const partition = parts.find((p) => session.fromPartition(p) === v.webContents.session) ?? "?"
  const text = await v.webContents.executeJavaScript("document.getElementById('who')?.textContent ?? ''")
  return { url: v.webContents.getURL(), text, partition }
})
const cookiesIn = (partition) => app.evaluate(async ({ session }, p) => (await session.fromPartition(p).cookies.get({})).map((c) => `${c.name}=${c.value}`), partition)
const inPage = (code) => app.evaluate(({ BaseWindow }, code) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.executeJavaScript(code) : null
}, code)
const activeTab = () => win.evaluate(() => document.querySelector("[role=tab][aria-selected=true]")?.textContent ?? "")

// ---------- Work: signed in ----------
await open(`view:web/@work/${SITE}/login?u=Alice`)
check("a tab in Work: its own logins (persist:web-c-work)", await until(async () => (await visible())?.partition === "persist:web-c-work", 15000), await visible())
await until(async () => (await visible())?.text === "signed in", 10000)
await inPage(`location.href = ${JSON.stringify(`${SITE}/whoami`)}`)
check("… signed in there", await until(async () => (await visible())?.text === "who:Alice", 10000), await visible())
check("… the bar says Work", await until(async () => (await win.locator("[data-web-page] [data-web-container=work]:visible").count()) === 1, 5000),
  await win.locator("[data-web-container]").evaluateAll((l) => l.map((e) => e.getAttribute("data-web-container"))))
check("… the tab's icon has its colour", await until(async () => (await win.locator("[role=tab][aria-selected=true] [data-container-tint]").count()) === 1, 5000), await activeTab())
check("… its chip inside the address", await win.locator("[data-web-page] [data-web-address-bar] [data-web-container=work]:visible").count() === 1, null)
const look = path.join(VAULT, ".vaultite/appearance.json")
const lookWas = fs.existsSync(look) ? fs.readFileSync(look, "utf8") : null
const washed = () => win.locator("[data-tab-wash] [role=tab][aria-selected=true]").count()
check("the active tab isn't tinted by default", (await washed()) === 0, null)
fs.writeFileSync(look, JSON.stringify({ ...JSON.parse(lookWas ?? "{}"), tabTint: true }) + "\n")
check("Tint the active tab (appearance tabTint): it takes its container's colour", await until(async () => (await washed()) === 1, 10000), null)
if (lookWas === null) fs.rmSync(look); else fs.writeFileSync(look, lookWas)
await until(async () => (await washed()) === 0, 10000)

// ---------- Personal, and no container: not signed in ----------
await open(`view:web/@personal/${SITE}/whoami?p`)
check("Personal: other logins, not signed in", await until(async () => { const v = await visible(); return v?.partition === "persist:web-c-personal" && v.text === "who:nobody" }, 15000), await visible())
await open(`view:web/${SITE}/whoami?none`)
check("no container: the workspace's logins, not signed in", await until(async () => { const v = await visible(); return v?.partition === "persist:web" && v.text === "who:nobody" }, 15000), await visible())
check("… the bar offers containers", await win.locator("[data-web-page] [data-web-container='']:visible").count() === 1, null)

// ---------- the container menu moves the tab ----------
await win.locator("[data-web-page] [data-web-container='']:visible").click()
await win.locator("[role^=menuitem]", { hasText: /^Work$/ }).click()
check("moved to Work from the menu: signed in", await until(async () => { const v = await visible(); return v?.partition === "persist:web-c-work" && v.text === "who:Alice" }, 15000), await visible())

// ---------- the container menu only chooses: its options are in Sites ----------
const SHOTS = process.env.SHOTS
const shot = async (name) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
await win.locator("[data-web-page] [data-web-container=work]:visible").click()
const rows = await win.locator("[role=menu] [role^=menuitem]").allInnerTexts()
check("the container menu: choosing, adding, managing", ["No container", "Work", "New container", "Manage containers"].every((w) => rows.some((r) => r.startsWith(w)))
  && !rows.some((r) => /^(Rename|Delete|Colour|Agent access|Lock)/.test(r)), rows)
// (an empty first column is a bare span: an icon is an svg or a coloured dot)
const leads = await win.locator("[role=menu] > button[role^=menuitem]").evaluateAll((bs) => bs.map((b) => { const f = b.firstElementChild; return f?.tagName === "SPAN" && !f.childElementCount && !f.getAttribute("style") ? "empty" : "icon" }))
check("… every row led by its icon (its check at the end)", leads.every((t) => t === "icon"), leads)
await shot("container-menu")
await win.keyboard.press("Escape")

// ---------- switching web tabs: never see-through ----------
// (the window is see-through where it cuts a hole for a page: each moment one's cut, a page must be on screen there)
await app.evaluate(({ BaseWindow, WebContentsView }) => {
  const w = BaseWindow.getAllWindows()[0]
  let proto = WebContentsView.prototype
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "setVisible")) proto = Object.getPrototypeOf(proto)
  const set = proto.setVisible
  const shown = () => w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).length
  globalThis.qaShown = [{ t: Date.now(), n: shown() }]
  proto.setVisible = function (v) { const r = set.call(this, v); globalThis.qaShown.push({ t: Date.now(), n: shown(), v, url: this.webContents?.getURL?.().slice(-8) }); return r }
})
await win.evaluate(() => {
  const cut = () => !!document.querySelector("[data-web-hole]")
  window.qaCut = [{ t: Date.now(), cut: cut() }]
  window.qaFrames = []
  const tick = () => { window.qaFrames.push(Date.now()); requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  new MutationObserver((ms) => window.qaCut.push({ t: Date.now(), cut: cut(), what: [...document.querySelectorAll("[data-web-hole]")].map((e) => e.tagName + (e.dataset.pane !== undefined ? "[pane]" : "") + (e.hasAttribute("data-web-box") ? "[box]" : "")).join(" ") })).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-web-hole"] })
})
await open(`view:web/${SITE}/whoami?a`)
await open(`view:web/${SITE}/whoami?b`)
await until(async () => (await visible())?.url.endsWith("?b"), 15000)
const tabs = win.locator("[role=tablist] [role=tab]")
const at = await win.evaluate(() => [...document.querySelectorAll("[role=tablist] [role=tab]")].findIndex((t) => t.getAttribute("aria-selected") === "true"))
for (let i = 0; i < 6; i++) { await tabs.nth(i % 2 ? at : at - 1).click(); await wait(400) }
const shownLog = await app.evaluate(() => globalThis.qaShown)
const cutLog = await win.evaluate(() => window.qaCut)
const frames = await win.evaluate(() => window.qaFrames)
// (a hole taken back is on screen once the next frame has begun)
const cutAt = (t) => { const i = cutLog.findLastIndex((c) => c.t <= t); return i >= 0 && (cutLog[i].cut || (i > 0 && cutLog[i - 1].cut && !frames.some((f) => f > cutLog[i].t && f <= t))) }
const gaps = shownLog.flatMap((s, i) => (s.n === 0 ? [{ from: s.t, to: shownLog[i + 1]?.t ?? Date.now() }] : []))
const bad = gaps.filter((g) => cutAt(g.from) || cutLog.some((c) => c.cut && c.t > g.from && c.t < g.to))
check("switching web tabs: the window is never see-through with no page there", bad.length === 0 && shownLog.length > 6,
  { bad, shown: shownLog.length, near: bad.map((g) => ({ cut: cutLog.filter((c) => c.t > g.from - 100 && c.t < g.to + 50).map((c) => [c.t - g.from, c.cut, c.what]), shown: shownLog.filter((c) => c.t > g.from - 100 && c.t < g.to + 50).map((c) => [c.t - g.from, c.n, c.v, c.url]) })) })

// ---------- a site always opens in Work ----------
await setting({ containers: [{ id: "personal", name: "Personal", color: "blue" }, { id: "work", name: "Work", color: "orange", sites: ["127.0.0.1"] }, { id: "shop", name: "Shopping", color: "pink" }] })
await open("view:web-pages")
check("Sites: Work's always-open site is pinned", await until(async () => (await win.locator("[data-web-logins-section=work] [data-web-site='127.0.0.1'] [data-web-always]").count()) === 1, 15000),
  await win.locator("[data-web-sites-view]").innerText().catch(() => ""))
await open(`view:web/${SITE}/whoami?rule`)
check("a site set to always open in Work goes there", await until(async () => { const v = await visible(); return v?.url.endsWith("?rule") && v.partition === "persist:web-c-work" && v.text === "who:Alice" }, 15000), await visible())

// ---------- deleting a container clears its logins ----------
await open(`view:web/@shop/${SITE}/whoami?shop`)
await until(async () => (await visible())?.partition === "persist:web-c-shop", 15000)
await win.locator("[data-web-page] [data-web-container=shop]:visible").click()
await win.locator("[role^=menuitem]", { hasText: /^Manage containers/ }).click()
check("Manage containers: the Sites tab, every container in it", await until(async () => (await win.locator("[data-web-logins-heading]:visible").count()) >= 4, 10000),
  await win.locator("[data-web-sites-view]").innerText().catch(() => ""))
await win.locator("[data-web-logins-heading=shop]:visible").hover()
await shot("sites-tab")
await win.locator("[data-web-logins-heading=shop]:visible button[aria-label='Options for Shopping']").click()
await shot("container-options")
await win.locator("[role^=menuitem]", { hasText: /^Delete Shopping/ }).click()
await win.locator("dialog[open] button", { hasText: "Delete" }).click()
await wait(1000)
const settingsFile = () => { try { return fs.readFileSync(path.join(VAULT, ".vaultite/plugins/web-viewer/data.json"), "utf8") } catch { return "" } }
check("Delete: the container goes", await until(async () => settingsFile().includes("work") && !settingsFile().includes("shop"), 5000), settingsFile())
check("… Work's logins stay", (await cookiesIn("persist:web-c-work")).includes("who=Alice"), await cookiesIn("persist:web-c-work"))
await win.evaluate(() => window.vaultite?.web?.engine?.("containers:clear", "c-work"))
check("clearing Work: its logins go", await until(async () => !(await cookiesIn("persist:web-c-work")).length, 5000), await cookiesIn("persist:web-c-work"))

// ---------- a new container, from Sites ----------
await win.locator("[data-web-sites-view] [data-web-new-container]:visible").click()
await win.keyboard.type("Travel"); await win.keyboard.press("Enter")
check("New container in Sites: it's added", await until(async () => settingsFile().includes("\"travel\""), 5000), settingsFile())

// ---------- the Sites panel: + adds a container and shows its sites ----------
const bars = path.join(VAULT, ".vaultite/sidebars.json")
fs.writeFileSync(bars, JSON.stringify({ ...JSON.parse(fs.existsSync(bars) ? fs.readFileSync(bars, "utf8") : "{}"), right: ["web-viewer:web-pages"] }) + "\n")
const panel = win.locator("[data-web-sites-panel]:visible")
if (!(await until(async () => (await panel.count()) === 1, 3000))) await win.locator("[data-sidebar-toggle=right]").click()
check("the Sites panel shows", await until(async () => (await panel.count()) === 1, 10000), null)
await panel.locator("[data-web-logins]").click()
const picks = await win.locator("[role=menu] [role^=menuitem]").allInnerTexts()
check("… its picker: every set of logins, New container, Manage containers", ["Work", "New container", "Manage containers"].every((w) => picks.some((r) => r.startsWith(w))), picks)
await shot("sites-panel-picker")
await win.keyboard.press("Escape")
await panel.hover()
await panel.locator("[data-web-new-container]").click()
await win.keyboard.type("Errands"); await win.keyboard.press("Enter")
check("… + adds a container and shows it", await until(async () => settingsFile().includes("\"errands\"") && (await panel.locator("[data-web-logins]").innerText()) === "Errands", 5000),
  await panel.locator("[data-web-logins]").innerText().catch(() => ""))
await shot("sites-panel")

// ---------- a container that needs Touch ID ----------
await open(`view:web/@personal/${SITE}/whoami?locked`)
await until(async () => (await visible())?.url.endsWith("?locked"), 15000)
await setting({ containers: [{ id: "personal", name: "Personal", color: "blue", lock: true }, { id: "work", name: "Work", color: "orange", sites: ["127.0.0.1"] }] })
check("set to lock: its page goes behind the lock", await until(async () => (await win.locator("[data-web-locked]:visible").count()) === 1 && !(await visible()), 10000),
  [await visible(), await win.locator("[data-web-locked]").count()])
const opened = await win.evaluate((s) => window.vaultite.web.open(s, null, "c-personal").then(() => "opened", (e) => String(e)), `${SITE}/whoami?sneak`)
check("… and the desktop app won't open one there", /locked/.test(opened), opened)
await setting({ containers: [{ id: "personal", name: "Personal", color: "blue" }, { id: "work", name: "Work", color: "orange", sites: ["127.0.0.1"] }] })

// ---------- a link from another app (Vaultite as the Mac's browser) ----------
await app.evaluate(({ app }, url) => app.emit("open-url", { preventDefault() {} }, url), `${SITE}/whoami?from-mail`)
check("a web link from another app opens in a web tab", await until(async () => (await visible())?.url.endsWith("?from-mail"), 15000), await visible())

// ---------- sound ----------
await open(`view:web/${SITE}/sound`)
check("a page playing sound: a speaker on its tab", await until(async () => (await win.locator("[role=tab][aria-selected=true] svg.lucide-volume-2").count()) === 1, 15000), await activeTab())
await win.locator("[data-web-page] button[aria-label='Mute tab']:visible").click()
const muted = () => app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; return w.contentView.children.some((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.webContents.isAudioMuted()) })
check("… the bar's button mutes it", await until(muted, 5000), null)
check("… and its tab says muted", await until(async () => (await win.locator("[role=tab][aria-selected=true] svg.lucide-volume-x").count()) === 1, 5000), await activeTab())
await win.locator("[role=tab][aria-selected=true] [data-icon-action]").click()
check("… a click on its tab's speaker unmutes it", await until(async () => !(await muted()), 5000), await activeTab())
check("… beside its site's icon, not in its place", await until(async () => (await win.locator("[role=tab][aria-selected=true] [data-icon-action] svg.lucide-volume-2").count()) === 1, 5000), await activeTab())

await open(`view:web/${SITE}/quiet`)
const speaker = () => win.locator("[role=tab][aria-selected=true] svg.lucide-volume-2").count()
check("a video playing: a speaker on its tab", await until(async () => (await speaker()) === 1, 15000), await activeTab())
await wait(5000)
check("… kept through a quiet scene", (await speaker()) === 1, await activeTab())
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; return Promise.all(w.contentView.children.filter((x) => x.webContents && x.webContents !== w.webContents && x.getVisible()).map((x) => x.webContents.executeJavaScript("player.pause()"))) })
check("… gone once it pauses", await until(async () => (await speaker()) === 0, 3000), await activeTab())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
