// Artifacts and tables: an .html file opens sandboxed and reads the vault through the bridge, a .csv opens as a table,
// both show inside other files (![[...]]), the theme follows the app, localStorage is kept in the vault, a changed CSV
// redraws the artifact, and the sandbox holds (no network, no reach into the app). WRITES fixtures (QA/ in the vault):
// throwaway server only.
//   node web/qa/artifacts.mjs <base url> <vault path>
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { qa, wait, SHOTS as OUT } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const temp = (p) => [realpathSync("/tmp"), realpathSync(tmpdir())].some((t) => realpathSync(p).startsWith(t + "/"))
if (!temp(VAULT)) { console.error("artifacts: the vault must be a throwaway one in a temporary folder"); process.exit(2) }
mkdirSync(OUT, { recursive: true })
mkdirSync(`${VAULT}/QA`, { recursive: true })

const ART = `<!doctype html>
<html><head><title>QA artifact</title><meta name="vaultite:icon" content="chart-line">
<style>body{font:15px system-ui;margin:16px;background:var(--vau-card, white);color:var(--vau-foreground, black)}</style></head>
<body><h1>QA artifact</h1><p id="rows">loading</p><p id="theme"></p><a id="ext" href="https://example.com/">example</a> <a id="note" href="QA note.md">note</a>
<script>
window.__t = {}
vau.csv("QA table.csv").then((r) => { document.getElementById("rows").textContent = r.length + " rows"; __t.rows = r.length; __t.first = r[0] })
fetch("QA table.csv").then((r) => r.text()).then((t) => { __t.fetched = t.split("\\n")[0] })
vau.on("theme", (t) => { document.getElementById("theme").textContent = t.dark ? "dark" : "light" })
localStorage.setItem("visits", String(Number(localStorage.getItem("visits") || 0) + 1))
__t.visits = localStorage.getItem("visits")
fetch("https://example.com/").then(() => { __t.net = "open" }, () => { __t.net = "blocked" })
fetch("/api/state").then(() => { __t.api = "open" }, () => { __t.api = "blocked" })
try { __t.parent = String(parent.document.title) } catch { __t.parent = "blocked" }
try { __t.cookie = document.cookie; } catch { __t.cookie = "blocked" }
</script></body></html>
`
writeFileSync(`${VAULT}/QA/QA artifact.html`, ART)
writeFileSync(`${VAULT}/QA/QA table.csv`, 'date,amount,note\n2026-01-01,-5.20,"Coffee, large"\n2026-01-02,1200,Pay\n2026-01-03,-42,Groceries\n')
writeFileSync(`${VAULT}/QA/QA note.md`, "# QA note\n\nAn artifact and a table inside a note:\n\n![[QA artifact.html]]\n\n![[QA table.csv]]\n")
writeFileSync(`${VAULT}/QA/QA board.md`, "---\ntype: dashboard\nicon: sun\n---\n\n![[QA artifact.html|300]]\n")

const enc = encodeURIComponent

async function open(width, height, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile })
  return watch(await ctx.newPage(), { label: width })
}
const frameOf = async (page, name = "QA%20artifact.html") => {
  for (let i = 0; i < 40; i++) {
    const f = page.frames().find((x) => x.url().includes(`/v/QA/${name}`))
    if (f) { try { await f.waitForFunction(() => window.__t && window.__t.rows !== undefined && window.__t.net && window.__t.api, null, { timeout: 8000 }); return f } catch { /* still loading */ } }
    await wait(250)
  }
  return null
}

// Desktop: the artifact opened.
let page = await open(1280, 860)
await page.goto(`${B}#file/${enc("QA/QA artifact.html")}`)
await wait(1500)
let f = await frameOf(page)
check("artifact opens in a frame", !!f)
if (f) {
  const t = await f.evaluate(() => window.__t)
  check("reads the CSV through the bridge", t.rows === 3 && t.first?.note === "Coffee, large", t)
  check("fetch() of a vault file works", t.fetched === "date,amount,note", t)
  check("no network", t.net === "blocked", t)
  check("no reach into the app's API", t.api === "blocked", t)
  check("no reach into the app's page", t.parent === "blocked", t)
  check("localStorage works", t.visits === "1", t)
  const box = await page.locator("iframe").first().boundingBox()
  check("frame fills the page", box && box.height > 500 && box.width > 600, box)
}
await wait(800)
let state = null
try { state = JSON.parse(readFileSync(`${VAULT}/.vaultite/artifacts/QA/QA artifact.html.json`, "utf8")) } catch { /* not saved */ }
check("localStorage kept in the vault", state?.visits === "1", state)
await page.screenshot({ path: `${OUT}artifact-desktop.png` })

// Theme: dark, sent to the frame.
await page.evaluate(() => fetch("api/config/appearance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "dark" }) }))
await page.reload()
await wait(1500)
f = await frameOf(page)
if (f) {
  await wait(500)
  const th = await f.evaluate(() => ({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).getPropertyValue("--vau-background").trim(), visits: localStorage.getItem("visits") }))
  check("dark theme reaches the frame", th.attr === "dark" && !!th.bg, th)
  check("localStorage comes back after a reload", th.visits === "2", th)
}
await page.screenshot({ path: `${OUT}artifact-dark.png` })
await page.evaluate(() => fetch("api/config/appearance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "system" }) }))

// Live: the CSV changes on disk, the artifact redraws.
writeFileSync(`${VAULT}/QA/QA table.csv`, readFileSync(`${VAULT}/QA/QA table.csv`, "utf8") + "2026-01-04,-9,Books\n")
let live = false
for (let i = 0; i < 30 && !live; i++) {
  await wait(500)
  const fr = page.frames().find((x) => x.url().includes("/v/QA/"))
  try { live = (await fr?.evaluate(() => window.__t?.rows)) === 4 } catch { /* reloading */ }
}
check("a changed CSV redraws the artifact", live)

// Links: a web link opens a new tab; a vault link opens the note in the app.
if (f) {
  const pop = page.context().waitForEvent("page", { timeout: 4000 }).catch(() => null)
  const fr = page.frames().find((x) => x.url().includes("/v/QA/"))
  await fr.click("#ext")
  const p2 = await pop
  check("web link opens a new tab", !!p2 && p2.url().startsWith("https://example.com"), p2?.url())
  if (p2) await p2.close()
  await fr.click("#note")
  await wait(1200)
  check("vault link opens the note", decodeURIComponent(await page.evaluate(() => location.hash)).includes("QA/QA note.md"), await page.evaluate(() => location.hash))
}

// A note with both embedded, being read.
await page.goto(`${B}#file/${enc("QA/QA note.md")}`)
await page.evaluate(() => localStorage.setItem("vaultite.fileMode", "read"))
await page.reload()
await wait(2000)
f = await frameOf(page)
check("artifact embedded in a note", !!f)
const tableRows = await page.locator(".csv-view tbody tr").count()
check("table embedded in a note", tableRows === 4, tableRows)
await page.screenshot({ path: `${OUT}artifact-embeds.png`, fullPage: true })

// A dashboard with an embed.
await page.goto(`${B}#file/${enc("QA/QA board.md")}`)
await wait(2000)
f = await frameOf(page)
const bh = (await page.locator("iframe").first().boundingBox())?.height
check("artifact in a dashboard, with its height", !!f && Math.abs(bh - 300) < 2, bh)

// The table opened: filter and sort.
await page.goto(`${B}#file/${enc("QA/QA table.csv")}`)
await wait(1500)
check("table opens as a table", (await page.locator(".csv-view tbody tr").count()) === 4)
await page.fill(".csv-view input", "coffee")
check("filter", (await page.locator(".csv-view tbody tr").count()) === 1)
await page.fill(".csv-view input", "")
await page.click(".csv-view th:nth-child(2) button")
const firstAmount = await page.locator(".csv-view tbody tr:first-child td:nth-child(2)").textContent()
check("sort numbers as numbers", firstAmount === "-42", firstAmount)
await page.screenshot({ path: `${OUT}table-desktop.png` })

// Phone: the artifact in the sheet, no sideways scroll.
page = await open(390, 844, true)
await page.goto(`${B}#file/${enc("QA/QA artifact.html")}`)
await wait(2500)
f = await frameOf(page)
check("phone: artifact opens", !!f)
const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check("phone: no sideways scroll", over <= 0, over)
await page.screenshot({ path: `${OUT}artifact-phone.png` })

// As text, for AIs.
const text = await (await fetch(`${B}api/render?path=${enc("QA/QA note.md")}`)).text()
check("render: artifact and table as text", text.includes("Reads: `QA/QA table.csv`") && text.includes("| 2026-01-01 | -5.20 | Coffee, large |"), text.slice(0, 400))

await done()
