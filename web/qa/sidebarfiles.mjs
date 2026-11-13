// Files dragged into a sidebar dock as panels (components/panelDrop.ts, components/Sidebar.tsx, components/panelMotion.ts),
// then move, open on a pane, hide. WRITES Qa dock/: throwaway server only.   node web/qa/sidebarfiles.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/sidebarfiles-shots/"], browser, check, watch, done } = await qa(import.meta.url, { motion: !!process.env.QA_MOTION })
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)

const DIR = "Qa dock", ONE = `${DIR}/One.md`, TWO = `${DIR}/Two.md`, THREE = `${DIR}/Three.md`, FOUR = `${DIR}/Four.md`
for (const [p, text] of [[ONE, "# One\n\nThe first note, opened in a tab.\n"], [TWO, "# Two\n\nA note docked from the file tree.\n\n- Plain text, drawn as the note.\n- [ ] A task in the sidebar\n"],
  [THREE, "# Three\n\nA pinned note.\n"], [FOUR, "# Four\n\nA note opened lately.\n"]]) await api("PUT", "file", { path: p, text })
for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
const START = { left: ["search:search", "pages:pages", "recent:recent", "files:files"], right: ["outline:outline"], collapsed: [], heights: {} }
await api("PUT", "config/sidebars", START)
const pagesAtStart = await api("GET", "config/pages")
await api("PUT", "config/pages", { ...pagesAtStart, pinned: [THREE] })
const filesAtStart = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesAtStart, fileSort: "name", autoReveal: false })
const setup = async () => { const w = (await api("GET", "workspaces")).workspaces?.[0]?.sidebars; return w ?? await api("GET", "config/sidebars") }
const keyOf = (p) => `pages:file/${p}`

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } })), ui = app(page)
const side = (s) => `aside[data-side=${s}] [data-sidebar-body]`
const shown = (s) => page.$$eval(`${side(s)} > [data-panel]`, (els) => els.map((e) => e.dataset.panel))
const box = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); return l.boundingBox() }
const between = async (s, before) => { const b = await box(`${side(s)} > [data-panel='${before}'] [data-panel-handle]`); return [b.x + b.width / 2, b.y + b.height / 2] }
const seen = () => page.evaluate(() => ({
  gap: [...document.querySelectorAll("[data-sidebar-body] > [data-slide=incoming]")].length,
  hint: document.querySelector("[data-drag-ghost]")?.textContent ?? "",
}))
async function drag(from, [x, y], { during, cancel = false, shot } = {}) {
  await ui.idle()
  const b = await box(from)
  const fx = b.x + Math.min(30, b.width / 2), fy = b.y + b.height / 2
  await page.mouse.move(fx, fy); await page.mouse.down()
  await page.mouse.move(fx + 10, fy + 6, { steps: 3 }); await page.mouse.move(x, y, { steps: 14 }); await ui.idle()
  const look = during ? await during() : await seen()
  if (shot) await page.screenshot({ path: `${OUT}${shot}` })
  if (cancel) await page.keyboard.press("Escape")
  await page.mouse.up(); await ui.idle()
  return look
}
const treeRow = (p) => `aside [role=tree] [data-tree-path="${p}"]`

try {
  await page.goto(`${B}#file/${encodeURIComponent(ONE)}`)
  await page.waitForSelector(`${side("left")} > [data-panel='files:files']`); await ui.idle()
  check("set up: four panels on the left, Outline on the right", (await shown("left")).join() === START.left.join() && (await shown("right")).join() === "outline:outline", [await shown("left"), await shown("right")])

  if (!await page.locator(treeRow(TWO)).count()) { await page.locator(`aside [role=tree] [data-tree-path="${DIR}"]`).first().click(); await page.waitForSelector(treeRow(TWO)) }

  const gapAt = await between("left", "pages:pages")
  const during = await drag(treeRow(TWO), gapAt, { shot: "sidebarfiles-dropping.png" })
  check("a file from the tree over the sidebar: the panels make way for it", during.gap === 1, during)
  check("its picture says what a drop does", /Show in the sidebar/.test(during.hint), during)
  const afterTree = (await setup()).left
  check("let go: the file is a panel there, between Search and Pinned", afterTree.join() === ["search:search", keyOf(TWO), "pages:pages", "recent:recent", "files:files"].join(), afterTree)
  check("and it draws the note", await until(async () => /A note docked from the file tree/.test(await page.locator(`[data-file-panel="${TWO}"]`).innerText().catch(() => ""))))
  await page.mouse.move(700, 500); await ui.idle()
  await page.screenshot({ path: `${OUT}sidebarfiles-docked.png` })

  const three = await box(treeRow(THREE))
  const nudge = await drag(treeRow(THREE), [three.x + 40, three.y + three.height / 2 + 14])
  check("a tree row nudged in the tree isn't docked", nudge.gap === 0 && !(await setup()).left.includes(keyOf(THREE)), nudge)
  const body = await box(`[data-file-panel="${TWO}"]`)
  const onText = await drag(treeRow(THREE), [body.x + body.width / 2, body.y + body.height / 2], { cancel: true })
  check("over a panel's body (a note's text) it isn't docked: only between panels", onText.gap === 0 && !/sidebar/.test(onText.hint), onText)

  await page.goto(`${B}#file/${encodeURIComponent(ONE)}`); await ui.idle()
  const chip = `[data-tab-strip] [data-tab-id]:has-text("One")`
  await page.waitForSelector(chip)
  const tabsBefore = await page.locator("[data-tab-strip] [data-tab-id]").count()
  const tabDrag = await drag(chip, await between("right", "outline:outline"))
  check("a tab over the other sidebar: a gap, and it says it moves there", tabDrag.gap === 1 && /To the right sidebar/.test(tabDrag.hint), tabDrag)
  check("let go: the tab's file is a panel above Outline", (await setup()).right.join() === [keyOf(ONE), "outline:outline"].join(), (await setup()).right)
  check("and the tab moved: it closed", await until(async () => await page.locator(chip).count() === 0) && await page.locator("[data-tab-strip] [data-tab-id]").count() <= tabsBefore, await page.locator("[data-tab-strip] [data-tab-id]").count())

  const pin = `aside nav[aria-label=Pages] [data-pin="${THREE}"]`
  const out = await drag(pin, await between("left", "files:files"), { cancel: true })
  check("a pinned page dragged out in its own sidebar: Unpin, no gap", /Unpin/.test(out.hint) && out.gap === 0, out)
  await drag(pin, await between("right", "outline:outline"))
  check("into the other sidebar: a panel there", (await setup()).right.join() === [keyOf(ONE), keyOf(THREE), "outline:outline"].join(), (await setup()).right)
  check("and still pinned", (await api("GET", "config/pages")).pinned.includes(THREE))

  await page.locator(treeRow(FOUR)).first().click()
  const recent = `aside [data-panel='recent:recent'] [data-keyrow]:has-text("Four")`
  if (await until(async () => await page.locator(recent).count() > 0, 6000)) {
    const o = await box(`${side("right")} > [data-panel='outline:outline']`)
    await drag(recent, [o.x + o.width / 2, o.y + o.height + 30])
    check("a recent file dragged in: a panel at the right sidebar's end", (await setup()).right.at(-1) === keyOf(FOUR), (await setup()).right)
  } else check("Recent files lists the note opened lately", false, await page.locator("aside [data-panel='recent:recent']").innerText().catch(() => ""))

  const head = (k, s = "left") => `${side(s)} > [data-panel='${k}'] [data-panel-handle]`
  await drag(head(keyOf(TWO)), await between("left", "files:files"))
  check("the file panel reorders by its heading", (await setup()).left.join() === ["search:search", "pages:pages", "recent:recent", keyOf(TWO), "files:files"].join(), (await setup()).left)
  await drag(head(keyOf(TWO)), await between("right", "outline:outline"))
  check("and moves to the other sidebar", (await setup()).right.includes(keyOf(TWO)) && !(await setup()).left.includes(keyOf(TWO)), await setup())
  const pane = await box("[data-pane-area] [data-pane-body]")
  await drag(head(keyOf(TWO), "right"), [pane.x + pane.width / 2, pane.y + pane.height / 2])
  check("dropped on a pane, it opens there as a tab (as any panel does)", await until(async () => await page.locator(`[data-tab-strip] [data-tab-id]:has-text("Two")`).count() === 1))
  await page.locator(head(keyOf(TWO), "right")).first().click({ button: "right" })
  const hide = page.getByRole("menuitem", { name: "Hide Two" })
  check("its menu hides it", await until(async () => await hide.count() > 0, 3000))
  await hide.click(); await ui.idle()
  check("hidden: out of the sidebar", !(await setup()).right.includes(keyOf(TWO)), (await setup()).right)

  const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
  await phone.goto(B)
  await phone.waitForSelector("[aria-label='Open sidebar']", { timeout: 30000 })
  await api("POST", "ops/panel.left", { panel: TWO })
  await phone.click("[aria-label='Open sidebar']")
  check("a phone's drawer draws the file panel", await until(async () => await phone.locator(`[data-phone-drawer] [data-file-panel="${TWO}"]`).count() > 0, 8000))
  await phone.close()
} finally {
  await api("PUT", "config/sidebars", START)
  await api("PUT", "config/pages", pagesAtStart)
  await api("PUT", "config/files", filesAtStart)
}
done()
