// The desktop status bar never reaches the left sidebar nor wraps (the rest goes to its tray), and its items drag and
// hide. WRITES appearance.json (put back) and .vaultite/plugins/qa-long (removed): throwaway server only.
//   node web/qa/statusbar.mjs <base url> <vault path>
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, qa, SHOTS, until, wait } from "./lib/qa.mjs"

const { args: [B0, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const api = apiAt(B)
const look = await api("GET", "config/appearance")
const P = "Qa status bar.md"
await api("POST", "file", { path: P, text: "# Status bar\n\nSome words to count.\n" })
// Every ambient item on, in a known order (the routines chip shows with a routine due, the inbox's with a new item).
await api("POST", "ops/inbox.add", { title: "Qa status bar", body: "An item for the bar." })
// A vault plugin's long item, so a narrow window has more than fits whichever of the others show here.
const LONG = path.join(VAULT, ".vaultite/plugins/qa-long")
mkdirSync(LONG, { recursive: true })
writeFileSync(path.join(LONG, "manifest.json"), JSON.stringify({ id: "qa-long", category: "other", name: "Qa long", icon: "ruler", description: "A made-up vault plugin with a long status bar item.", version: "1.0.0", author: "Alice Park", disclosures: {}, apiVersion: 1 }))
writeFileSync(path.join(LONG, "index.tsx"), `import { definePlugin } from "@vaultite"
export default definePlugin({ ambient: { long: { title: "Qa long", sort: 50, render: () => <span className="whitespace-nowrap px-1 text-[12px]">A long status item that takes a good deal of room in the bar, more than fits</span> } } })
`)
await api("POST", "ops/plugin.enable", { id: "qa-long" })
await api("PATCH", "config/appearance", { statusBar: ["today:routines", "terminal:agents", "inbox:new", "claude-code:limits", "qa-long:long", "core:view", "core:words", "core:characters"], statusBarMore: [] })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  await page.goto(`${B}#file/${encodeURIComponent(P)}`)
  const bar = page.locator("[data-status-bar]")
  await until(async () => (await bar.locator("[data-status-key='qa-long:long']").count()) > 0 && /word/.test(await bar.innerText()), 15000)
  const keys = () => bar.locator("[data-status-items] > [data-ambient]").evaluateAll((els) =>
    els.filter((e) => e.offsetWidth).map((e) => e.dataset.statusKey))
  const clear = () => page.evaluate(() => {
    const side = document.querySelector("aside[data-side=left]").getBoundingClientRect().right
    return document.querySelector("[data-status-bar]").getBoundingClientRect().left - side
  })
  // (settled: an item fetching its data, Claude's limits, comes a moment later)
  let shown = await keys()
  for (let i = 0; i < 20; i++) { await wait(250); const now = await keys(); if (now.join() === shown.join() && i > 7) break; shown = now }
  console.log("bar:", shown.join(", "), "|", (await bar.innerText()).replace(/\n/g, " "))
  check("wide window: every item in the bar, no more button", shown.length >= 2 && shown.includes("qa-long:long") && !(await bar.locator("[data-status-more]").isVisible()), shown)
  await page.screenshot({ path: `${SHOTS}statusbar-1-wide.png`, clip: { x: 0, y: 740, width: 1280, height: 60 } })

  // 1. Narrow: the bar stops at the sidebar; the leftmost go to the tray.
  await page.setViewportSize({ width: 820, height: 800 })
  await until(async () => !(await keys()).includes("qa-long:long"))
  const narrow = await keys()
  check("narrow: the bar keeps clear of the left sidebar", (await clear()) >= 0, await clear())
  check("narrow: the more button shows, the long item left out, the short ones still in", (await bar.locator("[data-status-more]").isVisible())
    && !narrow.includes("qa-long:long") && narrow.length > 0, narrow)
  const gap = await page.evaluate(() => {
    const more = document.querySelector("[data-status-more]").getBoundingClientRect()
    const next = [...document.querySelectorAll("[data-status-row] > *")].find((el) => el.getBoundingClientRect().left > more.right && el.getBoundingClientRect().width)
    return next.getBoundingClientRect().left - more.right
  })
  check("narrow: no empty room after the more button", gap <= 12, gap)
  await page.screenshot({ path: `${SHOTS}statusbar-2-narrow.png`, clip: { x: 0, y: 740, width: 820, height: 60 } })
  await bar.locator("[data-status-more]").click(); await wait(200)
  const tray = page.locator("[data-status-tray] > [data-status-key]")
  // (the file's items it left out too: the characters first)
  const inTray = (await tray.evaluateAll((els) => els.filter((e) => e.offsetWidth).map((e) => e.dataset.statusKey))).filter((k) => shown.includes(k))
  check("the tray has what the bar left out", inTray.length === shown.length - narrow.length && inTray.every((k) => !narrow.includes(k)), inTray)
  await page.screenshot({ path: `${SHOTS}statusbar-3-tray.png`, clip: { x: 0, y: 680, width: 820, height: 120 } })
  await page.keyboard.press("Escape"); await wait(100)
  check("Escape closes the tray", (await page.locator("[data-status-tray]").count()) === 0)

  // 2. Wide again: drag the first item to the end of the bar.
  await page.setViewportSize({ width: 1280, height: 800 }); await wait(400)
  const box = async (sel) => (await page.locator(sel).first().boundingBox())
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y, { steps: 3 }); await page.mouse.move(to.x, to.y, { steps: 12 }); await wait(150)
    await page.mouse.up(); await wait(400)
  }
  const first = await box(`[data-status-key="${shown[0]}"]`), last = await box(`[data-status-items] > [data-status-key="${shown.at(-1)}"]`)
  await drag({ x: first.x + first.width / 2, y: first.y + first.height / 2 }, { x: last.x + last.width - 2, y: last.y + last.height / 2 })
  const moved = await keys()
  check("drag along the bar: moved to the end", moved.at(-1) === shown[0], moved)
  // (the bar's list holds the file's items after them)
  const lastAmbient = (l) => l?.filter((k) => !k.startsWith("core:")).at(-1)
  check("…saved in appearance.json", !!(await until(async () => lastAmbient((await api("GET", "config/appearance")).statusBar) === shown[0])), (await api("GET", "config/appearance")).statusBar)

  // 3. Onto the more button (it shows while one is dragged): tucked away.
  const a = await box(`[data-status-items] > [data-status-key="${moved[0]}"]`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + 10, { steps: 3 }); await wait(150)
  const m = await box("[data-status-more]")
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 10 }); await wait(150)
  await page.mouse.up(); await wait(400)
  check("onto the more button: tucked in the tray", !(await keys()).includes(moved[0]) && !!(await until(async () => (await api("GET", "config/appearance")).statusBarMore?.includes(moved[0]))),
    { bar: await keys(), more: (await api("GET", "config/appearance")).statusBarMore })

  // 4. Out of the tray onto the bar: back.
  // (the bar's first item, the file's when no other is left: what the bar shows besides depends on the machine)
  const firstItem = () => bar.locator("[data-status-items] > [data-status-key]").evaluateAll((els) => {
    const r = els.find((e) => e.offsetWidth)?.getBoundingClientRect()
    return r && { x: r.x, y: r.y, width: r.width, height: r.height }
  })
  await bar.locator("[data-status-more]").click(); await wait(200)
  const t = await box(`[data-status-tray] > [data-status-key="${moved[0]}"]`), b = await firstItem()
  // (the last drop's toast may sit over the tray, bottom right, until it goes: the item held, not the toast)
  await until(() => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-status-tray]"), [t.x + t.width / 2, t.y + t.height / 2]), 10000)
  // (aimed at its first item as it was: the gap it opens grows the bar to the left, under a pointer that then stirs)
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2); await page.mouse.down()
  await page.mouse.move(t.x + t.width / 2 + 8, t.y + t.height / 2, { steps: 3 }); await page.mouse.move(b.x + 2, b.y + b.height / 2, { steps: 12 }); await wait(300)
  await page.mouse.move(b.x + 3, b.y + b.height / 2); await wait(300)
  await page.mouse.up(); await wait(400)
  check("out of the tray: back at the bar's start", (await keys())[0] === moved[0] && !!(await until(async () => !(await api("GET", "config/appearance")).statusBarMore?.includes(moved[0]))),
    { bar: await keys(), more: (await api("GET", "config/appearance")).statusBarMore })
  await page.screenshot({ path: `${SHOTS}statusbar-4-after.png`, clip: { x: 0, y: 740, width: 1280, height: 60 } })

  // 5. Never on two lines, whatever the width: what doesn't fit is left out, not wrapped.
  const lines = []
  for (let w = 1280; w >= 780; w -= 50) {
    await page.setViewportSize({ width: w, height: 800 }); await wait(250)
    lines.push(await page.evaluate((w) => {
      const bar = document.querySelector("[data-status-bar]"), row = bar.querySelector("[data-status-row]")
      // (a text on two lines draws two boxes)
      const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), two = [], range = document.createRange()
      for (let t = texts.nextNode(); t; t = texts.nextNode()) {
        if (!t.textContent.trim()) continue
        range.selectNodeContents(t)
        if ([...range.getClientRects()].filter((r) => r.width).length > 1) two.push(t.textContent)
      }
      return { w, tall: row.offsetHeight > bar.clientHeight, over: row.scrollWidth - row.clientWidth, two: two.slice(0, 3) }
    }, w))
  }
  check("never on two lines nor past its room at any width", lines.every((l) => !l.tall && l.over <= 1 && !l.two.length), lines.filter((l) => l.tall || l.over > 1 || l.two.length))

  // 6. Last load's widths hold only while the app loads: an item drawn narrower than last time (another song) keeps
  // no room of the old one, and coming back to the first file holds none again.
  await page.setViewportSize({ width: 1280, height: 800 }); await wait(2500)
  await page.evaluate(() => {
    const k = JSON.parse(localStorage.getItem("vaultite.statusbar.items") ?? "[]")
    localStorage.setItem("vaultite.statusbar.items", JSON.stringify(k.map(([key, w, ...rest]) => [key, key === "qa-long:long" ? w + 300 : w, ...rest])))
  })
  const longWidth = () => page.evaluate(() => Math.round(document.querySelector("[data-status-items] > [data-status-key='qa-long:long']")?.getBoundingClientRect().width ?? 0))
  const natural = await longWidth()
  await page.reload()
  await until(async () => (await longWidth()) > 0 && /word/.test(await bar.innerText()), 15000); await wait(1500)
  const after = await longWidth()
  await page.evaluate(() => { location.hash = "#view/inbox" }); await wait(800)
  await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, P); await wait(1500)
  const back = await longWidth()
  check("an item drawn narrower than last load keeps none of its old room", Math.abs(after - natural) <= 2 && Math.abs(back - natural) <= 2, { natural, after, back })
  // …and a file's items hold no room when the app opens on a view: no file comes there (an empty stretch past the line).
  await wait(2500)
  await page.evaluate(() => { location.hash = "#view/inbox" })
  await page.reload(); await wait(1000)
  const onView = await page.evaluate(() => [...document.querySelectorAll("[data-status-items] > :not([data-ambient])")]
    .filter((el) => el.offsetWidth).map((el) => el.dataset.statusKey ?? (el.hasAttribute("data-status-sep") ? "line" : "coming")))
  check("opened on a view: no room held for the last file's items", onView.length === 0, onView)
  await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, P)
  await until(async () => /word/.test(await bar.innerText()), 15000)

  // 7. The file's items are items too: hidden by right-click, back from the palette; none at all leaves a faint corner.
  const look_ = async () => (await api("GET", "config/appearance")).statusBar ?? []
  const words = bar.locator("[data-status-key='core:words']")
  await words.click({ button: "right" }); await wait(300)
  await page.getByRole("menuitemcheckbox", { name: "Word count", exact: true }).click(); await wait(300)
  await page.keyboard.press("Escape")
  check("right-click: the word count hides, saved", !!(await until(async () => !(await look_()).includes("core:words") && (await words.count()) === 0)), await look_())
  await page.keyboard.press("ControlOrMeta+P"); await wait(300)
  await page.keyboard.type("show in status bar: word"); await wait(300)
  await page.keyboard.press("Enter")
  check("the palette shows it again, in its place", !!(await until(async () => (await look_()).indexOf("core:words") === (await look_()).indexOf("core:view") + 1 && (await words.count()) === 1)), await look_())
  await api("PATCH", "config/appearance", { statusBar: [] })
  await until(async () => (await bar.locator("[data-status-key]").count()) === 0)
  await wait(300)
  const corner = await page.evaluate(() => {
    const el = document.querySelector("[data-status-bar]"), r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, bg: cs.backgroundColor, border: cs.borderTopColor }
  })
  const clear_ = (c) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c)
  check("nothing shown: no bar drawn, a corner of its height left", corner.h >= 27 && corner.w >= 36 && corner.bottom <= 1 && clear_(corner.bg) && clear_(corner.border), corner)
  await page.mouse.move(1280 - 10, 800 - 10); await wait(200)
  check("…its outline on hover", !clear_(await page.evaluate(() => getComputedStyle(document.querySelector("[data-status-bar]")).borderTopColor)))
  await page.screenshot({ path: `${SHOTS}statusbar-5-empty.png`, clip: { x: 1080, y: 740, width: 200, height: 60 } })
  await page.mouse.click(1280 - 10, 800 - 10, { button: "right" }); await wait(300)
  await page.getByRole("menuitem", { name: "Show all", exact: true }).click(); await wait(300)
  check("…whose right-click shows them all again", !!(await until(async () => (await look_()).filter((k) => k.startsWith("core:")).length === 3 && (await words.count()) === 1)), await look_())
} finally {
  await api("PATCH", "config/appearance", { statusBar: look.statusBar ?? null, statusBarMore: look.statusBarMore ?? [] })
  await api("POST", "ops/plugin.disable", { id: "qa-long" })
  rmSync(LONG, { recursive: true, force: true })
  for (const f of [P, "Inbox/Qa status bar.md"]) await fetch(`${B}api/file?path=${encodeURIComponent(f)}`, { method: "DELETE" })
}
await done()
