// An agent's act answers what it did (electron/browser/agent.ts act, settle, quiet): a page that goes elsewhere a moment
// after the click, a web component's shadow DOM changing, a fetch still running while an iframe navigates, and the first
// act in a page seeing its requests. Never "nothing changed" when something did.
// WRITES: the throwaway vault only.
//   node web/qa/agentsettle.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agentsettle-"))
keepAwake(300)

const PAGE = `<!doctype html><title>Lighthouse</title><style>body{font:18px system-ui;margin:40px}</style>
<h1>Lighthouse orders</h1>
<button id="late">Open order 1042</button>
<button id="shadow">Show status</button>
<button id="slow">Load notes</button>
<order-status></order-status>
<iframe id="f" src="/frame" width="200" height="60"></iframe>
<p id="notes"></p>
<script>
customElements.define("order-status", class extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<span id=s>Status unknown</span>" }
})
late.onclick = () => setTimeout(() => { location.href = "/order" }, 300)
shadow.onclick = () => setTimeout(() => { document.querySelector("order-status").shadowRoot.querySelector("#s").textContent = "Ships Tuesday" }, 150)
slow.onclick = () => {
  setTimeout(() => { f.src = "/frame?" + Date.now() }, 100)
  fetch("/slow").then((r) => r.text()).then((t) => { notes.textContent = t })
}
</script>`
const site = http.createServer((q, res) => {
  const send = (body) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body) }
  if (q.url === "/order") return send("<!doctype html><title>Order 1042</title><h1>Order 1042</h1><p>Ships Tuesday from the Lisbon depot.</p>")
  if (q.url.startsWith("/frame")) return send("<!doctype html><p>frame</p>")
  if (q.url === "/slow") return setTimeout(() => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("Gate code 4417") }, 900)
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
  const T = (await op("open", { url: SITE, task: "settle", summary: "Checking an order" }))?.tab
  check("an agent's page opens", typeof T === "number")
  const refOf = async (name) => new RegExp(`button "${name}" \\[ref=(e\\d+)\\]`).exec((await op("snapshot", { tab: T }))?.snapshot ?? "")?.[1]
  const text = (r) => JSON.stringify(r)

  // A fetch with an iframe navigating meanwhile: its answer waits for the fetch (the frame's navigation doesn't end it).
  const slow = await op("act", { tab: T, action: "click", ref: await refOf("Load notes") })
  check("the first act waits for its fetch, an iframe navigating meanwhile", /Gate code 4417/.test(text(slow)), slow)

  // Shadow DOM: its change is waited for.
  const sh = await op("act", { tab: T, action: "click", ref: await refOf("Show status") })
  check("a change in a shadow root is waited for", /Ships Tuesday/.test(text(sh)), sh)

  // A navigation its script starts 300 ms after the click.
  const late = await op("act", { tab: T, action: "click", ref: await refOf("Open order 1042") })
  check("a navigation set off after the click is waited for", late?.navigated === true && /order/.test(late?.url ?? ""), late)
} finally {
  await app.close().catch(() => {})
  site.close()
  await done()
}
