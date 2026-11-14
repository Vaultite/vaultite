// Hover cards (core/hovercard.ts, components/HoverCard.tsx, components/TabCard.tsx, components/TabPreview.tsx, plugins/core/terminal/Screen.tsx, plugins/core/terminal/screens.ts):
// a tab's after a rest, warm to the next, a terminal's screen in its tab's and its Terminals row's. Starts a shell, opens tabs: throwaway server only.   node web/qa/tabcards.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { PROMPT, apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/tabcards-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
if (!/\d+\. \w+:sessions/.test(vau("panels", "--vault"))) vau("panels", "show", "terminals", "--vault")
const look = await api("GET", "config/appearance")
await api("PUT", "config/appearance", { ...look, tabBar: true, animation: "natural" })

const TERM = `qacard${Date.now().toString(36)}`, MARK = "QA-SCREEN-42"
const screenText = async () => (await api("GET", `terminals/${TERM}/capture?lines=20`)).text ?? ""
await api("POST", `terminals/${TERM}`, {})

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } })), ui = app(page)
await page.goto("about:blank"); await page.goto(B)
await page.waitForSelector("[data-tab-bar] [aria-label='New tab']", { timeout: 60000 })
const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.endsWith(".md") && !f.path.startsWith(".")).map((f) => f.path).slice(0, 3))
const openTab = async (hash, first) => {
  if (!first) await page.click("[data-tab-bar] [aria-label='New tab']")
  await page.evaluate((h) => { location.hash = h }, hash); await ui.idle()
}
await openTab(`#file/${encodeURIComponent(files[0])}`, true)
await openTab(`#file/${encodeURIComponent(files[1])}`)
await openTab(`#view/terminal%2F${TERM}`)
await until(async () => PROMPT.test(await screenText()), 10000)
await api("POST", `terminals/${TERM}/send`, { text: "echo QA-SCREEN-$((6*7))" })
check("the shell printed its line", await until(async () => (await screenText()).split("\n").some((l) => l.trim() === MARK), 10000))
await openTab(`#file/${encodeURIComponent(files[2])}`)
const chips = await page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => ({ id: e.dataset.tabId, text: e.textContent.trim(), active: e.querySelector("[role=tab]")?.getAttribute("aria-selected") === "true" })))
const term = chips.find((c) => /Terminal/.test(c.text)), plain = chips.filter((c) => !c.active && c !== term), active = chips.find((c) => c.active)
check("four tabs, a terminal's among them", chips.length >= 4 && !!term && plain.length >= 2 && !!active, chips)

const chip = (id) => page.locator(`[data-tab-bar] [data-tab-id="${id}"]`)
const card = () => page.locator("[data-tab-hover-card]")
const cardFor = () => card().getAttribute("data-tab-hover-card").catch(() => null)
const due = () => page.evaluate(() => vaultiteBusy().includes("hover card"))
const rest = async (id) => { const b = await chip(id).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }) }
const away = async () => { await page.mouse.move(700, 600, { steps: 3 }); await ui.idle() }

await rest(plain[0].id)
check("resting on a tab: nothing at once (a wait)", (await card().count()) === 0 && await due())
await ui.idle()
check("…then its card", (await cardFor()) === plain[0].id, await cardFor())
{
  const [t, c] = [await chip(plain[0].id).boundingBox(), await card().locator(".preview-card").boundingBox()]
  check("below its tab, from its left", c.y >= t.y + t.height - 1 && Math.abs(c.x - Math.max(8, t.x)) <= 12, { t, c })
  check("titled as the tab is", (await card().locator("[data-card-title]").textContent()).trim() === plain[0].text, await card().locator("[data-card-title]").textContent())
  await page.screenshot({ path: `${OUT}note.png`, clip: { x: 0, y: 0, width: 900, height: 320 } })
  check("a note's picture is its text", ((await card().locator("[data-card-picture]").textContent()) ?? "").trim().length > 0)
}
await rest(plain[1].id)
check("warm: the next tab's card at once", (await cardFor()) === plain[1].id, await cardFor())
check("…gliding over from the last one's place", /left/.test(await card().evaluate((e) => e.style.transition)), await card().evaluate((e) => e.style.transition))
await ui.idle()
await rest(term.id); await ui.idle()
check("a terminal's tab card: its screen", await until(async () => ((await card().locator("[data-terminal-picture]").textContent().catch(() => "")) ?? "").includes(MARK), 8000),
  await card().locator("[data-terminal-picture]").textContent().catch(() => null))
await page.screenshot({ path: `${OUT}terminal-tab.png`, clip: { x: 0, y: 0, width: 900, height: 320 } })
await page.keyboard.press("Escape"); await ui.idle()
check("Escape closes it", (await card().count()) === 0)
await away()
await rest(active.id); await ui.idle()
check("none for the active tab", (await card().count()) === 0)
await away()
await rest(plain[0].id); await ui.idle()
await page.mouse.down(); await ui.idle()
check("a press closes it", (await card().count()) === 0)
await page.mouse.up(); await away()

const row = page.locator(`aside [data-session="${TERM}"]`).first()
await row.waitFor({ timeout: 10000 })
await row.hover(); await ui.idle()
const termCard = page.locator(`[data-terminal-card="${TERM}"]`)
check("a Terminals row's card: its screen", await until(async () => ((await termCard.locator("[data-terminal-picture]").textContent().catch(() => "")) ?? "").includes(MARK), 8000))
{
  const [a, c] = [await row.locator("xpath=ancestor::aside").boundingBox(), await termCard.locator(".preview-card").boundingBox()]
  await page.screenshot({ path: `${OUT}terminal-row.png`, clip: { x: 0, y: Math.max(0, c.y - 40), width: 800, height: c.height + 80 } })
  check("…beside the sidebar", c && a && (c.x >= a.x + a.width - 1 || c.x + c.width <= a.x + 1), { a, c })
}
await away()
await api("PUT", "config/appearance", look)
await page.evaluate((s) => new Promise((ok) => { const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`); w.onopen = w.onerror = w.onclose = ok }), TERM)
await done()
