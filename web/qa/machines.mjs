// Machines: two throwaway servers that list each other (.vaultite/plugins/machines/data.json in each vault), the app on
// the first. The machines block and view (both listed, the first one "this one"), a shell on the second from the first
// (typed into, answering from there: its VAULTITE_URL), the Terminals panel listing it with the machine's name, the tab
// saying where it runs, "Choose where…" offering the other machine, and ending it from here.
// Runs shells on this machine through both servers: throwaway servers only.
//   node web/qa/machines.mjs <base url> <other machine's id> <other machine's base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, terminalText, until } from "./lib/qa.mjs"
const { args: [B, OTHER, OTHER_URL, OUT = "/tmp/machines-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const other = (await (await fetch(new URL("api/machines", B.endsWith("/") ? B : `${B}/`))).json()).find((m) => m.id === OTHER)
if (!other?.online) { console.error(`the other machine '${OTHER}' isn't listed or doesn't answer`); process.exit(2) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage(), { console: true })
const text = () => terminalText(page)

// The machines view: both, this one said.
await page.goto(`${B}#view/machines`)
check("machines view lists both", await until(async () => (await page.locator("[data-machine]").count()) >= 2, 8000))
check("this one is said", (await page.locator(`[data-machine]`, { hasText: "This one" }).count()) === 1)
await page.screenshot({ path: `${OUT}machines.png` })

// A shell on the other machine, from this one.
const sid = `qa${Date.now().toString(36)}`
await page.goto(`${B}#view/terminal%2F${sid}%40${OTHER}`)
check("the other machine's terminal is drawn", await until(async () => (await page.locator(".xterm-screen").count()) > 0, 8000))
await until(async () => /%|\$|❯/.test(await text()), 8000)
await page.locator(".xterm").click()
await page.keyboard.type("echo at-$VAULTITE_URL"); await page.keyboard.press("Enter")
const port = new URL(OTHER_URL).port
check("it runs there", await until(async () => new RegExp(`^at-http://127\\.0\\.0\\.1:${port}\\s*$`, "m").test(await text()), 8000), (await text()).slice(-300))
check("its tab says where", await until(async () => (await page.locator("[role=tab]", { hasText: other.label }).count()) > 0 ||
  (await page.getByText(`· ${other.label}`).count()) > 0, 8000))
await page.screenshot({ path: `${OUT}remote-terminal.png` })

// The Terminals panel lists it, with the machine's name.
check("the Terminals panel lists it with its machine", await until(async () => (await page.locator(`[data-session="${sid}@${OTHER}"][data-machine="${OTHER}"]`).count()) > 0, 10000))

// Choose where: the other machine is offered.
await page.locator('[aria-label="New terminal or agent"]').first().click()
await page.getByText("Choose where…").click()
const where = page.getByPlaceholder("Where to open it…")
check("choose where opens", await until(async () => (await where.count()) > 0, 8000))
const rows = await page.evaluate(() => [...document.querySelectorAll("[role=option]")].map((o) => o.textContent))
const self = (await (await fetch(new URL("api/machines", B.endsWith("/") ? B : `${B}/`))).json()).find((m) => m.self)
check("choose where offers a terminal here and on the other machine", rows.some((r) => r.startsWith("Terminal") && r.endsWith(self.label)) &&
  rows.some((r) => r.startsWith("Terminal") && r.endsWith(other.label)), rows)
await page.screenshot({ path: `${OUT}choose-where.png` })
await page.keyboard.press("Escape")

// Ending it from here ends it there.
const ws = new WebSocket(`${B.replace(/^http/, "ws").replace(/\/$/, "")}/api/terminal/${sid}%40${OTHER}?end=1`)
await new Promise((r) => { ws.onclose = r; setTimeout(r, 3000) })
const gone = await until(async () => {
  const l = new WebSocket(`${OTHER_URL.replace(/^http/, "ws").replace(/\/$/, "")}/api/terminals`)
  const list = await new Promise((r) => { l.onmessage = (e) => { r(JSON.parse(e.data).list ?? []); l.close() }; setTimeout(() => r(null), 2000) })
  return Array.isArray(list) && !list.some((s) => s.id === sid)
}, 8000)
check("ending it from here ends it there", gone)

await done()
