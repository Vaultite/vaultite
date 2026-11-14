// A sidebar tab row or tab group row the companion follows shows an eye, whose click stops it; an ask lists the sidebar foot's links.
// WRITES the companion's data.json, plugins.json, sidebars and appearance: throwaway server only.
//   node web/qa/companion-rows.mjs <base url> <vault path> [out dir]
// Paths: plugins/core/companion/panes.ts, plugins/core/companion/pointed.ts, plugins/core/tabs/index.tsx
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/companion-rows-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json"), keep(".vaultite/appearance.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }

const plugins = JSON.parse(existsSync(file(".vaultite/plugins.json")) ? readFileSync(file(".vaultite/plugins.json"), "utf8") : "{}")
if (!(plugins.enabled ?? []).includes("companion")) { writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2)); await wait(1500) }
writeFileSync(file(".vaultite/sidebars.json"), JSON.stringify({ left: ["tabs:tabs", "files:files"], right: [], collapsed: [] }) + "\n")
const look = JSON.parse(existsSync(file(".vaultite/appearance.json")) ? readFileSync(file(".vaultite/appearance.json"), "utf8") : "{}")
writeFileSync(file(".vaultite/appearance.json"), JSON.stringify({ ...look, tabBar: false }) + "\n")
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
const notes = ["Notes/Lisbon trip.md", "Notes/How this vault works.md", "Start here.md"].filter((p) => existsSync(file(p)))
if (notes.length < 3) { console.error("needs the sandbox vault (vau sandbox <folder>)"); process.exit(2) }

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } })
  const page = watch(await ctx.newPage(), { label: "desktop" })
  await page.goto(`${B}/#file/${encodeURIComponent(notes[0])}`)
  await page.waitForSelector("[data-open-tab]")
  let r = await op("tabs.split", { pane: notes[0], to: notes[1] })
  check("a split tab made by its op", !!r.pane, r)
  await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, notes[2])
  await wait(800)
  const list = await op("tabs.list")
  const split = list.tabs?.find((t) => t.panes.length === 2)
  check("listed as one tab of two panes", !!split, list)
  await op("companion.next", { timeout: 0 })
  await until(async () => !(await op("companion.look", { pane: split.panes[0].id })).error, 6000)
  await wait(900)

  await op("companion.follow", { tab: split.id, as: "Claude" })
  const st = await op("companion.status")
  const f = st.follows?.find((x) => x.tab === split.id || split.panes.some((p) => p.id === x.pane))
  check("following a tab: listed", !!f, st.follows)
  const eye = page.locator(`[data-ui="tab:${split.id}"] button[aria-label^="Stop Claude following"]`)
  check("the row shows an eye", await until(async () => (await eye.count()) === 1, 4000))
  await page.screenshot({ path: `${OUT}eye.png` })
  await eye.click()
  check("its click stops following it", await until(async () => !(await op("companion.status")).follows?.some((x) => x.id === f?.id), 4000))
  check("and the eye goes", await until(async () => (await eye.count()) === 0, 4000))

  const g = await op("tabs.group", { tabs: [notes[2]], name: "Lighthouse" })
  const gid = g.group?.id
  await page.waitForSelector(`[data-ui="group:${gid}"]`)
  await op("companion.follow", { group: gid, as: "Claude" })
  check("following a group: listed", await until(async () => (await op("companion.status")).follows?.some((x) => x.group === gid), 4000))
  check("the group's row shows the eye", await until(async () => (await page.locator(`[data-ui="group:${gid}"] button[aria-label^="Stop Claude following"]`).count()) === 1, 4000))
  await op("companion.unfollow", { as: "Claude" })
  await ctx.close()
  noErrors()

  const desk = await browser.newContext({ viewport: { width: 1400, height: 860 } })
  await desk.addInitScript(() => {
    const done = Promise.resolve(undefined)
    const any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? done.then.bind(done) : k === "toJSON" || k === Symbol.toPrimitive ? undefined : any), apply: () => any })
    const bridge = (own) => new Proxy(own, { get: (t, k) => (k in t ? t[k] : any[k]) })
    window.vaultite = bridge({ dictation: bridge({ placeAt: (fn) => { window.qaPlaceAt = fn; return () => {} } }) })
  })
  const app = await desk.newPage()
  await app.goto(`${B}/#file/${encodeURIComponent(notes[0])}`)
  await app.waitForFunction(() => !!window.qaPlaceAt && !!document.querySelector(".cm-line"), null, { timeout: 30_000 })
  const line = await app.locator(".cm-line").nth(1).boundingBox()
  const place = await app.evaluate(([x, y]) => window.qaPlaceAt(x, y), [line.x + 20, line.y + line.height / 2])
  const near = place?.near ?? [], settings = near.find((e) => e.role === "link" && e.label === "Settings")
  const real = await app.locator('[data-sidebar-foot] [data-app-page="settings"]').boundingBox()
  check("an ask over a note lists the sidebar foot's Settings link by name, at its own frame, beside the foot whole",
    !!settings && Math.abs(settings.frame.x - real.x) < 2 && Math.abs(settings.frame.width - real.width) < 2 && near.some((e) => e.role === "navigation" && e.label === "App") && place?.path === notes[0],
    near.map((e) => `${e.role} ${e.label}`))
  await desk.close()
} finally {
  for (const r of restore) r()
}
await done()
