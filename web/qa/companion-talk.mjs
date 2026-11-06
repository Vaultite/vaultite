// The Conversations panel's Talk: the day's talk with the companion as a chat, oldest first, kept at its end; an ask from
// its line shows at once, reaches the companion, and its answer comes in live. A note with threads shows Comments (they
// stay when the last is resolved), one without the talk. Desktop light and dark, a phone's right drawer, the panel's tab.
// WRITES "QA talk/", the plugin's data.json and the vault's sidebars: throwaway server only.
//   node web/qa/companion-talk.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/companion-talk-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json"), keep(".vaultite/sidebars.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
/** An op as the companion's agent calls it (`vau` under Claude Code). */
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const enc = encodeURIComponent
const next = (kind, ms = 6000) => until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === kind) ?? null }, ms)

const plugins = JSON.parse(readFileSync(file(".vaultite/plugins.json"), "utf8") || "{}")
if (!(plugins.enabled ?? []).includes("companion")) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2))
  await wait(1500)
}
await api("PATCH", "config/plugin/companion", { mode: "quiet" })
const DIR = "QA talk", PLAIN = `${DIR}/Plain.md`, THREADS = `${DIR}/Threads.md`
rmSync(file(DIR), { recursive: true, force: true })
await api("PUT", "file", { path: PLAIN, text: "# Plain\n\nNothing to talk about here.\n" })
await api("PUT", "file", { path: THREADS, text: "# Threads\n\nTomatoes along the fence.\n\nBasil between them.\n" })
await api("POST", "ops/panel.right", { panel: "conversations", vault: true })
await op("companion.next", { timeout: 0 }) // (it's around: asks reach it, nothing starts)
await op("companion.clear")

const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("vaultite.prefs") || "{}"), rightSidebar: true })) } catch { /* private */ } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${enc(PLAIN)}`)
await page.locator(`.file-view[data-path="${PLAIN}"]:visible .cm-content`).waitFor({ timeout: 15000 })
const panel = page.locator('aside[data-side="right"] [data-companion-panel]')
await panel.waitFor({ timeout: 8000 })
check("a note without threads shows the talk", (await panel.getAttribute("data-tab")) === "talk")

// Asks from its line: each shows at once, reaches the companion, its answer comes in without a reload.
const ASKS = ["What's on my plate today?", "Remind me what Alice said about the launch.", "How long is the Lisbon trip?", "Any notes on Thinking in Systems?", "Thanks, that's all."]
const line = panel.locator("[data-ask-line] textarea")
for (const [i, q] of ASKS.entries()) {
  await line.fill(q)
  await line.press("Enter")
  if (i === 0) check("an ask shows at once", await until(async () => (await panel.locator("[data-companion-turn]").last().innerText()).includes(q), 400))
  const m = await next("ask")
  if (i === 0) check("it reaches the companion, not tied to a note", m?.text === q && !m.path, m)
  await op("companion.say", { text: `Answer ${i + 1}: ${"here's what I found. ".repeat(i + 2).trim()}` })
  await op("companion.next", { timeout: 0 })
  if (i === 0) check("its answer comes in live", await until(async () => (await panel.locator("[data-companion-turn]").last().innerText()).includes("Answer 1:"), 9000))
}
check("every answer comes in", await until(async () => (await panel.innerText()).includes("Answer 5:"), 9000))
const texts = await panel.locator("[data-companion-turn]").allInnerTexts()
check("oldest first, newest at the bottom", ASKS.every((q, i) => texts.findIndex((t) => t.includes(q)) === texts.length - ASKS.length + i), texts.map((t) => t.slice(0, 30)))
const box = panel.locator("[data-companion-talk] > .overflow-y-auto")
const at = await box.evaluate((el) => ({ over: el.scrollHeight > el.clientHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight }))
check("its box scrolls, kept at its end", at.over && at.gap < 4, at)
await page.screenshot({ path: `${OUT}desktop-light.png` })
await page.emulateMedia({ colorScheme: "dark" }); await page.evaluate(() => document.documentElement.classList.add("dark")); await wait(300)
await page.screenshot({ path: `${OUT}desktop-dark.png` })
await page.emulateMedia({ colorScheme: "light" }); await page.evaluate(() => document.documentElement.classList.remove("dark"))

// A note with threads: Comments, counted; Talk a click away; resolving the last keeps Comments.
const c = await op("companion.comment", { path: THREADS, find: "Basil between", text: "Basil keeps aphids off." })
await page.goto(`${B}/#file/${enc(THREADS)}`)
await page.locator(`.file-view[data-path="${THREADS}"]:visible .cm-content`).waitFor({ timeout: 15000 })
await panel.locator(`[data-companion-thread="${c.id}"]`).waitFor({ timeout: 6000 })
check("a note with threads shows Comments, counted", (await panel.getAttribute("data-tab")) === "note" && /Comments\s*1/.test(await panel.locator('[data-option="note"]').innerText()))
await panel.locator('[data-option="talk"]').click()
check("Talk is a click away", await until(async () => (await panel.getAttribute("data-tab")) === "talk" && (await panel.locator("[data-companion-turn]").count()) >= ASKS.length))
await panel.locator('[data-option="note"]').click()
await panel.locator(`[data-companion-thread="${c.id}"] [aria-label="Resolve"]`).click()
check("resolving the last keeps Comments", await until(async () => !(await panel.locator(`[data-companion-thread="${c.id}"]`).count())) && (await panel.getAttribute("data-tab")) === "note")
await page.locator(".file-view:visible .cm-content").first().click()
await page.goto(`${B}/#file/${enc(PLAIN)}`)
await until(async () => (await panel.getAttribute("data-tab")) === "talk")
await panel.locator("[data-companion-open-page]").click()
check("its page a click away", await until(async () => !!(await page.$("[data-companion-conversation] [data-companion-turn]")), 8000))
await ctx.close()

// A window too short for the talk: the panel keeps the room left (a panel that isn't rows was snapped to its heading,
// drawing nothing), and the wheel over the talk, at its end, goes on to bring the ask line in.
const sctx = await browser.newContext({ viewport: { width: 1280, height: 420 } })
await sctx.addInitScript(() => { try { localStorage.setItem("vaultite.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("vaultite.prefs") || "{}"), rightSidebar: true })) } catch { /* private */ } })
const short = watch(await sctx.newPage(), { label: "short window" })
await short.goto(`${B}/#file/${enc(PLAIN)}`)
const sp = short.locator('aside[data-side="right"] [data-panel="companion:conversations"]')
await sp.locator("[data-companion-turn]").first().waitFor({ timeout: 10000 })
await wait(500)
const sizes = () => sp.evaluate((p) => { const box = p.querySelector("[data-panel-scroll]"), ask = p.querySelector("[data-ask-line]")
  return { box: box.getBoundingClientRect().height, content: box.scrollHeight, askShown: ask.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1 } })
const sz = await sizes()
check("short window: the panel keeps its room, not just its heading", sz.content > sz.box && sz.box > 150, sz)
// (over the talk's top in view, clear of a toast in the corner)
const tb = await sp.locator("[data-companion-talk] > .overflow-y-auto").boundingBox()
await short.mouse.move(tb.x + tb.width / 2, tb.y + 30)
for (let i = 0; i < 6; i++) { await short.mouse.wheel(0, 120); await wait(120) }
check("short window: the wheel brings the ask line in", (await sizes()).askShown, await sizes())
await short.screenshot({ path: `${OUT}short.png` })
await sctx.close()

// The panel's tab: the talk, its line at the pane's foot.
const tctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const tab = watch(await tctx.newPage(), { label: "tab" })
await tab.goto(`${B}/#view/conversations`)
const tv = tab.locator("[data-conversations-view] [data-companion-panel]")
await tv.waitFor({ timeout: 10000 })
check("the tab: the talk", await until(async () => (await tv.getAttribute("data-tab")) === "talk" && (await tv.locator("[data-companion-turn]").count()) >= ASKS.length, 8000))
await tab.screenshot({ path: `${OUT}tab.png` })
await tctx.close()

// A phone's right drawer: the talk at a finger's sizes.
const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const pq = watch(await ph.newPage(), { label: "phone" })
await pq.goto(`${B}/#file/${enc(PLAIN)}`)
await pq.locator(`.file-view[data-path="${PLAIN}"]:visible .cm-content`).waitFor({ timeout: 15000 })
await pq.getByRole("button", { name: "Open right sidebar" }).tap()
const pp = pq.locator("[data-companion-panel]:visible")
await pp.waitFor({ timeout: 5000 })
check("phone: the drawer shows the talk", await until(async () => (await pp.getAttribute("data-tab")) === "talk" && (await pp.locator("[data-companion-turn]").count()) >= ASKS.length, 8000))
await wait(500) // (the drawer done sliding in)
const send = await pp.locator("[data-ask-line] [data-send]").boundingBox(), seg = await pp.locator('[data-option="talk"]').boundingBox()
check("phone: its targets fit a finger", !!send && send.width >= 40 && !!seg && seg.height >= 40, { send, seg })
await pq.screenshot({ path: `${OUT}phone.png` })
await ph.close()

rmSync(file(DIR), { recursive: true, force: true })
for (const r of restore) r()
await done()
