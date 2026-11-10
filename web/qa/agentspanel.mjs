// The Agents panel (the terminals socket, the chats route and the machines stood in for): offered once in the right
// sidebar, every agent in one flat list (needs you, working, done) with its state's glyph and a short time, older ones
// folded under Earlier, the filter on the tab only, a click opening its tab, and a phone's drawer; rows holding still
// while the pointer, a menu or a finger is in the list, and settling once it's let go. Writes the sidebars: throwaway
// server only.
//   node web/qa/agentspanel.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/agentspanel-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
// (Machines on, whatever the sandbox has: its machines name the rows; the panel hidden, to be offered)
vau("plugin", "on", "machines")
vau("panels", "hide", "agents", "--vault")
await wait(1000)

const now = Date.now(), id = `qa${now.toString(36)}`
const MACHINES = [
  { id: "home", label: "M1", url: "http://home.invalid", online: true, self: true, plugins: ["claude-code", "terminal"] },
  { id: "laptop", label: "M4", url: "http://laptop.invalid", online: true, self: false, plugins: ["claude-code", "terminal"] },
  { id: "box", label: "Mini PC", url: "http://box.invalid", online: true, self: false, plugins: ["terminal"] },
]
const term = (n, more) => ({ id: `claude-${id}${n}`, agent: "claude", process: "claude", busy: true, clients: 1, started: now - 60000 * (9 - n), backend: "vaultite", ...more })
const T = {
  asks: term(1, { state: "blocked", kind: "permission", msg: "Run npm test?", title: "Fix the upload test" }),
  works: term(2, { state: "working", title: "Write the release notes", machine: "laptop", machineLabel: "M4" }),
  rests: term(3, { state: "idle", title: "Tidy the Lighthouse README", machine: "box", machineLabel: "Mini PC", session: "took-over" }),
}
const shell = { id: `${id}9`, agent: null, process: "zsh", busy: false, clients: 1, started: now, backend: "vaultite" }
const chat = (cid, more) => ({ id: cid, cwd: "/Users/alice/lighthouse", by: "app", started: now - 600000, at: now - 300000, asks: [], turn: null, model: "", effort: "", mode: "auto", account: "default", seq: 0, told: 0, ...more })
const C = {
  asks: chat("c-asks", { state: "waiting", title: "Plan the Lighthouse launch", asks: ["a1"], at: now - 120000 }),
  works: chat("c-works@laptop", { state: "working", title: "Summarize Alice's notes", turn: { prompt: "Summarize Alice's notes from this week", text: "" } }),
  rests: chat("c-rests", { state: "idle", title: "Companion", by: "companion", at: now - 3600000 }),
  // the session a terminal took over: shown once, as the terminal
  dup: chat("took-over@box", { state: "idle", title: "Tidy the Lighthouse README" }),
}
const LIST = JSON.stringify({ t: "sessions", list: [...Object.values(T), shell] })
// (the one at rest asking now: sorted, it goes up to the second row)
const ASKS = JSON.stringify({ t: "sessions", list: [T.asks, T.works, { ...T.rests, state: "blocked", kind: "permission", msg: "Push?" }, shell] })

/** Stands in for the server; says a new terminals list to the page's sockets. */
async function standIn(page) {
  const socks = new Set()
  await page.routeWebSocket(/\/api\/terminals(\?.*)?$/, (ws) => { socks.add(ws); ws.send(LIST) })
  await page.routeWebSocket(/\/api\/terminal\/[^/?]+/, (ws) => {
    ws.send(JSON.stringify({ t: "attached", fresh: false, tmux: false, scrollback: 1000 }))
    ws.send(JSON.stringify({ t: "size", cols: 80, rows: 24 }))
  })
  await page.routeWebSocket(/\/api\/claude-code\/chat\/[^/?]+$/, (ws) => ws.send(JSON.stringify({ t: "hello", found: true, s: C.works, title: C.works.title,
    cwd: C.works.cwd, account: "default", model: "", effort: "", tui: null, driven: "", history: { entries: [], start: 0 }, live: [] })))
  await page.route(/\/api\/claude-code\/chats(\?.*)?$/, (r) => r.fulfill({ json: { sessions: Object.values(C) } }))
  await page.route(/\/api\/machines(\?.*)?$/, (r) => r.fulfill({ json: MACHINES }))
  return (list) => { for (const ws of socks) try { ws.send(list) } catch { socks.delete(ws) } }
}
const rowsOf = (page, scope) => page.$$eval(`${scope} [data-agent-run]`, (els) => els.map((e) => ({
  id: e.dataset.agentRun, kind: e.dataset.kind, state: e.dataset.state, text: e.innerText.trim().replace(/\s+/g, " "),
  where: e.querySelector("[data-agent-where]")?.textContent ?? "", when: e.querySelector("[data-agent-when]")?.textContent ?? "", tip: e.dataset.tip ?? "", dot: e.querySelector("[data-dot]")?.dataset.dot ?? null, bold: e.className.includes("font-medium") })))

// ---------- desktop: offered in the right sidebar, in its order ----------
const D = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const sayD = await standIn(D)
await D.goto(B)
await D.waitForSelector("[role=tree]", { timeout: 60000 })
const shown = await until(async () => !!(await D.$("[data-agents-panel] [data-agent-run]")), 15000)
const sides = await until(() => /Right sidebar:\n\s+1\. agents:agents/.test(vau("panels", "--vault")), 5000)
check("Agents: offered once an agent runs, at the top of the right sidebar", shown && sides, vau("panels", "--vault").split("\nHidden")[0])
await until(async () => (await rowsOf(D, "[data-agents-panel]")).length === 5, 10000)
const rows = await rowsOf(D, "[data-agents-panel]")
const order = rows.map((r) => r.id)
const want = [`terminal:${T.asks.id}`, "chat:c-asks", `terminal:${T.works.id}`, "chat:c-works@laptop", `terminal:${T.rests.id}`, "chat:c-rests"]
check("Agents: needs you, then working, then done lately, one list (a chat a terminal took over once)", JSON.stringify(order) === JSON.stringify(want.slice(0, 5)), order)
const panelText = await D.locator("[data-agents-panel]").innerText()
const heads = (await D.$$("[data-agents-panel] [data-agent-where]")).length + (/Needs you|Working|Done|All|M1|M4|Mini PC/.test(panelText) ? 1 : 0)
check("Agents: no group headings, filter or machine names on the rows", heads === 0, panelText)
const by = Object.fromEntries(rows.map((r) => [r.id, r]))
check("Agents: the machine and kind said in each row's tooltip", by[`terminal:${T.works.id}`]?.tip.includes("on M4") && by[`terminal:${T.rests.id}`]?.tip.includes("In a terminal"), rows.map((r) => r.tip))
check("Agents: its state as the glyph (ask, working, none at rest), the ones that need you stronger",
  JSON.stringify(rows.map((r) => [r.dot, r.bold])) === JSON.stringify([["ask", true], ["ask", true], ["working", false], ["working", false], [null, false]]), rows.map((r) => [r.dot, r.bold]))
check("Agents: a short time at the end of the ones not asking", rows.slice(2).every((r) => /^(now|\d+(m|h|d|mo))$/.test(r.when)) && rows[0].when === "", rows.map((r) => r.when))
check("Agents: what each is doing", by[`terminal:${T.works.id}`]?.text.includes("Write the release notes") && by["chat:c-works@laptop"]?.text.includes("Summarize Alice's notes"), rows)
await D.locator("[data-agents-panel]").screenshot({ path: `${OUT}panel.png` })

// ---------- earlier ones fold ----------
const earlier = D.locator("[data-agents-panel] [data-agent-earlier]")
check("Agents: the one done an hour ago folded under Earlier 1, closed", (await earlier.innerText().catch(() => "")).replace(/\s+/g, " ").trim() === "Earlier 1"
  && (await earlier.getAttribute("data-agent-earlier")) === "closed")
await earlier.click()
await wait(300)
const all = await rowsOf(D, "[data-agents-panel]")
check("Agents: opening Earlier shows it, last and dimmer", JSON.stringify(all.map((r) => r.id)) === JSON.stringify(want), all.map((r) => r.id))
await D.locator("[data-agents-panel]").screenshot({ path: `${OUT}panel-earlier.png` })
await earlier.click()
await wait(300)
check("Agents: and closing it folds it again", (await rowsOf(D, "[data-agents-panel]")).length === 5)

// ---------- nothing moves under the pointer ----------
const R = `terminal:${T.rests.id}`
const resorted = [`terminal:${T.asks.id}`, R, "chat:c-asks", `terminal:${T.works.id}`, "chat:c-works@laptop"]
const ids = async (p = D, scope = "[data-agents-panel]") => (await rowsOf(p, scope)).map((r) => r.id)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const away = () => D.mouse.move(900, 450)
await D.hover(`[data-agents-panel] [data-agent-run="terminal:${T.works.id}"]`)
await wait(200)
sayD(ASKS)
const asked = await until(async () => (await rowsOf(D, "[data-agents-panel]")).find((r) => r.id === R)?.dot === "ask", 5000)
await wait(1000)
check("Agents: a row starting to ask under the pointer says so in its place, nothing moving", asked && same(await ids(), order), await ids())
await away()
check("Agents: once the pointer leaves, it settles into its place", await until(async () => same(await ids(), resorted), 5000), await ids())
// (a row's menu open, the pointer gone to it: still held)
await D.click(`[data-agents-panel] [data-agent-run="${R}"]`, { button: "right" })
await D.waitForSelector("[role=menu]", { timeout: 5000 }).catch(() => {})
await away()
sayD(LIST)
await until(async () => (await rowsOf(D, "[data-agents-panel]")).find((r) => r.id === R)?.dot === null, 5000)
await wait(1200)
const menued = (await D.locator("[role=menu]").count()) > 0
check("Agents: nor while a row's menu is open", menued && same(await ids(), resorted), { menued, ids: await ids() })
await D.keyboard.press("Escape")
check("Agents: and settles once it closes", await until(async () => same(await ids(), order), 5000), await ids())

// ---------- a click opens it in its own place ----------
const active = () => D.$eval("[data-tab-bar] [data-tab-id][aria-selected=true], [data-tab-bar] [data-tab-id][data-active]", (e) => e.dataset.tabId).catch(() => "")
const hash = () => D.evaluate(() => decodeURIComponent(location.hash))
await D.click(`[data-agent-run="terminal:${T.works.id}"]`)
await wait(800)
check("Agents: a terminal's row opens its terminal tab", (await hash()).includes(`terminal/${T.works.id}`), await hash())
check("Agents: its row is the active one then", !!(await D.$(`[data-agents-panel] [data-agent-run="terminal:${T.works.id}"].font-medium`)), await active())
await D.click(`[data-agent-run="chat:c-works@laptop"]`)
await wait(800)
check("Agents: a chat's row opens its chat tab", (await hash()).includes("claude-session/c-works@laptop"), await hash())
await D.screenshot({ path: `${OUT}desktop.png` })

// ---------- as a tab ----------
await D.goto("about:blank")
await D.goto(`${B}#view/agents`)
await D.waitForSelector("[data-agents-view] [data-agent-run]", { timeout: 15000 })
await wait(500)
const seg = await D.$$eval("[data-agents-view] [role=radio]", (els) => els.map((e) => e.textContent))
check("Agents tab: All, Terminals and Chats to pick from, with counts", JSON.stringify(seg) === JSON.stringify(["All", "Terminals3", "Chats3"]), seg)
const step = await D.$eval(`[data-agents-view] [data-agent-run="terminal:${T.asks.id}"] [data-agent-step]`, (e) => e.textContent).catch(() => "")
check("Agents tab: what it asks spelled out", step === "Run npm test?", step)
await D.screenshot({ path: `${OUT}tab.png` })
await D.close()

// ---------- a phone: the same list in its drawer ----------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const P = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
const sayP = await standIn(P)
await P.goto(B)
await wait(2000)
// (the right sidebar's panels are the right drawer's)
await P.locator("[data-phone-header] button[aria-label='Open right sidebar']").tap()
await wait(800)
const phone = await rowsOf(P, "[data-phone-drawer] [data-agents-panel]").catch(() => [])
check("phone: the drawer lists them in the same order", JSON.stringify(phone.map((r) => r.id)) === JSON.stringify(want.slice(0, 5)), phone.map((r) => r.id))
const tall = await P.$eval("[data-phone-drawer] [data-agent-run]", (e) => e.getBoundingClientRect().height).catch(() => 0)
check("phone: rows at the sidebar's phone size (40px)", tall >= 39.5, tall)
// (a finger has no hover: a touch holds the list, a moment past it)
await P.locator("[data-phone-drawer] [data-agent-earlier]").tap()
sayP(ASKS)
await wait(1000)
const held = await ids(P, "[data-phone-drawer] [data-agents-panel]")
check("phone: just after a touch, rows hold still", same(held.slice(0, 5), want.slice(0, 5)), held)
const later = await until(async () => same((await ids(P, "[data-phone-drawer] [data-agents-panel]")).slice(0, 5), resorted), 6000)
check("phone: and settle a moment later", later, await ids(P, "[data-phone-drawer] [data-agents-panel]"))
await P.locator("[data-phone-drawer] [data-agents-panel]").screenshot({ path: `${OUT}phone.png` }).catch(() => P.screenshot({ path: `${OUT}phone.png` }))
await ctx.close()
await done()
