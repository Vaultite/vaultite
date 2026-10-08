// Terminal tabs on two machines: two throwaway servers on ONE vault copy, each listed in its machines data.json (ids A
// and B, loopback addresses). A terminal opened on A in workspace 1 is saved with A's id; B shows the same tab as A's
// shell (its output, typed into from B, no shell started on B), groups it under "Other workspaces" from workspace 2,
// says "runs on A, which isn't answering" while A is down (still no shell on B), and a tab saved the old way (no
// machine) for a shell A runs is claimed as A's and opens A's shell from B.
// Runs shells through both servers and stops and starts server A (a tmux session on the default socket, see below):
// throwaway servers only.
//   node web/qa/termhost.mjs <base A> <id A> <base B> <id B> <vault path> <tmux session running A> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait, workspaceKey } from "./lib/qa.mjs"
import { workspaces, wsDir } from "./lib/wsfiles.mjs"
const { args: [A, IDA, B, _IDB, VAULT, A_SESSION, OUT = "/tmp/termhost-shots/"], browser, check, done } = await qa(import.meta.url)
const errs = [] // (listed at the end, not failed)
mkdirSync(OUT, { recursive: true })
const TMUX = "/opt/homebrew/bin/tmux"
/** The default tmux server (where the caller runs server A), whatever tmux this script itself runs in. */
const plain = { env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "TMUX" && k !== "TMUX_PANE")) }
const base = (u) => (u.endsWith("/") ? u : `${u}/`)
const portOf = (u) => new URL(u).port
/** The tmux sessions a server's terminals run in (its own tmux server, vaultite-<port>). */
const shells = (u) => { try { return execFileSync(TMUX, ["-L", `vaultite-${portOf(u)}`, "ls", "-F", "#{session_name}"], { encoding: "utf8" }).trim().split("\n").filter(Boolean) } catch { return [] } }
const raw = () => ({ workspaces: workspaces(VAULT) })
const places = (w) => JSON.stringify(w?.layout ?? null).match(/"to":"[^"]+"/g)?.map((x) => x.slice(6, -1)) ?? []
const api = async (u, p) => (await fetch(new URL(`api/${p}`, base(u)))).json()
const sid = `qa${Date.now().toString(36)}`

async function open(u) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errs.push(`${u}: ${e}`))
  const text = () => page.evaluate(() => [...document.querySelectorAll(".xterm-rows > div")].map((d) => d.textContent).join("\n"))
  return { ctx, page, text }
}

// 1. A terminal on A, in workspace 1.
const a = await open(A)
await a.page.goto(`${base(A)}#view/terminal%2F${sid}`)
check("A: terminal drawn", await until(async () => (await a.page.locator(".xterm-rows").count()) > 0, 10000))
await until(async () => /%|\$|❯/.test(await a.text()), 8000)
await a.page.locator(".xterm").click()
await a.page.keyboard.type("echo from-a-$((6*7))"); await a.page.keyboard.press("Enter")
check("A: the shell answers", await until(async () => /^from-a-42\s*$/m.test(await a.text()), 10000), (await a.text()).slice(-200))
check("A: saved with A's id", await until(async () => places(raw().workspaces[0]).includes(`view:terminal/${sid}@${IDA}`), 10000), raw())
check("A's app has it as its own", places((await api(A, "workspaces")).workspaces[0]).includes(`view:terminal/${sid}`), (await api(A, "workspaces")).workspaces[0])
check("B's app has it as A's", places((await api(B, "workspaces")).workspaces[0]).includes(`view:terminal/${sid}@${IDA}`), (await api(B, "workspaces")).workspaces[0])
check("the shell runs on A only", shells(A).includes(`vau-${sid}`) && !shells(B).includes(`vau-${sid}`), [shells(A), shells(B)])

// 2. B on workspace 1: A's shell, not a new one.
const b = await open(B)
await b.page.goto(base(B))
check("B: the workspace's terminal tab is drawn", await until(async () => (await b.page.locator(".xterm-rows").count()) > 0, 15000))
check("B: it's A's shell (its output)", await until(async () => /^from-a-42\s*$/m.test(await b.text()), 10000), (await b.text()).slice(-300))
check("B: its tab says it's on A", await until(async () => (await b.page.locator('[role="tab"]', { hasText: /Qa A|· /i }).count()) > 0 || (await b.page.getByText(/· .*A/).count()) > 0, 10000), null)
await b.page.locator(".xterm").click()
await b.page.keyboard.type("echo typed-on-b-$VAULTITE_URL"); await b.page.keyboard.press("Enter")
check("B: typed into A's shell (it's A's server's)", await until(async () => new RegExp(`^typed-on-b-http://127\\.0\\.0\\.1:${portOf(A)}\\s*$`, "m").test(await b.text()), 10000), (await b.text()).slice(-300))
check("B: still no shell on B", !shells(B).length, shells(B))
await b.page.screenshot({ path: `${OUT}b-remote.png` })

// 3. Other workspaces: from workspace 2, the shell is listed under "Other workspaces", on both.
for (const [name, x, id] of [["B", b, `${sid}@${IDA}`], ["A", a, sid]]) {
  await x.page.keyboard.press(workspaceKey(2)); await wait(500)
  check(`${name}: on workspace 2, the terminal is under Other workspaces`, await until(async () =>
    (await x.page.locator(`[data-session="${id}"][data-where]`).count()) > 0 && (await x.page.locator("[data-terminals-elsewhere]").count()) > 0, 10000),
    await x.page.evaluate(() => [...document.querySelectorAll("[data-session]")].map((e) => `${e.dataset.session}|${e.dataset.where ?? ""}`)))
  await x.page.keyboard.press(workspaceKey(1)); await wait(500)
}
await a.ctx.close()

// 4. A down: B's tab says where the shell runs and keeps trying; nothing starts on B.
execFileSync(TMUX, ["send-keys", "-t", A_SESSION, "C-c"], plain)
check("A stopped", await until(async () => { try { await fetch(base(A)); return false } catch { return true } }, 10000), null)
await b.page.reload()
check("B: the tab says A isn't answering", await until(async () => (await b.page.locator("[data-terminal-away]").textContent())?.includes("runs on Qa A"), 30000),
  await b.page.locator("[data-terminal-away]").textContent().catch(() => null))
check("B: and no shell started on B", !shells(B).length, shells(B))
await b.page.screenshot({ path: `${OUT}b-away.png` })

// 5. A back (its shells kept running in tmux): B reaches it again by itself.
execFileSync(TMUX, ["send-keys", "-t", A_SESSION, "Up", "Enter"], plain)
check("A back", await until(async () => { try { return (await fetch(base(A))).ok } catch { return false } }, 20000), null)
check("B: back on A's shell once A answers", await until(async () => /^from-a-42\s*$/m.test(await b.text()) && !(await b.page.locator("[data-terminal-away]").count()), 45000),
  (await b.text()).slice(-200))
await b.ctx.close()

// 6. A tab saved before tabs said their machine (no @), for a shell A runs: claimed as A's, and B opens A's shell.
const old = `${sid}old`
const s = await open(A)
await s.page.goto(`${base(A)}#view/terminal%2F${old}`)
await until(async () => /%|\$|❯/.test(await s.text()), 8000)
await s.page.locator(".xterm").click()
await s.page.keyboard.type("echo old-on-a"); await s.page.keyboard.press("Enter")
await until(async () => /^old-on-a\s*$/m.test(await s.text()), 10000)
await s.page.keyboard.press("Control+w").catch(() => {})
await s.ctx.close()
await wait(1500)
mkdirSync(wsDir(VAULT), { recursive: true })
writeFileSync(path.join(wsDir(VAULT), "3.json"), JSON.stringify({ name: "Old", layout: { root: { id: "g0", tabs: [{ id: "t1", to: `view:terminal/${old}` }], active: "t1" }, focus: "g0" } }, null, 2))
const c = await open(B)
await c.page.goto(base(B))
await c.page.keyboard.press(workspaceKey(3))
check("B: the old tab opens A's shell", await until(async () => /^old-on-a\s*$/m.test(await c.text()), 20000), (await c.text()).slice(-200))
check("B: no shell of its own for it", !shells(B).includes(`vau-${old}`), shells(B))
check("the old tab is now saved as A's", await until(async () => places(raw().workspaces[2]).includes(`view:terminal/${old}@${IDA}`), 30000), raw().workspaces[2])
await c.ctx.close()

await browser.close()
// End the shells (and nothing else: the servers are the caller's).
for (const u of [A, B]) for (const x of shells(u)) try { execFileSync(TMUX, ["-L", `vaultite-${portOf(u)}`, "kill-session", "-t", `=${x}`]) } catch { /* gone */ }
if (errs.length) console.log("page errors:", errs.slice(0, 5))
await done()
