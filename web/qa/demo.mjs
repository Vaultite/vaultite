// The web demo (npm run build:demo) in Chrome and WebKit, under /demo/ or at <demo url>, not the base url tools/qa.ts fills.
// WRITES only the browser profile it makes.
//   node web/qa/demo.mjs [<demo url>]
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { ROOT, launch, qa, until, wait } from "./lib/qa.mjs"
const { check, done } = await qa(import.meta.url, { chrome: false })

const DIST = path.join(ROOT, "web/dist-demo")
let base = process.argv[2], server = null
if (!base) {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("demo: no web/dist-demo (npm run build:demo first)"); process.exit(1) }
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" }
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/demo\//, "")
    const file = path.join(DIST, rel || "index.html")
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end() }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" })
    res.end(fs.readFileSync(file))
  })
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
  base = `http://127.0.0.1:${server.address().port}/demo/`
}

async function visit(name, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  // (WebKit fails the fetches a page leaving had going "due to access control checks": the old page's, not an error)
  const errors = []
  let leaving = false
  page.on("pageerror", (e) => { if (!leaving) errors.push(e.stack || e.message) })
  ctx.on("weberror", (e) => { if (!leaving) errors.push(String(e.error())) })
  const leave = async () => { leaving = true; await page.goto("about:blank").finally(() => { leaving = false }) }
  const api = (method, p, body) => page.evaluate(async ([method, p, body]) => {
    const r = await fetch(`api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, [method, p, body])
  const drawn = () => page.waitForFunction(() => document.getElementById("vau-boot-error") || document.querySelector("#root [data-pane]"), null, { timeout: 30000 })
    .then(() => page.evaluate(() => document.getElementById("vau-boot-error")?.innerText ?? "")).catch(() => "nothing drawn in 30 s")
  const open = async (file) => { await leave(); await page.goto(`${base}#view/files/file/${encodeURIComponent(file)}`); await drawn() }
  const shown = () => page.evaluate(() => document.querySelector("[data-pane]")?.innerText ?? "")
  const is = (what, ok, got) => check(`${name}: ${what}`, ok, got)
  const editDays = async () => {
    const days = {}
    for (const f of (await api("GET", "files")).json?.files ?? []) {
      if (!f.path.endsWith(".md") || f.path.startsWith(".")) continue
      const d = new Date(f.mtime), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      days[day] = (days[day] ?? 0) + 1
    }
    return days
  }
  const spread = (days) => Object.keys(days).length >= 10 && Math.max(...Object.values(days)) <= 15

  await page.goto(base)
  const screen = await drawn()
  is("starts", !screen, screen)
  is("says it's a demo", await page.getByText("Demo: your edits stay in this browser").isVisible())
  is("the sample's pins are in the sidebar", await page.getByText("Start here").first().waitFor({ timeout: 10000 }).then(() => true, () => false))

  await open("Notes/Lisbon trip.md")
  is("a note opens in the editor", await until(async () => (await page.locator(".cm-content").count()) > 0 && (await shown()).includes("Lisbon"), 15000), (await shown()).slice(0, 200))

  for (const name of ["Today", "Health", "Learning", "Projects"]) {
    const at = (await api("GET", "files")).json?.files?.find((f) => f.plugin === name.toLowerCase() && f.type === "dashboard")?.path
    await open(at)
    is(`${name} draws its blocks`, !!at && await until(async () => (await page.locator("[data-pane] [data-block]").count()) > 0, 15000), at ?? `no ${name} page`)
  }

  const found = await api("POST", "ops/file.search", { query: "Lisbon" })
  is("search finds a note", found.status === 200 && JSON.stringify(found.json).includes("Lisbon trip"), found)

  const fresh = await editDays()
  is("the sample's notes were edited across the weeks before", spread(fresh), fresh)

  const refused = await api("PATCH", "config/plugins", { disabled: [] })
  is("a plugin that needs a machine isn't turned on", refused.status === 403 && /needs the Vaultite app/.test(refused.json?.error), refused)

  await leave()
  await page.goto(`${base}?bundle=zen`)
  await drawn()
  const bundles = (await api("GET", "bundles")).json, plugins = (await api("GET", "config/plugins")).json
  is("?bundle= starts on that bundle", bundles?.previous?.bundle === "zen" && !plugins?.enabled?.includes("dispatch"),
    { previous: bundles?.previous, enabled: plugins?.enabled })

  const AGENTS = ["cursor", "opencode", "openclaw", "hermes"]
  await api("PATCH", "config/plugins", { enabled: [...new Set([...plugins?.enabled ?? [], ...AGENTS])] })
  const nowOn = (await api("GET", "config/plugins")).json?.enabled ?? []
  const agentsOn = AGENTS.filter((id) => nowOn.includes(id))
  const made = await Promise.all(agentsOn.map(async (id) => [id, (await api("GET", `${id}?days=30`)).json?.sessions?.length ?? 0]))
  const cursorLimits = (await api("GET", "cursor?days=30")).json?.limits?.windows?.length ?? 0
  is("the coding agents of Vaultite's own, turned on, draw made-up sessions (Cursor's limits too)", agentsOn.length === 4 && made.every(([, n]) => n > 0) && cursorLimits > 0,
    { agentsOn, made, cursorLimits })
  await open("Dashboards/Agents.md")
  const titles = ["Search results page", "Retry failed uploads", "Plan the Lighthouse launch", "Map tiles flicker"]
  const drew = await page.waitForFunction((ts) => ts.every((t) => document.querySelector("[data-pane]")?.innerText.includes(t)), titles, { timeout: 15000 }).then(() => true, () => false)
  is("the Agents page draws them", drew, (await shown()).slice(0, 600))

  await leave()
  await page.goto(`${base}?bundle=browser`)
  is("?bundle=browser starts", !(await drawn()))
  const web = (await api("GET", "demo/bundle/browser")).json, nt = (await api("GET", "config/newtab")).json
  is("...on Browser: its panels, the switcher for a new tab", (await api("GET", "bundles")).json?.previous?.bundle === "browser" && nt?.opens === "switcher" &&
    await page.locator("aside[data-side=left] [data-panel]").count() > 0 && !web?.problems?.length, { web, nt })

  await page.goto("about:blank")
  await page.goto(`${base}?bundle=research`)
  await drawn()
  is("?bundle=research opens its paper, its citations in APA and its references beside it",
    await until(async () => decodeURIComponent(page.url()).includes("Papers/Paper machines/Draft.md") && (await page.locator(".cm-citation").count()) > 3 &&
      (await page.locator("[data-references-panel] [data-reference]").count()) > 10, 30000) &&
    /\(Bush, 1945\)/.test(await page.locator(".cm-citation").first().innerText()), page.url())

  const DAYS = path.join(ROOT, "tools/fixtures/bundles/days")
  const daysFiles = Object.fromEntries(fs.readdirSync(DAYS, { recursive: true }).filter((f) => fs.statSync(path.join(DAYS, f)).isFile())
    .map((f) => [f, f.endsWith(".json") ? JSON.parse(fs.readFileSync(path.join(DAYS, f), "utf8")) : fs.readFileSync(path.join(DAYS, f), "utf8")]))
  const imported = await api("POST", "bundles/import", { file: { vaultite: "bundle", format: 1, id: "days", files: daysFiles } })
  await wait(1000)
  await leave()
  await page.goto(`${base}?bundle=days`)
  await drawn()
  const books = ((await api("GET", "state")).json?.books ?? []).length, life = (await api("GET", "demo/bundle/days")).json
  is("Vaultite's own plugins are built in: Days turns Books on, with the sample's books", imported.status === 200 && books >= 3 && life?.on?.includes("Books") && !life?.notInDemo?.includes("Books") &&
    (await api("GET", "config/plugins")).json?.enabled?.includes("books"), { books, life })
  is("...and Today, Health, Learning and Projects", ["Today", "Health", "Learning", "Projects"].every((n) => life?.on?.includes(n) && !life?.notInDemo?.includes(n)), life)
  const shelf = (await api("GET", "files")).json?.files?.find((f) => f.path.endsWith("Books/Piranesi.md"))?.path
  await open(shelf)
  is("a book draws its block", await until(async () => (await page.locator("[data-pane] [data-block]").count()) > 0, 15000), shelf)
  const wanted = await api("POST", "bundles/import/preview", { file: { vaultite: "bundle", format: 1, id: "shelf", files: {
    "bundle.json": { name: "Shelf" }, "plugins.json": { enabled: ["books", "lighthouse"], install: { books: { source: "Vaultite/plugins/books" }, lighthouse: { source: "alicepark/lighthouse" } } } } } })
  const code = (wanted.json?.plan?.code ?? []).map((c) => c.id), missing = wanted.json?.plan?.plugins?.missing ?? []
  is("a bundle installing Vaultite's own gets the built-in one here, others' are left out", wanted.status === 200 && !code.length && !missing.includes("books"), wanted.json?.plan)

  const MARK = "Edited in the demo"
  const saved = async () => JSON.stringify((await api("GET", "file?path=Notes%2FLisbon%20trip.md")).json).includes(MARK)
  await open("Notes/Lisbon trip.md")
  await page.locator(".cm-content").click({ timeout: 15000 })
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type(`\n${MARK}\n`)
  const autosaved = await until(saved, 15000)
  const history = () => api("GET", "history?path=Notes%2FLisbon%20trip.md").then((r) => r.json)
  is("file history kept its text from before the edit", await until(async () => (await history())?.versions?.length > 0, 15000), await history())
  await open("Notes/Lisbon trip.md")
  is("an edit is kept across a reload", await until(async () => (await shown()).includes(MARK), 15000), (await shown()).slice(-300))
  is("and the server has it", autosaved && await saved())
  const kept = await editDays()
  is("and the notes' edit times came back with them", spread(kept), kept)

  await page.getByRole("button", { name: "Reset" }).click()
  await page.locator("[data-confirm] button", { hasText: "Reset" }).click()
  await page.waitForURL((u) => !u.hash, { timeout: 10000 }).catch(() => {})
  await drawn()
  await open("Notes/Lisbon trip.md")
  is("Reset brings the sample back", await until(async () => { const t = await shown(); return !t.includes(MARK) && t.includes("Lisbon") }, 15000), (await shown()).slice(-300))

  const pageOf = async (id, hash = "") => { await leave(); await page.goto(`${base}?desk=page&bundle=gh:Vaultite/vaultite/bundles/${id}${hash}`); await drawn() }
  const NOTE = "Only on Zen's page.md", has = async () => (await api("GET", `file?path=${encodeURIComponent(NOTE)}`)).status === 200
  const on = async () => (await api("GET", "bundles")).json?.previous?.bundle
  await pageOf("zen")
  is("a built-in bundle's page opens the demo's own copy, not GitHub's", (await on()) === "zen")
  is("...and keeps what's written there", (await api("POST", "file", { path: NOTE, text: "here" })).status === 201 && await has())
  await pageOf("browser")
  is("another bundle's page has none of it", (await on()) === "browser" && !(await has()))
  is("...the Browser's opens its live sites", await page.waitForFunction(() => location.hash.startsWith("#view/web"), null, { timeout: 15000 }).then(() => true, () => false), page.url())
  await leave()
  await page.goto(base)
  await drawn()
  is("nor the main demo", !(await has()) && (await on()) !== "browser")
  await pageOf("zen", "#file/Start%20here.md")
  is("back on the first page, it's still there", await has())
  await page.getByRole("button", { name: "Reset" }).click()
  await page.locator("[data-confirm] button", { hasText: "Reset" }).click()
  await page.waitForURL((u) => !u.hash, { timeout: 10000 }).catch(() => {})
  await drawn()
  is("Reset there starts that bundle again", !(await has()) && (await on()) === "zen" && page.url().includes("bundle=gh"), page.url())
  is("throws nothing", !errors.length, errors.slice(0, 5))
  await browser.close()
}

try {
  await visit("chrome", await launch())
  const { webkit } = await import("playwright-core")
  if (fs.existsSync(webkit.executablePath())) await visit("webkit", await webkit.launch())
  else console.log("webkit: skipped (npx playwright-core install webkit)")
} finally {
  server?.close()
}
await done()
