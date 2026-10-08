// Graph view: the whole vault in a tab (palette "Open graph view"), drawn fast enough with a couple of thousand files,
// hover lighting a node, a click opening its file, search, the filters menu (files with no links), a legend group
// hidden and shown (its settings file written), light and dark, the local graph block in a note, the sidebar's Local
// graph panel, "Open local graph", and a phone at 390px. WRITES the graph's settings, appearance.json and sidebars.json (put back),
// and a "Qa graph" folder: throwaway server only.
//   node web/qa/graph.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces, workspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const req = (method, path, body) => fetch(`${B}api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
const SETTINGS = `${VAULT}/.vaultite/plugins/graph/data.json`, APPEAR = `${VAULT}/.vaultite/appearance.json`
const SIDEBARS = `${VAULT}/.vaultite/sidebars.json`, PLUGINS = `${VAULT}/.vaultite/plugins.json`
const saved = Object.fromEntries([SETTINGS, APPEAR, SIDEBARS, PLUGINS].map((p) => [p, existsSync(p) ? readFileSync(p, "utf8") : null]))
// What it tests needs Workspaces (a panel shown is the current workspace's) and Graph on, whatever the vault turned off
// (the sandbox starts calm: Workspaces off). Put back at the end with the rest.
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: VAULT } })
vau("plugin", "on", "workspaces")
vau("plugin", "on", "graph")
const putBackWs = setAsideWorkspaces(VAULT)
rmSync(SETTINGS, { force: true })
const DEFAULT = ["search:search", "pages:pages", "terminal:sessions", "files:files"]
await req("PUT", "config/sidebars", { left: DEFAULT, right: [], collapsed: [] })
const NOTE = "Qa graph/With a graph.md"
await req("DELETE", `file?path=${encodeURIComponent("Qa graph")}`)
const before = await (await req("GET", "graph")).json()
const hub = before.nodes.slice().sort((a, b) => b.degree - a.degree)[0]
await req("POST", "file", { path: NOTE, text: `Links to [[${hub.path.replace(/\.md$/, "")}]].\n\n\`\`\`block-graph\ndepth: 2\nheight: 260\n\`\`\`\n` })
const all = await (await req("GET", "graph")).json()

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-local-graph] canvas", { timeout: 15000 })
check("the local graph block draws in a note", true)
check("the block has no Fit button until it's moved", !(await page.$("[data-local-graph] [data-graph-fit]")))
{
  const b = await (await page.$("[data-local-graph] canvas")).boundingBox()
  await page.mouse.move(b.x + 6, b.y + 6); await page.mouse.down()
  await page.mouse.move(b.x + b.width - 6, b.y + b.height - 6, { steps: 8 }); await page.mouse.up(); await wait(300)
  check("dragged away, the block shows Fit", !!(await page.$("[data-local-graph] [data-graph-fit]")))
  await page.click("[data-local-graph] [data-graph-fit]"); await wait(300)
  check("Fit brings it back and goes", !(await page.$("[data-local-graph] [data-graph-fit]")))
}
check("the sidebar's Local graph panel is hidden until shown (`hidden`)", !(await page.$("[data-local-graph-panel]")))
// Shown from the sidebar's right-click menu (a hidden panel is under More ▸, 1db1908): at the end of the left sidebar.
await page.click("aside [data-titlebar]", { button: "right" }); await wait(300)
await page.locator("[role=menu]").first().locator(":scope > button", { hasText: /^More$/ }).hover(); await wait(300)
check("the menu lists it under More, unticked", await page.getAttribute('[role=menuitemcheckbox]:has-text("Local graph")', "aria-checked") === "false")
await page.click('[role=menuitemcheckbox]:has-text("Local graph")'); await wait(500)
// (Escape closes the submenu, then the menu)
while (await page.$("[role=menu]")) { await page.keyboard.press("Escape"); await wait(100) }
await page.waitForSelector("[data-local-graph-panel] canvas", { timeout: 8000 }).then(() => check("shown from the menu, it draws the file's neighbours", true), () => check("shown from the menu, it draws the file's neighbours", false))
// With Workspaces on there always is a current workspace (02c5ae8): a panel shown is that workspace's own (its
// `sidebars` in Workspaces' data.json, the first one here), and sidebars.json, the default new ones start with, stays.
const own = workspaces(VAULT)[0]?.sidebars ?? null
check(`showing it writes the workspace's panels (${JSON.stringify(own?.left)})`, JSON.stringify(own?.left) === JSON.stringify([...DEFAULT, "graph:local"]))
check("...and leaves sidebars.json, the default, as it was", JSON.stringify(JSON.parse(readFileSync(SIDEBARS, "utf8")).left) === JSON.stringify(DEFAULT))

await palette(page, "Open graph view")
const canvas = page.locator("[data-graph-canvas=view] canvas")
await canvas.waitFor({ timeout: 15000 })
const linked = new Set(all.edges.flatMap((e) => [e.from, e.to])).size
const shownNodes = Number(await canvas.getAttribute("data-graph-nodes"))
check(`files with no links are hidden by default (${shownNodes} of ${all.nodes.length})`, shownNodes === linked)
// Frames while the layout settles.
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2) }; requestAnimationFrame(f) }))
// Headless Chrome draws the canvas in software (about 20 fps here); a real window draws the same 1800 nodes at 60.
check(`draws at ${Math.round(fps)} fps while ${shownNodes} nodes settle (headless, software)`, fps >= 10)
await wait(3000)
await page.screenshot({ path: `${OUT}graph-light.png` })

// Hover: find a node by moving over the canvas, then click it.
const cb = await canvas.boundingBox()
let hovered = ""
for (let y = cb.y + 120; y < cb.y + cb.height - 60 && !hovered; y += 9) {
  for (let x = cb.x + cb.width / 2 - 200; x < cb.x + cb.width / 2 + 200 && !hovered; x += 9) {
    await page.mouse.move(x, y)
    hovered = (await canvas.getAttribute("data-graph-hover")) || ""
  }
}
check(`hovering a dot lights it (${hovered})`, !!hovered)
await page.screenshot({ path: `${OUT}graph-hover.png` })
const at = await page.evaluate(() => [location.hash])
await page.mouse.down(); await page.mouse.up()
await wait(800)
const hash = decodeURIComponent(await page.evaluate(() => location.hash))
check(`a click opens it (${hash}, was ${at[0]})`, hash.includes(hovered))
await page.goBack(); await wait(800)
await page.locator("[data-graph-canvas=view] canvas").waitFor()

// Search.
await page.fill("[data-graph-search]", "Gen 1")
await wait(300)
const count = await page.textContent("[data-graph-count]")
check(`search counts what it finds (${count})`, /found/.test(count))
await page.fill("[data-graph-search]", "")

// Filters: files with no links.
await page.click("[data-graph-filters]"); await wait(300)
await page.getByText("Show files with no links").click(); await wait(800)
const withOrphans = Number(await page.locator("[data-graph-canvas=view] canvas").getAttribute("data-graph-nodes"))
check(`the filter shows files with no links (${withOrphans})`, withOrphans === all.nodes.length)
check("the setting is saved in .vaultite/plugins/graph/data.json", existsSync(SETTINGS) && JSON.parse(readFileSync(SETTINGS, "utf8")).orphans === true)

// Legend: hide a group, then show it again.
const first = page.locator("[data-graph-group]").first()
const group = await first.getAttribute("data-graph-group")
await first.click(); await wait(600)
const fewer = Number(await page.locator("[data-graph-canvas=view] canvas").getAttribute("data-graph-nodes"))
check(`hiding a group (${group || "top level"}) leaves its files out (${fewer})`, fewer < withOrphans)
await first.click(); await wait(600)

// Dark.
await req("PUT", "config/appearance", { theme: "dark" }); await wait(1500)
await page.screenshot({ path: `${OUT}graph-dark.png` })
const px = await page.evaluate(() => {
  const c = document.querySelector("[data-graph-canvas=view] canvas"), g = c.getContext("2d")
  const d = g.getImageData(0, 0, c.width, c.height).data
  let lit = 0
  for (let i = 0; i < d.length; i += 4 * 37) if (d[i + 3] > 0) lit++
  return lit
})
check(`draws in dark (${px} painted samples)`, px > 100)
await req("PUT", "config/appearance", { theme: "light" })

// Local graph from the palette.
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1200)
await palette(page, "Open local graph")
check("Open local graph opens the file's graph in a tab", !!(await page.$(`[data-graph-view="${NOTE}"] canvas`)))
noErrors()

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = await phone.newPage()
await pp.goto(`${B}#view/graph`)
await pp.waitForSelector("[data-graph-canvas=view] canvas", { timeout: 15000 })
await wait(2500)
const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check(`no sideways scroll at 390px (${over})`, over <= 0)
await pp.screenshot({ path: `${OUT}graph-phone.png` })

await browser.close()
for (const [p, text] of Object.entries(saved)) { if (text === null) rmSync(p, { force: true }); else writeFileSync(p, text) }
putBackWs()
await req("DELETE", `file?path=${encodeURIComponent("Qa graph")}`)
await done()
