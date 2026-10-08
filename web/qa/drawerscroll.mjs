// The phone's left drawer opens at its top: with Files' auto-reveal on, it used to jump down to the open file each time
// (a pinned page opened from the top, then the drawer again). Turn auto-reveal on in the throwaway server's vault
// (.vaultite/files.json: {"autoReveal": true}); reads only:
//   QA_BASE=http://127.0.0.1:8799/ node web/qa/drawerscroll.mjs [shots dir]
import { SHOTS, qa } from "./lib/qa.mjs"
const { args: [dir = SHOTS], browser, errs, watch } = await qa(import.meta.url)
const B = process.env.QA_BASE ?? "http://127.0.0.1:8799/"
const ctx = await browser.newContext({ viewport: { width: 375, height: 560 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = watch(await ctx.newPage())
const top = () => page.evaluate(() => { const b = document.querySelector("[data-phone-drawer] [data-sidebar-body]"); return b ? { top: Math.round(b.scrollTop), room: b.scrollHeight - b.clientHeight } : null })
const open = async () => { await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await page.waitForTimeout(600) }
await page.goto(B); await page.waitForTimeout(1500)
const r = {}
await open()
r.before = await top()
const pins = page.locator("[data-phone-drawer] [data-pin]")
r.pins = await pins.count()
// The second pin, then the first: each a page other than the one open (the start page is the first).
for (const [k, i] of [[0, 1], [1, 0]]) {
  if (i >= r.pins) continue
  await pins.nth(i).tap(); await page.waitForTimeout(900)
  await open()
  r[`after${k}`] = await top()
  await page.screenshot({ path: `${dir}drawerscroll-${k}.png` })
}
console.log(JSON.stringify({ ...r, errs }, null, 1))
// With Files' auto-reveal on (the sandbox's files.json), and a drawer taller than the screen: else it proves nothing.
const ok = r.pins > 1 && r.before?.room > 0 && [r.before, r.after0, r.after1].every((x) => x?.top === 0) && !errs.length
await browser.close()
process.exit(ok ? 0 : 1)
