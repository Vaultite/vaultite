// Use AI (Settings > AI, core/ai.ts): off, the app shows nothing for AI (the companion, token counts, agents' commands
// and keys, at once with no reload (App.tsx), Settings > AI's settings (pluginSettings.ts), Screen, who wrote a line,
// the Inbox panel, AI plugins on the Plugins page, the new tab's Connect your AI) while ops and MCP still answer; back on, every plugin is as its own switch was. Settings >
// AI's agents show their paths only on hover. Shots: light, dark, 390px phone, on and off. WRITES plugins.json and a
// note: throwaway server only.
//   node web/qa/aiswitch.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, command, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const conf = () => { try { return JSON.parse(readFileSync(path.join(VAULT, ".vaultite", "plugins.json"), "utf8")) } catch { return {} } }
const lists = (c) => JSON.stringify({ disabled: c.disabled ?? [], enabled: c.enabled ?? [] })
const NOTE = "Qa ai/Harbour plan.md"
await api("POST", "ops/settings.set", { name: "plugins", values: { ai: null } })
await api("POST", "file", { path: NOTE, text: "# Harbour plan\n\nAlice Park walks the Lighthouse path at dawn.\n" })
const before = lists(conf())
// (the Inbox panel in the sidebar, as the Standard layout has it)
const SIDEBARS = path.join(VAULT, ".vaultite", "sidebars.json")
const hadSidebars = (() => { try { return readFileSync(SIDEBARS, "utf8") } catch { return null } })()
writeFileSync(SIDEBARS, JSON.stringify({ left: ["pages:pages", "files:files", "inbox:inbox"], right: [], collapsed: [] }, null, 2))

/** A window at `w`×`h` on the note, its colour scheme `scheme`. */
async function open(w, h, scheme = "light", mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
  const page = watch(await ctx.newPage(), { label: `${w} ${scheme}` })
  await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await page.waitForSelector("main", { timeout: 30000 })
  await wait(1500)
  return { ctx, page }
}
/** Settings, on its AI section. */
async function settingsAi(page) {
  await page.goto("about:blank"); await page.goto(`${B}#settings`)
  await page.locator('[data-settings-nav="ai"]').click()
  await until(() => page.locator('[data-settings-row="ai"]').count(), 5000)
  await wait(600)
}
const aiSwitch = (page) => page.locator('[data-settings-row="ai"] [role=switch]')
const hasCommand = async (page, name) => {
  await page.keyboard.press("ControlOrMeta+p"); await page.waitForSelector("[role=dialog] input:focus"); await page.keyboard.type(name)
  const hit = await until(() => page.locator("[role=option]", { hasText: name }).count(), 1200)
  await page.keyboard.press("Escape"); await wait(200)
  return !!hit
}

// ---------- on: the section, the agents (paths on hover only), the AI items
const { ctx, page } = await open(1280, 800)
check("on at first: the companion and the token count are in the status bar", !!(await until(async () =>
  (await page.locator('[data-status-key="companion:status"]').count()) && (await page.locator('[data-status-key^="token-count:"]').count()), 6000)))
check("...and the palette has Open Claude Code", await hasCommand(page, "Open Claude Code"))
check("...the Inbox panel and who wrote it in the status bar", !!(await until(() => page.locator('[data-panel="inbox:inbox"]').count(), 4000)) &&
  await page.locator('[data-status-key="provenance:origin"]').count() === 1)
await settingsAi(page)
check("Settings > AI: Use AI, on", (await aiSwitch(page).getAttribute("aria-checked")) === "true")
check("...its line says it all works without", (await page.locator('[data-settings-row="ai"]').innerText()).includes("Vaultite works fully without them"))
await until(() => page.locator("[data-ai-agents] [data-ai-agent], [data-ai-none]").count(), 8000)
const rows = await page.locator("[data-ai-agent]").evaluateAll((els) => els.map((e) => ({ text: e.textContent, tip: e.getAttribute("data-tip") })))
check("...coding agents found here: no path in a row, the path as its tooltip", rows.every((r) => !r.text.includes("/") && !!r.tip), rows)
check("...one plain line on what they are", (await page.locator("[data-ai-agents]").innerText()).includes("Agents run in Vaultite's terminals. Your companion is the one you talk to."))
check("...no install instructions", !(await page.locator("[data-ai-agents] code").count()) && !(await page.locator("[data-ai-agents]").innerText()).includes("npm i"))
check("...Connect an AI app, with its one line", (await page.locator('[data-ai-part="mcp:apps"]').innerText()).includes("They can read and write your notes."))
check("...and no AI apps item of its own in the menu", !(await page.locator('[data-settings-nav="mcp:apps"]').count()))
await page.screenshot({ path: `${OUT}aiswitch-on-light.png` })
const search = page.locator("[data-settings-search] input")
await search.fill("use ai"); await wait(300)
check("Settings' search finds Use AI, its switch right there", await page.locator('[data-settings-result="ai"] [role=switch]').count() === 1)
await search.fill("coding agents"); await wait(300)
check("...and Coding agents", await page.locator('[data-settings-result="coding-agents"]').count() === 1)
await search.fill("")
if (rows.length) {
  await page.locator("[data-ai-agent]").first().hover(); await wait(900)
  await page.screenshot({ path: `${OUT}aiswitch-on-tip.png` })
  await page.mouse.move(5, 5)
}

// ---------- off: nothing for AI, the plugins' own switches untouched
await aiSwitch(page).click()
check("off: plugins.json says ai false, its lists as they were", !!(await until(() => conf().ai === false, 4000)) && lists(conf()) === before, conf())
check("...the section keeps only the switch, off", !!(await until(async () => !(await page.locator("[data-ai-agents]").count()) && !(await page.locator("[data-ai-part]").count()), 3000))
  && (await aiSwitch(page).getAttribute("aria-checked")) === "false")
await wait(400) // (the switch's slide)
await page.screenshot({ path: `${OUT}aiswitch-off-light.png` })
check("...nor any plugin's settings under it (the Agents panel's, MCP's, the Inbox's)", !(await page.locator("[data-settings-member]").count()))
// (in the same page: what the plugins registered goes as AI does, not at the next reload)
await page.evaluate((n) => { location.hash = `#file/${encodeURIComponent(n)}` }, NOTE); await page.waitForSelector("main"); await wait(800)
check("...at once, no reload: no Open Claude Code, Ask the companion or the Agents panel's settings", !(await hasCommand(page, "Open Claude Code")) &&
  !(await hasCommand(page, "Ask the companion")) && !(await hasCommand(page, "Sort agents by")) && !(await hasCommand(page, "Agents at work")))
check("...nor who wrote a line, MCP's settings, the Inbox's agents' answers or Connections", !(await hasCommand(page, "Label who wrote it")) &&
  !(await hasCommand(page, "Open MCP settings")) && !(await hasCommand(page, "Agents' answers")) && !(await hasCommand(page, "Open connections")))
check("...the inbox itself stays (the app's notices)", await hasCommand(page, "Open inbox"))
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await page.waitForSelector("main"); await wait(1500)
// (an item that draws nothing keeps its empty slot: Agents at work's, with no agent at work)
const keys = await page.locator("[data-status-key]").evaluateAll((els) => els.filter((e) => e.childElementCount).map((e) => e.getAttribute("data-status-key")))
check("...no companion, token count, agents or who wrote it in the status bar", !keys.some((k) => /^(companion|token-count|provenance|review):|^terminal:agents$/.test(k)), keys)
check("...nor the Inbox panel", !(await page.locator('[data-panel="inbox:inbox"]').count()))
check("...no agent commands (nor their keys): Open Claude Code, Ask the companion, Ask an agent", !(await hasCommand(page, "Open Claude Code")) && !(await hasCommand(page, "Ask the companion")) && !(await hasCommand(page, "Ask an agent")))
check("...plain terminals stay", await hasCommand(page, "Open terminal"))
await page.keyboard.press("ControlOrMeta+Shift+k"); await wait(500)
check("...⌘⇧K (the companion's) does nothing", !(await page.locator("[data-companion-ask], [data-ask-box]").count()))
await page.goto("about:blank"); await page.goto(`${B}#plugins`); await until(() => page.locator("[data-plugin-row]").count(), 6000)
check("...the Plugins page lists no plugin for AI, Screen neither", !(await page.locator('[data-plugin-row="claude-code"], [data-plugin-row="companion"], [data-plugin-row="token-count"], [data-plugin-row="screen"], [data-plugin-members~="claude-code"]').count()))
await command(page, "New tab"); await wait(800)
check("...a new tab has no Connect your AI", !(await page.locator("[data-newtab-connect]").count()))
const version = await api("POST", "ops/app.version", {})
check("...ops still answer", !!version && typeof version === "object" && !version.error, version)
const mcp = async (body, sid) => {
  const r = await fetch(`${B}api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "Mcp-Session-Id": sid } : {}) }, body: JSON.stringify(body) })
  const text = await r.text()
  return { sid: r.headers.get("mcp-session-id") ?? sid, body: text ? JSON.parse(text) : null }
}
const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qa", version: "1" } } })
await mcp({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sid)
const tools = (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, init.sid)).body?.result?.tools ?? []
check("...and MCP: its tools are there (search, write_file)", tools.some((t) => t.name === "write_file") && tools.some((t) => t.name === "search"), tools.map((t) => t.name).slice(0, 12))
check("...the CLI's ai op says so", (await api("POST", "ops/ai.set", {})).ai === false)

// ---------- on again: as it was
await settingsAi(page)
await aiSwitch(page).click()
check("on again: plugins.json without ai, its lists as they were", !!(await until(() => !("ai" in conf()), 4000)) && lists(conf()) === before, conf())
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await page.waitForSelector("main")
check("...the companion and the token count are back", !!(await until(async () =>
  (await page.locator('[data-status-key="companion:status"]').count()) && (await page.locator('[data-status-key^="token-count:"]').count()), 6000)))
check("...and Open Claude Code", await hasCommand(page, "Open Claude Code"))
await ctx.close()

// ---------- dark, and a phone
const dark = await open(1280, 800, "dark")
await settingsAi(dark.page); await until(() => dark.page.locator("[data-ai-agent], [data-ai-none]").count(), 8000); await wait(400)
await dark.page.screenshot({ path: `${OUT}aiswitch-on-dark.png` })
await dark.ctx.close()
for (const scheme of ["light", "dark"]) {
  const phone = await open(390, 844, scheme, true)
  await phone.page.goto("about:blank"); await phone.page.goto(`${B}#settings`); await wait(1200)
  await phone.page.locator('[data-settings-nav="ai"]').click()
  check(`phone (${scheme}): AI opens as a sheet with the switch`, !!(await until(() => phone.page.locator('dialog[open] [data-settings-row="ai"]').count(), 5000)))
  await until(() => phone.page.locator("dialog[open] [data-ai-agent], dialog[open] [data-ai-none]").count(), 8000); await wait(600)
  const h = await phone.page.locator('dialog[open] [data-settings-row="ai"]').evaluate((e) => e.getBoundingClientRect().height)
  check(`...its row a finger tall (${Math.round(h)}px)`, h >= 44, h)
  await phone.page.screenshot({ path: `${OUT}aiswitch-phone-${scheme}.png` })
  await phone.ctx.close()
}
await api("POST", "ops/settings.set", { name: "plugins", values: { ai: null } })
if (hadSidebars === null) rmSync(SIDEBARS, { force: true }); else writeFileSync(SIDEBARS, hadSidebars)
await done()
