// The right sidebar: no room taken until a panel goes there, only its toggle in the corner. Dragging a panel's heading
// outlines the toggle; dropped on it, the panel moves to the end of the right sidebar (`right` in sidebars.json) and
// leaves the left one. What's fixed to
// the window's right edge (the status bar) keeps clear of it. Its toggle folds it to an icon rail whose flyouts open
// to its left; the panel's menu moves it back (Move to left sidebar), and with nothing left the right sidebar goes.
// Reveal current file in file tree opens the folded right sidebar on the file. The search field (a panel that's one
// button) drags like the others, and still searches on a click. Writes sidebars.json and empties the workspaces:
// throwaway server only.
//   node web/qa/rightsidebar.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/rightsidebar-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (p, init) => fetch(new URL(`/api/${p}`, B), init).then((r) => r.json())
// The sidebars the app shows: the current workspace's (1) when it has its own, else sidebars.json's.
const conf = async () => (await api("workspaces")).workspaces?.[0]?.sidebars ?? api("config/sidebars")
const reset = () => fetch(new URL("/api/config/sidebars", B), { method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] }) })

// No workspaces, the default panels: this device's setup is sidebars.json's.
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
await reset()

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
const right = () => page.$("aside[data-side=right]")
// A sidebar's panels, top to bottom.
const panelsIn = (side) => page.$$eval(`aside[data-side=${side}] [data-panel]`, (els) => els.map((e) => e.dataset.panel))
async function dragTo(handle, x, y, shot) {
  const b = await (await page.$(handle)).boundingBox()
  await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + 70, b.y + b.height / 2 - 10, { steps: 5 }); await page.mouse.move(x, y, { steps: 12 }); await wait(250)
  if (shot) await page.screenshot({ path: `${OUT}${shot}.png` })
  const during = await page.$eval("[data-sidebar-toggle=right]", (e) => e.className.includes("ring-primary"))
  await page.mouse.up(); await wait(800)
  return during
}

try {
  const file = (await api("state")).files.files.find((f) => f.path.endsWith(".md") && !f.path.startsWith("Dashboards/"))?.path
  await page.goto(`${B}#file/${encodeURIComponent(file)}`); await wait(2000)
  check("no right sidebar to start with", !(await right()))

  check("...only its toggle", !!(await page.$("[data-sidebar-toggle=right]")))
  const t = await (await page.$("[data-sidebar-toggle=right]")).boundingBox()
  const during = await dragTo("aside[data-side=left] [data-panel='files:files'] [data-panel-handle]", t.x + t.width / 2, t.y + t.height / 2, "dragging")
  check("dragging a panel outlines the right sidebar's toggle", during)
  check("dropped there: Files is in the right sidebar", !!(await until(async () => JSON.stringify(await panelsIn("right")) === '["files:files"]')), await panelsIn("right"))
  check("...and not in the left one", !(await panelsIn("left")).includes("files:files"), await panelsIn("left"))
  check("...saved as the right sidebar's", !!(await until(async () => JSON.stringify((await conf()).right) === '["files:files"]')), (await conf()).right)
  const aside = await (await right()).boundingBox()
  const status = await (await page.$("[role=status]"))?.boundingBox()
  check("the status bar keeps clear of it", !!status && status.x + status.width <= aside.x + 1, [status, aside])
  const panes = await page.$eval("section[data-group]", (e) => e.closest(".fixed").getBoundingClientRect().right)
  check("the panes end where it starts", Math.abs(panes - aside.x) < 2, [panes, aside.x])
  await page.screenshot({ path: `${OUT}open.png` })

  // Fold it to its rail: a flyout opens on the rail's left.
  await page.click("[data-sidebar-toggle=right]"); await wait(500)
  const rail = await (await right()).boundingBox()
  check("folded: an icon rail", rail.width < 60, rail.width)
  await page.click("aside[data-side=right] [data-flyout-icon='files:files']"); await wait(500)
  const fly = await (await page.$("[data-flyout='files:files']"))?.boundingBox()
  check("its flyout opens to the rail's left", !!fly && fly.x + fly.width <= rail.x, [fly, rail])
  await page.screenshot({ path: `${OUT}rail.png` })
  await page.keyboard.press("Escape"); await wait(200)
  // Reveal current file in file tree while the tree is folded away in the rail: the right sidebar opens on the file.
  await page.evaluate(() => { location.hash = "#file/ME.md" }); await wait(900)
  await page.keyboard.press("ControlOrMeta+p"); await wait(250); await page.keyboard.type("Reveal current file in file tree"); await page.keyboard.press("Enter")
  check("Reveal current file in file tree from the rail: the right sidebar opens on it", !!(await until(() => page.evaluate(() =>
    !!document.querySelector('aside[data-side=right] [data-tree-path="ME.md"]')?.offsetParent && document.querySelector("aside[data-side=right]").getBoundingClientRect().width > 100))))

  // The menu moves it back; with nothing left, the right sidebar goes.
  await page.click("aside[data-side=right] [data-panel='files:files'] [data-panel-handle]", { button: "right" })
  await page.getByRole("menuitem", { name: "Move to left sidebar" }).click()
  check("Move to left sidebar: back on the left", !!(await until(async () => (await panelsIn("left")).includes("files:files"))), await panelsIn("left"))
  check("...and the right sidebar is gone", !!(await until(async () => !(await right()))))

  // The search field drags like the others (onto the right sidebar), and a click still searches.
  const t2 = await (await page.$("[data-sidebar-toggle=right]")).boundingBox()
  await dragTo("aside[data-side=left] [data-panel='search:search'] [data-panel-handle]", t2.x + t2.width / 2, t2.y + t2.height / 2)
  check("the search field drags too", !!(await until(async () => (await panelsIn("right")).includes("search:search"))), await panelsIn("right"))
  await page.click("aside[data-side=right] [aria-label=Search]"); await wait(400)
  check("...and a click on it still searches", !!(await page.$("[role=dialog] input, [aria-label='Quick switcher'] input, input[placeholder*='Find']")))
  await page.keyboard.press("Escape"); await wait(200)
  await dragTo("aside[data-side=right] [data-panel='search:search'] [data-panel-handle]", 100, 45)
  check("dragged back to the left's top", !!(await until(async () => (await panelsIn("left"))[0] === "search:search" && !(await right()))), await panelsIn("left"))
  noErrors()
} finally {
  await reset()
  await browser.close()
}
await done()
