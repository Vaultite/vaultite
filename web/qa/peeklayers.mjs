// A hidden sidebar slid in covers what floats over the page: a comment card in the margin, an agent's cursor, the find
// bar (index.css' --z-page-float); its toggle and a menu opened in it stay over it.
// WRITES "QA peek layers/", appearance.json, sidebars.json and the companion's data.json (put back): throwaway server only.
//   node web/qa/peeklayers.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/peeklayers-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const appearance = await api("GET", "config/appearance")
const sidebars = await api("GET", "config/sidebars")

const plugins = JSON.parse(text(".vaultite/plugins.json") || "{}")
if (!(plugins.enabled ?? []).includes("companion")) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2))
  await wait(1500)
}
const DIR = "QA peek layers", NOTE = `${DIR}/Garden.md`, W = 1440
rmSync(file(DIR), { recursive: true, force: true })
try {
  await api("PATCH", "config/plugin/companion", { mode: "quiet", comments: null })
  await api("PUT", "config/appearance", { ...appearance, rails: false, peekShade: false })
  await api("PUT", "config/sidebars", { left: ["search:search", "pages:pages"], right: ["files:files"], collapsed: [] })
  await api("PUT", "file", { path: NOTE, text: `# Garden\n\nTomatoes along the fence, where it's sunny.\n\n${"Basil between them keeps the aphids off, and it smells of summer. ".repeat(4)}\n\nBee.\n` })
  await op("companion.clear")
  // Both sidebars hidden and as wide as they go, so each covers the text's margin when it slides in.
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 } })
  await ctx.addInitScript(() => {
    try {
      const was = JSON.parse(localStorage.getItem("vaultite.prefs") || "{}")
      localStorage.setItem("vaultite.prefs", JSON.stringify({ ...was, sidebar: false, rightSidebar: false, sidebarWidth: 480, rightSidebarWidth: 480 }))
    } catch { /* about:blank */ }
  })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}/#file/${encodeURIComponent(NOTE)}`)
  const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
  await editor.waitFor({ timeout: 10000 })
  await wait(1000)
  const id = (await op("companion.comment", { path: NOTE, find: "Tomatoes", text: "@claude how is it going?" })).id
  await op("companion.look", { path: NOTE, find: "Basil" })
  const card = page.locator(`[data-companion-note="${id}"]`)
  await card.waitFor({ timeout: 5000 }).catch(() => {})
  check("a comment card in the margin", (await card.count()) === 1)
  // (the agent looks at the long paragraph's first row: its cursor at the row's end, in the right margin)
  const cursor = page.locator(".companion-cursor[data-agent] [data-companion-grip]").first()
  await cursor.waitFor({ timeout: 5000 }).catch(() => {})
  await wait(900)
  const peeks = (s) => page.evaluate((s) => document.querySelector(`aside[data-side=${s}]`).dataset.peek === "true", s)

  /** What's on top at a box's centre, and whether it's in the slid-in sidebar. */
  const top = (sel, side) => page.evaluate(([sel, side]) => {
    const el = document.querySelector(sel), aside = document.querySelector(`aside[data-side=${side}]`)
    if (!el) return { missing: sel }
    const r = el.getBoundingClientRect(), a = aside.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return { x: Math.round(x), y: Math.round(y), a: [Math.round(a.left), Math.round(a.right)], under: x > a.left && x < a.right && y > a.top && y < a.bottom, sidebar: !!hit?.closest(`aside[data-side=${side}]`),
      self: !!hit && (el === hit || el.contains(hit)), hit: hit && `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}` }
  }, [sel, side])
  const slide = async (side) => {
    await page.mouse.move(W / 2, 450)
    await until(async () => !(await peeks("left")) && !(await peeks("right")), 3000)
    await wait(400)
    await page.mouse.move(side === "left" ? 1 : W - 1, 450, { steps: 6 })
    check(`${side}: slides in at its edge`, await until(() => peeks(side), 2000))
    await wait(500)
    await page.mouse.move(side === "left" ? 240 : W - 240, 860)
    await wait(100)
  }

  // Before: nothing slid in, the card and the cursor are on top where they are.
  check("hidden: the card is on top", (await top(`[data-companion-note="${id}"]`, "right")).self)
  check("hidden: the cursor is on top", (await top(".companion-cursor[data-agent] [data-companion-grip]", "right")).self)

  await slide("right")
  const c = await top(`[data-companion-note="${id}"]`, "right")
  check("right slid in: it covers the card", c.under && c.sidebar, c)
  const k = await top(".companion-cursor[data-agent] [data-companion-grip]", "right")
  check("right slid in: it covers the agent's cursor", k.under && k.sidebar, k)
  const t = await top("[data-sidebar-toggle=right]", "right")
  check("right slid in: its toggle rides over it", t.self, t)
  await page.screenshot({ path: `${OUT}right.png`, clip: { x: W - 720, y: 0, width: 720, height: 400 } })
  // A menu opened in the sidebar is over it.
  await page.locator("aside[data-side=right] [data-titlebar]").click({ button: "right", position: { x: 120, y: 20 } }).catch(() => {})
  await until(() => page.locator("[role=menu]").count(), 2000)
  const m = await top("[role=menu]", "right")
  check("right slid in: a menu opened in it is over it", m.self, m)
  await page.keyboard.press("Escape")

  // (now at the end of a short line, by the text's left edge)
  await op("companion.look", { path: NOTE, find: "Bee." })
  await wait(900)
  await slide("left")
  const l = await top(".companion-cursor[data-agent] [data-companion-grip]", "left")
  check("left slid in: it covers the agent's cursor", l.under && l.sidebar, l)
  await page.screenshot({ path: `${OUT}left.png`, clip: { x: 0, y: 0, width: 720, height: 400 } })

  // A page's find bar (a dashboard's: a note's is CodeMirror's, in the pane) is the page's too.
  const DASH = `${DIR}/Board.md`
  await api("PUT", "file", { path: DASH, text: "---\ntype: dashboard\n---\n\nA marmot up top.\n" })
  await page.mouse.move(W / 2, 450)
  await page.goto("about:blank")
  await page.goto(`${B}/#file/${encodeURIComponent(DASH)}`)
  await wait(2500)
  await page.locator("#main-scroll").click({ position: { x: 400, y: 300 } })
  await page.keyboard.press("ControlOrMeta+f")
  await page.locator("[data-page-find]").waitFor({ timeout: 3000 }).catch(() => {})
  await slide("right")
  const f = await top("[data-page-find]", "right")
  check("right slid in: it covers the find bar", f.under && f.sidebar, f)
} finally {
  await api("PUT", "config/appearance", appearance)
  await api("PUT", "config/sidebars", sidebars)
  await op("companion.clear").catch(() => {})
  rmSync(file(DIR), { recursive: true, force: true })
  for (const r of restore) r()
  await browser.close()
}
await done()
