// How long agents' browser calls take (electron/browser/agent.ts), each timed several times on a made-up local site: the
// floor of each op (what the app adds, not the site), p50 and max. Prints a table; checks nothing but that they work.
// The agents' card watches the page, so a pointer's act includes its glide (GLIDE_MS) while someone's at this Mac:
// VAULTITE_PRESENCE=away times it with nobody there (no glide), =here with someone (else this Mac's idle time decides).
// RUNS=<n> times each (8); REAL="<url> <url>" also times going to real sites (their own load and drawing included).
// WRITES: the throwaway vault only.
//   node web/qa/agentspeed.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa } from "./lib/qa.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agentspeed-"))
const N = Number(process.env.RUNS ?? 8)

const rows = Array.from({ length: 200 }, (_, i) => `<li><a href="/item/${i}">Order ${1000 + i}</a> <span>Lisbon depot</span> <button>Archive</button></li>`).join("")
const PAGE = `<!doctype html><title>Lighthouse</title><style>body{font:16px system-ui;margin:40px}</style>
<h1>Lighthouse orders</h1>
<label>Customer <input id="who" name="who"></label>
<button id="add">Add note</button>
<button id="load">Load notes</button>
<button id="still">Do nothing</button>
<a id="next" href="/next">Next page</a>
<p id="notes"></p>
<ul>${rows}</ul>
<script>
let n = 0
add.onclick = () => { notes.textContent = "Note " + (++n) }
load.onclick = () => fetch("/data").then((r) => r.text()).then((t) => { notes.textContent = t + " " + (++n) })
</script>`
const site = http.createServer((q, res) => {
  const send = (body, type = "text/html; charset=utf-8") => { res.writeHead(200, { "Content-Type": type }); res.end(body) }
  if (q.url === "/next") return send("<!doctype html><title>Next</title><h1>Order list, page 2</h1><a href=\"/\">Back</a>")
  if (q.url === "/data") return setTimeout(() => send("Gate code 4417", "text/plain"), 100)
  send(PAGE)
})
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}/`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  const op = async (id, params) => {
    const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
    const j = await r.json().catch(() => ({}))
    return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
  }
  await new Promise((r) => setTimeout(r, 2000))
  const T = (await op("open", { url: SITE, task: "speed", summary: "Timing calls" }))?.tab
  check("an agent's page opens", typeof T === "number")
  const snap = (await op("snapshot", { tab: T }))?.snapshot ?? ""
  const refOf = (name) => new RegExp(`(?:button|link|textbox) "${name}" \\[ref=(e\\d+)\\]`).exec(snap)?.[1]
  const [add, load, still, who] = ["Add note", "Load notes", "Do nothing", "Customer"].map(refOf)

  const results = []
  async function time(label, fn, runs = N) {
    const ms = []
    let last
    for (let i = 0; i < runs; i++) {
      const t = performance.now()
      last = await fn(i)
      ms.push(performance.now() - t)
    }
    ms.sort((a, b) => a - b)
    results.push({ label, p50: Math.round(ms[Math.floor(ms.length / 2)]), min: Math.round(ms[0]), max: Math.round(ms.at(-1)) })
    check(`${label} works`, !last?.error, last)
    return last
  }
  await time("tabs", () => op("tabs", {}))
  await time("read", () => op("read", { tab: T }))
  await time("snapshot", () => op("snapshot", { tab: T }))
  await time("evaluate 1+1", () => op("evaluate", { tab: T, expression: "1+1" }))
  await time("screenshot", () => op("screenshot", { tab: T }))
  await time("wait (text there)", () => op("wait", { tab: T, text: "Lighthouse" }))
  const added = await time("act click (DOM change)", () => op("act", { tab: T, action: "click", ref: add }))
  check("a click's change is answered", /Note \d/.test(JSON.stringify(added)), added)
  await time("act click (no change)", () => op("act", { tab: T, action: "click", ref: still }))
  await time("act click, diff none", () => op("act", { tab: T, action: "click", ref: add, diff: "none" }))
  const loaded = await time("act click (100 ms fetch)", () => op("act", { tab: T, action: "click", ref: load }))
  check("a click's fetch is waited for", /Gate code 4417/.test(JSON.stringify(loaded)), loaded)
  await time("act click by name", () => op("act", { tab: T, action: "click", name: "Add note" }))
  await time("act fill", (i) => op("act", { tab: T, action: "fill", ref: who, value: `Alice Park ${i}` }))
  await time("act press Tab", () => op("act", { tab: T, action: "press", key: "Tab" }))
  await time("navigate (same page)", () => op("navigate", { tab: T, to: SITE }))
  await time("navigate, diff none", () => op("navigate", { tab: T, to: SITE, diff: "none" }))
  await time("open + close", async () => { const o = await op("open", { url: `${SITE}next`, task: "speed" }); await op("close", { tab: o.tab }); return o }, 4)
  for (const url of (process.env.REAL ?? "").split(" ").filter(Boolean)) {
    const host = new URL(url).hostname.replace(/^www\./, "")
    await time(`navigate ${host}`, () => op("navigate", { tab: T, to: url }), 2)
    await time(`  snapshot`, () => op("snapshot", { tab: T }), 3)
    await time(`  read`, () => op("read", { tab: T }), 3)
    await time(`  evaluate 1+1`, () => op("evaluate", { tab: T, expression: "1+1" }), 3)
  }
  console.log("\nop                          p50    min    max (ms)")
  for (const r of results) console.log(`${r.label.padEnd(26)} ${String(r.p50).padStart(5)}  ${String(r.min).padStart(5)}  ${String(r.max).padStart(5)}`)
} finally {
  await app.close().catch(() => {})
  site.close()
  await done()
}
