// Tab groups as they move and line up, frame by frame: folding and opening (the count and the line moving with the
// tabs, never a frame of what's gone), turned round mid-way, the line on whole pixels from the chip to the last tab in
// both densities and never broken while tabs move (dragged, closed, come in, in the bar and the Tabs panel), a closed
// tab going once (not back for a moment when its view asks first), and which tab shows after a close or a fold. Writes the vault's appearance and sidebars
// (put back): throwaway server only.
//   node web/qa/tabgroupmotion.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0, VAULT, OUT = "/tmp/tabgroupmotion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
mkdirSync(OUT, { recursive: true })
const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json")
const lookNow = () => JSON.parse(existsSync(look.p) ? readFileSync(look.p, "utf8") : "{}")
const appearance = (v) => writeFileSync(look.p, JSON.stringify({ ...lookNow(), ...v }) + "\n")

// [Start here] (A "Lighthouse": two tabs) (B, no name, folded: two) (C, no name: two) [blank]
const f = (p) => `file:${p}`
const seed = {
  root: { id: "g1", active: "a2", sets: [{ id: "sA", name: "Lighthouse", color: "blue" }, { id: "sB", name: "", color: "green", collapsed: true }, { id: "sC", name: "", color: "purple" }],
    tabs: [{ id: "p0", to: f("Start here.md") }, { id: "a1", to: f("Projects/Lighthouse.md"), set: "sA" }, { id: "a2", to: f("Projects/Garden planner.md"), set: "sA" },
      { id: "b1", to: f("ME.md"), set: "sB" }, { id: "b2", to: f("Notes/Lisbon trip.md"), set: "sB" }, { id: "c1", to: "view:search", set: "sC" }, { id: "c2", to: "view:graph", set: "sC" }, { id: "x", to: "new" }] },
  focus: "g1",
}
async function open(dpr = 2, start = seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: dpr })
  await ctx.addInitScript((s) => { if (!sessionStorage.getItem("qa.seeded")) { localStorage.setItem("vaultite.tabs", s); sessionStorage.setItem("qa.seeded", "1") } }, JSON.stringify(start))
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${encodeURIComponent("Projects/Garden planner.md")}`)
  await page.waitForSelector("[data-set-chip], [data-set-row]")
  await wait(1000)
  await page.mouse.move(640, 500)
  return { ctx, page }
}
/** Each frame drawn while `act` runs and `ms` after: what `probe` (a function's source, given the group's id) sees. */
async function frames(page, probe, id, act, ms = 700) {
  await page.evaluate(([src, id, ms]) => {
    const fn = new Function("id", `return (${src})(id)`), out = window.__frames = [], end = performance.now() + ms
    // (read once the frame's callbacks have all run, as it's painted: the group lines are drawn in one, core/tabline.ts)
    const tick = () => setTimeout(() => { out.push(fn(id)); if (performance.now() < end) requestAnimationFrame(tick) })
    requestAnimationFrame(tick)
  }, [probe.toString(), id, ms])
  await act()
  await wait(ms + 50)
  return page.evaluate(() => window.__frames)
}
/** A click on the group's chip or row from inside the page after `ms` (Playwright's own waits for it to stop moving). */
const clickIn = (page, sel, ms = 0) => page.evaluate(([sel, ms]) => new Promise((r) => setTimeout(() => { document.querySelector(sel).click(); r() }, ms)), [sel, ms])
const barProbe = (id) => {
  const chip = document.querySelector(`[data-set-chip="${id}"]`), count = chip?.querySelector("[data-set-count]"), line = document.querySelector(`[data-tab-row] [data-set-line="${id}"]`)
  return { chip: chip ? chip.getBoundingClientRect().width : 0, count: count ? +getComputedStyle(count).opacity : 0, line: line ? +getComputedStyle(line).opacity : 0,
    tabs: [...document.querySelectorAll(`[data-tab-bar] [data-in-set="${id}"]`)].map((e) => e.getBoundingClientRect().width),
    shown: document.querySelector("[data-tab-bar] [role=tab][aria-selected=true]")?.closest("[data-tab-id]")?.dataset.tabId }
}
const rising = (xs, d = 0.6) => xs.every((x, i) => !i || x >= xs[i - 1] - d)
const falling = (xs, d = 0.6) => xs.every((x, i) => !i || x <= xs[i - 1] + d)
/** Once its tabs are gone, none comes back (the stray frame a fold used to draw). */
const goneForGood = (fs) => {
  const from = fs.findIndex((x) => x.tabs.length), i = fs.findIndex((x, k) => k > from && !x.tabs.length)
  return from >= 0 && i > 0 && fs.slice(i).every((x) => !x.tabs.length)
}

/** A group's line and its tabs as drawn (the bar's along x, the panel's down y); `next`: where the tab after its first
 *  (c2) is drawn. */
const lineProbe = (id) => {
  const panel = !!document.querySelector("[data-tabs-pane]"), root = document.querySelector(panel ? "[data-tabs-pane]" : "[data-tab-row]")
  const span = (e) => { const b = e.getBoundingClientRect(); return panel ? [b.top, b.bottom] : [b.left, b.right] }
  const line = root.querySelector(`:scope > [data-set-line="${id}"]`), next = root.querySelector("[data-slide='c2']")
  return { line: line ? span(line) : null, tabs: [...root.querySelectorAll(`[data-line-of="${id}"]`)].map(span), next: next ? span(next)[0] : null }
}
/** Each tab within its line's reach: along the bar under it (a spring going a pixel past it), down the panel by it
 *  (ending rounded a little above the last's bottom). */
const besideAll = (axis) => (x) => !!x.line && x.tabs.every(([a, b]) => a >= x.line[0] - 1 && b <= x.line[1] + (axis === "y" ? 12 : 2))

try {
  appearance({ tabBar: true, theme: "light", density: "compact" })
  writeFileSync(sidebars.p, JSON.stringify({ left: ["files:files"], right: [], collapsed: [] }) + "\n")

  // ---------- the line: on whole pixels, from the chip's left to the last tab's right, no seams ----------
  for (const dpr of [1, 2]) {
    const { ctx, page } = await open(dpr)
    for (const density of ["compact", "comfortable"]) {
      await page.evaluate((d) => { document.documentElement.dataset.density = d }, density); await wait(300)
      const g = await page.evaluate(() => {
        const r = (e) => e.getBoundingClientRect()
        return [...document.querySelectorAll("[data-set-chip][aria-expanded=true]")].map((chip) => {
          const id = chip.dataset.setChip, tabs = [...document.querySelectorAll(`[data-tab-bar] [data-in-set="${id}"]`)]
          const line = r(document.querySelector(`[data-tab-row] [data-set-line="${id}"]`))
          return { id, label: r(chip.querySelector("[data-set-label]")).left, last: r(tabs.at(-1)).right, bottom: r(tabs[0]).bottom, line: [line.left, line.right, line.top, line.height] }
        })
      })
      const bad = g.filter((x) => {
        const [left, right, top, height] = x.line
        return height !== 2 || !Number.isInteger(top * dpr) || top - x.bottom < 1 || top - x.bottom > 2 || Math.abs(left - x.label) > 0.5 || Math.abs(right - x.last) > 0.5
      })
      check(`the line, ${density} at ${dpr}x: 2px on a whole pixel under the tabs, from the chip's left to the last tab's right`, g.length === 2 && !bad.length, bad.length ? bad : g)
      await page.screenshot({ path: `${OUT}bar-${density}-${dpr}x.png`, clip: { x: 200, y: 0, width: 1000, height: 48 } })
    }
    await page.evaluate(() => { document.documentElement.dataset.density = "compact" })
    await ctx.close()
  }

  // ---------- folding and opening in the bar ----------
  {
    const { ctx, page } = await open()
    const full = (await page.evaluate(barProbe, "sC")).tabs
    const fold = await frames(page, barProbe, "sC", () => clickIn(page, "[data-set-chip='sC']"))
    const moving = fold.filter((x) => x.tabs.length && x.tabs.some((w) => w > 1 && w < full[0] - 1))
    check("folding: its tabs shrink into the chip, the count opening out and the line going as they do, not after",
      moving.length >= 3 && moving.some((x) => x.count > 0.2 && x.count < 0.95) && moving.some((x) => x.line > 0.05 && x.line < 0.95), moving.map((x) => [x.tabs.map(Math.round), x.count.toFixed(2), x.line.toFixed(2)]))
    check("  each frame further: the chip widens, the tabs narrow, the count shows more, the line less", rising(fold.map((x) => x.chip)) && falling(fold.map((x) => Math.max(0, ...x.tabs)))
      && rising(fold.map((x) => x.count), 0.01) && falling(fold.map((x) => x.line), 0.01), fold.map((x) => [Math.round(x.chip), x.tabs.map(Math.round)]))
    check("  no frame shows its tabs or line again once they've gone", goneForGood(fold) && fold.at(-1).count === 1 && fold.at(-1).line === 0, fold.slice(-4))
    const opening = await frames(page, barProbe, "sC", () => clickIn(page, "[data-set-chip='sC']"))
    check("opening: they grow back out of it, the count closing up and the line coming as they do",
      opening.some((x) => x.tabs.length && x.tabs.every((w) => w > 1 && w < full[0] - 1) && x.count > 0.05 && x.count < 0.8) && falling(opening.map((x) => x.chip)) && falling(opening.map((x) => x.count), 0.01),
      opening.map((x) => [Math.round(x.chip), x.tabs.map(Math.round), x.count.toFixed(2)]))
    const end = opening.at(-1).tabs
    check("  each tab ends where it's laid out, with no jump at the end", end.length === full.length && end.every((w, i) => Math.abs(w - full[i]) < 1)
      && opening.filter((x) => x.tabs.length === full.length).every((x) => x.tabs.every((w, i) => w <= full[i] + 1.5)), opening.map((x) => x.tabs.map(Math.round)))
    // Turned round mid-way, either way: from where it had got to, back.
    const back = await frames(page, barProbe, "sC", async () => { await clickIn(page, "[data-set-chip='sC']"); await clickIn(page, "[data-set-chip='sC']", 90) })
    const low = Math.min(...back.filter((x) => x.tabs.length).map((x) => Math.max(...x.tabs)))
    check("a click mid-fold turns it round from where it was: the tabs never vanish, and end as they were", low > 1 && low < full[0] - 4 && back.every((x) => x.tabs.length === full.length)
      && back.at(-1).tabs.every((w, i) => Math.abs(w - full[i]) < 1) && back.at(-1).count === 0 && back.at(-1).line === 1, back.map((x) => x.tabs.map(Math.round)))
    await clickIn(page, "[data-set-chip='sC']"); await wait(500)
    const again = await frames(page, barProbe, "sC", async () => { await clickIn(page, "[data-set-chip='sC']"); await clickIn(page, "[data-set-chip='sC']", 90) })
    check("a click mid-opening folds it from where it was", again.some((x) => x.tabs.length && x.tabs.every((w) => w > 4)) && goneForGood(again) && again.at(-1).count === 1, again.map((x) => x.tabs.map(Math.round)))
    await clickIn(page, "[data-set-chip='sC']"); await wait(500)
    // The group on screen turned round mid-fold: its tab shows again.
    const sway = await frames(page, barProbe, "sA", async () => { await clickIn(page, "[data-set-chip='sA']"); await clickIn(page, "[data-set-chip='sA']", 90) })
    check("a click mid-fold of the group on screen turns it round to its own tab again", sway.some((x) => x.shown === "c1") && sway.at(-1).shown === "a2", sway.map((x) => x.shown))
    await wait(300)
    // Folding the group on screen: the page changes at the click, to the nearest tab not folded away (past folded B).
    const handing = await frames(page, barProbe, "sA", () => clickIn(page, "[data-set-chip='sA']"))
    const first = handing.findIndex((x) => x.shown !== "a2")
    check("folding the group on screen: another tab shows at the click, not once they've gone, past a folded group", first >= 0 && handing[first].shown === "c1" && handing[first].tabs.length === 2
      && handing[first].tabs.every((w) => w > 20), handing.map((x) => [x.shown, x.tabs.map(Math.round)]))
    await page.screenshot({ path: `${OUT}bar-folded.png`, clip: { x: 200, y: 0, width: 1000, height: 48 } })
    await ctx.close()
  }

  // ---------- turned round mid-fold with no other tab to hand over to: the blank tab made meanwhile goes ----------
  {
    const alone = { root: { id: "g1", active: "a2", sets: [{ id: "sA", name: "Lighthouse", color: "blue" }], tabs: seed.root.tabs.filter((t) => t.set === "sA") }, focus: "g1" }
    const { ctx, page } = await open(2, alone)
    const sway = await frames(page, barProbe, "sA", async () => { await clickIn(page, "[data-set-chip='sA']"); await clickIn(page, "[data-set-chip='sA']", 90) })
    const ids = await page.evaluate(() => [...document.querySelectorAll("[data-tab-bar] [data-tab-id]")].map((e) => e.dataset.tabId))
    check("the only group turned round mid-fold: a blank tab meanwhile, then its own tab again and no blank tab left", sway.some((x) => x.shown && !x.shown.startsWith("a"))
      && sway.at(-1).shown === "a2" && ids.join() === "a1,a2", { shown: sway.map((x) => x.shown), ids })
    await ctx.close()
  }

  // ---------- the chip by pointer and keyboard; tabs sliding as they're regrouped; ungrouping fading ----------
  {
    const { ctx, page } = await open()
    const halo = () => page.$eval("[data-set-chip='sA'] > [data-set-label]", (e) => getComputedStyle(e).boxShadow)
    const off = await halo()
    await page.hover("[data-set-chip='sA']"); await wait(350)
    check("a chip under the pointer shows a halo of its colour", off === "none" && (await halo()) !== "none", [off, await halo()])
    await page.mouse.move(640, 500)
    await page.locator("[data-tab-id='a2'] [role=tab]").focus()
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight")
    const on = await page.evaluate(() => { const a = document.activeElement, l = a?.querySelector("[data-set-label]"); return { chip: a?.dataset.setChip, ring: l && getComputedStyle(l).outlineStyle } })
    check("the arrows reach a chip as they do the tabs, its ring showing", on.chip === "sC" && on.ring === "solid", on)
    const expanded = () => page.$eval("[data-set-chip='sC']", (e) => e.getAttribute("aria-expanded"))
    await page.keyboard.press("Enter"); await wait(500)
    const folded = await expanded()
    await page.keyboard.press(" "); await wait(500)
    check("Enter folds it, Space opens it, the keyboard staying on it", folded === "false" && (await expanded()) === "true" && await page.evaluate(() => document.activeElement?.dataset.setChip === "sC"), [folded, await expanded()])
    await page.keyboard.press("Shift+F10"); await wait(300)
    check("⇧F10 opens its editor", (await page.locator("[role=menu] [data-menu-field] input").count()) === 1)
    await page.keyboard.press("Escape"); await wait(200)
    // Regrouped (the blank tab added to Lighthouse by its menu): what's between slides over rather than jumping.
    const xs = (id) => page.evaluate((id) => { const out = window.__xs = [], end = performance.now() + 600, e = () => document.querySelector(`[data-tab-id="${id}"]`)
      const tick = () => { out.push(e()?.getBoundingClientRect().left ?? null); if (performance.now() < end) requestAnimationFrame(tick) }; requestAnimationFrame(tick) }, id)
    const left = () => page.$eval("[data-tab-id='c1']", (e) => e.getBoundingClientRect().left)
    const x0 = await left()
    await page.click("[data-tab-id='x']", { button: "right" }); await wait(200)
    await page.locator("[role=menu]").last().getByRole("menuitem", { name: "Add to group", exact: true }).hover(); await wait(200)
    await xs("c1")
    await page.locator("[role=menu]").last().getByRole("menuitem", { name: "Lighthouse", exact: true }).click(); await wait(700)
    const path1 = (await page.evaluate(() => window.__xs)).filter((x) => x !== null), x1 = await left()
    check("a tab added to a group: the tabs it passes slide over to make room, no jump", x1 > x0 + 20 && path1.some((x) => x > x0 + 2 && x < x1 - 2), [x0, x1, path1.map(Math.round)])
    // Ungrouped: its chip shrinks away and its line fades, not cut at once.
    await xs("c1")
    await page.evaluate(() => { const out = window.__ug = [], end = performance.now() + 1000
      const tick = () => { const ps = [...document.querySelectorAll("[data-tab-row] [data-set-line='sC']")], chip = [...document.querySelectorAll("[data-tab-bar] [data-set-label]")].find((l) => l.style.background.includes("purple"))
        out.push({ line: ps.length ? Math.max(...ps.map((p) => +getComputedStyle(p).opacity)) : 0, chip: chip ? chip.parentElement.getBoundingClientRect().width : 0 })
        if (performance.now() < end) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    await page.click("[data-set-chip='sC']", { button: "right" }); await wait(200)
    await page.locator("[role=menu]").last().getByRole("menuitem", { name: "Ungroup", exact: true }).click(); await wait(900)
    const ug = await page.evaluate(() => window.__ug)
    check("ungrouped: its chip shrinks away and its line fades out", ug.some((x) => x.line > 0.1 && x.line < 0.9) && ug.some((x) => x.chip > 1 && x.chip < 13) && ug.at(-1).line === 0 && ug.at(-1).chip === 0, ug.map((x) => [x.line.toFixed(2), Math.round(x.chip)]))
    await ctx.close()
  }

  // ---------- the line in the bar while tabs move: dragged within the group, a view's tab closed ----------
  {
    const { ctx, page } = await open()
    const a = await page.locator("[data-tab-id='a1']").boundingBox(), b = await page.locator("[data-tab-id='a2']").boundingBox()
    await page.mouse.move(a.x + 20, a.y + a.height / 2); await page.mouse.down()
    const fs = await frames(page, lineProbe, "sA", async () => { await page.mouse.move(a.x + 28, a.y + a.height / 2, { steps: 3 }); await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2, { steps: 12 }) }, 600)
    await page.mouse.up(); await wait(500)
    const moved = fs.some((x) => x.tabs.length === 2 && Math.abs(x.tabs[0][0] - fs[0].tabs[0][0]) > 2)
    check("the bar: dragged within its group, the line runs under each of its tabs in every frame as they slide", moved && fs.every(besideAll("x")), fs.filter((x) => !besideAll("x")(x)).slice(0, 4))
    const c1 = page.locator("[data-tab-id='c1']")
    await c1.hover(); await wait(200)
    const closing = await frames(page, lineProbe, "sC", () => c1.locator("[data-tab-close]").click(), 700)
    const xs = closing.map((x) => x.next)
    check("the bar: a view's tab closed shrinks away once, the tab after it moving over and never jumping back, the line under them", xs[0] - xs.at(-1) > 20 && falling(xs, 0.5)
      && closing.every((x) => !x.tabs.length || besideAll("x")(x)), xs.map(Math.round))
    await ctx.close()
  }

  // ---------- which tab shows after a close (Chrome's) ----------
  {
    const { ctx, page } = await open()
    const shown = () => page.$eval("[data-tab-bar] [role=tab][aria-selected=true]", (e) => e.closest("[data-tab-id]").dataset.tabId)
    const folded = () => page.$$eval("[data-set-chip]", (els) => els.filter((e) => e.getAttribute("aria-expanded") === "false").map((e) => e.dataset.setChip).join())
    const close = async (id) => { const t = page.locator(`[data-tab-id="${id}"]`); await t.hover(); await t.locator("[data-tab-close]").click(); await wait(400); await page.mouse.move(640, 500); await wait(300) }
    await close("a2")
    check("closing a group's tab shows another of the group (before it, as none is after)", (await shown()) === "a1" && (await folded()) === "sB", [await shown(), await folded()])
    await close("a1")
    check("closing a group's last tab shows the nearest tab outside it not folded away: never into a folded group, which stays folded", (await shown()) === "c1" && (await folded()) === "sB", [await shown(), await folded()])
    await ctx.close()
  }

  // ---------- the Tabs panel ----------
  appearance({ tabBar: false, theme: "light" })
  writeFileSync(sidebars.p, JSON.stringify({ left: ["tabs:tabs", "files:files"], right: [], collapsed: [] }) + "\n")
  await wait(800)
  {
    const { ctx, page } = await open()
    const geo = await page.evaluate(() => [...document.querySelectorAll("[data-set-row]")].map((row) => {
      const r = (e) => e.getBoundingClientRect(), label = r(row.querySelector("[data-set-label]")), box = r(row), line = row.closest("[data-tabs-pane]").querySelector(`:scope > [data-set-line="${row.dataset.setRow}"]`)
      return { id: row.dataset.setRow, open: row.getAttribute("aria-expanded") === "true", mid: [label.top + label.height / 2, box.top + box.height / 2], rail: line && [r(line).left, r(line).top], label: [label.left, label.right, label.top, label.bottom] }
    }))
    check("the panel: each group's chip sits in the middle of its row (a square without a name too), its line coming out from under it (a folded one's gone)",
      geo.length === 3 && geo.every((x) => Math.abs(x.mid[0] - x.mid[1]) < 0.6 && (x.open ? x.rail && x.rail[0] > x.label[0] && x.rail[0] < x.label[1] && x.rail[1] > x.label[2] && x.rail[1] < x.label[3] : !x.rail)), geo)
    // Dragged within its group: the tabs slide past each other, and the line stays one, by each of them wherever it's drawn.
    {
      const a = await page.locator("[data-tabs-pane] [data-slide='a1']").boundingBox(), b = await page.locator("[data-tabs-pane] [data-slide='a2']").boundingBox()
      await page.mouse.move(a.x + 60, a.y + a.height / 2); await page.mouse.down()
      const fs = await frames(page, lineProbe, "sA", async () => { await page.mouse.move(a.x + 60, a.y + a.height / 2 + 8, { steps: 3 }); await page.mouse.move(a.x + 60, b.y + b.height * 0.7, { steps: 10 }) }, 600)
      await page.mouse.up(); await wait(500)
      const moved = fs.some((x) => x.tabs.length === 2 && Math.abs(x.tabs[0][0] - fs[0].tabs[0][0]) > 2)
      check("the panel: dragged within its group, the line runs by each of its tabs in every frame as they slide", moved && fs.every(besideAll("y")), fs.filter((x) => !besideAll("y")(x)).slice(0, 4))
    }
    const panelProbe = (id) => {
      const row = document.querySelector(`[data-set-row="${id}"]`), count = row?.querySelector("[data-set-count]"), rail = row?.closest("[data-tabs-pane]").querySelector(`:scope > [data-set-line="${id}"]`)
      return { chip: row ? row.querySelector("[data-set-label]").getBoundingClientRect().width : 0, count: count ? +getComputedStyle(count).opacity : 0, line: rail ? +getComputedStyle(rail).opacity : 0,
        tabs: [...document.querySelectorAll(`[data-tabs-panel] [data-in-set="${id}"]`)].map((e) => e.getBoundingClientRect().height) }
    }
    const fold = await frames(page, panelProbe, "sC", () => clickIn(page, "[data-set-row='sC']"))
    check("the panel: folding, its rows shrink up into the row of its chip, which grows its count as they do, the line going", fold.some((x) => x.tabs.length && x.tabs.some((h) => h > 2 && h < 26) && x.count > 0.1 && x.count < 0.95)
      && goneForGood(fold) && rising(fold.map((x) => x.chip)) && fold.at(-1).count === 1 && fold.at(-1).line === 0, fold.map((x) => [x.tabs.map(Math.round), x.count.toFixed(2), Math.round(x.chip)]))
    const opening = await frames(page, panelProbe, "sC", () => clickIn(page, "[data-set-row='sC']"))
    check("the panel: opening, they grow back down, the count closing up as they do", opening.some((x) => x.tabs.length && x.tabs.every((h) => h > 1 && h < 26) && x.count > 0.05 && x.count < 0.9)
      && opening.at(-1).count === 0 && opening.at(-1).line === 1 && opening.at(-1).tabs.every((h) => Math.abs(h - 28) < 1), opening.map((x) => [x.tabs.map(Math.round), x.count.toFixed(2)]))
    // A view's tab closed (it asks its view first, a moment even when it says yes): it shrinks away once, the line's
    // end rising with it, never back for a frame.
    {
      await page.hover("[data-tabs-pane] [data-slide='c1']"); await wait(200)
      const fs = await frames(page, lineProbe, "sC", () => page.locator("[data-tabs-pane] [data-slide='c1'] button[aria-label^='Close']").click(), 700)
      const ys = fs.map((x) => x.next)
      check("the panel: a view's tab closed shrinks away once, the tab under it rising and never jumping back", ys[0] - ys.at(-1) > 20 && falling(ys, 0.5) && fs.every((x) => !x.tabs.length || besideAll("y")(x)), ys.map(Math.round))
    }
    await page.screenshot({ path: `${OUT}panel-light.png`, clip: { x: 0, y: 0, width: 300, height: 380 } })
    appearance({ theme: "dark" }); await until(() => page.evaluate(() => document.documentElement.classList.contains("dark")), 5000); await wait(400)
    await page.screenshot({ path: `${OUT}panel-dark.png`, clip: { x: 0, y: 0, width: 300, height: 380 } })
    await ctx.close()
  }
  // A phone's drawer, its lists zoomed (data-size-up): a group opened, its tabs grow straight to their size, never past it
  // to snap back at the end (they used to grow to their on-screen size times the zoom: a bounce).
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    await ctx.addInitScript((s) => { if (!sessionStorage.getItem("qa.seeded")) { localStorage.setItem("vaultite.tabs", s); sessionStorage.setItem("qa.seeded", "1") } }, JSON.stringify(seed))
    const page = watch(await ctx.newPage())
    await page.goto(B); await page.waitForSelector("[data-phone-bar]"); await wait(1200)
    await page.click("[aria-label='Open sidebar']"); await page.waitForSelector("[data-phone-drawer] [data-set-row='sB']"); await wait(800)
    const probe = (id) => [...document.querySelectorAll(`[data-phone-drawer] [data-in-set="${id}"]`)].map((e) => e.getBoundingClientRect().height)
    const fs = await frames(page, probe, "sB", () => clickIn(page, "[data-phone-drawer] [data-set-row='sB']"), 600)
    const end = fs.at(-1), hs = fs.filter((x) => x.length === 2).map((x) => x[0])
    check("a phone's drawer: a group opened, its tabs grow straight to their size, never past it", end.length === 2 && end[0] > 30 && hs.length > 3 && rising(hs, 0.3) && hs.every((h) => h <= end[0] + 0.5), hs.map(Math.round))
    await ctx.close()
  }
} finally {
  for (const x of [sidebars, look]) if (x.was === null) rmSync(x.p, { force: true }); else writeFileSync(x.p, x.was)
}
await done()
