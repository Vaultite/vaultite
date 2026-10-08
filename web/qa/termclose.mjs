// Closing a terminal's tab isn't ending its shell. A shell running something (here `sleep`, and a bash script, which the
// pty names "bash", like `mo`) keeps running when its last tab closes (a toast offers End it; the Terminals panel lists
// it as detached); a shell at its prompt ends; the
// same terminal open in two workspaces keeps running when one of its tabs closes (no toast); End session in the tab's
// menu asks, then ends it and closes the tab. Graph view (the Local graph panel's button) opens beside a terminal,
// never in its tab, and dragging the Local graph panel's heading onto a pane opens it as a tab. Runs shells and writes
// workspaces: throwaway server only.
//   node web/qa/termclose.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait, workspaceKey } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/termclose-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
// What it uses, whatever the vault turned off or hid (the sandbox starts calm): Workspaces, and the Terminals panel.
const vault = (await (await fetch(new URL("/api/vault", B))).json()).path
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: vault } })
vau("plugin", "on", "workspaces")
await wait(1500)
if (!/\d+\. terminal:sessions/.test(vau("panels", "--vault"))) vau("panels", "show", "terminals", "--vault")
const id = `qa${Date.now().toString(36)}`
const [busy, idle, both, script] = [`${id}a`, `${id}b`, `${id}c`, `${id}d`]
const qamo = path.join(OUT, "qamo")
writeFileSync(qamo, "#!/bin/bash\nsleep 600\n"); chmodSync(qamo, 0o755)

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
const sessions = () => page.evaluate(() => new Promise((res) => {
  const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminals`)
  s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === "sessions") { s.close(); res(Object.fromEntries(m.list.map((x) => [x.id, x]))) } }
}))
const tabs = () => page.$$eval("[data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
// (A toast that was there before `forgetToasts` doesn't count. They're React's nodes: marked, never removed, or React
// fails removing one that's gone when it times out, and the app stops.)
const toast = (re) => page.$$eval("[data-sonner-toast]:not([data-qa-seen])", (els, src) => els.some((e) => new RegExp(src).test(e.textContent)), re.source)
const forgetToasts = () => page.$$eval("[data-sonner-toast]", (els) => els.forEach((e) => e.setAttribute("data-qa-seen", "")))
async function closeTab(re) {
  // (By its menu: a lone tab has no X.)
  for (const t of await page.$$("[data-tab-id]")) if (re.test(await t.textContent())) { await t.click({ button: "right" }); await page.getByRole("menuitem", { name: "Close", exact: true }).click(); return true }
  return false
}
const open = async (sid) => { await page.evaluate((s) => { location.hash = `#view/terminal%2F${s}` }, sid); await until(async () => (await sessions())[sid], 8000); await wait(800) }
const end = (sid) => page.evaluate((s) => { new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`) }, sid)

try {
  // Workspaces 1 and 2 start empty (earlier runs leave tabs there).
  for (const n of [1, 2]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
  await page.goto(B); await wait(2000)
  await page.keyboard.press(workspaceKey(1)); await wait(600)

  // A busy shell: its last tab closes, it keeps running, detached, and the toast offers to end it.
  await open(busy)
  await page.keyboard.type("sleep 600\n")
  check("the shell runs sleep, and its tab says so", !!(await until(async () => (await sessions())[busy]?.process === "sleep" && (await tabs()).includes("sleep"), 8000)), await tabs())
  await closeTab(/sleep/)
  check("closing its last tab: still running", !!(await until(async () => (await sessions())[busy] && await toast(/still running/), 6000)))
  check("...listed as detached (no tab shows it)", !!(await until(async () => (await sessions())[busy]?.clients === 0, 6000)), (await sessions())[busy])
  check("...the toast offers End it", await page.$$eval("[data-sonner-toast] button", (b) => b.some((x) => /End it/.test(x.textContent))))

  // A bash script: the pty says "bash", still it runs, named by its script.
  await forgetToasts()
  await open(script)
  await page.keyboard.type(`${qamo}\n`)
  check("a script runs, named by it", !!(await until(async () => (await sessions())[script]?.process === "qamo" && (await sessions())[script]?.busy && (await tabs()).includes("qamo"), 8000)), [(await sessions())[script], await tabs()])
  await closeTab(/qamo/)
  check("closing a script's last tab: still running", !!(await until(async () => (await sessions())[script]?.clients === 0 && await toast(/qamo is still running/), 6000)), (await sessions())[script])

  // An idle shell: its last tab closes, it ends.
  await open(idle)
  await closeTab(/Terminal/)
  check("an idle shell's last tab: it ends", !!(await until(async () => !(await sessions())[idle], 6000)))

  // The same terminal in two workspaces: closing one tab leaves it running, without a toast.
  await open(both)
  await page.keyboard.type("sleep 600\n"); await until(async () => (await tabs()).includes("sleep"), 6000)
  await page.keyboard.press(workspaceKey(2)); await wait(1200)
  await page.click(`aside [data-session='${both}']`, { modifiers: ["ControlOrMeta"] }); await wait(1500)
  check("opened in workspace 2 too", (await tabs()).filter((t) => t === "sleep").length === 1, await tabs())
  await forgetToasts()
  await closeTab(/sleep/); await wait(1500)
  check("closing it in 2: still running, and no toast (1 still has it)", !!(await sessions())[both] && !(await toast(/still running/)))
  await page.keyboard.press(workspaceKey(1)); await wait(1200)
  check("...still a tab in 1", (await tabs()).includes("sleep"), await tabs())

  // Graph view from a terminal tab opens beside it.
  const before = (await tabs()).length
  const local = "aside [data-panel='graph:local']"
  // (Shown from the sidebar's own menu, a hidden panel under More ▸: a panel's has the list under Panels ▸. A checklist:
  // the menu stays open after the tick; Escape closes More ▸, then the menu.)
  if (!(await page.$(local))) {
    await page.click("aside [data-titlebar]", { button: "right" }); await page.hover("[role=menu] > button:has-text('More')"); await wait(300)
    await page.click("[role^=menuitem]:has-text('Local graph')"); await wait(500)
    await until(async () => { await page.keyboard.press("Escape"); return !(await page.$("[role=menu]")) }, 2000, 200)
  }
  if (await page.$(`${local}[data-collapsed]`)) { await page.click(`${local} [data-panel-handle]`); await wait(300) }
  await page.hover(`${local} [data-panel-handle]`); await page.click("aside [aria-label='Open graph view']"); await wait(1000)
  const now = await tabs()
  check("Graph view opens in a new tab, the terminal's stays", now.length === before + 1 && now.includes("Graph view") && now.includes("sleep"), now)

  // Dragging the Local graph heading onto the pane opens it as a tab.
  const h = await (await page.$(`${local} [data-panel-handle]`)).boundingBox()
  await page.mouse.move(h.x + 30, h.y + h.height / 2); await page.mouse.down()
  await page.mouse.move(h.x + 90, h.y - 40, { steps: 5 }); await page.mouse.move(800, 450, { steps: 10 }); await wait(200)
  await page.mouse.up(); await wait(1000)
  check("Local graph dropped on a pane: a tab", (await tabs()).includes("Local graph"), await tabs())
  await page.screenshot({ path: `${OUT}tabs.png` })

  // End session from the tab's menu: asks, then ends it and closes its tab.
  for (const t of await page.$$("[data-tab-id]")) if (/sleep/.test(await t.textContent())) { await t.click({ button: "right" }); break }
  await page.click("[role=menuitem]:has-text('End session')")
  const ask = await until(() => page.$("dialog[open] button:has-text('End it')"), 6000)
  check("End session asks (something runs in it)", !!ask)
  await ask?.click()
  check("...ended, and its tab closed", !!(await until(async () => !(await sessions())[both] && !(await tabs()).includes("sleep"), 6000)), await tabs())
  noErrors()
} finally {
  for (const s of [busy, idle, both, script]) await end(s).catch(() => {})
  await wait(500)
  await browser.close()
}
await done()
