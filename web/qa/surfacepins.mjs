// Views pinned (plugins/core/pages): Pin in a view tab's menu pins it as its target (Inbox: view:inbox), a search tab as
// its search; a web page pinned by its address (vau pin <address> --label) shows under its name and opens in a web tab,
// hidden while the Web viewer is off; Pinned's menu (More ▸) offers the plugins' main views, one click to pin.
// WRITES pages.json and turns plugins on and off (puts them back): throwaway server only.
//   node web/qa/surfacepins.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import path from "node:path"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const post = (p, body) => fetch(`${B}api/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const conf = async () => (await (await fetch(`${B}api/config/pages`)).json())
const pins = async () => (await conf()).pinned ?? []
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
const on = (id) => new RegExp(`^on\\s+${id}\\b`, "m").test(vau("plugins"))
// (pages.json's list is the sidebar's without Workspaces)
const desks = on("workspaces")
if (desks) vau("plugin", "off", "workspaces")
const webWas = on("web-viewer"), graphWas = on("graph")
if (!webWas) vau("plugin", "on", "web-viewer")
if (!graphWas) vau("plugin", "on", "graph")
const before = await pins()
const WEB = "view:web/https://example.com/"
const added = ["view:inbox", "search:qa pins", WEB, "view:graph"]
for (const k of added) await post("pins", { path: k, pinned: false })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } } catch { /* about:blank */ } })
  const page = watch(await ctx.newPage())
  const go = async (hash) => { await page.goto("about:blank"); await page.goto(`${B}${hash}`); await page.waitForSelector("nav[aria-label=Pages]"); await wait(800) }
  const sidebarPin = async (name) => {
    await page.locator("[data-tab-bar] [data-tab-id]", { hasText: name }).first().click({ button: "right" }); await wait(200)
    const items = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
    // (Pin tab keeps the tab; the sidebar's Pin comes after the view's own items)
    if (items.includes("Pin tab") && items.filter((t) => t === "Pin").length === 1) await page.locator("[role=menu] [role^=menuitem]", { hasText: /^Pin$/ }).click()
    else await page.keyboard.press("Escape")
    return items
  }

  await go("#view/inbox")
  const items = await sidebarPin("Inbox")
  check("an Inbox tab's menu: Pin tab, then one Pin for the sidebar", items.indexOf("Pin tab") >= 0 && items.filter((t) => t === "Pin").length === 1 && items.indexOf("Pin") > items.indexOf("Pin tab"), items)
  check("Pin: it's pinned as its target", await until(async () => (await pins()).includes("view:inbox")), await pins())
  const inbox = page.locator(`nav[aria-label=Pages] [data-pin="view:inbox"]`)
  check("...in the sidebar, by its name", await until(async () => (await inbox.count()) === 1) && (await inbox.innerText()).trim() === "Inbox")

  await go(`#view/${encodeURIComponent("search/qa pins")}`)
  await sidebarPin("qa pins")
  check("a search tab pins as its search", await until(async () => (await pins()).includes("search:qa pins")), await pins())

  vau("pin", "https://example.com/", "--label", "Example Domain")
  const web = page.locator(`nav[aria-label=Pages] [data-pin="${WEB}"]`)
  check("a web page pinned by its address shows by its name", await until(async () => (await web.count()) === 1) && (await web.innerText()).trim() === "Example Domain",
    await page.locator("nav[aria-label=Pages]").innerText())
  check("...linking to its web tab", (await web.getAttribute("href")) === `#view/${encodeURIComponent(WEB.slice(5))}`, await web.getAttribute("href"))
  check("...its site's icon (the globe until it has one)", (await web.locator("svg, img").count()) > 0)
  await page.screenshot({ path: `${OUT}surfacepins-sidebar.png` })
  await web.click()
  // (a browser isn't the desktop app: the tab says it opens outside)
  check("a click opens it in a web tab", await until(async () => (await page.locator("[data-web-elsewhere]").count()) === 1 &&
    decodeURIComponent(await page.evaluate(() => location.hash)).includes("web/https://example.com/")), await page.evaluate(() => location.hash))
  check("...its row the active one", await until(async () => /font-medium/.test(await web.getAttribute("class") ?? "")), await web.getAttribute("class"))
  await web.click({ button: "right" }); await wait(200)
  const rowItems = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
  check("its row's menu: open it, Unpin last", rowItems[0] === "Open in new tab" && rowItems.at(-1) === "Unpin", rowItems)
  await page.keyboard.press("Escape")

  vau("plugin", "off", "web-viewer")
  check("Web viewer off: it hides, still pinned", await until(async () => (await web.count()) === 0, 8000) && (await pins()).includes(WEB))
  vau("plugin", "on", "web-viewer")
  check("...back when it's on, in its place", await until(async () => (await web.count()) === 1, 8000))

  // Pinned's menu: More ▸ offers the plugins' main views.
  await page.locator("[data-panel='pages:pages'] [data-panel-handle]").first().click({ button: "right" }); await wait(200)
  await page.locator("[role=menu] button", { hasText: /^Pinned pages$/ }).first().hover(); await wait(300)
  await page.locator("[role=menu] button", { hasText: /^More$/ }).last().hover(); await wait(300)
  const more = await page.locator("[role=menu]").last().locator("[role=menuitemcheckbox]").allInnerTexts()
  check("More offers main views (Graph view), not what's pinned (Inbox) or the list itself", more.includes("Graph view") && !more.includes("Inbox") && !more.includes("Pinned pages"), more)
  await page.screenshot({ path: `${OUT}surfacepins-menu.png` })
  await page.locator("[role=menu]").last().getByRole("menuitemcheckbox", { name: "Graph view", exact: true }).click()
  check("one click pins it", await until(async () => (await pins()).includes("view:graph")), await pins())
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.keyboard.press("Escape")
  const graph = page.locator(`nav[aria-label=Pages] [data-pin="view:graph"]`)
  await graph.click()
  check("...and a click opens it", await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)) === "#view/graph"), await page.evaluate(() => location.hash))
  await page.screenshot({ path: `${OUT}surfacepins-graph.png` })
} finally {
  for (const k of added) await post("pins", { path: k, pinned: false })
  for (const p of before) await post("pins", { path: p, pinned: true })
  if (!webWas) vau("plugin", "off", "web-viewer")
  if (!graphWas) vau("plugin", "off", "graph")
  if (desks) vau("plugin", "on", "workspaces")
}
await done()
