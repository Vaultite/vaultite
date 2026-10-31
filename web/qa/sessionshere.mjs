// Sessions here: a file's top bar says how many coding agent sessions changed it ("3 sessions"), and its menu lists each
// (title, running or when), newest first; picking a running one shows its terminal; the palette's command lists them too.
// Agents' edits come through Activity's hook, as Claude Code's and Codex's do; a shell running `sleep` stands in for a
// live one. WRITES "QA sessions/", starts a shell: throwaway server only.
//   node web/qa/sessionshere.mjs <base url> <vault path> [out dir]
import { mkdirSync, rmSync } from "node:fs"
import { palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/sessionshere-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const app = { "X-Vaultite-Client": "app/desktop" }
const api = (method, p, body, headers = app) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) }).then((r) => r.json())

// Activity on (it's off by default), without its day recaps (their write's ask would cover the page).
const plugins = await api("GET", "config/plugins")
await api("PATCH", "config/plugins", { enabled: [...(plugins.enabled ?? []).filter((x) => x !== "activity"), "activity"] })
await api("PATCH", "config/plugin/activity", { recaps: false })
await wait(1500)
// (a folder, terminals and sessions of its own each run: an earlier run's would count too)
const RUN = Date.now().toString(36).slice(-4), uuid = (n) => `${RUN}${n}e2a-4f1d-4c4e-9a7e-2d6f1b3c8e90`
const DIR = `QA sessions ${RUN}`, NOTE = `${DIR}/Launch plan.md`, OTHER = `${DIR}/Other.md`
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await api("PUT", "file", { path: NOTE, text: "# Launch plan\n\nShip the Lighthouse beta in spring.\n" })
await api("PUT", "file", { path: OTHER, text: "# Other\n" })
/** An agent's edit as its hook reports it (Terminal gives the agents it starts this hook). */
const edit = async (agent, terminal, file, sid) => { await wait(30); return api("POST", `activity/hook?agent=${agent}&terminal=${terminal}`,
  { tool_name: "Edit", tool_input: { file_path: `${VAULT}/${file}` }, ...(sid ? { session_id: sid } : {}) }, {}) }
await edit("claude-code", `claude-qa1${RUN}`, NOTE, uuid(1))
await edit("claude-code", `claude-qa1${RUN}`, NOTE, uuid(1))
await edit("codex", `resume-codex-${uuid(2)}`, NOTE)
await edit("claude-code", `claude-qa2${RUN}`, OTHER, uuid(3))
// A live one: a shell of this server's running something.
const LIVE = `qasess${RUN}`
await api("POST", `terminals/${LIVE}`, {})
await api("POST", `terminals/${LIVE}/send`, { text: "sleep 600" })
await until(async () => (await api("POST", "ops/terminal.list", {})).sessions?.some((s) => s.id === LIVE && s.busy), 8000)
await edit("claude-code", LIVE, NOTE)

const r = await api("POST", "ops/activity.sessions", { path: NOTE }, { "X-Vaultite-Client": "cli" })
check("activity.sessions: three, newest first, the shell's running", r.sessions?.length === 3 && r.sessions[0].terminal === LIVE && r.sessions[0].live && r.sessions.slice(1).every((s) => !s.live), r)

const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${encodeURIComponent(NOTE)}`)
const chip = page.locator("[data-sessions-here]:visible")
await chip.first().waitFor({ timeout: 10000 })
check("the top bar says how many", (await chip.first().textContent())?.trim() === "3 sessions", await chip.first().textContent())
await chip.first().click()
const rows = page.locator("[role=menu] [role=menuitem]")
await until(() => rows.count(), 3000)
const texts = await rows.allTextContents()
check("its menu lists them, newest first: the running one, then each agent's with when", texts.length === 3 && /Running/.test(texts[0]) && /Codex session/.test(texts[1]) && /Claude Code session/.test(texts[2]) && /just now|ago/.test(texts[2]), texts)
await wait(300)
await page.screenshot({ path: `${OUT}menu.png` })
await rows.first().click()
const shown = await until(() => page.evaluate((id) => decodeURIComponent(location.hash).includes(`terminal/${id}`), LIVE), 4000)
check("picking the running one shows its terminal", shown, await page.evaluate(() => location.hash))

await page.goto("about:blank")
await page.goto(`${B}/#file/${encodeURIComponent(OTHER)}`)
await page.locator("[data-sessions-here]:visible").first().waitFor({ timeout: 10000 })
check("another file has its own", (await page.locator("[data-sessions-here]:visible").first().textContent())?.trim() === "1 session")
await palette(page, "Sessions that changed this file", 600)
const options = await page.locator("[role=option]").allTextContents()
check("the palette's command lists them with agent and state", options.length === 1 && /Claude Code · ended · changed it/.test(options[0]), options)
await page.keyboard.press("Escape")
await page.screenshot({ path: `${OUT}other.png` })

await api("PUT", "file", { path: `${DIR}/Untouched.md`, text: "# Untouched\n" })
await page.goto("about:blank")
await page.goto(`${B}/#file/${encodeURIComponent(`${DIR}/Untouched.md`)}`)
await page.locator(".cm-content:visible").first().waitFor({ timeout: 10000 })
await wait(1200)
check("a file no agent's session changed shows none", !(await page.locator("[data-sessions-here]:visible").count()))

await api("DELETE", `terminals/${LIVE}`)
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
console.log(`shots in ${OUT}`)
await done()
