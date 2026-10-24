// A bundle applied while the app is open draws what a reload of it draws: the shell (sidebars, tab bars, panes, the
// status bar) keeps nothing of the bundle before (the status bar once held another's width in Zen): Standard, Zen, Browser.
// WRITES the vault's settings: throwaway servers only.
//   node web/qa/bundle-live.mjs <base url>
import { spawnSync } from "node:child_process"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const NOTE = "Start here.md"

function apply(id) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "bundle", "apply", id, "--code"], { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, "") } })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout)
}

/** The shell's boxes (left, top, width, height). */
const shell = (page) => page.evaluate(() => {
  const out = {}
  const SEL = ["[data-status-bar]", "[data-status-bar] [data-ambient]", "[data-steady]", "aside[data-side=left]", "aside[data-side=right]", "main", "[data-pane]", "section[data-group]", "[role=tablist]"]
  for (const sel of SEL) document.querySelectorAll(sel).forEach((el, i) => {
    const r = el.getBoundingClientRect()
    if (r.width || r.height) out[`${sel}#${i}`] = [r.left, r.top, r.width, r.height].map(Math.round)
  })
  return out
})
/** Where they differ by more than a rounding (a pixel or two: what's held as it loads). */
const differ = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => !a[k] || !b[k] || a[k].some((v, i) => Math.abs(v - b[k][i]) > 2)).map((k) => `${k}: live ${a[k] ?? "-"} / reload ${b[k] ?? "-"}`)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const page = watch(await ctx.newPage(), { label: "bundle-live" })
const go = async () => {
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await until(() => page.locator("[data-status-bar]").count(), 10_000)
  await wait(3500)
}

for (const [from, to] of [["standard", "zen"], ["zen", "standard"], ["standard", "browser"], ["browser", "zen"], ["zen", "browser"]]) {
  apply(from)
  await go()
  apply(to)
  await wait(4000)
  const live = await shell(page)
  await page.reload()
  await until(() => page.locator("[data-status-bar]").count(), 10_000)
  await wait(3500)
  const fresh = await shell(page)
  const d = differ(live, fresh)
  check(`${from} to ${to}, applied live, draws the shell as a reload does`, !d.length, d)
}

await ctx.close()
await done()
