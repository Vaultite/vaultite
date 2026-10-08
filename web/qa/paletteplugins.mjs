// The command palette's plugin rows (components/CommandPalette.tsx): a plugin that's off, its name typed, is offered
// after the commands to turn on, with what it needs (People map brings People), and says so with Undo; a plugin
// that's on is offered to turn off only after "turn off" or "disable"; "turn on" alone lists the ones that are off;
// a vault plugin is never offered to turn on; one letter offers none. WRITES plugins.json (put back) and a vault
// plugin (.vaultite/plugins/qa-lamp, removed): throwaway server only.
//   node web/qa/paletteplugins.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { SHOTS, apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = `${SHOTS}paletteplugins/`], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const conf = () => api("GET", "config/plugins")

const saved = await conf()
await api("POST", "ops/plugin.new", { id: "qa-lamp", name: "Qa lamp", description: "A vault plugin for the palette's QA" })
await api("PUT", "config/plugins", { ...saved, disabled: ["workspaces", "people", "people-map"], enabled: [] })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })

/** Open the palette and type `q`: the rows' names, in order, and the section headings. */
async function search(q) {
  await page.keyboard.press("Escape"); await wait(100)
  await page.keyboard.press("ControlOrMeta+P"); await page.waitForSelector("[role=option]")
  await page.keyboard.type(q); await wait(200)
  const rows = await page.locator("#palette-results [role=option]").allInnerTexts()
  const heads = await page.locator("#palette-results [role=presentation]").allInnerTexts()
  return { rows: rows.map((t) => t.split("\n")[0].trim()), heads }
}
const pick = (name) => page.locator("#palette-results [role=option]", { hasText: name }).first().click()
const toastWith = (text) => page.locator("[data-sonner-toast]", { hasText: text }).first()

await page.goto(B); await wait(1500)

// 1. A plugin that's off, its name typed: offered last, under its heading.
let r = await search("workspa")
check("an off plugin is offered to turn on", r.rows.includes("Turn on Workspaces"), r.rows)
check("after the commands", r.rows[r.rows.length - 1] === "Turn on Workspaces", r.rows)
check("under its heading", r.heads.includes("Plugins that are off"), r.heads)
await page.screenshot({ path: `${OUT}turn-on.png` })
await pick("Turn on Workspaces"); await wait(500)
check("picking it turns it on", !(await conf()).disabled.includes("workspaces"), (await conf()).disabled)
check("it says so", await toastWith("Workspaces is on").isVisible())
await toastWith("Workspaces is on").getByRole("button", { name: "Undo" }).click(); await wait(500)
check("Undo turns it off again", (await conf()).disabled.includes("workspaces"), (await conf()).disabled)

// 2. One that needs another that's off: both go on.
r = await search("people m")
check("a plugin needing one that's off is offered", r.rows.includes("Turn on People map"), r.rows)
await pick("Turn on People map"); await wait(500)
let c = await conf()
check("it and what it needs go on", c.enabled.includes("people-map") && c.enabled.includes("people"), c.enabled)
check("the toast names both", await toastWith("People map is on, and People").isVisible())

// 3. On: a plain name doesn't offer to turn it off; "turn off" does, and says what goes with it.
r = await search("people")
check("a plain name offers no turn off", !r.rows.some((x) => x.startsWith("Turn off")), r.rows)
check("nor turn on (it's on)", !r.rows.includes("Turn on People"), r.rows)
r = await search("turn off peop")
check("\"turn off\" offers it", r.rows.includes("Turn off People"), r.rows)
check("under its heading", r.heads.includes("Plugins that are on"), r.heads)
await pick("Turn off People"); await wait(500)
c = await conf()
check("picking it turns it off", !c.enabled.includes("people"), c.enabled)
check("the toast says what goes with it", await toastWith(/^People is off, and People map\b.* with it/).isVisible(), await page.locator("[data-sonner-toast]").allInnerTexts())
r = await search("disable tag")
check("\"disable\" works too", r.rows.includes("Turn off Tags"), r.rows)

// 4. "turn on" alone lists what's off (Dock icon is off until asked for); never a vault plugin.
r = await search("turn on")
check("\"turn on\" lists the off plugins", r.rows.includes("Turn on Dock icon") && r.rows.includes("Turn on Workspaces"), r.rows)
check("not a vault plugin", !r.rows.includes("Turn on Qa lamp"), r.rows)
r = await search("qa lamp")
check("a vault plugin's name offers nothing", !r.rows.some((x) => x.includes("Qa lamp")), r.rows)

// 5. One letter offers no plugins.
r = await search("w")
check("one letter offers no plugin", !r.rows.some((x) => x.startsWith("Turn on")), r.rows)
await page.keyboard.press("Escape")

await browser.close()
await api("PUT", "config/plugins", saved)
await fetch(`${B}api/file?path=${encodeURIComponent(".vaultite/plugins/qa-lamp")}`, { method: "DELETE" })
await done()
