// Asks as threads: an "@claude …" line goes at Enter (or once the caret leaves it) as a comment thread by the text above,
// and leaves the note; the agent hears it with the thread's id and answers in it, and the user's replies there reach it
// without its @name. Ask (Mod+Shift+K) opens a comment that starts with @claude, on the selection, writing nothing in
// the note. An @name mid-line stays the user's prose, asked as before.
// WRITES "QA threads/" and the plugin's data.json: throwaway server only.
//   node web/qa/threads.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/threads-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
/** An op as the companion's agent calls it (`vau` under Claude Code). */
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const enc = encodeURIComponent
const next = (kind, ms = 6000) => until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === kind) ?? null }, ms)

const plugins = JSON.parse(text(".vaultite/plugins.json") || "{}")
if (!(plugins.enabled ?? []).includes("companion")) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2))
  await wait(1500)
}
await api("PATCH", "config/plugin/companion", { mode: "quiet", comments: null })
const DIR = "QA threads", NOTE = `${DIR}/Garden.md`
const SIDE = `.vaultite/plugins/companion/comments/${DIR}`
rmSync(file(DIR), { recursive: true, force: true })
rmSync(file(SIDE), { recursive: true, force: true })
await api("PUT", "file", { path: NOTE, text: "# Garden\n\nTomatoes along the fence, where it's sunny.\n\nBasil between them.\n" })
await op("companion.next", { timeout: 0 })
await op("companion.clear")

const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("vaultite.prefs") || "{}"), rightSidebar: false })) } catch { /* private */ } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${enc(NOTE)}`)
const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
await editor.waitFor({ timeout: 10000 })
await wait(1200)
await op("companion.look", { path: NOTE, find: "Basil" }) // (it's around: asks reach it, nothing starts)

// "@claude …" + Enter: a thread by the line above, out of the note.
await editor.click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("@claude how far apart should they be?\n")
const ask = await next("ask")
await until(() => !text(NOTE).includes("@claude"), 4000)
check("ask line: gone from the note at Enter", !text(NOTE).includes("@claude") && text(NOTE).includes("Basil between them."), text(NOTE))
check("ask line: the agent hears it with its thread, by the text above", !!ask?.item && ask.text === "@claude how far apart should they be?" && ask.path === NOTE, ask)
const card = page.locator(`[data-companion-note="${ask?.item}"]`)
await card.waitFor({ timeout: 4000 }).catch(() => {})
check("ask line: a card in the margin with the ask, by the user", (await card.count()) === 1 && (await card.innerText()).includes("how far apart"))
const status = await op("companion.status")
const thread = (status.notes ?? status.items ?? []).find?.((n) => n.id === ask?.item)
check("ask line: anchored on the line above", !thread || thread.find === "Basil between them.", thread)

// It answers in the thread; the user's reply there reaches it without an @name.
await op("companion.comment", { id: ask?.item, text: "About 60 cm: they get big." })
await until(async () => /1 reply/.test(await card.innerText()), 4000)
await card.click()
await until(async () => (await card.innerText()).includes("60 cm"), 4000)
check("answer: in the thread, under the ask, in Claude's name", /You[\s\S]*how far apart[\s\S]*Claude[\s\S]*60 cm/.test(await card.innerText()), await card.innerText())
await page.screenshot({ path: `${OUT}thread.png` })
await card.getByRole("textbox", { name: "Reply" }).click()
await page.keyboard.type("And the basil?")
await page.keyboard.press("Enter")
const reply = await next("reply")
check("reply: reaches the agent the thread asks, with its id", reply?.item === ask?.item && reply.text === "And the basil?", reply)

// An ask line left without Enter goes as well.
await editor.click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("@claude any pests to watch?")
await wait(300)
check("ask line: not sent while they're still on it", !(await op("companion.next", { timeout: 2 })).moments?.some((m) => m.kind === "ask"))
await editor.locator(".cm-line", { hasText: "Tomatoes" }).click()
const left = await next("ask")
await until(() => !text(NOTE).includes("pests"), 4000)
check("ask line: goes once the caret leaves it, and leaves the note", left?.text === "@claude any pests to watch?" && !text(NOTE).includes("pests"), { left, note: text(NOTE) })

// Mid-line: the user's prose stays, asked as before.
await page.keyboard.press("ControlOrMeta+End")
const MID = `Alright, how is it going @claude? ${Date.now() % 1000}`
await page.keyboard.type(`\n${MID}`)
const mid = await next("ask", 8000)
check("mid-line: asked at the pause, the line kept", mid?.text === MID && !mid.item && text(NOTE).includes(MID), mid)

// Ask: a comment that starts with @claude, on the selection; nothing written in the note.
const before = text(NOTE)
await editor.locator(".cm-line", { hasText: "Tomatoes" }).click({ position: { x: 2, y: 5 } })
await page.keyboard.press("Home")
await page.keyboard.press("Shift+Alt+ArrowRight")
await page.keyboard.press("ControlOrMeta+Shift+K")
const input = page.locator('[data-companion-note="draft"] input')
await input.waitFor({ timeout: 3000 }).catch(() => {})
check("Ask: a comment box that starts with @claude", (await input.inputValue().catch(() => "")) === "@claude ")
await page.keyboard.type("is this spelled right?")
await page.keyboard.press("Enter")
const sel = await next("ask")
check("Ask: the agent hears it with the selection, in its thread", !!sel?.item && sel.text === "@claude is this spelled right?" && sel.selection === "Tomatoes", sel)
check("Ask: the note unchanged", text(NOTE) === before)
await page.screenshot({ path: `${OUT}ask.png` })

await ctx.close()
await op("companion.clear")
rmSync(file(DIR), { recursive: true, force: true })
rmSync(file(SIDE), { recursive: true, force: true })
for (const r of restore) r()
await done()
