// Tabs closed one after another with the mouse (components/Tabs.tsx TabBar) keep their width, so the next X comes under
// the pointer, and fill the bar once it leaves. Opens tabs only: throwaway server.
//   node web/qa/tabclose.mjs <base url>
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)

const page = watch(await browser.newPage({ viewport: { width: 1100, height: 700 } }))
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
await command(page, "Close all other tabs")
const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.endsWith(".md")).map((f) => f.path).slice(0, 10))
for (const [i, f] of files.entries()) {
  if (i) { await page.click("[aria-label='New tab']"); await wait(120) }
  await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await wait(250)
}

const tabs = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => ({ id: e.dataset.tabId, w: e.getBoundingClientRect().width, held: !!e.style.flex })))
// What's under the pointer: the tab whose X it is (null when it isn't over an X).
const xUnder = (x, y) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-tab-close]")?.closest("[data-tab-id]")?.dataset.tabId ?? null, [x, y])
const xOf = async (id) => {
  await page.hover(`[data-tab-id="${id}"]`)
  const b = await page.locator(`[data-tab-id="${id}"] [data-tab-close]`).boundingBox()
  return [b.x + b.width / 2, b.y + b.height / 2]
}
const same = (a, b) => Math.abs(a - b) < 0.5

let before = await tabs()
check("ten tabs, squeezed below their widest", before.length === 10 && before[0].w < 200, before)

// Three closes from the same spot: each brings the next tab's X under the pointer, the widths unchanged.
const [x, y] = await xOf(before[2].id)
for (let n = 0; n < 3; n++) {
  const next = (await tabs())[3].id
  await page.mouse.click(x, y); await wait(150)
  const now = await tabs()
  check(`close ${n + 1}: the widths hold`, now.length === 9 - n && now.every((t) => t.held && same(t.w, before[0].w)), now)
  check(`close ${n + 1}: the next tab's X is under the pointer`, (await xUnder(x, y)) === next, { next, under: await xUnder(x, y) })
}

// The last one: the rest widen to end where it did.
before = await tabs()
const [lx, ly] = await xOf(before.at(-1).id)
await page.mouse.click(lx, ly); await wait(150)
let now = await tabs()
check("closing the last: the new last tab's X is under the pointer", (await xUnder(lx, ly)) === now.at(-1).id, { now, under: await xUnder(lx, ly) })
check("closing the last: the rest widened", now.every((t) => t.held && t.w > before[0].w + 1), { before: before[0].w, now })

// The pointer leaves the bar: they fill it again.
const held = now[0].w
await page.mouse.move(550, 450)
check("left the bar: no width held", await until(async () => (await tabs()).every((t) => !t.held)), await tabs())
await wait(300)
now = await tabs()
check("left the bar: they widen to fill it", now.every((t) => t.w > held + 1 && same(t.w, now[0].w)), { held, now })

// Closed by a command with the pointer over the bar: they fill it at once.
await page.hover(`[data-tab-id="${now[1].id}"]`)
await command(page, "Close current tab")
await wait(300)
const after = await tabs()
check("closed by a command: nothing held", after.length === now.length - 1 && after.every((t) => !t.held && t.w > now[0].w + 1), { now, after })

await page.close()
await done()
