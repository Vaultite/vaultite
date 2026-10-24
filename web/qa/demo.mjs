// The web demo (npm run build:demo): the app with its server in the browser. Serves web/dist-demo under /demo/ (or uses
// <demo url>, a demo served elsewhere: not "base url", which tools/qa.ts fills with an app server's) and checks, in Chrome and WebKit, it starts, opens a note, Vaultite's own plugins' pages and search, keeps an edit across a reload,
// refuses a plugin that needs a machine, opens on a bundle (?bundle=), that the sample's files were edited across the
// weeks before (also once a reload brings them back from IndexedDB), and that Reset brings the sample back.
// WRITES: only the browser profile it makes.
//   node web/qa/demo.mjs [<demo url>]
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { ROOT, launch, qa, wait } from "./lib/qa.mjs"
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

/** The whole visit in one engine: WebKit too, since Safari runs the demo's workers its own way. */
async function visit(name, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.stack || e.message))
  ctx.on("weberror", (e) => errors.push(String(e.error())))
  const api = (method, p, body) => page.evaluate(async ([method, p, body]) => {
    const r = await fetch(`api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, [method, p, body])
  const drawn = () => page.waitForFunction(() => document.getElementById("vau-boot-error") || document.querySelector("#root [data-pane]"), null, { timeout: 30000 })
    .then(() => page.evaluate(() => document.getElementById("vau-boot-error")?.innerText ?? "")).catch(() => "nothing drawn in 30 s")
  const open = async (file) => { await page.goto("about:blank"); await page.goto(`${base}#view/files/file/${encodeURIComponent(file)}`); await drawn(); await wait(1500) }
  const shown = () => page.evaluate(() => document.querySelector("[data-pane]")?.innerText ?? "")
  const is = (what, ok, got) => check(`${name}: ${what}`, ok, got)
  /** How many of the sample's notes were last edited on each day (a calendar by `updated`). */
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
  is("a note opens in the editor", (await page.locator(".cm-content").count()) > 0 && (await shown()).includes("Lisbon"), (await shown()).slice(0, 200))

  // (the pages of Vaultite's own plugins the sample turns on, built in here)
  for (const name of ["Today", "Health", "Learning", "Projects"]) {
    const at = (await api("GET", "files")).json?.files?.find((f) => f.plugin === name.toLowerCase() && f.type === "dashboard")?.path
    await open(at)
    is(`${name} draws its blocks`, at && (await page.locator("[data-pane] [data-block]").count()) > 0, at ?? `no ${name} page`)
  }

  const found = await api("POST", "ops/file.search", { query: "Lisbon" })
  is("search finds a note", found.status === 200 && JSON.stringify(found.json).includes("Lisbon trip"), found)

  const fresh = await editDays()
  is("the sample's notes were edited across the weeks before", spread(fresh), fresh)

  const refused = await api("PATCH", "config/plugins", { disabled: [] })
  is("a plugin that needs a machine isn't turned on", refused.status === 403 && /needs the Vaultite app/.test(refused.json?.error), refused)

  await page.goto("about:blank")
  await page.goto(`${base}?bundle=zen`)
  await drawn()
  const bundles = (await api("GET", "bundles")).json, plugins = (await api("GET", "config/plugins")).json
  is("?bundle= starts on that bundle", bundles?.previous?.bundle === "zen" && !plugins?.enabled?.includes("dispatch"),
    { previous: bundles?.previous, enabled: plugins?.enabled })

  // The coding agents of Vaultite's own plugins (built in here) draw their made-up sessions and limits, as the app's do.
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

  // Browser: on the web the new tab is the quick switcher, its panels and guide there, nothing broken.
  await page.goto("about:blank")
  await page.goto(`${base}?bundle=browser`)
  is("?bundle=browser starts", !(await drawn()))
  const web = (await api("GET", "demo/bundle/browser")).json, nt = (await api("GET", "config/newtab")).json
  is("...on Browser: its panels, the switcher for a new tab", (await api("GET", "bundles")).json?.previous?.bundle === "browser" && nt?.opens === "switcher" &&
    await page.locator("aside[data-side=left] [data-panel]").count() > 0 && !web?.problems?.length, { web, nt })

  // Vaultite's own plugins are built in (vite.demo.config.ts): Days (as the directory's Life OS) installs Books in the app; here it's there.
  const DAYS = path.join(ROOT, "tools/fixtures/bundles/days")
  const daysFiles = Object.fromEntries(fs.readdirSync(DAYS, { recursive: true }).filter((f) => fs.statSync(path.join(DAYS, f)).isFile())
    .map((f) => [f, f.endsWith(".json") ? JSON.parse(fs.readFileSync(path.join(DAYS, f), "utf8")) : fs.readFileSync(path.join(DAYS, f), "utf8")]))
  const imported = await api("POST", "bundles/import", { file: { vaultite: "bundle", format: 1, id: "days", files: daysFiles } })
  await wait(1000) // (the demo keeps its files a moment later)
  await page.goto("about:blank")
  await page.goto(`${base}?bundle=days`)
  await drawn()
  const books = ((await api("GET", "state")).json?.books ?? []).length, life = (await api("GET", "demo/bundle/days")).json
  is("Vaultite's own plugins are built in: Days turns Books on, with the sample's books", imported.status === 200 && books >= 3 && life?.on?.includes("Books") && !life?.notInDemo?.includes("Books") &&
    (await api("GET", "config/plugins")).json?.enabled?.includes("books"), { books, life })
  is("...and Today, Health, Learning and Projects", ["Today", "Health", "Learning", "Projects"].every((n) => life?.on?.includes(n) && !life?.notInDemo?.includes(n)), life)
  const shelf = (await api("GET", "files")).json?.files?.find((f) => f.path.endsWith("Books/Piranesi.md"))?.path
  await open(shelf)
  is("a book draws its block", (await page.locator("[data-pane] [data-block]").count()) > 0, shelf)
  const wanted = await api("POST", "bundles/import/preview", { file: { vaultite: "bundle", format: 1, id: "shelf", files: {
    "bundle.json": { name: "Shelf" }, "plugins.json": { enabled: ["books", "lighthouse"], install: { books: { source: "Vaultite/plugins/books" }, lighthouse: { source: "alicepark/lighthouse" } } } } } })
  const code = (wanted.json?.plan?.code ?? []).map((c) => c.id), missing = wanted.json?.plan?.plugins?.missing ?? []
  is("a bundle installing Vaultite's own gets the built-in one here, others' are left out", wanted.status === 200 && !code.length && !missing.includes("books"), wanted.json?.plan)

  const MARK = "Edited in the demo"
  await open("Notes/Lisbon trip.md")
  await page.locator(".cm-content").click()
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type(`\n${MARK}\n`)
  await wait(2500) // (autosave)
  await open("Notes/Lisbon trip.md")
  is("an edit is kept across a reload", (await shown()).includes(MARK), (await shown()).slice(-300))
  is("and the server has it", JSON.stringify((await api("GET", "file?path=Notes%2FLisbon%20trip.md")).json).includes(MARK))
  const kept = await editDays()
  is("and the notes' edit times came back with them", spread(kept), kept)

  await page.getByRole("button", { name: "Reset" }).click()
  await page.locator("[data-confirm] button", { hasText: "Reset" }).click()
  await page.waitForURL((u) => !u.hash, { timeout: 10000 }).catch(() => {})
  await drawn()
  await open("Notes/Lisbon trip.md")
  is("Reset brings the sample back", !(await shown()).includes(MARK) && (await shown()).includes("Lisbon"), (await shown()).slice(-300))
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
