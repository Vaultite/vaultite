// The Agents panel's shelves, chips, marks and stage (the Code workspace), in a sidebar and a phone's drawer.
// Writes the sidebars, appearance and workspaces: throwaway server only.
//   node web/qa/agentspanel.mjs <base url> [out dir]
// core/agentorder.ts, core/steadyrows.tsx, core/files.ts, core/plugins.ts, plugins/core/agents/Rows.tsx, plugins/core/agents/marks.ts, plugins/core/agents/shelves.ts, plugins/core/agents/runs.ts, plugins/core/workspaces/preset.ts, plugins/core/workspaces/code.ts, plugins/core/workspaces/List.tsx
import { mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { routeSocket } from "./lib/sockets.mjs"
import { clearWorkspaces, workspaces } from "./lib/wsfiles.mjs"
const { args: [B, OUT = "/tmp/agentspanel-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
vau("plugin", "on", "machines")
vau("panels", "hide", "agents", "--vault")

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
  dup: chat("took-over@box", { state: "idle", title: "Tidy the Lighthouse README" }),
}
const LIST = JSON.stringify({ t: "sessions", list: [...Object.values(T), shell] })
const ASKS = JSON.stringify({ t: "sessions", list: [T.asks, T.works, { ...T.rests, state: "blocked", kind: "permission", msg: "Push?" }, shell] })

async function standIn(page) {
  const socks = new Set()
  await routeSocket(page, /\/api\/terminals(\?.*)?$/, (ws) => { socks.add(ws); ws.send(LIST) })
  await routeSocket(page, /\/api\/terminal\/[^/?]+/, (ws) => {
    ws.send(JSON.stringify({ t: "attached", fresh: false, tmux: false, scrollback: 1000 }))
    ws.send(JSON.stringify({ t: "size", cols: 80, rows: 24 }))
  })
  await routeSocket(page, /\/api\/claude-code\/chat\/[^/?]+$/, (ws) => ws.send(JSON.stringify({ t: "hello", found: true, s: C.works, title: C.works.title,
    cwd: C.works.cwd, account: "default", model: "", effort: "", tui: null, driven: "", history: { entries: [], start: 0 }, live: [] })))
  await page.route(/\/api\/claude-code\/chats(\?.*)?$/, (r) => r.fulfill({ json: { sessions: Object.values(C) } }))
  await page.route(/\/api\/machines(\?.*)?$/, (r) => r.fulfill({ json: MACHINES }))
  return (list) => { for (const ws of socks) try { ws.send(list) } catch { socks.delete(ws) } }
}
async function marks(page, ui, say, ids) {
  const row = (id) => page.locator(`[data-agents-panel] [data-agent-run="${id}"]`)
  const shelfOf = (id) => row(id).evaluate((el) => { for (let e = el.previousElementSibling; e; e = e.previousElementSibling) if (e.dataset.agentShelf) return e.dataset.agentShelf; return null })
  const W = `terminal:${T.works.id}`, R = `terminal:${T.rests.id}`, CW = "chat:c-works@laptop", A = `terminal:${T.asks.id}`
  await ui.menu.context(row(W))
  const settle = await ui.menu.top().getByRole("menuitem", { name: "Settle", exact: true }).isDisabled().catch(() => false)
  await ui.menu.pick("Pin")
  await page.mouse.move(900, 450)
  check("Agents: Pin puts it on Pinned, first; Settle refused while it works", await until(async () => (await shelfOf(W)) === "pinned" && (await ids())[0] === W, 5000) && settle, [await ids(), settle])
  await page.keyboard.press(`${MOD}+Shift+P`)
  check("Agents: Mod+Shift+P pins the session on screen (the chat)", await until(async () => (await row(CW).getAttribute("data-pinned")) === "", 5000), await ids())
  await ui.menu.context(row(CW))
  await ui.menu.pick("Snooze", "For an hour")
  await page.mouse.move(900, 450)
  const snoozed = page.locator("[data-agents-panel] button[data-agent-shelf=snoozed]")
  check("Agents: Snooze takes it off its shelf into Snoozed, folded", await until(async () => (await snoozed.innerText().catch(() => "")).replace(/\s+/g, " ").trim() === "Snoozed 1" && !(await ids()).includes(CW), 5000), await ids())
  await row(R).click()
  await ui.idle()
  await page.mouse.move(900, 450)
  await page.keyboard.press(`${MOD}+Shift+S`)
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
  check("Agents: Mod+Shift+S settles the session on screen and goes to the next that needs you", await until(async () => !(await ids()).includes(R) && (await hash()).includes(`terminal/${T.asks.id}`), 5000), [await ids(), await hash()])
  await row(A).click()
  await ui.idle()
  await page.mouse.move(900, 450)
  await page.keyboard.press(`${MOD}+Shift+S`)
  check("Agents: but not one waiting on you: it says so and stays", !!(await ui.toast.wait("is waiting on you").catch(() => null)) && (await ids()).includes(A), await ui.toast())
  say(JSON.stringify({ t: "sessions", list: [T.asks, { ...T.works, project: "beacon" }, T.rests, shell] }))
  const chips = page.locator("[data-agents-panel] [data-agent-projects] button")
  check("Agents: chips for each repository the runs not settled work in, All first", await until(async () => same(await chips.allInnerTexts(), ["All", "beacon", "lighthouse"]), 5000), await chips.allInnerTexts())
  await page.click("[data-agents-panel] [data-agent-project=beacon]")
  await ui.idle()
  check("Agents: picking one lists only its runs", await until(async () => same(await ids(), [W]), 5000), await ids())
  await page.locator("[data-agents-panel]").screenshot({ path: `${OUT}panel-shelves.png` })
  await page.click("[data-agents-panel] [data-agent-project=all]")
  await ui.idle()
  check("Agents: All lists every one again", await until(async () => (await ids()).length > 1, 5000), await ids())
  await ui.menu.context(row(W))
  await ui.menu.pick("Unpin")
  say(LIST)
}
const MOD = process.platform === "darwin" ? "Meta" : "Control"
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const rowsOf = (page, scope) => page.$$eval(`${scope} [data-agent-run]`, (els) => els.map((e) => ({
  id: e.dataset.agentRun, kind: e.dataset.kind, state: e.dataset.state, text: e.innerText.trim().replace(/\s+/g, " "),
  where: e.querySelector("[data-agent-where]")?.textContent ?? "", when: e.querySelector("[data-agent-when]")?.textContent ?? "", tip: e.dataset.tip ?? "", dot: e.querySelector("[data-dot]")?.dataset.dot ?? null, bold: e.className.includes("font-medium") })))

const D = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const sayD = await standIn(D), ui = app(D)
await D.goto(B)
await D.waitForSelector("[role=tree]", { timeout: 60000 })
const shown = await until(async () => !!(await D.$("[data-agents-panel] [data-agent-run]")), 15000)
const sides = await until(() => /Right sidebar:\n\s+1\. agents:agents/.test(vau("panels", "--vault")), 5000)
check("Agents: offered once an agent runs, at the top of the right sidebar", shown && sides, vau("panels", "--vault").split("\nHidden")[0])
await until(async () => (await rowsOf(D, "[data-agents-panel]")).length === 5, 10000)
const rows = await rowsOf(D, "[data-agents-panel]")
const order = rows.map((r) => r.id)
const want = [`terminal:${T.asks.id}`, "chat:c-asks", `terminal:${T.rests.id}`, `terminal:${T.works.id}`, "chat:c-works@laptop", "chat:c-rests"]
check("Agents: needs you (asking, then done for you to settle), then working (a chat a terminal took over once)", JSON.stringify(order) === JSON.stringify(want.slice(0, 5)), order)
const panelText = await D.locator("[data-agents-panel]").innerText()
const shelves = await D.$$eval("[data-agents-panel] div[data-agent-shelf]", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()))
const heads = (await D.$$("[data-agents-panel] [data-agent-where]")).length + (/M1|M4|Mini PC/.test(panelText) ? 1 : 0) + (await D.$$("[data-agents-panel] [data-agent-projects]")).length
check("Agents: shelves headed with their counts; no repository chips for one repository, no machine names on the rows", same(shelves, ["Needs you 3", "Working 2"]) && heads === 0, [shelves, panelText])
const by = Object.fromEntries(rows.map((r) => [r.id, r]))
check("Agents: the machine and kind said in each row's tooltip", by[`terminal:${T.works.id}`]?.tip.includes("on M4") && by[`terminal:${T.rests.id}`]?.tip.includes("In a terminal"), rows.map((r) => r.tip))
check("Agents: its state as the glyph (ask, working, none at rest), the ones that need you stronger",
  JSON.stringify(rows.map((r) => [r.dot, r.bold])) === JSON.stringify([["ask", true], ["ask", true], [null, false], ["working", false], ["working", false]]), rows.map((r) => [r.dot, r.bold]))
check("Agents: a short time at the end of the ones not asking", rows.slice(2).every((r) => /^(now|\d+(m|h|d|mo))$/.test(r.when)) && rows[0].when === "", rows.map((r) => r.when))
check("Agents: what each is doing", by[`terminal:${T.works.id}`]?.text.includes("Write the release notes") && by["chat:c-works@laptop"]?.text.includes("Summarize Alice's notes"), rows)
await D.locator("[data-agents-panel]").screenshot({ path: `${OUT}panel.png` })

const earlier = D.locator("[data-agents-panel] [data-agent-earlier]")
check("Agents: the one done an hour ago folded under Settled 1, closed", (await earlier.innerText().catch(() => "")).replace(/\s+/g, " ").trim() === "Settled 1"
  && (await earlier.getAttribute("data-agent-earlier")) === "closed")
await earlier.click()
await ui.idle()
const all = await rowsOf(D, "[data-agents-panel]")
check("Agents: opening Settled shows it, last and dimmer", JSON.stringify(all.map((r) => r.id)) === JSON.stringify(want), all.map((r) => r.id))
await D.locator("[data-agents-panel]").screenshot({ path: `${OUT}panel-earlier.png` })
await earlier.click()
await ui.idle()
check("Agents: and closing it folds it again", (await rowsOf(D, "[data-agents-panel]")).length === 5)

const R = `terminal:${T.rests.id}`
const resorted = [`terminal:${T.asks.id}`, R, "chat:c-asks", `terminal:${T.works.id}`, "chat:c-works@laptop"]
const ids = async (p = D, scope = "[data-agents-panel]") => (await rowsOf(p, scope)).map((r) => r.id)
const away = () => D.mouse.move(900, 450)
await D.hover(`[data-agents-panel] [data-agent-run="terminal:${T.works.id}"]`)
await ui.idle()
sayD(ASKS)
const asked = await until(async () => (await rowsOf(D, "[data-agents-panel]")).find((r) => r.id === R)?.dot === "ask", 5000)
await ui.idle()
check("Agents: a row starting to ask under the pointer says so in its place, nothing moving", asked && same(await ids(), order), await ids())
await away()
check("Agents: once the pointer leaves, it settles into its place", await until(async () => same(await ids(), resorted), 5000), await ids())
await D.click(`[data-agents-panel] [data-agent-run="${R}"]`, { button: "right" })
await D.waitForSelector("[role=menu]", { timeout: 5000 }).catch(() => {})
await away()
sayD(LIST)
await until(async () => (await rowsOf(D, "[data-agents-panel]")).find((r) => r.id === R)?.dot === null, 5000)
await ui.idle()
const menued = (await D.locator("[role=menu]").count()) > 0
check("Agents: nor while a row's menu is open", menued && same(await ids(), resorted), { menued, ids: await ids() })
await D.keyboard.press("Escape")
check("Agents: and settles once it closes", await until(async () => same(await ids(), order), 5000), await ids())

const ago = (m) => now - m * 60000
const Q = {
  quiet: term(5, { state: "idle", since: ago(10), clients: 0, title: "Rename the Lighthouse assets" }),
  review: term(6, { state: "idle", since: ago(10), clients: 0, review: true, title: "Check the Lighthouse build" }),
  unread: term(7, { state: "done", since: ago(10), clients: 0, needs: true, title: "Answer about the Lighthouse beta" }),
  failed: term(8, { state: "error", since: ago(10), clients: 0, title: "Deploy the Lighthouse site" }),
  just: term(4, { state: "idle", since: ago(1), clients: 0, title: "Bump the Lighthouse version" }),
}
sayD(JSON.stringify({ t: "sessions", list: [...Object.values(T), ...Object.values(Q), shell] }))
await away()
const qid = (k) => `terminal:${Q[k].id}`
const settled = await until(async () => (await ids()).includes(qid("just")) && (await earlier.innerText().catch(() => "")).replace(/\s+/g, " ").trim() === "Settled 2", 5000)
const front = await ids()
check("Agents: a terminal done and read 10 min ago, with no tab, settles by itself; one just done stays", settled && !front.includes(qid("quiet")) && front.includes(qid("just")), front)
check("Agents: one ready for review, one with an unread answer and one failed never fold", ["review", "unread", "failed"].every((k) => front.includes(qid(k))), front)
const dotFor = async (k) => (await rowsOf(D, "[data-agents-panel]")).find((r) => r.id === qid(k))
const [reviewRow, unreadRow] = [await dotFor("review"), await dotFor("unread")]
check("Agents: one ready for review says so with the unread dot", reviewRow?.dot === "unread", reviewRow)
check("Agents: a finished turn unread is blue (unread), not amber, and not bold", unreadRow?.dot === "unread" && unreadRow?.state === "done" && !unreadRow?.bold, unreadRow)
await earlier.click()
check("Agents: Settled opens to show it", await until(async () => (await ids()).includes(qid("quiet")), 3000), await ids())
await earlier.click()
await ui.idle()
sayD(LIST)
await until(async () => !(await ids()).includes(qid("just")), 5000)

const active = () => D.$eval("[data-tab-bar] [data-tab-id][aria-selected=true], [data-tab-bar] [data-tab-id][data-active]", (e) => e.dataset.tabId).catch(() => "")
const hash = () => D.evaluate(() => decodeURIComponent(location.hash))
await D.click(`[data-agent-run="terminal:${T.works.id}"]`)
await ui.idle()
check("Agents: a terminal's row opens its terminal tab", (await hash()).includes(`terminal/${T.works.id}`), await hash())
check("Agents: its row is the active one then", !!(await D.$(`[data-agents-panel] [data-agent-run="terminal:${T.works.id}"].font-medium`)), await active())
await D.click(`[data-agent-run="chat:c-works@laptop"]`)
await ui.idle()
check("Agents: a chat's row opens its chat tab", (await hash()).includes("claude-session/c-works@laptop"), await hash())
await D.screenshot({ path: `${OUT}desktop.png` })
await marks(D, ui, sayD, ids)

await D.goto("about:blank")
await D.goto(`${B}#view/agents`)
await D.waitForSelector("[data-agents-view] [data-agent-run]", { timeout: 15000 })
await ui.idle()
const seg = await D.$$eval("[data-agents-view] [role=radio]", (els) => els.map((e) => e.textContent))
check("Agents tab: All, Terminals and Chats to pick from, with counts", JSON.stringify(seg) === JSON.stringify(["All", "Terminals3", "Chats3"]), seg)
const step = await D.$eval(`[data-agents-view] [data-agent-run="terminal:${T.asks.id}"] [data-agent-step]`, (e) => e.textContent).catch(() => "")
check("Agents tab: what it asks spelled out", step === "Run npm test?", step)
await D.screenshot({ path: `${OUT}tab.png` })
await D.close()

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const P = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
const sayP = await standIn(P), phoneUi = app(P)
await P.goto(B)
await phoneUi.idle()
await P.locator("[data-phone-header] button[aria-label='Open right sidebar']").tap()
await phoneUi.idle()
const phone = await rowsOf(P, "[data-phone-drawer] [data-agents-panel]").catch(() => [])
check("phone: the drawer lists them in the same order", JSON.stringify(phone.map((r) => r.id)) === JSON.stringify(want.slice(0, 5)), phone.map((r) => r.id))
const tall = await P.$eval("[data-phone-drawer] [data-agent-run]", (e) => e.getBoundingClientRect().height).catch(() => 0)
check("phone: rows at the sidebar's phone size (40px)", tall >= 39.5, tall)
await P.locator("[data-phone-drawer] [data-agent-earlier]").tap()
sayP(ASKS)
const heard = await until(async () => (await rowsOf(P, "[data-phone-drawer] [data-agents-panel]")).find((r) => r.id === R)?.dot === "ask", 5000)
const held = await ids(P, "[data-phone-drawer] [data-agents-panel]")
check("phone: just after a touch, rows hold still", heard && same(held.slice(0, 5), want.slice(0, 5)), held)
await phoneUi.idle()
check("phone: and settle a moment later", same((await ids(P, "[data-phone-drawer] [data-agents-panel]")).slice(0, 5), resorted), await ids(P, "[data-phone-drawer] [data-agents-panel]"))
await P.locator("[data-phone-drawer] [data-agents-panel]").screenshot({ path: `${OUT}phone.png` }).catch(() => P.screenshot({ path: `${OUT}phone.png` }))
await ctx.close()
await codeStage()
await done()

async function codeStage() {
  const api = apiAt(B)
  const look = await api("GET", "config/appearance")
  await api("PUT", "config/appearance", { ...look, tabBar: false })
  clearWorkspaces(B)
  vau("plugin", "on", "workspaces")

  const codeTerm = (n, title) => ({ id: `claude-${id}c${n}`, agent: "claude", process: "claude", busy: true, clients: 1, started: now - 60000 * (9 - n), backend: "vaultite", state: "idle", title })
  const T = [codeTerm(1, "Fix the Lighthouse upload test"), codeTerm(2, "Write the Beacon release notes"), codeTerm(3, "Tidy the Harbor README")]
  const CODE_LIST = JSON.stringify({ t: "sessions", list: T })

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ }), ui = app(page)
  await routeSocket(page, /\/api\/terminals(\?.*)?$/, (ws) => ws.send(CODE_LIST))
  await routeSocket(page, /\/api\/terminal\/[^/?]+/, (ws) => {
    ws.send(JSON.stringify({ t: "attached", fresh: false, tmux: false, scrollback: 1000 }))
    ws.send(JSON.stringify({ t: "size", cols: 80, rows: 24 }))
  })
  await page.route(/\/api\/claude-code\/chats(\?.*)?$/, (r) => r.fulfill({ json: { sessions: [] } }))
  await page.goto(B)
  await page.waitForSelector("aside [data-workspace-switcher]", { timeout: 60000 })
  await ui.idle()

  await page.click("aside [data-workspace-switcher]")
  await page.click("[data-workspace-list] [data-workspace-new-code]")
  await ui.idle()
  const code = () => workspaces(B).findIndex((w) => w?.name === "Code") + 1
  const n = await until(async () => code() > 0, 5000) ? code() : 0
  const made = workspaces(B)[n - 1]
  const lit = await page.$eval("aside [data-workspace-switcher]", (e) => e.getAttribute("data-workspace-switcher")).catch(() => null)
  check("New Code workspace: one made and switched to, the Agents panel alone on the left, nothing on the right",
    n > 0 && lit === String(n) && JSON.stringify(made?.sidebars?.left) === '["agents:agents"]' && !made?.sidebars?.right?.length, [n, lit, made])
  const panels = await page.$$eval("aside [data-panel]", (els) => els.map((e) => e.getAttribute("data-panel")))
  check("New Code workspace: no tab list on screen, the Agents panel shown", panels.join() === "agents:agents" && !(await page.$("[data-tab-bar] [data-tab-id]")), panels)

  const row = (t) => page.locator(`[data-agents-panel] [data-agent-run="terminal:${t.id}"]`)
  await row(T[0]).waitFor({ timeout: 15000 })
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
  const tabsNow = () => (workspaces(B)[n - 1]?.layout?.tabs ?? []).length
  const showing = async (t) => (await hash()).includes(`terminal/${t.id}`)
  await row(T[0]).click()
  await ui.idle()
  await row(T[1]).click()
  await ui.idle()
  const one = await until(async () => await showing(T[1]) && tabsNow() === 1, 6000)
  check("stage: a session clicked takes the focused pane's place, no tab piling up", one, [await hash(), workspaces(B)[n - 1]?.layout])
  await page.screenshot({ path: `${OUT}code.png` })
  await row(T[2]).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] })
  await ui.idle()
  check("stage: ⌘-click opens a tab of its own", await until(async () => tabsNow() === 2, 6000), workspaces(B)[n - 1]?.layout)

  await api("PUT", "config/appearance", { ...look, tabBar: true })
  await until(async () => !!(await page.$("[data-tab-bar] [data-tab-id]")), 6000)
  await row(T[0]).click()
  await ui.idle()
  check("tab bar on: a session clicked opens its own tab, as before", await until(async () => await showing(T[0]) && tabsNow() === 3, 6000), workspaces(B)[n - 1]?.layout)

  await api("PUT", "config/appearance", look)
  clearWorkspaces(B)
  vau("plugin", "off", "workspaces")
  await ctx.close()
}
