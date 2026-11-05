// What the browser tools answer on the made-up sites, with no agent: each page's snapshot, read and open sizes, and a
// few acts (fill replacing, a control by name, text by where it's drawn, paste). Cheap, so run it on every change.
//   node tools/browser-evals/probe.mjs [--app <checkout>] [--show]   (--show prints each answer)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { startSites } from "./sites.mjs"

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const SHOW = process.argv.includes("--show")
const APP = path.resolve(arg("app", path.join(path.dirname(new URL(import.meta.url).pathname), "../..")))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-probe-"))
const VAULT = path.join(TMP, "vault")
await new Promise((ok) => spawn(process.execPath, [path.join(APP, "bin/vau"), "sandbox", VAULT], { stdio: "ignore" }).on("exit", ok))
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const { _electron } = createRequire(path.join(APP, "package.json"))("playwright-core")
const app = await _electron.launch({ executablePath: path.join(APP, "node_modules/.bin/electron"), args: [APP, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") } })
const win = await app.firstWindow()
await win.waitForSelector("[role=tree]", { timeout: 90000 })
const ORIGIN = new URL(win.url()).origin
await new Promise((r) => setTimeout(r, 3000))
const sites = await startSites()
/** An op as vau prints it: its text answer. */
const op = async (id, params) => {
  const r = await fetch(`${ORIGIN}/api/ops/web-viewer.${id}?as=text`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) })
  const t = await r.text()
  try { const j = JSON.parse(t); return typeof j.text === "string" ? j.text : typeof j.error === "string" ? `error: ${j.error}` : t } catch { return t }
}
const rows = []
const note = (what, text) => { rows.push([what, text.length]); if (SHOW) console.log(`\n===== ${what} (${text.length})\n${text}`) }
try {
  for (const page of ["/mail", "/drive", "/doc/d6", "/doc/d8", "/billing", "/billing/invoices/INV-2026-10", "/settings", "/orders"]) {
    const opened = await op("open", { url: sites.url + page, task: "probe" })
    note(`open ${page}`, opened)
    const tab = Number(/Tab (\d+)/.exec(opened)?.[1])
    note(`snapshot ${page}`, await op("snapshot", { tab }))
    note(`read ${page}`, await op("read", { tab }))
    note(`read --main ${page}`, await op("read", { tab, main: true }))
    if (page === "/settings") {
      note("fill email by name", await op("act", { tab, action: "fill", name: "Notification email", value: "alice@lighthouse.test" }))
      note("fill form by names", await op("act", { tab, action: "fill", fields: [{ name: "Time zone", value: "America/Chicago" }, { name: "Weekly digest email", value: "false" }] }))
      note("click save by name", await op("act", { tab, action: "click", name: "Save settings" }))
      await new Promise((r) => setTimeout(r, 1200))
      const s = sites.state.settings
      console.log(`settings: ${s.email} ${s.timezone} digest ${s.digest} saves ${s.saves} ${s.email === "alice@lighthouse.test" && s.timezone === "America/Chicago" && !s.digest && s.saves ? "OK" : "WRONG"}`)
    }
    if (page === "/doc/d8") {
      note("click text Goals", await op("act", { tab, action: "click", name: "Goals" }))
      note("style heading 2", await op("act", { tab, action: "select", name: "Paragraph style", value: "Heading 2" }))
      note("dblclick recieve", await op("act", { tab, action: "dblclick", name: "recieve" }))
      note("type receive", await op("act", { tab, action: "type", value: "receive" }))
      note("save", await op("act", { tab, action: "click", name: "Save" }))
      await new Promise((r) => setTimeout(r, 800))
      console.log("doc:", JSON.stringify(sites.state.outreach.blocks.slice(0, 3)))
    }
    if (page === "/mail") {
      note("snapshot --find harbor", await op("snapshot", { tab, find: "harbor" }))
      note("run with args", await op("run", { tab, args: { q: "harbor" }, script: `await act({ action: "fill", name: "Search mail", value: args.q }); await act({ action: "press", key: "Enter" }); await wait({ text: "conversations" }); return (await read()).split("\\n").filter((l) => /Harbor/.test(l)).length` }))
    }
    if (page === "/billing/invoices/INV-2026-10") {
      note("download the invoice", await op("download", { tab, url: "/billing/invoices/INV-2026-10.pdf" }))
      const got = await op("act", { tab, action: "click", name: "View receipt" })
      note("click a link to a new tab", got)
      const t2 = Number(/Opened tab (\d+)/.exec(got)?.[1])
      if (t2) await op("close", { tab: t2 })
    }
    await op("close", { tab })
  }
} finally {
  console.log(rows.map(([w, n]) => `${String(n).padStart(7)}  ${w}`).join("\n"))
  console.log(`total ${rows.reduce((s, [, n]) => s + n, 0)}`)
  sites.server.close()
  await app.close().catch(() => {})
  fs.rmSync(TMP, { recursive: true, force: true })
}
