// Quiet panel headings (appearance.json `panelHeadings`, sidebars.json `headings`): a slim gap named on hover or ⌥,
// folded panels and needsHeading ones shown, an empty Inbox gone, the panel menu's Heading and Fold, vau panels heading.
// Exercises web/src/components/SidebarHeading.tsx, web/src/components/Sidebar.tsx, web/src/core/headingpeek.ts,
// core/sidebars.ts, core/coreops/panels.ts. Writes sidebars.json and appearance.json: throwaway only.
//   node web/qa/panelheadings.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/panelheadings-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const json = { "Content-Type": "application/json" }
const api = (p, init) => fetch(new URL(`/api/${p}`, B), init).then((r) => r.json())
const appearance = (o) => fetch(new URL("/api/config/appearance", B), { method: "PATCH", headers: json, body: JSON.stringify(o) })
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
const LEFT = ["search:search", "pages:pages", "tabs:tabs", "inbox:inbox", "terminal:sessions", "files:files"]
await fetch(new URL("/api/config/sidebars", B), { method: "PUT", headers: json, body: JSON.stringify({ left: LEFT, right: [], collapsed: [], heights: {} }) })
await appearance({ panelHeadings: "quiet", tabBar: false })
const sidebars = async () => (await api("workspaces")).workspaces?.[0]?.sidebars ?? await api("config/sidebars")

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 860 } }))
await page.goto(B)
const L = "aside[data-side=left]"
const panel = (k) => `${L} [data-sidebar-body] > [data-panel='${k}']`
await page.waitForSelector(`${panel("pages:pages")} [data-heading-mode]`, { timeout: 20000 })

/** A panel's heading: its mode, the strip's height, and how visible its name is. */
const heading = (k) => page.$eval(`${panel(k)} [data-panel-handle]`, (e) => ({
  mode: e.getAttribute("data-heading-mode") ?? "shown", h: Math.round(e.getBoundingClientRect().height),
  name: Number(getComputedStyle(e.querySelector("[data-heading-name]") ?? e).opacity),
})).catch(() => null)
const settle = () => wait(400)

// At rest: a slim gap, its name out of sight.
const pinned = await heading("pages:pages")
check("quiet: Pinned's heading is a slim gap", pinned?.mode === "quiet" && pinned.h > 0 && pinned.h <= 24, pinned)
check("quiet: its name is out of sight", pinned?.name === 0, pinned)
check("quiet: the Tabs panel's own heading is quiet too", (await heading("tabs:tabs"))?.mode === "quiet", await heading("tabs:tabs"))
await page.screenshot({ path: `${OUT}quiet.png` })

// Pointed at, the name shows, nothing moving.
const below = async () => page.$eval(`${panel("pages:pages")} [data-panel-handle] + *`, (e) => Math.round(e.getBoundingClientRect().top)).catch(() => null)
const before = await below()
const strip = await (await page.$(`${panel("tabs:tabs")} [data-panel-handle]`)).boundingBox()
await page.mouse.move(strip.x + 40, strip.y + strip.height / 2); await settle()
check("hovered: the gap shows its name", (await heading("tabs:tabs"))?.name === 1, await heading("tabs:tabs"))
check("hovered: the others stay quiet", (await heading("pages:pages"))?.name === 0)
check("hovered: nothing moves", (await below()) === before)
await page.screenshot({ path: `${OUT}hovered.png` })
await page.mouse.move(900, 400); await settle()

// ⌥ held: every name at once; let go, gone.
await page.keyboard.down("Alt"); await settle()
check("⌥ held: the page says so", await page.evaluate(() => document.documentElement.hasAttribute("data-headings-peek")))
check("⌥ held: every quiet name shows", (await heading("pages:pages"))?.name === 1 && (await heading("files:files"))?.name === 1)
await page.screenshot({ path: `${OUT}alt.png` })
await page.keyboard.up("Alt"); await settle()
check("⌥ let go: they go again", (await heading("pages:pages"))?.name === 0)

// Inbox needs its name (needsHeading), but empty it takes no room while headings are quiet.
const inboxShown = () => page.$eval(panel("inbox:inbox"), (e) => !!e.getClientRects().length).catch(() => false)
const ai = (await api("config/plugins")).ai !== false
if (ai) {
  await until(() => page.$(`${panel("inbox:inbox")} [data-inbox-panel]`), 10000)
  check("quiet: an empty Inbox takes no room", !(await inboxShown()))
  await appearance({ panelHeadings: "shown" })
  await until(async () => (await heading("pages:pages"))?.mode === "shown", 5000)
  check("shown: the empty Inbox is back, saying so", await inboxShown())
  check("shown: headings are headings", (await heading("pages:pages"))?.h >= 26, await heading("pages:pages"))
  await appearance({ panelHeadings: "quiet" })
  await until(async () => (await heading("pages:pages"))?.mode === "quiet", 5000)
}

// The panel's menu: Heading's three choices, and Fold while it isn't shown.
const menuText = () => page.$eval("[role=menu]", (e) => e.textContent).catch(() => "")
await page.click(`${panel("files:files")} [data-panel-handle]`, { button: "right", position: { x: 60, y: 8 } })
await until(() => page.$("[role=menu]"), 3000)
const m = await menuText()
check("menu: Heading with Shown, Quiet and Hidden", /Shown/.test(m) && /Quiet/.test(m) && /Hidden/.test(m), m)
check("menu: Fold, its heading not being shown", /Fold File explorer/.test(m), m)
await page.screenshot({ path: `${OUT}menu.png` })
await page.getByRole("menuitem", { name: /Fold File explorer/ }).click()
await until(async () => (await sidebars()).collapsed?.includes("files:files"), 5000)
await until(async () => (await heading("files:files"))?.mode === "shown", 5000)
check("folded: its heading is shown, the only thing left of it", (await heading("files:files"))?.mode === "shown", await heading("files:files"))
await page.screenshot({ path: `${OUT}folded.png` })

// vau panels heading: one panel's own mode, saved in sidebars.json's `headings`, drawn at once; `default` takes it back.
const op = (id, body) => fetch(new URL(`/api/ops/${id}`, B), { method: "POST", headers: json, body: JSON.stringify(body) }).then((r) => r.json())
await op("panel.heading", { panel: "tabs", mode: "hidden" })
check("op: saved in headings", (await sidebars()).headings?.["tabs:tabs"] === "hidden", await sidebars())
await until(async () => (await heading("tabs:tabs"))?.mode === "hidden", 5000)
const tabs = await (await page.$(`${panel("tabs:tabs")} [data-panel-handle]`)).boundingBox()
await page.mouse.move(tabs.x + 40, tabs.y + tabs.height / 2); await settle()
check("hidden: pointing doesn't name it", (await heading("tabs:tabs"))?.name === 0, await heading("tabs:tabs"))
await page.mouse.move(900, 400)
await op("panel.heading", { panel: "tabs", mode: "default" })
check("op: default takes its own away", !(await sidebars()).headings, await sidebars())
await op("panel.heading", { panel: "pinned", mode: "shown" })
await until(async () => (await heading("pages:pages"))?.mode === "shown", 5000)
check("op: one panel shown among quiet ones", (await heading("pages:pages"))?.mode === "shown" && (await heading("tabs:tabs"))?.mode === "quiet")

await appearance({ panelHeadings: null, tabBar: null })
await done()
