// A finger drags and swipes (core/drag.ts' pickUp, components/SwipeRow.tsx), on a phone-sized page with touch, in the
// left drawer: held still, a file row's menu opens and lifting leaves it; held then moved onto a folder, the menu
// closes, the row's picture follows the finger, the folder lights up and letting go moves the file there; moved without
// a hold (a scroll), nothing is picked up; a panel's heading held and moved puts the panel elsewhere in the drawer;
// a row swiped right (away from the left drawer's edge) shows Move and Delete, and Delete trashes it; swiped left, the
// drawer closes instead. In the Files tab a row swipes left. Chrome's touch emulation, not an iPhone: WebKit's own
// scrolling and selection aren't covered. WRITES (moves and trashes sandbox files, sidebars.json): throwaway only.
//   node web/qa/touchdrag.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"
import { fingers, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/touchdrag-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

// A top-level file and a folder to drop it into, whatever the sandbox has.
const top = readdirSync(VAULT).filter((f) => f.endsWith(".md") && !f.startsWith("."))
const folder = readdirSync(VAULT, { withFileTypes: true }).find((d) => d.isDirectory() && !d.name.startsWith(".") && readdirSync(path.join(VAULT, d.name)).length)?.name
if (!top.length || !folder) { console.error("the vault needs a top-level note and a folder"); process.exit(2) }
const [moved] = top

const page = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
const { touch } = await fingers(page)
const mid = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + Math.min(b.width / 2, 80), y: b.y + b.height / 2 } }
/** A finger on `from`, held `ms`, then moved to `to` in steps (and held there `rest` ms), then lifted. */
const gesture = async (from, { ms = 0, to, steps = 10, rest = 0, before } = {}) => {
  await touch("touchStart", from.x, from.y)
  if (ms) await wait(ms)
  if (to) for (let i = 1; i <= steps; i++) { await touch("touchMove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await wait(16) }
  if (rest) await wait(rest)
  if (before) await before()
  await touch("touchEnd", from.x, from.y)
  await wait(400)
}
const row = (p) => `[data-phone-drawer] [data-tree-path="${p}"]`
const menus = () => page.locator("[role=menu]").count()
const drawerOut = () => page.evaluate(() => document.querySelector("[data-phone-drawer]")?.getAttribute("aria-hidden") === "false")
const openDrawer = async () => {
  if (await drawerOut()) return
  await page.click("[aria-label='Open sidebar']")
  await page.waitForSelector("[data-phone-drawer] [data-tree-path]")
  await wait(400)
}

await page.goto(B)
await page.waitForSelector("[aria-label='Open sidebar']", { timeout: 30000 })
await openDrawer()

// Held, lifted: the menu, nothing picked up.
await gesture(await mid(row(moved)), { ms: 700 })
check("held and lifted: the row's menu opens", await menus() === 1, await menus())
check("held and lifted: nothing is dragged", await page.locator("[data-drag-ghost]").count() === 0)
await page.keyboard.press("Escape"); await wait(200)

// Held, then moved onto a folder: dragged there.
let seen = {}
await gesture(await mid(row(moved)), {
  ms: 700, to: await mid(row(folder)), rest: 300,
  before: async () => { seen = { menus: await menus(), ghost: await page.locator("[data-drag-ghost]").count(), lit: await page.locator(`li:has(> div > ${row(folder).split(" ")[1]}).drop-target, li.drop-target:has([data-tree-path="${folder}"])`).count() } },
})
check("held and moved: the menu closes", seen.menus === 0, seen)
check("held and moved: the row's picture follows the finger", seen.ghost === 1, seen)
check("held and moved: the folder under the finger lights up", seen.lit > 0, seen)
check("let go on a folder: the file moves into it", await until(() => existsSync(path.join(VAULT, folder, moved)) && !existsSync(path.join(VAULT, moved))))
await page.screenshot({ path: path.join(OUT, "after-drop.png") })

// Moved without a hold: a scroll.
await openDrawer()
const a = await mid(row(folder))
await gesture(a, { to: { x: a.x, y: a.y - 120 }, steps: 6 })
check("moved without a hold: no menu, nothing picked up", await menus() === 0 && await page.locator("[data-drag-ghost]").count() === 0)

// The second panel's heading, held and moved above the first (the drawer afresh: at its top).
await page.reload()
await page.waitForSelector("[aria-label='Open sidebar']", { timeout: 30000 })
await openDrawer()
// (Where the order is kept, sidebars.json or the workspace's, is the sidebar's business: the drawer shows it.)
const order = () => page.evaluate(() => [...document.querySelectorAll("[data-phone-drawer] [data-panel]")].map((p) => p.dataset.panel))
const was = await order()
const handles = page.locator("[data-phone-drawer] [data-panel-handle]")
if (await handles.count() >= 2) {
  const h1 = await handles.nth(1).boundingBox()
  const first = await page.locator("[data-phone-drawer] [data-panel]").first().boundingBox()
  await gesture({ x: h1.x + 40, y: h1.y + h1.height / 2 }, { ms: 700, to: { x: h1.x + 40, y: first.y + 4 }, rest: 200 })
  await page.keyboard.press("Escape"); await wait(200)
  await openDrawer()
  check("a panel's heading held and moved: the panel moves", await until(async () => JSON.stringify(await order()) !== JSON.stringify(was)), await order())
} else console.log("skip panel move: fewer than two panels with headings")

// Swiped right in the left drawer: its actions; Delete trashes it.
await openDrawer()
// (A file row in sight: the drop above opened its folder, which may push the first ones' down.)
const inSight = () => page.evaluate(() => [...document.querySelectorAll("[data-phone-drawer] [data-tree-path]:not([data-tree-folder])")]
  .find((r) => { const b = r.getBoundingClientRect(); return b.top > 100 && b.bottom < innerHeight - 120 })?.dataset.treePath)
const swiped = await inSight()
const s = await mid(row(swiped))
await gesture({ x: 40, y: s.y }, { to: { x: 240, y: s.y }, steps: 8 })
const del = page.locator(`[data-phone-drawer] li:has([data-tree-path="${swiped}"]) button[aria-label="Delete"]`)
const w = (await del.boundingBox())?.width ?? 0
check("swiped right in the left drawer: Move and Delete show", w > 40 && await page.locator(`[data-phone-drawer] li:has([data-tree-path="${swiped}"]) button[aria-label="Move"]`).count() === 1, w)
check("swiped right: the drawer stays out", await drawerOut())
await page.screenshot({ path: path.join(OUT, "swiped.png") })
await del.tap()
check("Delete: the file goes to the trash", await until(() => !existsSync(path.join(VAULT, swiped))))

// Swiped left in the left drawer: the drawer's own swipe closes it.
await openDrawer()
const o = await mid(row(await inSight()))
await gesture({ x: 300, y: o.y }, { to: { x: 60, y: o.y }, steps: 8 })
check("swiped left in the left drawer: the drawer closes, no actions show", !(await drawerOut()))

// The Files tab: a row swipes left.
await page.goto(`${B}#view/files`)
const tabRow = page.locator("main [data-tree-path]:not([data-tree-folder])").first()
await tabRow.waitFor({ timeout: 10000 })
const t = await tabRow.boundingBox()
await gesture({ x: t.x + t.width - 30, y: t.y + t.height / 2 }, { to: { x: t.x + 60, y: t.y + t.height / 2 }, steps: 8 })
const tw = (await page.locator("main li button[aria-label=Delete]").first().boundingBox())?.width ?? 0
check("the Files tab: a row swiped left shows its actions", tw > 40, tw)
await page.screenshot({ path: path.join(OUT, "files-tab-swiped.png") })

await done()
