// The sidebar is plugins' panels: Search, Pages (core plugins), Terminal's sessions and Files, in that order (the
// default: their `sort`). With no sessions the Terminals panel folds itself (nothing saved). Opens a
// terminal from the Terminals panel and finds it listed (lit while its tab is focused), turns plugins off one by one
// (their panels go, live, without a reload) until the sidebar is empty but for Plugins and Settings, turns them on again,
// folds panels by their headings (and checks a drag or a heading's button doesn't), then ends the session from the
// panel (its tab closes). In both densities, the geometry (RAIL in Sidebar.tsx): rows follow density, and the headings,
// row icons, tree chevrons and search icon stay on one line, the rail's icons centred. Runs a shell and writes
// .vaultite/plugins.json, sidebars.json and appearance.json: throwaway only.
//   node web/qa/sidebar.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/sidebar-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const settings = path.join(VAULT, ".vaultite/plugins.json")
const original = existsSync(settings) ? readFileSync(settings, "utf8") : null // a new vault has none yet
const pagesFile = path.join(VAULT, ".vaultite/pages.json")
const pagesBefore = readFileSync(pagesFile, "utf8")
// Workspaces off (web/qa/workspaces.mjs checks them): the sidebar's setup is sidebars.json's, the default to start.
const setDisabled = (ids) => writeFileSync(settings, JSON.stringify({ ...JSON.parse(original ?? "{}"), disabled: [...ids, "workspaces"] }, null, 2) + "\n")
const sidebarsFile = path.join(VAULT, ".vaultite/sidebars.json")
const sidebarsBefore = existsSync(sidebarsFile) ? readFileSync(sidebarsFile, "utf8") : null
const DEFAULT = ["search:search", "pages:pages", "terminal:sessions", "files:files"]
const setDefault = () => writeFileSync(sidebarsFile, JSON.stringify({ left: DEFAULT, right: [], collapsed: [] }, null, 2) + "\n")
const saved = () => { try { return JSON.parse(readFileSync(sidebarsFile, "utf8")) } catch { return {} } }
/** Saved as folded (sidebars.json's `collapsed`); in the left sidebar. */
const folded = (k) => !!saved().collapsed?.includes(k)
const listed = (k) => !!saved().left?.includes(k)

const appearance = await fetch(new URL("/api/config/appearance", B)).then((r) => r.json())
const setDensity = (density) => fetch(new URL("/api/config/appearance", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...appearance, density }) })

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const panels = () => page.$$eval("aside [data-panel]", (els) => els.map((e) => e.getAttribute("data-panel")))
try {
  // (Links, the backlinks panel, stays off here: web/qa/links.mjs checks it.)
  setDisabled(["backlinks"])
  setDefault()
  // Two pinned pages, so the Pages panel has rows.
  for (const p of ["Dashboards/Today.md"]) await fetch(new URL("/api/pins", B), { method: "POST", body: JSON.stringify({ path: p, pinned: true }) })
  await page.goto(B)
  await page.waitForSelector("aside [data-panel]")
  await until(async () => (await panels()).length === 4)
  check("panels in order", JSON.stringify(await panels()) === JSON.stringify(["search:search", "pages:pages", "terminal:sessions", "files:files"]), await panels())
  // (With tmux, the list is every vau- session on this machine, the live server's included: only ours is ended below.)
  const before = await until(async () => (await page.$$("aside [data-session]")).length > 0 || !!(await page.$("aside [data-auto-folded]")))
  check("terminals listed or none yet", !!before)
  if (await page.$("aside [data-auto-folded]")) {
    check("no sessions: Terminals folded by itself", !!(await page.$("aside [data-panel='terminal:sessions'] [data-fold=collapsed]")) && !(await page.$("aside >> text=No terminals running")))
    check("...not saved as folded", !folded("terminal:sessions"))
    await page.click("aside [data-panel='terminal:sessions'] [data-panel-handle]", { position: { x: 12, y: 14 } })
    check("its heading clicked: shown, with Open one", !!(await until(() => page.$("aside >> text=No terminals running"))))
    check("...still not saved", !folded("terminal:sessions"))
  }
  check("pinned pages listed", (await page.$$("aside [data-panel='pages:pages'] [data-pin]")).length >= 1)
  await page.screenshot({ path: `${OUT}1-default.png` })

  // A new terminal from the panel's + (a menu: a terminal, then every coding agent that's on) opens a tab and shows up
  // in the list, lit.
  await page.hover("aside [data-panel='terminal:sessions']")
  await page.click("aside [aria-label='New terminal or agent']")
  const offered = await page.$$eval("[role=menu] [role=menuitem]", (els) => els.map((e) => e.textContent.trim()))
  check("the + menu offers a terminal and the agents", offered[0] === "New terminal" && offered.includes("New Claude Code") && offered.includes("New Codex"), offered)
  await page.locator("[role=menu] [role=menuitem]", { hasText: "New terminal" }).click()
  const had = new Set(await page.$$eval("aside [data-session]", (els) => els.map((e) => e.getAttribute("data-session"))))
  const row = await until(async () => { for (const r of await page.$$("aside [data-session]")) if (!had.has(await r.getAttribute("data-session"))) return r })
  check("session listed", !!row)
  const sid = row && (await row.getAttribute("data-session"))
  check("its tab opened", !!(await until(async () => decodeURIComponent(page.url()).includes(`terminal/${sid}`))), page.url())
  check("row lit", await until(async () => (await row.getAttribute("class")).includes("font-medium")), await row.getAttribute("class"))
  await wait(800)
  await page.screenshot({ path: `${OUT}2-terminal.png` })

  // Plugins off, one by one: their panels go without a reload.
  const off = ["backlinks"]
  for (const id of ["search", "pages", "files", "terminal"]) {
    off.push(id)
    setDisabled(off)
    const left = await until(async () => { const p = await panels(); return p.every((k) => !off.includes(k.split(":")[0])) ? p : null })
    check(`${id} off: its panel goes`, !!left, await panels())
  }
  check("empty sidebar", (await panels()).length === 0, await panels())
  check("Plugins and Settings stay", !!(await page.$("aside nav[aria-label='App'] [aria-label='Plugins']")) && !!(await page.$("aside nav[aria-label='App'] [aria-label='Settings']")))
  await page.screenshot({ path: `${OUT}3-empty.png` })

  // Back on: the session is still running (turning the panel off doesn't end shells).
  setDisabled(["backlinks"])
  await until(async () => (await panels()).length === 4)
  check("panels back", (await panels()).length === 4, await panels())
  check("session survived", !!(await until(() => page.$(`aside [data-session='${sid}']`))))

  const y = async (sel) => (await (await page.$(sel)).boundingBox()).y
  // Right-click the sidebar: a menu of its panels, ticked; unticking one hides it and the menu stays open.
  await page.click("aside [data-titlebar]", { button: "right" })
  const item = (name) => page.$(`[role=menuitemcheckbox]:has-text("${name}")`)
  const labels = await page.$$eval("[role=menuitemcheckbox]", (els) => els.map((e) => `${e.textContent.trim()}:${e.getAttribute("aria-checked")}`))
  check("panel menu lists the panels, ticked", ["Search field", "Pinned pages", "File explorer", "Terminals"].every((n) => labels.includes(`${n}:true`)), labels)
  await (await item("File explorer")).click()
  check("unticked: the tree goes", !!(await until(async () => !(await panels()).includes("files:files"))), await panels())
  check("menu stays open, unticked", (await (await item("File explorer"))?.getAttribute("aria-checked")) === "false")
  const conf = () => JSON.parse(readFileSync(settings, "utf8"))
  check("saved as hidden (in no sidebar), the plugin stays on", !!(await until(async () => !listed("files:files"))) && !conf().disabled.includes("files"), [saved(), conf()])
  await (await item("File explorer")).click()
  check("ticked again: the tree's back", !!(await until(async () => (await panels()).includes("files:files"))), await panels())
  // Hiding Terminals hides the list only: terminals still work (the plugin stays on, its commands too).
  await (await item("Terminals")).click()
  check("Terminals hidden", !!(await until(async () => !(await panels()).includes("terminal:sessions"))), await panels())
  check("Terminal plugin still on", !conf().disabled.includes("terminal"), conf())
  await (await item("Terminals")).click()
  check("Terminals back", !!(await until(async () => (await panels()).includes("terminal:sessions"))), await panels())
  await page.keyboard.press("Escape")
  // The pages' own menu ends with the panel's: the same panels, under Panels ▸.
  await page.click("aside [data-panel='pages:pages'] [data-pin]", { button: "right" })
  await page.getByRole("menuitem", { name: "Panels" }).hover()
  check("pages menu has the panels", !!(await until(() => item("File explorer"))))
  await page.keyboard.press("Escape")

  // Click a heading: its panel folds to it (a chevron after the name), saved in sidebars.json's `collapsed`; click again,
  // it's back.
  // The same for a heading the sidebar draws (Pinned) and one a panel draws itself (Files, grow: it gives its height back).
  const head = (k) => `aside [data-panel='${k}'] [data-panel-handle]`
  const visible = (sel) => page.$eval(sel, (e) => !!e.getClientRects().length).catch(() => false)
  const clickHead = (k) => page.click(head(k), { position: { x: 12, y: 14 } })
  await clickHead("pages:pages")
  check("pinned folds: its rows go", !!(await until(async () => !(await visible("aside [data-panel='pages:pages'] [data-pin]")))))
  check("folded: the heading stays, with a right chevron", await visible(head("pages:pages")) && await visible(`${head("pages:pages")} [data-fold=collapsed]`))
  check("folded: saved as collapsed", !!(await until(async () => folded("pages:pages"))), saved())
  await clickHead("files:files")
  check("files folds: the tree goes", !!(await until(async () => !(await visible("aside [data-panel='files:files'] [role=tree]")))))
  const filesH = (await (await page.$("aside [data-panel='files:files']")).boundingBox()).height
  check("a folded grow panel gives its height back", filesH < 50, filesH)
  check("...the room below it is empty", (await y("aside nav[aria-label='App']")) - (await y("aside [data-panel='files:files']")) - filesH > 100)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${OUT}4-collapsed.png` })
  // A heading's button doesn't fold or open it.
  await page.hover(head("files:files"))
  await page.click(`${head("files:files")} [aria-label='Change sort order']`)
  await page.keyboard.press("Escape")
  await wait(300)
  check("a heading's button doesn't toggle it", !(await visible("aside [data-panel='files:files'] [role=tree]")))
  // Dragging a heading moves the panel and doesn't fold it at the end.
  const hb = await (await page.$(head("terminal:sessions"))).boundingBox()
  const pb = await (await page.$(head("pages:pages"))).boundingBox()
  await page.mouse.move(hb.x + 20, hb.y + hb.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(hb.x + 20, hb.y + (pb.y - 2 - hb.y) * i / 10); await wait(20) }
  await page.mouse.up()
  const order = await until(async () => { const p = await panels(); return p.indexOf("terminal:sessions") < p.indexOf("pages:pages") ? p : null })
  check("drag a heading: the panel moves", !!order, await panels())
  await wait(300)
  check("...and the drag doesn't fold it", !(await page.$("aside [data-panel='terminal:sessions'][data-collapsed]")) && !folded("terminal:sessions"), saved())
  // The rail ignores folding: the pages' icons show.
  await page.keyboard.press("ControlOrMeta+Backslash")
  await wait(400)
  check("rail: folded pages still show their icons", await visible("aside [data-panel='pages:pages'] [data-pin]"))
  await page.keyboard.press("ControlOrMeta+Backslash")
  await wait(400)
  // Open both again (and the order as it was).
  await clickHead("pages:pages")
  await clickHead("files:files")
  check("opened again", !!(await until(async () => await visible("aside [data-panel='pages:pages'] [data-pin]") && await visible("aside [data-panel='files:files'] [role=tree]"))))
  check("...and saved", !!(await until(async () => !folded("pages:pages") && !folded("files:files"))), saved())
  setDefault()
  await until(async () => JSON.stringify(await panels()) === JSON.stringify(DEFAULT))

  // The rail: pages keep their icons, the tree and the Terminals heading hide.
  await page.keyboard.press("ControlOrMeta+Backslash")
  await wait(400)
  check("rail: terminals right under the pages, past a line", (await y("aside [data-session]")) - (await page.$$eval("aside [data-pin]", (els) => els[els.length - 1].getBoundingClientRect().y)) < 50)
  check("rail: no headings, a line between panels", !(await page.$("aside [data-panel-handle]")) &&
    (await page.$$eval("aside [data-rail-section]", (els) => els.filter((e) => getComputedStyle(e, "::before").content !== "none").length)) >= 3)
  // ...and none above the first icons: with the Inbox panel in the sidebar, the header's Inbox button draws nothing,
  // and its empty place is no group.
  writeFileSync(sidebarsFile, JSON.stringify({ left: [...DEFAULT, "inbox:inbox"], right: [], collapsed: [] }, null, 2) + "\n")
  check("rail: no line above the first icons", !!(await until(() => page.$$eval("aside [data-rail-section]", (els) => {
    const first = els.find((e) => e.getBoundingClientRect().height > 0.5 && [...e.children].some((c) => c.getBoundingClientRect().height > 0))
    return !!document.querySelector("aside [data-panel='inbox:inbox']") && !!first && getComputedStyle(first, "::before").content === "none"
  }), 3000)))
  setDefault()
  await until(async () => !(await page.$("aside [data-panel='inbox:inbox']")))
  check("rail: sessions in their own colours", new Set(await page.$$eval("aside [data-session] svg", (els) => els.map((e) => getComputedStyle(e).color))).size === Math.min(2, (await page.$$("aside [data-session]")).length) || (await page.$$("aside [data-session]")).length > 2)
  await page.screenshot({ path: `${OUT}5-rail.png` })
  // Files is one icon that opens the tree beside the rail: a file picked opens and closes it; Escape and a click
  // outside close it.
  await page.click("aside [data-flyout-icon='files:files']")
  check("rail: Files opens a flyout with the tree", !!(await until(() => page.$("[data-flyout='files:files'] [role=tree]"))))
  await page.screenshot({ path: `${OUT}6-flyout.png` })
  await page.keyboard.press("Escape")
  check("...Escape closes it", !!(await until(async () => !(await page.$("[data-flyout]")))))
  await page.click("aside [data-flyout-icon='files:files']")
  await until(() => page.$("[data-flyout] [role=tree]"))
  await page.mouse.click(700, 400)
  check("...a click outside closes it", !!(await until(async () => !(await page.$("[data-flyout]")))))
  await page.click("aside [data-flyout-icon='files:files']")
  const f = await until(() => page.$("[data-flyout] [data-tree-path]:not([data-tree-folder]) button"))
  const fp = await (await f.$("xpath=..")).getAttribute("data-tree-path")
  await f.click()
  check("...a file picked opens and closes it", !!(await until(async () => !(await page.$("[data-flyout]")) && (await page.evaluate(() => decodeURIComponent(location.hash))).includes(fp))), fp)
  await page.keyboard.press("ControlOrMeta+Backslash")
  await wait(400)

  // Density: everything in the sidebar is in spacing units (4px in compact, 4.5px in comfortable).
  for (const [density, u] of [["comfortable", 4.5], ["compact", 4]]) {
    await setDensity(density)
    await until(async () => (await page.evaluate(() => document.documentElement.dataset.density ?? "compact")) === density)
    await wait(300)
    const g = await page.evaluate(() => {
      const a = document.querySelector("aside").getBoundingClientRect()
      const x = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().left - a.left : null }
      return {
        tree: document.querySelector("aside [role=tree] [data-tree-path]").getBoundingClientRect().height,
        row: document.querySelector("aside [data-pin]").getBoundingClientRect().height,
        xs: [x("aside [data-panel-handle] span.truncate"), x("aside [data-pin] svg"), x("aside [role=tree] [data-tree-folder] svg")],
      }
    })
    check(`${density}: tree rows ${6.5 * u}px, sidebar rows ${7 * u}px`, g.tree === 6.5 * u && g.row === 7 * u, g)
    check(`${density}: headings, row icons and chevrons on one line, ${3.5 * u}px in`, g.xs.every((v) => v === 3.5 * u), g.xs)
    await page.keyboard.press("ControlOrMeta+Backslash"); await wait(400)
    const r = await page.evaluate(() => {
      const a = document.querySelector("aside").getBoundingClientRect(), i = document.querySelector("aside [data-pin] svg").getBoundingClientRect()
      return { rail: a.width, icon: i.left + i.width / 2 - a.left }
    })
    check(`${density}: the rail is ${11 * u}px, its icons centred`, r.rail === 11 * u && r.icon === r.rail / 2, r)
    await page.keyboard.press("ControlOrMeta+Backslash"); await wait(400)
  }

  // End it from the panel: its tab closes and the list empties.
  const r = await page.$(`aside [data-session='${sid}']`)
  await r.hover()
  await page.click(`aside [data-session='${sid}'] [aria-label='End session']`)
  check("session ended", !!(await until(async () => !(await page.$(`aside [data-session='${sid}']`)))))
  check("its tab closed", !!(await until(async () => !decodeURIComponent(page.url()).includes(sid))), page.url())
  await page.screenshot({ path: `${OUT}6-ended.png` })
} finally {
  if (original === null) rmSync(settings, { force: true }); else writeFileSync(settings, original)
  if (sidebarsBefore === null) rmSync(sidebarsFile, { force: true }); else writeFileSync(sidebarsFile, sidebarsBefore)
  writeFileSync(pagesFile, pagesBefore)
  await setDensity(appearance.density ?? "compact")
  await browser.close()
}
await done()
