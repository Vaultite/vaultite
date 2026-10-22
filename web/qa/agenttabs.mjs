// Agents' states in their tabs, on a list the page is fed (the sessions socket stood in for: five Claude Code sessions
// working, waiting on you, done with an unread Inbox row, done with nothing for you and failed, and a plain shell): the
// Terminals panel lists the ones that need you first, in bold; each keeps Claude's logo, its state a dot on its corner
// (breathing, yellow, blue, none, red), on the desktop's tab bar, the Tabs panel and the phone's tab list.
// Writes workspaces (the tabs it opens): throwaway server only.
//   node web/qa/agenttabs.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/agenttabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const vault = (await (await fetch(new URL("/api/vault", B))).json()).path
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: vault } })
// (what it uses, whatever the sandbox hid: Workspaces, so the phone shares the tabs, and the Terminals and Tabs panels)
vau("plugin", "on", "workspaces")
for (const p of ["terminals", "tabs"]) if (!new RegExp(`\\d+\\. \\w+:${p === "terminals" ? "sessions" : "tabs"}`).test(vau("panels", "--vault"))) vau("panels", "show", p, "--vault")
await wait(1500)

const now = Date.now(), id = `qa${now.toString(36)}`
const agent = (n, more) => ({ id: `claude-${id}${n}`, agent: "claude", process: "claude", busy: true, clients: 1, started: now - 60000 * (5 - n), backend: "vaultite", ...more })
const [working, blocked, unseen, seen, failed] = [
  agent(1, { state: "working", title: "Working one" }),
  agent(2, { state: "blocked", kind: "permission", msg: "Run npm test?", title: "Blocked one" }),
  agent(3, { state: "done", needs: true, title: "Unseen one" }),
  agent(4, { state: "done", title: "Seen one" }),
  agent(0, { state: "error", title: "Failed one" }),
]
const shell = { id: `${id}5`, agent: null, process: "zsh", busy: false, clients: 0, started: now, backend: "vaultite" }
const LIST = JSON.stringify({ t: "sessions", list: [working, blocked, unseen, seen, failed, shell] })
async function standIn(page) {
  // The list as above; each terminal's own socket answers as attached.
  await page.routeWebSocket(/\/api\/terminals(\?.*)?$/, (ws) => { ws.send(LIST) })
  await page.routeWebSocket(/\/api\/terminal\/[^/?]+/, (ws) => {
    ws.send(JSON.stringify({ t: "attached", fresh: false, tmux: false, scrollback: 1000 }))
    ws.send(JSON.stringify({ t: "size", cols: 80, rows: 24 }))
  })
}

const D = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await standIn(D)
await D.goto(B)
await D.waitForSelector("[role=tree]", { timeout: 60000 })
await until(async () => !!(await D.$(`[data-session="${working.id}"]`)), 10000)

// ---------- the Terminals panel: needs you first ----------
const rows = await D.$$eval("[data-session]", (els) => els.map((e) => ({ id: e.dataset.session, needs: e.dataset.needs !== undefined, bold: e.className.includes("font-semibold"),
  dot: e.querySelector("[data-dot]")?.dataset.dot ?? null, icon: e.querySelector("svg")?.getAttribute("class") ?? "" })))
const order = rows.map((r) => r.id)
check("Terminals: the ones that need you first (waiting, then with an unread row), then working, then at rest, then shells",
  JSON.stringify(order) === JSON.stringify([blocked.id, unseen.id, working.id, seen.id, failed.id, shell.id]), order)
const row = (s) => rows.find((r) => r.id === s.id)
check("Terminals: those that need you are bold", [blocked, unseen].every((s) => row(s)?.bold) && [working, seen, failed].every((s) => !row(s)?.bold), rows)
const dots = Object.fromEntries([working, blocked, unseen, seen, failed].map((s) => [s.title, row(s)?.dot]))
check("Terminals: Claude's logo on each, its state a dot: working, ask, unread, none, error",
  JSON.stringify(dots) === JSON.stringify({ "Working one": "working", "Blocked one": "ask", "Unseen one": "unread", "Seen one": null, "Failed one": "error" })
  && [working, seen].every((s) => !/working-dot|lucide-check/.test(row(s)?.icon)), dots)
const ambient = await D.$eval('[data-ambient] > [data-status-key$="agents"]', (e) => e.innerText.trim()).catch(() => "")
check("status bar: agents at work count what Terminals says needs you (blocked and an unread row)", ambient === "1 · 2 need you", ambient)

// ---------- tabs: each session opened from its row ----------
for (const s of [working, blocked, unseen, seen, failed]) { await D.click(`[data-session="${s.id}"]`); await wait(400) }
const look = (page, sel) => page.$$eval(sel, (els) => els.map((e) => ({ text: e.innerText.trim().split("\n")[0], dot: e.querySelector("[data-dot]")?.dataset.dot ?? "none" })))
const states = (list) => Object.fromEntries(list.filter((x) => / one$/.test(x.text)).map((x) => [x.text, x.dot]))
const WANT = JSON.stringify({ "Working one": "working", "Blocked one": "ask", "Unseen one": "unread", "Seen one": "none", "Failed one": "error" })
const bar = states(await look(D, "[data-tab-bar] [data-tab-id]"))
check("tab bar: working, ask, unread, none, error", JSON.stringify(bar) === WANT, bar)
const panel = states(await look(D, "[data-open-tab]"))
check("Tabs panel: the same", JSON.stringify(panel) === WANT, panel)
await D.screenshot({ path: `${OUT}desktop.png` })

// ---------- the phone's tab list ----------
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const P = watch(await pctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await standIn(P)
// (each opened here by its address: a session's tab that the server doesn't run isn't kept in the workspace)
for (const s of [working, blocked, unseen, seen, failed]) {
  await P.goto("about:blank")
  await P.goto(`${B}#view/${encodeURIComponent(`terminal/${s.id}`)}`)
  await P.waitForSelector("[data-tabs-button]", { timeout: 60000 })
  await wait(1200)
}
await P.click("[data-tabs-button]")
await P.waitForSelector("[data-tab-row]")
await until(async () => Object.keys(states(await look(P, "[data-tab-row]"))).length === 5, 10000)
const cards = states(await look(P, "[data-tab-row]"))
check("phone tab list: the same", JSON.stringify(cards) === WANT, cards)
await P.screenshot({ path: `${OUT}phone.png` })
await done()
