import { chromium } from "playwright-core"
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.addInitScript(() => {
  window.__cb = []
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (fn) => raf((t) => { const s = performance.now(); fn(t); const d = performance.now() - s; if (d > 1) window.__cb.push(d) })
})
const id = "dbgr" + Date.now().toString(36)
await p.goto(process.env.B + "/#view/terminal%2F" + id)
await p.waitForTimeout(3000)
await p.click("[data-term]")
await p.keyboard.type("seq 1 30\n")
await p.waitForTimeout(500)
await p.evaluate(() => { window.__cb = [] })
for (let i = 0; i < 20; i++) { await p.keyboard.type("x"); await p.waitForTimeout(80) }
const cb = await p.evaluate(() => window.__cb)
cb.sort((a, b) => a - b)
console.log(process.env.B, "rAF callbacks >1ms:", cb.length, "median", cb[cb.length >> 1]?.toFixed(1), "max", cb.at(-1)?.toFixed(1))
await p.evaluate((id) => new WebSocket(`ws://${location.host}/api/terminal/${id}?end=1`), id)
await p.waitForTimeout(300); await b.close()
