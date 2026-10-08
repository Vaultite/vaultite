// The Links panel (plugins/core/backlinks) and Claude Code's sessions (plugins/core/claude-code): the panel lists a
// file's linked mentions, unlinked mentions (Link makes one a [[link]] on disk) and outgoing links (unresolved faint),
// follows the focused file, opens from the rail as a flyout, and opens as a tab in a split that follows the other pane. The Claude
// page has projects and models side by side; a finished session opens its conversation in a tab (tool calls expand,
// Resume in terminal opens `claude --resume` in a terminal tab); a session running in one of the app's terminals goes
// to that tab. Phones at 390px: no horizontal overflow. WRITES a "Qa links" folder, plugins.json and sidebars.json (put
// back), runs shells, and fakes a running Claude Code session in <claude dir>/sessions: a throwaway server started with
// CLAUDE_CONFIG_DIR=<claude dir> (a copy holding tools/fixtures/claude), never the real ~/.claude.
//   node web/qa/links.mjs <base url> <vault path> <claude dir> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, CLAUDE, OUT = "/tmp/links-shots/"], browser, check, watch, done } = await qa(import.meta.url)
if (path.resolve(CLAUDE) === path.join(process.env.HOME, ".claude")) { console.error("not the real ~/.claude"); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const api = async (p, init) => (await fetch(new URL(`/api/${p}`, B), init)).json()
const shot = async (page, name) => { const f = `${OUT}${name}.png`; await page.screenshot({ path: f }); try { execFileSync("sips", ["-Z", "1200", f], { stdio: "ignore" }) } catch { /* no sips */ } }
/** A terminal's shell process, whichever backend holds it (the terminal's own keeper by default, tmux, herdr): asked of
 *  the shell itself (it echoes its $$), through the API outside apps use (vau terminal send / screen). 0 until it runs. */
const shellOf = async (id) => {
  const t = encodeURIComponent(id)
  const listed = await until(async () => (await api("terminals/sessions")).sessions?.some((x) => x.id === id), 10000)
  if (!listed) return 0
  await fetch(new URL(`/api/terminals/${t}/send`, B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "echo QA-PID-$$" }) })
  return Number(await until(async () => /QA-PID-(\d+)/.exec(((await api(`terminals/${t}/screen`)).lines ?? []).join("\n"))?.[1], 10000)) || 0
}
/** End a terminal session (its shell), as the app's End terminal session does. */
const endTerminal = (id) => fetch(new URL(`/api/terminals/${encodeURIComponent(id)}`, B), { method: "DELETE" }).catch(() => {})

const DIR = "Qa links"
const SID = "0a1b2c3d-1111-4222-8333-444455556666" // tools/fixtures/claude
const put = (rel, text) => { mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); writeFileSync(path.join(VAULT, rel), text) }
put(`${DIR}/Beacon.md`, "The beacon: a made-up note others mention.\n")
put(`${DIR}/Linker.md`, "Links to [[Beacon]] here.\n")
put(`${DIR}/Mention.md`, "We talked about the beacon at lunch. Also [[Nowhere yet]] and [[Linker]].\n")
const fake = path.join(CLAUDE, "sessions")
let fakeFile = ""

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const open = (rel) => page.goto(`${B}#file/${encodeURIComponent(rel)}`)
const group = (id) => `aside [data-links-panel] [data-links-group='${id}']`
const count = async (id) => Number(await page.$eval(`${group(id)} [data-count]`, (e) => e.textContent))
const palette = async (name) => { await page.keyboard.press("ControlOrMeta+P"); await page.keyboard.type(name); await wait(200); await page.keyboard.press("Enter") }
let term = ""
const disabledBefore = (await api("config/plugins")).disabled ?? []
try {
  // Every plugin on but Workspaces (whose workspaces would keep sidebars of their own), and Links shown (hidden until
  // shown): the default panels, then Links.
  await api("config/plugins", { method: "PATCH", body: JSON.stringify({ disabled: ["workspaces"] }) })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files", "backlinks:links"], right: [], collapsed: [] }) })
  await open(`${DIR}/Beacon.md`)
  await page.waitForSelector("aside [data-links-panel]")
  check("the Links panel is in the sidebar", !!(await page.$("aside [data-panel='backlinks:links']")))
  check("linked mentions: Linker", await until(async () => (await count("linked")) === 1 && !!(await page.$(`${group("linked")} [data-link-item='Linker']`)), 8000))
  check("unlinked mentions: Mention (any case)", await until(async () => (await count("unlinked")) === 1, 8000), await count("unlinked").catch(() => null))
  check("outgoing: none", (await count("outgoing")) === 0)
  await shot(page, "1-links-panel")

  // Link it: the file on disk gets the link, and it moves from unlinked to linked.
  await page.hover(`${group("unlinked")} [data-link-item='Mention']`)
  await page.click(`${group("unlinked")} [data-link-action]`)
  check("Link writes the link", await until(() => readFileSync(path.join(VAULT, DIR, "Mention.md"), "utf8").includes("the [[Beacon|beacon]] at lunch"), 8000),
    readFileSync(path.join(VAULT, DIR, "Mention.md"), "utf8"))
  check("then it's a linked mention", await until(async () => (await count("linked")) === 2 && (await count("unlinked")) === 0, 8000))

  // The panel follows the focused file: Mention links out, one link going nowhere (faint).
  await page.click(`${group("linked")} [data-link-item='Mention']`)
  check("clicking a mention opens it", await until(() => decodeURIComponent(page.url()).includes(`${DIR}/Mention.md`), 8000), page.url())
  check("outgoing: three, the unresolved one faint", await until(async () => (await count("outgoing")) === 3 &&
    (await page.$eval(`${group("outgoing")} [data-link-item='Nowhere yet']`, (e) => e.className.includes("opacity-60"))), 8000))
  await shot(page, "2-links-outgoing")

  // Collapsing a group sticks.
  await page.click(`${group("outgoing")} > button`)
  check("a group collapses", !(await page.$(`${group("outgoing")} [data-link-item]`)))
  await page.click(`${group("outgoing")} > button`)

  // As a tab in a split, following the other pane.
  await open(`${DIR}/Beacon.md`)
  await palette("Open links in right split")
  const view = await until(() => page.$("[data-links-view]"), 8000)
  check("Open links in right split: a Links tab", !!view)
  check("it shows the file of the other pane", await until(async () => (await page.$eval("[data-links-view] h1", (e) => e.textContent)) === "Beacon", 8000))
  check("the tab agrees with the panel (the mention linked above is gone)", await until(async () =>
    (await page.$eval("[data-links-view] [data-links-group='unlinked'] [data-count]", (e) => e.textContent)) === "0" &&
    (await page.$eval("[data-links-view] [data-links-group='linked'] [data-count]", (e) => e.textContent)) === "2", 8000))
  await shot(page, "3-links-tab")
  await page.click("[data-links-view] [data-link-item='Linker']")
  check("opening from it: in the other pane, and the tab follows", await until(async () => (await page.$eval("[data-links-view] h1", (e) => e.textContent)) === "Linker", 8000))
  check("the Links tab is still there", (await page.$$("[data-links-view]")).length === 1)
  // Close it (focus its pane first): back to one pane.
  await page.click("[data-links-view] p")
  await palette("Close current tab")
  check("closed: one pane again", await until(async () => !(await page.$("[data-links-view]")), 8000))
  await open(`${DIR}/Beacon.md`)

  // The rail: an icon for the panel, which opens it as a flyout beside the rail (the sidebar stays folded).
  await page.keyboard.press("ControlOrMeta+Backslash")
  check("rail: the Links icon", !!(await until(() => page.$("aside [data-flyout-icon='backlinks:links']"), 8000)))
  await page.click("aside [data-flyout-icon='backlinks:links']")
  check("clicking it opens the panel in a flyout", !!(await until(() => page.$("[data-flyout='backlinks:links'] [data-links-panel]"), 8000)) && !!(await page.$("aside[data-collapsed]")))
  await shot(page, "4-rail")
  await page.keyboard.press("Escape")
  check("...Escape closes it", !!(await until(async () => !(await page.$("[data-flyout]")), 8000)))
  await page.keyboard.press("ControlOrMeta+Backslash")

  // The Claude page: projects and models side by side under usage.
  await open("Dashboards/Claude.md")
  const box = async (t) => (await page.locator("section.glass", { has: page.locator(`h2:text-is("${t}")`) }).first().boundingBox())
  const pb = await until(() => box("Projects"), 8000), mb = await until(() => box("Models"), 8000)
  check("Projects and Models side by side", pb && mb && Math.abs(pb.y - mb.y) < 2 && mb.x > pb.x, [pb, mb])
  await wait(500)
  await shot(page, "5-claude-page")

  // A finished session: its conversation in a tab.
  await page.click("section:has(h2:text-is('Sessions')) button:has-text('Upload test fix')")
  check("a session opens its conversation", !!(await until(() => page.$(`[data-claude-session='${SID}']`), 8000)))
  check("title, folder, model", await until(async () => /Upload test fix/.test(await page.textContent("[data-claude-session] h1")) &&
    (await page.textContent("[data-claude-session] header")).includes("Opus 5.5"), 8000))
  check("messages as Markdown", !!(await page.$("[data-claude-session] [data-entry=assistant] strong")))
  check("tool calls are one line each", (await page.$$("[data-claude-session] [data-tool]")).length >= 2)
  await page.click("[data-claude-session] [data-tool='Bash'] button")
  check("a tool call expands to its input and result", (await page.textContent("[data-claude-session] [data-tool='Bash']")).includes("1 failing: upload retries"))
  await shot(page, "6-session-view")
  // Resume in terminal: a terminal tab running claude --resume (the fixture's session isn't real: claude says so, the shell stays).
  await page.click("[data-claude-session] [data-resume]")
  check("Resume in terminal opens a terminal tab", await until(() => decodeURIComponent(page.url()).includes(`view/terminal/resume-claude-${SID}`), 8000), page.url())
  await wait(1500)
  await palette("End terminal session") // ends that shell (closing its tab would leave Claude Code running)
  // Claude Code may still be running in it (it asks which session to pick): ending asks first.
  const ask = await until(() => page.$("dialog[data-confirm] button[data-confirm-ok]"), 1500)
  if (ask) await ask.click()
  await wait(500)

  // A session running in one of the app's terminals: clicking it goes to that tab.
  {
    // A new terminal by its address: "Open terminal" in the palette may pick "Open terminals in a tab" (the palette puts
    // commands used last first).
    term = `qa${Date.now().toString(36)}`
    await page.goto(`${B}#view/terminal%2F${term}`)
    const pid = await shellOf(term)
    check("the terminal's shell runs", pid > 0, pid)
    const local = new Date(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim())
    const p2 = (n) => String(n).padStart(2, "0")
    const utc = `${local.toUTCString().slice(0, 3)} ${local.toUTCString().slice(8, 11)} ${local.getUTCDate()} ${p2(local.getUTCHours())}:${p2(local.getUTCMinutes())}:${p2(local.getUTCSeconds())} ${local.getUTCFullYear()}`
    mkdirSync(fake, { recursive: true })
    fakeFile = path.join(fake, `${pid}.json`)
    writeFileSync(fakeFile, JSON.stringify({ pid, sessionId: SID, cwd: "/Users/sam/lighthouse", startedAt: Date.now(), procStart: utc, kind: "interactive",
      status: "idle", statusUpdatedAt: Date.now() }))
    await open("Dashboards/Claude.md")
    const row = await until(() => page.$(`section:has(h2:text-is('Sessions')) [data-session='${SID}']`), 20000)
    check("the running session is listed under Now", !!row)
    check("its row says it goes to its terminal", (await row?.getAttribute("data-tip")) === "Go to its terminal")
    await row?.click()
    check("clicking it focuses its terminal tab", await until(() => decodeURIComponent(page.url()).includes(`view/terminal/${term}`), 8000), page.url())
  }

  // Phones.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [name, url] of [["claude-page", "#file/Dashboards%2FClaude.md"], ["session", `#view/claude-session%2F${SID}`]]) {
    await page.goto(`${B}${url}`)
    await wait(1500)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    check(`390px ${name}: no horizontal overflow`, over <= 0, over)
    await shot(page, `7-phone-${name}`)
  }
} finally {
  if (fakeFile) rmSync(fakeFile, { force: true })
  if (term) await endTerminal(term)
  await endTerminal(`resume-claude-${SID}`)
  rmSync(path.join(VAULT, DIR), { recursive: true, force: true })
  await api("config/sidebars", { method: "PUT", body: JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] }) })
  await api("config/plugins", { method: "PATCH", body: JSON.stringify({ disabled: disabledBefore }) })
  await browser.close()
}
await done()
