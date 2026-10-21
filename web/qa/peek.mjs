// Sidebars without rails (Zen): hidden, each takes no room and is off the window with its toggle; at its edge of the
// window it slides in as a floating panel, as far from the window's top as from its side, and its toggle rides on it,
// mid-slide too, sitting in it where it sits beside the pinned sidebar, centred on its top row (the Mac's traffic
// lights follow the left one the same way, electron/main.ts: not in a browser). Writes appearance.json and
// sidebars.json (put back after): throwaway server only.
//   node web/qa/peek.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/peek-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = async (p, init) => (await fetch(new URL(`/api/${p}`, B), { headers: { "Content-Type": "application/json" }, ...init })).json()
const appearance = await api("config/appearance")
const sidebars = await api("config/sidebars")
const W = 1440
try {
  await api("config/appearance", { method: "PUT", body: JSON.stringify({ ...appearance, rails: false }) })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify({ left: ["search:search", "pages:pages"], right: ["files:files"], collapsed: [] }) })
  const page = watch(await browser.newPage({ viewport: { width: W, height: 900 } }))
  await page.goto(B)
  await page.waitForSelector("aside[data-side=right]")
  await wait(800)
  // The toggle's place in its sidebar (inside its edges' hairline), the middle of the sidebar's top row, each one's box.
  const at = (side) => page.evaluate((side) => {
    const el = document.querySelector(`aside[data-side=${side}]`), a = el.getBoundingClientRect(), cs = getComputedStyle(el)
    const t = document.querySelector(side === "left" ? "[data-sidebar-toggle='']" : "[data-sidebar-toggle=right]").getBoundingClientRect()
    const row = el.querySelector("[data-titlebar]").getBoundingClientRect()
    const inner = { left: a.left + parseFloat(cs.borderLeftWidth), right: a.right - parseFloat(cs.borderRightWidth), top: a.top + parseFloat(cs.borderTopWidth) }
    return { peek: el.dataset.peek ?? null, a: { left: a.left, right: a.right, top: a.top }, t: { left: t.left, right: t.right },
      dx: side === "left" ? t.left - inner.left : inner.right - t.right, dy: t.top - inner.top, mid: t.top + t.height / 2 - (row.top + row.height / 2) }
  }, side)

  for (const side of ["left", "right"]) {
    const pinned = await at(side)
    check(`${side}: pinned, not floating`, pinned.peek === null, pinned)
    await page.click(side === "left" ? "[data-sidebar-toggle='']" : "[data-sidebar-toggle=right]")
    await page.mouse.move(W / 2, 450)
    const hidden = await until(async () => { const s = await at(side); return s.peek === "false" && (side === "left" ? s.a.right <= 0 && s.t.right <= 0 : s.a.left >= W && s.t.left >= W) && s }, 2000)
    check(`${side}: hidden, it and its toggle are off the window`, !!hidden, hidden || await at(side))
    await page.mouse.move(side === "left" ? 1 : W - 1, 450)
    await until(async () => (await at(side)).peek === "true", 2000)
    // Mid-slide: the toggle moves with the panel.
    await wait(60)
    const mid = await at(side)
    check(`${side}: mid-slide, the toggle rides on the panel`, Math.abs(mid.dx - pinned.dx) <= 1 && Math.abs(mid.dy - pinned.dy) <= 1, { mid, pinned })
    await wait(400)
    const shown = await at(side)
    const inset = shown.a.top, edge = side === "left" ? shown.a.left : W - shown.a.right
    check(`${side}: slid in, floating as far from the top as from its edge`, inset > 0 && Math.abs(inset - edge) < 0.01, shown)
    check(`${side}: its toggle where it sits beside the pinned sidebar`, Math.abs(shown.dx - pinned.dx) < 0.01 && Math.abs(shown.dy - pinned.dy) < 0.01, { shown, pinned })
    check(`${side}: its toggle centred on the top row, pinned and floating`, Math.abs(pinned.mid) < 0.01 && Math.abs(shown.mid) < 0.01, { shown, pinned })
    await page.screenshot({ path: `${OUT}${side}.png`, clip: { x: side === "left" ? 0 : W - 400, y: 0, width: 400, height: 160 } })
    // A click on its toggle pins it again.
    await page.click(side === "left" ? "[data-sidebar-toggle='']" : "[data-sidebar-toggle=right]")
    const back = await until(async () => { const s = await at(side); return s.peek === null && s }, 2000)
    check(`${side}: its toggle pins it, the toggle back in place`, !!back && Math.abs(back.dx - pinned.dx) < 0.01 && Math.abs(back.dy - pinned.dy) < 0.01, back || await at(side))
    await page.mouse.move(W / 2, 450)
  }
} finally {
  await api("config/appearance", { method: "PUT", body: JSON.stringify(appearance) })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify(sidebars) })
  await browser.close()
}
await done()
