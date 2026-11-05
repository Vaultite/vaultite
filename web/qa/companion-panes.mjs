// Companion beyond notes: its cursor points at the app's UI (look --ui) and at a terminal pane's row (look --pane --find),
// and lights it; dropped on a terminal it's a point (with that row's text) and a follow, whose command's end comes as a
// change moment; a watch of a note tells it once what it waits for is there.
// WRITES "QA companion panes/", the companion's data.json, folders.json: throwaway server only.
//   node web/qa/companion-panes.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { PROMPT, qa, terminalText, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/companion-panes-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins/watches/data.json"), keep(".vaultite/plugins.json"), keep(".vaultite/folders.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const until = async (pred, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await pred()) return true; await wait(100) } return false }

const plugins = JSON.parse(existsSync(file(".vaultite/plugins.json")) ? readFileSync(file(".vaultite/plugins.json"), "utf8") : "{}")
if (!(plugins.enabled ?? []).includes("companion")) { writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2)); await wait(1500) }
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
const DIR = "QA companion panes"
rmSync(file(DIR), { recursive: true, force: true })
await op("companion.next", { timeout: 0 })

const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
const sid = `qa${Date.now().toString(36)}`
await page.goto(`${B}#view/terminal%2F${sid}`)
check("a terminal drawn", await until(async () => (await page.locator(".xterm-screen").count()) > 0))
await until(async () => PROMPT.test(await terminalText(page)), 8000)
const pane = await page.evaluate(() => document.querySelector("[data-ui^='pane:'] [data-terminal]")?.closest("[data-ui]")?.getAttribute("data-ui")?.slice(5))
check("its pane carries its tab's id (data-ui pane:<id>)", !!pane, pane)
await page.locator(".xterm").click()
await page.keyboard.type("echo needle-17"); await page.keyboard.press("Enter")
await until(async () => /^needle-17\s*$/m.test(await terminalText(page)))
// (the window has told the server its panes)
await until(async () => { const r = await op("companion.look", { pane }); return !r.error }, 6000)
const cursor = page.locator('.companion-cursor[data-agent="Claude"]')
// (where it's going: its spring writes where it is on the way)
const tip = () => cursor.evaluate((el) => { const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(el.dataset.to ?? ""); return m ? { x: Number(m[1]) + 3, y: Number(m[2]) + 2 } : null })

// The app's own UI by its id.
const ui = await page.evaluate(() => ["button:switcher:open", "button:sidebar:toggle", "button:tab:new"].find((id) => [...document.querySelectorAll(`[data-ui="${id}"]`)].some((e) => e.getClientRects().length)))
let r = await op("companion.look", { ui })
await wait(900)
const box = await page.evaluate((id) => { const e = [...document.querySelectorAll(`[data-ui="${id}"]`)].find((x) => x.getClientRects().length); const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }, ui)
let at = await tip()
check("look --ui: its cursor goes to that part of the app", !!at && at.x >= box.left - 2 && at.x <= box.right + 2 && at.y >= box.top - 2 && at.y <= box.bottom + 2, { ui, r, at, box })

// A terminal's row by its text, lit.
r = await op("companion.look", { pane, find: "needle-17" })
await wait(900)
const row = await page.evaluate(() => {
  const host = document.querySelector("[data-terminal]"), lines = host.terminalText().split("\n"), s = host.querySelector(".xterm-screen").getBoundingClientRect()
  const i = lines.findLastIndex((l) => l.includes("needle-17")), h = s.height / lines.length
  return { top: s.top + i * h, bottom: s.top + (i + 1) * h }
})
at = await tip()
check("look --pane --find: its cursor goes to the terminal's row with that text", !!at && at.y >= row.top - 4 && at.y <= row.bottom + 4, { r, at, row })
await wait(700)
const [moved, to] = await cursor.evaluate((el) => [el.style.translate, el.dataset.to])
const [mx, my] = moved.split(" ").map(parseFloat), [tx, ty] = to.split(",").map(Number)
check("its cursor, moved by the cursor's spring, settles where it was going", Math.abs(mx - tx) < 1.5 && Math.abs(my - ty) < 1.5, { moved, to })
r = await op("companion.highlight", { pane, find: "needle-17" })
check("highlight in a terminal: its row lit in its colour", await until(async () => (await page.locator("[data-companion-highlight]").count()) > 0, 3000), r)
await op("companion.say", { text: "That's the line.", pane, find: "needle-17" })
check("say in a pane: its bubble there", await until(async () => (await page.locator("[data-companion-bubble]").count()) > 0, 3000))
await page.screenshot({ path: `${OUT}terminal.png` })

// Dropped on the terminal: a point with that row's words, and a follow.
await op("companion.next", { timeout: 0 })
await op("companion.look", { pane })
await wait(900)
const grip = page.locator('.companion-cursor[data-agent="Claude"] [data-companion-grip]')
const g = await grip.boundingBox()
await page.mouse.move(g.x + 5, g.y + 5); await page.mouse.down()
await page.mouse.move(g.x + 40, g.y + 40, { steps: 4 }); await page.mouse.move(row.top ? 300 : 300, (row.top + row.bottom) / 2, { steps: 6 }); await page.mouse.up()
r = await op("companion.next", { timeout: 4 })
const point = r.moments?.find((m) => m.kind === "point")
check("dropped on a terminal: a point at its row, with what's there", point?.pane === pane && point.row > 0 && /needle-17/.test(point.text ?? ""), r.moments)
const st = await op("companion.status")
check("and it follows that pane", st.follows?.some((f) => f.pane === pane), st.follows)
check("the point comes with what the terminal shows now (the look)", (r.notes ?? []).some((e) => e.pane === pane && /needle-17/.test(e.text ?? "")), r.notes)

// The follow: a command's end, its new output.
await page.locator(".xterm").click()
await page.keyboard.type("sleep 1; echo done-$((40+2))"); await page.keyboard.press("Enter")
check("(the command ran)", await until(async () => /^done-42\s*$/m.test(await terminalText(page)), 6000), (await terminalText(page)).slice(-300))
let change = null
for (let i = 0; i < 6 && !change; i++) { r = await op("companion.next", { timeout: 5 }); change = r.moments?.find((m) => m.kind === "change") }
check("a command's end in a followed terminal comes as a change, with its new output", change?.pane === pane && (change.changes ?? []).some((l) => l.includes("done-42")), r)
check("only once: no change while nothing happens", !(await op("companion.next", { timeout: 4 })).moments?.some((m) => m.kind === "change"))
await op("companion.unfollow", { id: pane })

// A watch: a note's text, told once what it waits for is there.
await api("PUT", "file", { path: `${DIR}/Order.md`, text: "Status: packing\n" })
await api("PATCH", "config/folders", { watches: `${DIR}/Watches` })
r = await op("watches.add", { source: `note:${DIR}/Order.md`, until: "shipped", why: "Tell me when it ships", title: "Order" })
check("a watch is a file in the folder set for watches (folders.json)", existsSync(file(`${DIR}/Watches/Order.md`)), r)
await wait(1200)
await api("PUT", "file", { path: `${DIR}/Order.md`, text: "Status: packed\n" })
await wait(1200)
await api("PUT", "file", { path: `${DIR}/Order.md`, text: "Status: shipped\n" })
let hit = null
for (let i = 0; i < 4 && !hit; i++) { r = await op("companion.next", { timeout: 4 }); hit = r.moments?.find((m) => m.kind === "watch") }
check("what it waited for comes to the companion as a watch moment (not the packed in between)", !!hit && (hit.changes ?? []).some((l) => l.includes("shipped")) && hit.text === "Tell me when it ships", r)
check("and it's done", (await op("watches.list")).find?.((w) => w.title === "Order")?.state === "done")
await op("watches.remove", { id: "Order" })

await op("companion.clear")
await ctx.close()
rmSync(file(DIR), { recursive: true, force: true })
for (const f of restore) f()
await done()
