// Plugins turned off and on while the app is open, from outside (the plugin.disable / plugin.enable ops, as an agent
// does) and from the Plugins page's switches: what each draws goes and comes back without a reload. Token count's
// status bar item, sidebar panel, command and open tab; Random note's command; Audio recorder's file menu item; People's
// blocks, and People map's (it needs People), on a computer and, live from it, on a phone. Writes plugins.json and
// sidebars.json (put back): throwaway server only.
//   node web/qa/pluginlive.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, apiAt, openPalette, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = `${SHOTS}pluginlive/`], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json")]
const conf = () => api("GET", "config/plugins")
const pages = []
/** A plugin turned by its op once every open page is live. */
const turn = async (id, on) => { await until(() => pages.every((p) => p.live), 10000); return api("POST", `ops/plugin.${on ? "enable" : "disable"}`, { id }) }
const NOTE = "Notes/Lisbon trip.md"
const at = (p) => `${B}#file/${encodeURIComponent(p)}`

// The plugins this covers on, Token count's panel shown in the right sidebar.
const was = await conf()
await api("PUT", "config/plugins", { ...was, enabled: [...new Set([...(was.enabled ?? []), "token-count", "random-note", "audio-recorder", "people", "people-map"])] })
writeFileSync(file(".vaultite/sidebars.json"), JSON.stringify({ left: ["pages:pages", "files:files"], right: ["token-count:context"], collapsed: [], heights: {} }, null, 2))

/** A page that counts its loads (none may happen: everything follows live). */
async function open(opts) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true, label: opts.viewport.width })
  page.loads = 0
  page.on("load", () => page.loads++)
  // (live: its events socket has said hello, so a change made from outside reaches it)
  page.live = false
  pages.push(page)
  page.on("websocket", (ws) => { if (ws.url().includes("/api/events")) { ws.on("framesent", () => { page.live = true }); ws.on("close", () => { page.live = false }) } })
  return page
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` })

/** The palette's rows for `q` (closed again). */
async function paletteRows(page, q) {
  await openPalette(page); await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.type(q); await wait(250)
  const rows = (await page.locator("#palette-results [role=option]").allInnerTexts()).map((t) => t.split("\n")[0].trim())
  await page.keyboard.press("Escape")
  await until(async () => !(await page.locator("[role=dialog] input").count()), 2000)
  return rows
}
const hasCommand = async (page, q, name) => (await paletteRows(page, q)).includes(name)

/** The file tree's menu for a file: its items' labels (closed again). */
async function fileMenu(page, p) {
  await page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first().click({ button: "right" })
  const menu = page.locator("[role=menu]").first()
  await until(() => menu.isVisible(), 2000)
  const more = menu.getByRole("menuitem", { name: /^More/ })
  if (await more.count()) { await more.first().hover(); await wait(300) }
  const items = await page.locator("[role=menu] [role=menuitem], [role=menu] > button").allInnerTexts()
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape")
  await until(async () => !(await page.locator("[role=menu]").count()), 2000)
  return items.map((t) => t.trim())
}

/** What a dashboard shows of its block `name`: "drawn", or, its plugin off (its block left out, the page empty), the
 *  page's note; null: neither. */
const blockState = (page, name) => page.evaluate((name) => {
  const shown = (sel) => [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length || e.firstElementChild?.getClientRects().length)
  if (shown(`[data-block="${name}"]`)) return "drawn"
  return shown("[data-dashboard-off]")?.textContent.trim() ?? null
}, name)

try {
  const page = await open({ viewport: { width: 1440, height: 900 } })
  await page.goto(at(NOTE))
  // (read at once: a locator's innerText on an item that just went waits out its 30 s)
  const statusText = () => page.evaluate(() => [...document.querySelectorAll('[data-status-key="token-count:tokens"]')].map((e) => e.innerText).join("").trim())
  const panel = page.locator('[data-panel="token-count:context"]')
  await until(async () => (await statusText()).includes("tokens"), 10000)
  await until(() => panel.isVisible(), 4000)

  // ---------- Token count, off and on by its op (as an agent turns it)
  check("token count: its status bar item shows", (await statusText()).includes("tokens"))
  check("...its sidebar panel shows", await panel.isVisible())
  check("...its command is in the palette", await hasCommand(page, "agent context in", "Open agent context in a tab"))
  await page.getByRole("tab").first().click() // (back to the note: the panel follows the file)
  await turn("token-count", false)
  check("off by its op: the status bar item goes", await until(async () => !(await statusText()), 5000))
  check("...the sidebar panel goes", await until(async () => !(await panel.count()), 5000))
  check("...the command goes", !(await hasCommand(page, "agent context in", "Open agent context in a tab")))
  await shot(page, "token-count-off")
  await turn("token-count", true)
  check("on again: the status bar item is back", await until(async () => (await statusText()).includes("tokens"), 5000))
  check("...the panel is back, where it was", await until(() => panel.isVisible(), 5000) &&
    await panel.evaluate((el) => !!el.closest("aside") && el.getBoundingClientRect().left > window.innerWidth / 2))
  check("...the command is back", await hasCommand(page, "agent context in", "Open agent context in a tab"))

  // Its view open in a tab when it goes off: the tab stays, saying so; on again, it draws again.
  await page.keyboard.press("Escape")
  await openPalette(page); await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.type("Open agent context in a tab"); await until(() => page.locator("[role=option]", { hasText: "Open agent context in a tab" }).count(), 3000)
  await page.keyboard.press("Enter")
  check("its view opens in a tab", await until(async () => (await page.getByRole("tab", { name: /Agent context/ }).count()) > 0, 4000))
  const viewText = () => page.locator("main:visible").first().innerText()
  await until(async () => /Agent context|tokens/i.test(await viewText()), 4000)
  await turn("token-count", false)
  check("off while its tab is open: the tab says it's off", await until(async () => /Token count is off/.test(await viewText()), 5000), (await viewText()).slice(0, 300))
  await shot(page, "token-count-tab-off")
  await turn("token-count", true)
  check("on again: the tab draws it again", await until(async () => !/Token count is off/.test(await viewText()), 5000), (await viewText()).slice(0, 300))

  // ---------- Random note's command
  check("random note: its command is offered", await hasCommand(page, "random note", "Open random note"))
  await turn("random-note", false)
  check("off: its command isn't", await until(async () => !(await hasCommand(page, "random note", "Open random note")), 4000))
  await turn("random-note", true)
  check("on: it is again", await until(() => hasCommand(page, "random note", "Open random note"), 4000))

  // ---------- Audio recorder's file menu item
  await page.goto(at(NOTE)) // (a fresh load: the tree shows the note)
  page.loads = 0
  await until(() => page.locator(`aside [role=tree] div[data-tree-path="${NOTE}"]`).count(), 6000)
  let items = await fileMenu(page, NOTE)
  check("audio recorder: the file menu has Record audio", items.includes("Record audio"), items)
  await turn("audio-recorder", false); await until(async () => !(await conf()).enabled.includes("audio-recorder"))
  items = await until(async () => { const i = await fileMenu(page, NOTE); return i.includes("Record audio") ? null : i }, 4000, 300)
  check("off: it doesn't", !!items, items)
  await turn("audio-recorder", true)
  items = await until(async () => { const i = await fileMenu(page, NOTE); return i.includes("Record audio") ? i : null }, 4000, 300)
  check("on: it does again", !!items, items)

  // ---------- People, from the Plugins page's switch, with People map (needs it) open on a phone
  const phone = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.goto(at("Dashboards/People map.md"))
  check("phone: the people map draws", await until(async () => (await blockState(phone, "people-map")) === "drawn", 10000), await blockState(phone, "people-map"))
  await page.goto(at("Dashboards/People.md"))
  check("computer: People's dashboard draws its block", await until(async () => (await blockState(page, "people-due")) === "drawn", 8000), await blockState(page, "people-due"))
  page.loads = 0
  await page.goto(`${B}#plugins`)
  const row = (id) => page.locator(`[data-plugin-row="${id}"]`).locator("..")
  const sw = (id) => row(id).locator("[role=switch]")
  await until(() => sw("people").isVisible(), 8000)
  check("Plugins page: People and People map are on", (await sw("people").getAttribute("aria-checked")) === "true" && (await sw("people-map").getAttribute("aria-checked")) === "true")
  await sw("people").click()
  check("People's switch turns it off", await until(async () => !(await conf()).enabled.includes("people"), 4000))
  check("...People map's switch shows off, and that it needs People", await until(async () => (await sw("people-map").getAttribute("aria-checked")) === "false" &&
    (await row("people-map").locator("[data-plugin-needs]").count()) === 1, 4000))
  check("...People map stays switched on in plugins.json (it comes back with People)", (await conf()).enabled.includes("people-map"))
  check("phone, live: the map's page, empty now, says People map needs People", await until(async () => /^Nothing to show: People map needs People, which is off\./.test(await blockState(phone, "people-map")), 5000), await blockState(phone, "people-map"))
  await shot(phone, "phone-people-map-off")
  await page.goBack()
  check("computer: People's page says People is off", await until(async () => /^Nothing to show: People is off\./.test(await blockState(page, "people-due")), 5000), await blockState(page, "people-due"))
  await shot(page, "people-off")
  await page.goForward()
  await until(() => sw("people").isVisible(), 5000)
  await sw("people").click()
  check("on again from its switch: both are on", await until(async () => (await sw("people-map").getAttribute("aria-checked")) === "true", 4000))
  check("phone, live: the people map draws again", await until(async () => (await blockState(phone, "people-map")) === "drawn", 5000), await blockState(phone, "people-map"))
  await shot(phone, "phone-people-map-on")

  // From outside again: People off by its op while the phone shows the map.
  await turn("people", false)
  check("off by its op: the phone's map page says so", await until(async () => /^Nothing to show/.test(await blockState(phone, "people-map")), 5000), await blockState(phone, "people-map"))
  await turn("people", true)
  check("on by its op: it draws again", await until(async () => (await blockState(phone, "people-map")) === "drawn", 5000))

  check("nothing reloaded the app", page.loads === 0 && phone.loads === 1, [page.loads, phone.loads])
} finally {
  for (const r of restore) r()
}
await done()
