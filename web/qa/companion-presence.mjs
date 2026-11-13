// Companion, its cursor's states: each shows by itself, unhovered and long after it began, on a desktop (a phone has no
// cursor: companion-phone.mjs):
// reading and thinking its dots (thinking bobs), starting its dots and word, writing its name, a question its word,
// listening a wave, words waiting for the user's pause its dots, idle it goes home; a bubble never shows without words.
// On a Mac, dictation end to end in the app (its helper's events played): it listens where they speak, what it says
// meanwhile waits as dots and shows at their pause, and the words they go on saying don't take it away before it showed.
// WRITES "QA presence/" and the plugin's data.json: throwaway server only.
//   node web/qa/companion-presence.mjs <base url> <vault path>
import { _electron } from "playwright-core"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { app as appOf } from "./lib/app.mjs"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = keep(".vaultite/plugins/companion/data.json")
const enc = encodeURIComponent
const http = (base) => ({
  api: (method, p, body) => fetch(`${base}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json()),
  /** An op as the companion's agent calls it (vau run by Claude Code). */
  op: (id, params = {}) => fetch(`${base}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json()),
})
const { api, op } = http(B)
/** Past its name's own time (3 s after it acted, 8 s for the arrow to dim): what shows now shows for its state alone. */
const LATER = 4500

/** Claude's cursor as drawn: its state, whether its flag shows, its mark, its bubble's words. */
const cursorOf = (page) => page.evaluate(() => {
  const c = document.querySelector('.companion-cursor[data-agent="Claude"]')
  if (!c) return null
  const f = c.querySelector("[data-companion-flag]"), s = f?.querySelector("[data-companion-sign]"), b = c.querySelector("[data-companion-bubble]")
  const r = f?.getBoundingClientRect(), sr = s?.getBoundingClientRect()
  return { state: c.dataset.state, docked: c.hasAttribute("data-docked"), cursor: Number(getComputedStyle(c).opacity), flag: f ? Number(getComputedStyle(f).opacity) : 0,
    onScreen: !!r && r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
    sign: s?.dataset.companionSign ?? null, signShown: !!sr && sr.width > 0 && sr.height > 0, words: f?.textContent ?? "",
    bob: !!c.querySelector(".companion-bob"), bubble: b ? (b.querySelector(".companion-md")?.textContent ?? "").trim() : null, bubbles: c.querySelectorAll("[data-companion-bubble]").length }
})
/** Its flag shows, on screen, with `sign` (null: none), without the pointer on it. */
const shows = (c, sign) => !!c && !c.docked && c.cursor > 0.9 && c.flag > 0.9 && c.onScreen && c.sign === sign && (sign === null || c.signShown)

// ---------- a desktop's window: the server's states as an agent's ops make them, then each
// state played to the window's socket (as the server would say it)

await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
{
  const L = "desktop", NOTE = `QA presence/${L}.md`
  await api("PUT", "file", { path: NOTE, text: "# Garden\n\nTomatoes along the fence.\n\nBasil between them.\n" })
  await op("companion.next", { timeout: 0 }) // (what came before: and it's around, so an ask wakes no session)
  await op("companion.clear")
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } })
  await ctx.addInitScript(() => {
    const W = window.WebSocket
    window.WebSocket = class extends W {
      constructor(...a) { super(...a); if (String(a[0]).includes("companion/live")) window.__companion = this }
    }
    window.__play = (m) => window.__companion.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(m) }))
  })
  const page = watch(await ctx.newPage(), { label: L }), ui = appOf(page)
  await page.goto(`${B}/#file/${enc(NOTE)}`)
  const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
  await editor.waitFor({ timeout: 15000 })
  await until(() => page.evaluate(() => window.__companion?.readyState === 1), 10000)
  await ui.idle()
  const away = () => page.mouse.move(2, 2)
  const at = (text) => editor.locator(".cm-line", { hasText: text }).click({ position: { x: 2, y: 4 } })
  await op("companion.look", { path: NOTE, find: "Basil" })
  await until(async () => (await cursorOf(page))?.onScreen, 5000)

  // What they write, handed: it reads, its dots showing all along.
  await at("Tomatoes")
  await page.keyboard.press("End")
  await page.keyboard.type(" Cherry ones.", { delay: 20 })
  await away()
  const r = await until(async () => { const x = await op("companion.next", { timeout: 3 }); return x.moments?.find((m) => m.kind === "edit") ? x : null }, 8000)
  await wait(LATER)
  let c = await cursorOf(page)
  check(`${L}: reading, its flag and dots show unhovered, long after it began`, !!r && c?.state === "reading" && shows(c, "dots"), c)
  await page.screenshot({ path: `/tmp/companion-presence-${L}-reading.png` })

  // An ask: it thinks, dots and a bob, however long it takes.
  await op("companion.next", { timeout: 0 })
  await at("Basil")
  await page.keyboard.press("End")
  await page.keyboard.type(" @claude how far apart?", { delay: 15 })
  await page.keyboard.press("Enter")
  await away()
  const asked = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 6000)
  await wait(LATER)
  c = await cursorOf(page)
  check(`${L}: thinking, its flag, dots and bob show unhovered, long after it began`, !!asked && c?.state === "thinking" && shows(c, "dots") && c.bob, c)

  // Its words: a bubble with them, its dots on while it's still on the ask.
  await op("companion.say", { text: "About a foot apart." })
  c = await until(async () => { const x = await cursorOf(page); return x?.bubble ? x : null }, 4000).then(async (x) => (x ? (await ui.idle(), cursorOf(page)) : x))
  check(`${L}: a say shows its words in a bubble, its flag up, still thinking`, c?.bubble === "About a foot apart." && shows(c, "dots"), c)
  await op("companion.next", { timeout: 0 })
  await op("companion.clear")

  // Each state as the server says it, long after it began: nothing hovered, each shows.
  const base = { name: "Claude", tint: "orange", path: NOTE, line: 5, find: "Basil", t: Date.now() - 20_000 }
  const played = async (a) => { await page.evaluate((x) => window.__play({ t: "agent", agent: x }), { ...base, ...a }); await ui.idle(); return cursorOf(page) }
  c = await played({ state: "starting" })
  check(`${L}: starting, its flag, word and dots show`, shows(c, "dots") && c.words.includes("starting"), c)
  c = await played({ state: "listening" })
  check(`${L}: listening, its flag and a wave show`, shows(c, "wave"), c)
  c = await played({ state: "writing" })
  check(`${L}: writing, its flag shows`, shows(c, null), c)
  c = await played({ state: "thinking", asks: { event: "chat:q", text: "Run vau tabs?" } })
  check(`${L}: asking leave, its flag says it needs you`, shows(c, null) && c.words.includes("needs you"), c)
  c = await played({ state: "watching", seen: true, why: "not for me" })
  check(`${L}: watching a while, it goes home: nothing of it in the note`, !!c && c.docked, c)

  // A bubble with no words yet is none; its words come, it shows them.
  await page.evaluate((p) => window.__play({ t: "note", note: { id: "qempty", kind: "say", agent: "Claude", text: " ", path: p, line: 5, t: Date.now() } }), NOTE)
  await ui.idle()
  c = await cursorOf(page)
  check(`${L}: a say with no words draws no bubble`, c?.bubbles === 0, c)
  await page.evaluate((p) => window.__play({ t: "note", note: { id: "qempty", kind: "say", agent: "Claude", text: "Here.", path: p, line: 5, t: Date.now() } }), NOTE)
  c = await until(async () => { const x = await cursorOf(page); return x?.bubble ? x : null }, 3000).then(async (x) => (x ? (await ui.idle(), cursorOf(page)) : x))
  check(`${L}: its words come, the bubble shows them`, c?.bubble === "Here." && shows(c, "tick"), c)
  await page.screenshot({ path: `/tmp/companion-presence-${L}-said.png` })
  await page.evaluate(() => window.__play({ t: "drop", id: "qempty" }))
  await ctx.close()
}
await op("companion.next", { timeout: 0 })
await op("companion.clear")
restore()

// ---------- dictation, in the app on a Mac: the helper's events played from the main process, no microphone

if (process.platform === "darwin") await dictated()
else console.log("skip dictation: a Mac's")
await done()

async function dictated() {
  const TMP = mkdtempSync(path.join(os.tmpdir(), "vau-presence-")), V = path.join(TMP, "vault"), NOTE = "Spoken.md"
  mkdirSync(path.join(V, ".vaultite", "plugins", "companion"), { recursive: true })
  writeFileSync(path.join(V, ".vaultite", "plugins", "companion", "data.json"), JSON.stringify({ mode: "pair", pause: 1 }))
  writeFileSync(path.join(V, NOTE), "# Spoken\n\nShopping:")
  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", V],
    env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
  })
  try {
    // (the helper stands in: it says it can, starts at once, and ends when asked; its events are ours to send)
    await app.evaluate(({ ipcMain, webContents }) => {
      const tell = (e) => { for (const w of webContents.getAllWebContents()) w.send("vaultite:dictation", e) }
      globalThis.__tell = tell
      for (const ch of ["dictation:engines", "dictation:start", "dictation:stop", "dictation:cancel"]) ipcMain.removeHandler(ch)
      ipcMain.handle("dictation:engines", () => ({ apple: true, parakeet: false, locale: "en-US" }))
      ipcMain.handle("dictation:start", () => { setTimeout(() => tell({ type: "start" }), 50); return { ok: true } })
      ipcMain.handle("dictation:stop", () => { setTimeout(() => tell({ type: "end", reason: "stop" }), 20) })
      ipcMain.handle("dictation:cancel", () => { setTimeout(() => tell({ type: "end", reason: "cancel" }), 20) })
    })
    const tell = (e) => app.evaluate((_, x) => globalThis.__tell(x), e)
    const win = watch(await app.firstWindow(), { label: "app" })
    await win.waitForSelector("[role=tree]", { timeout: 60000 })
    const { op: aop } = http(new URL(win.url()).origin)
    await win.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, NOTE)
    const editor = win.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
    await editor.waitFor({ timeout: 15000 })
    await wait(1200)
    await aop("companion.next", { timeout: 0 })
    await aop("companion.look", { path: NOTE, find: "Spoken" })
    await until(async () => (await cursorOf(win))?.onScreen, 5000)
    await editor.locator(".cm-line", { hasText: "Shopping:" }).click({ position: { x: 2, y: 4 } })
    await win.keyboard.press("End")
    await win.mouse.move(2, 2)
    await win.keyboard.press("Meta+J")
    await until(() => win.evaluate(() => document.querySelector(".dictation-pill")?.hasAttribute("data-ready")), 5000)
    await wait(LATER)
    let c = await cursorOf(win)
    check("dictating: it listens where they speak, its flag and wave showing all along", c?.state === "listening" && shows(c, "wave"), c)

    // It says something while they speak: it waits for their pause, as dots, no bubble.
    await tell({ type: "speech" })
    await tell({ type: "pending", text: "eggs and" })
    await wait(300)
    await aop("companion.say", { text: "Milk too?" })
    await wait(600)
    c = await cursorOf(win)
    check("dictating: what it says while they speak waits, its dots showing, no bubble", c?.bubbles === 0 && shows(c, "dots"), c)

    // Their pause, a while on: the clause settles and the bubble shows, its words in it, and the settling doesn't take it
    // away (it waited longer than a bubble's first moment, which counts from when it shows).
    await tell({ type: "pending", text: "eggs and bread" })
    await wait(1500)
    await tell({ type: "pending", text: "" })
    await tell({ type: "final", text: "eggs and bread." })
    await tell({ type: "pause", ms: 700 })
    c = await until(async () => { const x = await cursorOf(win); return x?.bubble ? x : null }, 3000)
    check("dictating: at their pause its bubble shows, with its words", c?.bubble === "Milk too?", c)
    await tell({ type: "speech" })
    await tell({ type: "final", text: "Butter." })
    await tell({ type: "pause", ms: 700 })
    await wait(300)
    c = await cursorOf(win)
    check("dictating: their next words, right after it showed, leave it showing", c?.bubble === "Milk too?", c)
    await wait(1600)
    await tell({ type: "speech" })
    await tell({ type: "final", text: "Jam." })
    await tell({ type: "pause", ms: 700 })
    await wait(400)
    c = await cursorOf(win)
    check("dictating: once it showed a moment, speaking on takes it away (as writing on does)", c?.bubbles === 0, c)

    // A longer pause hands what they said: it reads, dots over the wave; they stop, and it's back to watching.
    await tell({ type: "pause", ms: 2000 })
    const got = await until(async () => { const x = await aop("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "edit") ? x : null }, 8000)
    await wait(400)
    c = await cursorOf(win)
    check("dictating: handed what they said, it reads (dots), though they still dictate", !!got && c?.state === "reading" && shows(c, "dots"), c)
    // (each clause they settled was an edit too: its turns end on what's left)
    const until_ = (state) => until(async () => { await aop("companion.next", { timeout: 0 }); await wait(150); const x = await cursorOf(win); return x?.state === state ? x : null }, 6000)
    c = await until_("listening")
    check("dictating: its turn over, it listens again at once", shows(c, "wave"), c)
    await win.keyboard.press("Meta+J")
    c = await until_("watching")
    check("dictation over: it stops listening", c?.state === "watching" && c.sign !== "wave", c)
  } finally {
    await app.close().catch(() => {})
    rmSync(TMP, { recursive: true, force: true })
  }
}
