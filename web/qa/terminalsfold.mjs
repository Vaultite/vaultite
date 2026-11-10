// The Terminals panel's Earlier (the sessions socket stood in for): an agent's session done and read a few minutes ago,
// with nothing for the user and no tab, folds under a closed Earlier at the end of the list
// (plugins/core/terminal/SessionsPanel.tsx, core/agentorder.ts, core/steadyrows.tsx); one waiting on the user, with an
// unread answer, a job ready for review, failed or just done never does; Earlier opens to show it, and a click resumes
// it in its tab, which keeps it in view; set to never fold (plugins/core/agents/fold.ts), it stays. Writes the
// sidebars and the Agents plugin's settings: throwaway server only.
//   node web/qa/terminalsfold.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/terminalsfold-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
// (the Terminals panel shown, whatever the sandbox hid)
if (!/\d+\. \w+:sessions/.test(vau("panels", "--vault"))) vau("panels", "show", "terminals", "--vault")
await wait(1000)

const now = Date.now(), id = `qa${now.toString(36)}`, ago = (m) => now - m * 60000
const agent = (n, more) => ({ id: `claude-${id}${n}`, agent: "claude", process: "claude", busy: true, clients: 0, started: ago(60 - n), backend: "vaultite", since: ago(10), ...more })
const S = {
  quiet: agent(1, { state: "idle", title: "Rename the Lighthouse assets" }),
  asks: agent(2, { state: "blocked", kind: "permission", msg: "Run npm test?", title: "Fix the upload test" }),
  unread: agent(3, { state: "done", needs: true, title: "Answer about the Lighthouse beta" }),
  review: agent(4, { state: "idle", review: true, title: "Check the Lighthouse build" }),
  failed: agent(5, { state: "error", title: "Deploy the Lighthouse site" }),
  just: agent(6, { state: "idle", since: ago(1), title: "Bump the Lighthouse version" }),
}
const shell = { id: `${id}9`, agent: null, process: "zsh", busy: false, clients: 0, started: now, backend: "vaultite" }
const LIST = JSON.stringify({ t: "sessions", list: [...Object.values(S), shell] })

const D = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await D.routeWebSocket(/\/api\/terminals(\?.*)?$/, (ws) => ws.send(LIST))
await D.routeWebSocket(/\/api\/terminal\/[^/?]+/, (ws) => {
  ws.send(JSON.stringify({ t: "attached", fresh: false, tmux: false, scrollback: 1000 }))
  ws.send(JSON.stringify({ t: "size", cols: 80, rows: 24 }))
})
await D.goto(B)
await D.waitForSelector("[role=tree]", { timeout: 60000 })
const panel = "aside [data-terminal-rows]"
const ids = () => D.$$eval(`${panel} [data-session]`, (els) => els.map((e) => e.dataset.session))
await until(async () => (await ids()).includes(S.asks.id), 15000)
await D.mouse.move(900, 450)

const front = await ids()
check("Terminals: the session done and read 10 min ago, asking nothing, with no tab, is out of the list", !front.includes(S.quiet.id), front)
check("Terminals: waiting on you, an unread answer, ready for review, failed and just done all stay, as does the shell",
  ["asks", "unread", "review", "failed", "just"].every((k) => front.includes(S[k].id)) && front.includes(shell.id), front)
const earlier = D.locator(`${panel} [data-terminals-earlier]`)
const label = (await earlier.innerText().catch(() => "")).replace(/\s+/g, " ").trim()
check("Terminals: it folds under Earlier 1, closed, at the end", label === "Earlier 1" && (await earlier.getAttribute("data-terminals-earlier")) === "closed"
  && await D.$eval(panel, (el) => el.lastElementChild?.hasAttribute("data-terminals-earlier")), label)
const dot = await D.$eval(`${panel} [data-session="${S.review.id}"] [data-dot]`, (e) => e.dataset.dot).catch(() => null)
check("Terminals: the one ready for review says so with the unread dot", dot === "unread", dot)
await D.locator(panel).screenshot({ path: `${OUT}folded.png` })

await earlier.click()
const opened = await until(async () => (await ids()).at(-1) === S.quiet.id, 3000)
check("Terminals: Earlier opens to show it, under it", opened && (await earlier.getAttribute("data-terminals-earlier")) === "open", await ids())
await D.locator(panel).screenshot({ path: `${OUT}earlier.png` })

await D.click(`${panel} [data-session="${S.quiet.id}"]`)
const hash = await until(async () => decodeURIComponent(await D.evaluate(() => location.hash)).includes(`terminal/${S.quiet.id}`), 5000)
check("Terminals: a click on it resumes it in its tab", hash, await D.evaluate(() => location.hash))
await D.mouse.move(900, 450)
const back = await until(async () => !(await earlier.count()) && (await ids()).includes(S.quiet.id), 5000)
check("Terminals: with its tab open it's back in the list, nothing left under Earlier", back, { ids: await ids(), earlier: await earlier.count() })
await D.close()

// The Agents plugin's setting: never folding keeps every one listed.
const setFold = (fold) => fetch(new URL("/api/config/plugin/agents", B), { method: "PATCH", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/desktop" }, body: JSON.stringify({ fold }) })
await setFold("never")
const N = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await N.routeWebSocket(/\/api\/terminals(\?.*)?$/, (ws) => ws.send(LIST))
await N.goto(B)
await N.waitForSelector("[role=tree]", { timeout: 60000 })
// (the quiet one's tab closed: a new page has none)
const listed = await until(async () => (await N.$$eval(`${panel} [data-session]`, (els) => els.map((e) => e.dataset.session))).includes(S.quiet.id), 10000)
check("Terminals: with Fold finished agents set to Never, it stays listed and there's no Earlier", listed && !(await N.locator(`${panel} [data-terminals-earlier]`).count()))
await setFold("5")
await N.close()
await done()
