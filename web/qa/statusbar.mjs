// The desktop status bar beside the left sidebar: it never reaches it (what doesn't fit goes to the tray behind its
// more button), its ambient items drag along it, onto the more button (tucked: appearance.json's
// `statusBarMore`) and back out of the tray. WRITES appearance.json (put back) and a made-up vault plugin with a long
// item, .vaultite/plugins/qa-long (removed): throwaway server only.
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
export default definePlugin({ ambient: { long: { title: "Qa long", sort: 50, render: () => <span className="whitespace-nowrap px-1 text-[12px]">A long status item that takes room in the bar</span> } } })
`)
await api("POST", "ops/plugin.enable", { id: "qa-long" })
await api("PATCH", "config/appearance", { statusBar: ["today:routines", "terminal:agents", "inbox:new", "claude-code:limits", "qa-long:long"], statusBarMore: [] })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  await page.goto(`${B}#file/${encodeURIComponent(P)}`)
  const bar = page.locator("[data-status-bar]")
  await until(async () => (await bar.locator("[data-status-key='qa-long:long']").count()) > 0 && /word/.test(await bar.innerText()), 15000)
  const keys = () => bar.locator("[data-ambient] > [data-status-key]").evaluateAll((els) =>
    els.filter((e) => e.offsetWidth).map((e) => e.dataset.statusKey))
  const clear = () => page.evaluate(() => {
    const side = document.querySelector("aside[data-side=left]").getBoundingClientRect().right
    return document.querySelector("[data-status-bar]").getBoundingClientRect().left - side
  })
  const shown = await keys()
  console.log("bar:", shown.join(", "), "|", (await bar.innerText()).replace(/\n/g, " "))
  check("wide window: every item in the bar, no more button", shown.length >= 2 && shown.includes("qa-long:long") && (await bar.locator("[data-status-more]").count()) === 0, shown)
  await page.screenshot({ path: `${SHOTS}statusbar-1-wide.png`, clip: { x: 0, y: 740, width: 1280, height: 60 } })

  // 1. Narrow: the bar stops at the sidebar; the leftmost go to the tray.
  await page.setViewportSize({ width: 820, height: 800 })
  await until(async () => !(await keys()).includes("qa-long:long"))
  const narrow = await keys()
  check("narrow: the bar keeps clear of the left sidebar", (await clear()) >= 0, await clear())
  check("narrow: the more button shows, the long item left out, the short ones still in", (await bar.locator("[data-status-more]").count()) === 1
    && !narrow.includes("qa-long:long") && narrow.length > 0, narrow)
  const gap = await page.evaluate(() => {
    const more = document.querySelector("[data-status-more]").getBoundingClientRect()
    const next = [...document.querySelectorAll("[data-status-bar] > *")].find((el) => el.getBoundingClientRect().left > more.right && el.getBoundingClientRect().width)
    return next.getBoundingClientRect().left - more.right
  })
  check("narrow: no empty room after the more button", gap <= 12, gap)
  await page.screenshot({ path: `${SHOTS}statusbar-2-narrow.png`, clip: { x: 0, y: 740, width: 820, height: 60 } })
  await bar.locator("[data-status-more]").click(); await wait(200)
  const tray = page.locator("[data-status-tray] > [data-status-key]")
  const inTray = await tray.evaluateAll((els) => els.filter((e) => e.offsetWidth).map((e) => e.dataset.statusKey))
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
  const first = await box(`[data-status-key="${shown[0]}"]`), last = await box(`[data-ambient] > [data-status-key="${shown.at(-1)}"]`)
  await drag({ x: first.x + first.width / 2, y: first.y + first.height / 2 }, { x: last.x + last.width - 2, y: last.y + last.height / 2 })
  const moved = await keys()
  check("drag along the bar: moved to the end", moved.at(-1) === shown[0], moved)
  check("…saved in appearance.json", !!(await until(async () => (await api("GET", "config/appearance")).statusBar?.at(-1) === shown[0])), (await api("GET", "config/appearance")).statusBar)

  // 3. Onto the more button (it shows while one is dragged): tucked away.
  const a = await box(`[data-ambient] > [data-status-key="${moved[0]}"]`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + 10, { steps: 3 }); await wait(150)
  const m = await box("[data-status-more]")
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2, { steps: 10 }); await wait(150)
  await page.mouse.up(); await wait(400)
  check("onto the more button: tucked in the tray", !(await keys()).includes(moved[0]) && !!(await until(async () => (await api("GET", "config/appearance")).statusBarMore?.includes(moved[0]))),
    { bar: await keys(), more: (await api("GET", "config/appearance")).statusBarMore })

  // 4. Out of the tray onto the bar: back.
  await bar.locator("[data-status-more]").click(); await wait(200)
  const t = await box(`[data-status-tray] > [data-status-key="${moved[0]}"]`), b = await box(`[data-ambient] > [data-status-key="${(await keys())[0]}"]`)
  // (the last drop's toast may sit over the tray, bottom right, until it goes: the item held, not the toast)
  await until(() => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-status-tray]"), [t.x + t.width / 2, t.y + t.height / 2]), 10000)
  await drag({ x: t.x + t.width / 2, y: t.y + t.height / 2 }, { x: b.x + 2, y: b.y + b.height / 2 })
  check("out of the tray: back at the bar's start", (await keys())[0] === moved[0] && !!(await until(async () => !(await api("GET", "config/appearance")).statusBarMore?.includes(moved[0]))),
    { bar: await keys(), more: (await api("GET", "config/appearance")).statusBarMore })
  await page.screenshot({ path: `${SHOTS}statusbar-4-after.png`, clip: { x: 0, y: 740, width: 1280, height: 60 } })
} finally {
  await api("PATCH", "config/appearance", { statusBar: look.statusBar ?? null, statusBarMore: look.statusBarMore ?? [] })
  await api("POST", "ops/plugin.disable", { id: "qa-long" })
  rmSync(LONG, { recursive: true, force: true })
  for (const f of [P, "Inbox/Qa status bar.md"]) await fetch(`${B}api/file?path=${encodeURIComponent(f)}`, { method: "DELETE" })
}
await done()
