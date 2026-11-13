// Companion on a phone: no cursor, a caret where it points, its words in a card by the thumb; a desktop's cursor.
// WRITES "QA phone/" and the plugin's data.json: throwaway server only.
//   node web/qa/companion-phone.mjs <base url> <vault path>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url, { motion: true })
const B = BASE.replace(/\/+$/, ""), OUT = "/tmp/companion-phone-"
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = keep(".vaultite/plugins/companion/data.json")
const enc = encodeURIComponent
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const moment = (kind, ms = 6000) => until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === kind) ?? null }, ms)

const NOTE = "QA phone/Garden.md"
const TEXT = ["# Garden", "", "Tomatoes along the fence.", "", "Basil between them.", "", ...Array.from({ length: 50 }, (_, i) => `Row ${i + 1}: notes on bed ${i + 1}.`), "", "Last line here.", ""].join("\n")
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
await api("PUT", "file", { path: NOTE, text: TEXT })
await op("companion.next", { timeout: 0 })
await op("companion.clear")

async function open(o) {
  const ctx = await browser.newContext(o)
  await ctx.addInitScript(() => {
    const W = window.WebSocket
    window.WebSocket = class extends W { constructor(...a) { super(...a); if (String(a[0]).includes("companion/live")) window.__companion = this } }
    window.__play = (m) => window.__companion.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(m) }))
  })
  const page = watch(await ctx.newPage(), { label: o.label })
  await page.goto(`${B}/#file/${enc(NOTE)}`)
  await page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 15000 })
  await until(() => page.evaluate(() => window.__companion?.readyState === 1), 10000)
  await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important; }" })
  const ui = app(page)
  await ui.idle()
  return { ctx, page, ui }
}
const seen = (page) => page.evaluate(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
  const caret = document.querySelector("[data-companion-caret]:not([data-gone])"), card = document.querySelector("[data-companion-card]"), chip = document.querySelector("[data-companion-edge]")
  const bar = [...document.querySelectorAll("[data-phone-bar]")].map((e) => e.getBoundingClientRect()).find((b) => b.height)
  return { cursors: document.querySelectorAll(".companion-cursor").length, carets: document.querySelectorAll("[data-companion-caret]:not([data-gone])").length,
    caret: caret && { ...r(caret), doing: caret.dataset.doing, flag: caret.querySelector("[data-companion-flag]")?.textContent, dots: !!caret.querySelector(".companion-dots"), tick: !!caret.querySelector('[data-companion-sign="tick"]') },
    flash: r(document.querySelector("[data-companion-flash]")), flashAnim: (() => { const f = document.querySelector("[data-companion-flash]"); return f ? getComputedStyle(f).animationName : null })(),
    card: card && { ...r(card), kind: card.dataset.companionCard, text: card.textContent }, chip: chip && { ...r(chip), dir: chip.dataset.dir, text: chip.textContent },
    barTop: bar ? Math.round(bar.top) : innerHeight, width: innerWidth }
})
const lineBox = (page, text) => page.locator(".cm-line", { hasText: text }).first().boundingBox()
const arrived = (page, sel) => page.locator(sel).first().evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)))
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
const near = (caret, box) => !!caret && !!box && caret.y >= box.y - 4 && caret.y + caret.h <= box.y + box.height + 4

{
  const { ctx, page, ui } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, label: "phone" })
  let s = await seen(page)
  check("phone: at rest, nothing of it in the note (no cursor, no caret, no card)", s.cursors === 0 && s.carets === 0 && !s.card && !s.chip, s)

  await op("companion.look", { path: NOTE, find: "Basil" })
  s = await until(async () => { const x = await seen(page); return x.caret ? x : null }, 3000)
  const basil = await lineBox(page, "Basil between them")
  check("phone: a look shows its caret at that line, with its name", s?.caret?.doing === "pointing" && near(s.caret, basil) && s.caret.flag?.startsWith("Claude") && s.cursors === 0, { s, basil })
  check("phone: and lights the line a moment", !!s?.flash && Math.abs(s.flash.y - basil.y) < 8, s?.flash)
  await arrived(page, "[data-companion-caret]")
  await page.screenshot({ path: `${OUT}look.png` })
  s = await until(async () => { const x = await seen(page); return x.carets === 0 && !x.flash ? x : null }, 5000)
  check("phone: the look's caret and light go after a moment", !!s, await seen(page))

  await page.getByRole("button", { name: "Edit", exact: true }).tap()
  await page.locator(".cm-line", { hasText: "Tomatoes along" }).first().tap({ position: { x: 4, y: 4 } })
  await page.keyboard.press("End")
  await page.keyboard.type(` @claude how far apart, run ${Date.now() % 1000}?`, { delay: 15 })
  await page.keyboard.press("Enter")
  const asked = await moment("ask", 10000)
  s = await until(async () => { const x = await seen(page); return x.caret?.doing === "thinking" ? x : null }, 4000)
  const tom = await lineBox(page, "Tomatoes along")
  check("phone: an ask sent from here, its caret thinks at that line, dots on its flag", !!asked && s?.caret?.dots && near(s.caret, tom), { asked: !!asked, s, tom })
  await arrived(page, "[data-companion-caret]")
  await page.screenshot({ path: `${OUT}thinking.png` })

  await op("companion.say", { text: "About **a foot** apart. Basil stays smaller, so it fits between the tomatoes and shades their roots." })
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "say" ? x : null }, 4000).then(async (x) => (x ? (await arrived(page, "[data-companion-card]"), seen(page)) : x))
  const field = page.getByRole("textbox", { name: "Reply to Claude" }), fb = await field.boundingBox()
  const put = await page.locator("[data-companion-card] button[aria-label='Put in note']").boundingBox()
  check("phone: a say is a card at the bottom, inside the screen, over the bar", !!s && s.card.text.includes("About a foot apart") && s.card.x >= 0 && s.card.x + s.card.w <= s.width && s.card.y + s.card.h <= s.barTop && s.card.y > s.barTop - 330, s)
  check("phone: its reply box and buttons are a finger's size", (fb?.height ?? 0) >= 44 && (put?.width ?? 0) >= 36, { fb, put })
  check("phone: still thinking meanwhile", s?.caret?.doing === "thinking", s?.caret)
  await page.screenshot({ path: `${OUT}say.png` })
  await field.fill("Thanks, and how deep?")
  await field.press("Enter")
  const reply = await moment("reply")
  check("phone: a reply from the card reaches it, and the card goes", reply?.text === "Thanks, and how deep?" && !(await seen(page)).card, reply)
  await op("companion.next", { timeout: 0 })
  s = await until(async () => { const x = await seen(page); return x.carets === 0 ? x : null }, 3000)
  check("phone: its turn over, the caret goes", !!s, await seen(page))

  await page.getByRole("button", { name: "Read", exact: true }).tap().catch(() => {})
  const typing = op("companion.edit", { path: NOTE, after: "Basil between them.", text: "Water both in the morning, at the roots, never the leaves; mulch keeps the soil even through the summer heat and spares a second watering." })
  s = await until(async () => { const x = await seen(page); return x.caret?.doing === "writing" ? x : null }, 4000, 30)
  check("phone: writing, its caret where it types, its name on it", !!s && s.caret.flag?.startsWith("Claude") && s.caret.y > (await lineBox(page, "Basil between them")).y - 4, s)
  await arrived(page, "[data-companion-caret]")
  await page.screenshot({ path: `${OUT}writing.png` })
  await typing
  s = await until(async () => { const x = await seen(page); return x.carets === 0 ? x : null }, 4000)
  check("phone: written, the caret goes", !!s, await seen(page))

  await page.evaluate(() => { const p = document.querySelector("[data-pane]"); if (p) p.scrollTop = 0; scrollTo(0, 0) })
  await ui.idle()
  const below = op("companion.edit", { path: NOTE, after: "Last line here.", text: "A last row, written while you were reading the top: peppers along the south wall, where the wall keeps the evening warm; three plants, staked early, picked green." })
  s = await until(async () => { const x = await seen(page); return x.chip ? x : null }, 4000, 30)
  check("phone: writing below the screen, a chip at the bottom says so", s?.chip?.dir === "down" && /Claude is writing/.test(s.chip.text) && s.chip.y + s.chip.h <= s.barTop && s.carets === 0, s)
  if (s?.chip) await arrived(page, "[data-companion-edge]")
  await page.screenshot({ path: `${OUT}chip.png` })
  if (s?.chip) await page.locator("[data-companion-edge]").tap()
  const last = await until(async () => { const box = await page.locator(".cm-line", { hasText: "Last line here" }).first().boundingBox({ timeout: 100 }); return box && box.y > 0 && box.y < 844 ? box : null }, 3000)
  check("phone: the chip tapped, the note scrolls to where it writes", !!last && last.y > 0 && last.y < 844, last)
  await below
  await until(async () => (await seen(page)).carets === 0, 4000)

  await op("companion.say", { text: "Swipe me away." })
  const card = page.locator("[data-companion-card='say']")
  await card.waitFor({ timeout: 3000 })
  await arrived(page, "[data-companion-card]")
  const head = await card.locator("[data-swipe]").last().boundingBox()
  const cdp = await ctx.newCDPSession(page), pt = (y) => [{ x: head.x + 60, y }]
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(head.y + 10) })
  for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(head.y + 10 + i * 18) }); await frame(page) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  s = await until(async () => { const x = await seen(page); return !x.card ? x : null }, 2000)
  check("phone: a card swiped down goes", !!s, await seen(page))
  await page.evaluate(() => window.__play({ t: "said", said: [{ id: "qunseen", kind: "say", agent: "Claude", text: "Swipe me away, or read me later.", t: Date.now() }] }))
  const face = page.locator('[data-companion-presence]:visible button[data-agent="Claude"]')
  check("phone: what it said unseen, a dot on its face", await until(() => face.locator("[data-companion-unread]").count(), 3000) > 0)
  await face.dispatchEvent("click")
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "conversation" ? x : null }, 3000).then(async (x) => (x ? (await arrived(page, "[data-companion-card]"), seen(page)) : x))
  check("phone: its face tapped, its conversation at the bottom, what it said in it", !!s && s.card.text.includes("Swipe me away") && s.card.x >= 0 && s.card.x + s.card.w <= s.width && s.card.y + s.card.h <= s.barTop, s)
  await page.screenshot({ path: `${OUT}conversation.png` })
  await page.touchscreen.tap(200, 240)
  check("phone: a tap outside closes its conversation", await until(async () => (await seen(page)).card === null, 2000), await seen(page))

  const base = { name: "Claude", tint: "orange", path: NOTE, line: 5, find: "Basil", t: Date.now() - 20_000 }
  await page.evaluate((a) => window.__play({ t: "agent", agent: a }), { ...base, state: "thinking", asks: { event: "chat:q", text: "Run vau tabs to see what's open?" } })
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "ask" ? x : null }, 3000)
  const approve = await page.locator("[data-companion-card='ask'] [data-gate='approve']").boundingBox()
  check("phone: asking leave, a card with Deny and Approve by the thumb, no caret for it", !!s && /needs you/.test(s.card.text) && (approve?.height ?? 0) >= 44 && s.carets === 0, { s, approve })
  await arrived(page, "[data-companion-card]")
  await page.screenshot({ path: `${OUT}ask.png` })
  await page.evaluate((a) => window.__play({ t: "agent", agent: a }), { ...base, state: "watching", seen: true, why: "not for me" })
  s = await until(async () => { const x = await seen(page); return x.carets === 0 && !x.card ? x : null }, 4000) ?? await seen(page)
  check("phone: at rest again, nothing of it (no cursor, caret, chip or card), however it was left", s.cursors === 0 && s.carets === 0 && !s.chip && !s.card, s)
  await ctx.close()
}

{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", label: "still" })
  await op("companion.look", { path: NOTE, find: "Tomatoes" })
  const s = await until(async () => { const x = await seen(page); return x.caret && x.flash ? x : null }, 3000)
  check("reduced motion: its caret and the lit line, unanimated", !!s && s.flashAnim === "none", s)
  await ctx.close()
}

{
  const { ctx, page } = await open({ viewport: { width: 1300, height: 850 }, label: "desktop" })
  await op("companion.look", { path: NOTE, find: "Basil" })
  await op("companion.say", { text: "On a desktop, by its cursor." })
  const s = await until(async () => { const x = await page.evaluate(() => ({ cursor: !!document.querySelector('.companion-cursor[data-agent="Claude"]:not([data-docked])'), bubble: !!document.querySelector(".companion-cursor [data-companion-bubble]"),
    caret: document.querySelectorAll("[data-companion-caret]").length, card: document.querySelectorAll("[data-companion-card]").length })); return x.bubble ? x : null }, 4000)
  check("desktop: its cursor and a bubble by it, no caret or card", !!s && s.cursor && s.caret === 0 && s.card === 0, s)
  await page.screenshot({ path: `${OUT}desktop.png` })
  await ctx.close()
}

await op("companion.next", { timeout: 0 })
await op("companion.clear")
rmSync(file("QA phone"), { recursive: true, force: true })
restore()
await done()
