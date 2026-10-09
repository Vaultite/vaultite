// The web demo (npm run build:demo): the app with its server in the browser. Serves web/dist-demo under /demo/ (or uses
// <base url>) and checks, in Chrome and WebKit, it starts, opens a note, Today and search, keeps an edit across a reload,
// refuses a plugin that needs a machine, opens on a bundle (?bundle=), and that Reset brings the sample back.
// WRITES: only the browser profile it makes.
//   node web/qa/demo.mjs [<base url>]
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

  await page.goto(base)
  const screen = await drawn()
  is("starts", !screen, screen)
  is("says it's a demo", await page.getByText("Demo: your edits stay in this browser").isVisible())
  is("the sample's pins are in the sidebar", await page.getByText("Start here").first().waitFor({ timeout: 10000 }).then(() => true, () => false))

  await open("Notes/Lisbon trip.md")
  is("a note opens in the editor", (await page.locator(".cm-content").count()) > 0 && (await shown()).includes("Lisbon"), (await shown()).slice(0, 200))

  const today = (await api("GET", "files")).json?.files?.find((f) => f.plugin === "today" && f.type === "dashboard")?.path
  await open(today)
  is("Today draws its blocks", today && (await page.locator("[data-pane] [data-block]").count()) > 0, today ?? "no Today page")

  const found = await api("POST", "ops/file.search", { query: "Lisbon" })
  is("search finds a note", found.status === 200 && JSON.stringify(found.json).includes("Lisbon trip"), found)

  const refused = await api("PATCH", "config/plugins", { disabled: [] })
  is("a plugin that needs a machine isn't turned on", refused.status === 403 && /needs the Vaultite app/.test(refused.json?.error), refused)

  await page.goto("about:blank")
  await page.goto(`${base}?bundle=everything`)
  await drawn()
  const bundles = (await api("GET", "bundles")).json, plugins = (await api("GET", "config/plugins")).json
  is("?bundle= starts on that bundle, what needs a machine still off", bundles?.previous?.bundle === "everything" && !plugins?.enabled?.includes("machines"),
    { previous: bundles?.previous, enabled: plugins?.enabled })

  const MARK = "Edited in the demo"
  await open("Notes/Lisbon trip.md")
  await page.locator(".cm-content").click()
  await page.keyboard.press("ControlOrMeta+End")
  await page.keyboard.type(`\n${MARK}\n`)
  await wait(2500) // (autosave)
  await open("Notes/Lisbon trip.md")
  is("an edit is kept across a reload", (await shown()).includes(MARK), (await shown()).slice(-300))
  is("and the server has it", JSON.stringify((await api("GET", "file?path=Notes%2FLisbon%20trip.md")).json).includes(MARK))

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
