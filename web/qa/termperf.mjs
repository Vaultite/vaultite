// Terminal speed: how long a terminal takes from the key or click to its first screen, for a new shell, a new Claude
// Code, and a terminal's tab picked again in the Terminals panel (a new xterm.js, a new socket, the replay). Each row
// splits it up, in ms since the input: xterm (the view is mounted), text (something is drawn), ws (the socket made),
// open, attached (the server said so), firstData (the shell's first bytes); total is when what it waits for is drawn.
// Starts shells and Claude Code on the server's machine: throwaway server only, and end its tmux server after
// (tmux -L vaultite-<port> kill-server). Compare two builds by running it on each, alternately: the machine's load
// moves these numbers a lot.
//   node web/qa/termperf.mjs <base url> [runs]
import { qa, wait } from "./lib/qa.mjs"
const { args: [B, RUNS = "3"], browser } = await qa(import.meta.url)
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => {
  window.__input = 0
  for (const ev of ["keydown", "pointerdown"]) addEventListener(ev, (e) => { window.__input = performance.now() }, true)
  window.__ws = []
  const W = window.WebSocket
  window.WebSocket = class extends W {
    constructor(url, p) {
      super(url, p)
      if (!/\/api\/terminal\//.test(url)) return
      const r = { url: String(url).replace(/.*\/api\/terminal\//, "").replace(/\?.*/, ""), created: performance.now() }
      window.__ws.push(r)
      this.addEventListener("open", () => { r.open = performance.now() })
      this.addEventListener("message", (e) => {
        if (typeof e.data === "string") r.attached ??= performance.now()
        else { r.firstData ??= performance.now(); r.bytes = (r.bytes || 0) + (e.data.byteLength || e.data.size || 0) }
      })
    }
  }
})
const page = await ctx.newPage()
page.on("pageerror", (e) => console.error("pageerror", String(e)))
await page.goto(B)
await page.waitForSelector("[data-agent]", { timeout: 15000 }).catch(() => console.error("no agent buttons"))
await wait(1500)

/** Waits in the page (rAF) until the terminal's rows match `re`; ms since the last input event, plus the socket's steps. */
const until = (re, ms = 20000) => page.evaluate(({ src, ms }) => new Promise((resolve) => {
  const re = new RegExp(src), t0 = window.__input, end = performance.now() + ms
  let chunk = null, first = null
  const step = () => {
    const rows = document.querySelector("[data-terminal]") || document.querySelector(".xterm-rows")
    if (rows && chunk == null) chunk = performance.now() - t0
    const text = !rows ? "" : rows.terminalText ? rows.terminalText() : [...rows.children].map((d) => d.textContent).join("\n")
    if (text.trim() && first == null) first = performance.now() - t0
    if (re.test(text) || performance.now() > end) {
      const w = window.__ws.at(-1)
      const rel = (k) => (w && w[k] != null && w.created >= t0 - 5 ? Math.round(w[k] - t0) : null)
      return resolve({ total: Math.round(performance.now() - t0), timedOut: !re.test(text), xterm: Math.round(chunk ?? -1), text: Math.round(first ?? -1),
        ws: rel("created"), open: rel("open"), attached: rel("attached"), firstData: rel("firstData"), bytes: w?.bytes })
    }
    requestAnimationFrame(step)
  }
  step()
}), { src: re.source, ms })

const rows = []
const ids = []
for (let i = 0; i < Number(RUNS); i++) {
  await page.keyboard.press("Control+Backquote")
  const r = await until(/\]\$/)
  rows.push({ step: `new shell ${i + 1}`, ...r })
  const id = await page.evaluate(() => window.__ws.at(-1).url)
  ids.push(id)
  await page.locator(".xterm").click()
  await page.keyboard.type(`clear; echo MARK-${i}`); await page.keyboard.press("Enter")
  await wait(800)
}
// Switch between them from the Terminals panel (the tab comes back: a new xterm, a new socket, the replay).
for (let round = 0; round < 2; round++) for (let i = 0; i < ids.length; i++) {
  const row = page.locator(`[data-session="${ids[i]}"]`).first()
  await row.click()
  const r = await until(new RegExp(`MARK-${i}`))
  rows.push({ step: `switch to shell ${i + 1}`, ...r })
  await wait(500)
}
// Claude Code, new.
for (let i = 0; i < 2; i++) {
  await page.locator('button[data-agent="claude"]').first().click()
  const r = await until(/Claude Code|╭|>\s*$|Try "/m, 30000)
  rows.push({ step: `new Claude ${i + 1}`, ...r })
  rows.at(-1).id = await page.evaluate(() => window.__ws.at(-1).url)
  await wait(2500)
}
const claudeId = rows.at(-1).id
// Back to a shell, then to Claude (a full-screen program: the replay plus tmux's redraw).
for (let i = 0; i < 2; i++) {
  await page.locator(`[data-session="${ids[0]}"]`).first().click(); await until(/MARK-0/); await wait(400)
  await page.locator(`[data-session="${claudeId}"]`).first().click()
  rows.push({ step: `switch to Claude ${i + 1}`, ...(await until(/Claude Code|╭|>/m)) })
  await wait(400)
}
console.table(rows.map(({ id, ...r }) => r))
await browser.close()
