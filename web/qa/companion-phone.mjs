// Companion on a phone: no cursor, ever. Nothing of it at rest; a caret with its name where it points (its line lit a
// moment), thinks on an ask sent from the phone, or writes, gone after; a chip at the edge when that's off screen, which
// scrolls there; its words in a card by the thumb (a reply sent from it, swiped away, the unread dot on its face, which
// opens its conversation); its leave asked in a card. Reduced motion: no flash animation. A desktop keeps its cursor.
// WRITES "QA phone/" and the plugin's data.json: throwaway server only.
//   node web/qa/companion-phone.mjs <base url> <vault path>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, ""), OUT = "/tmp/companion-phone-"
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = keep(".vaultite/plugins/companion/data.json")
const enc = encodeURIComponent
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
/** An op as the companion's agent calls it (vau run by Claude Code). */
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const moment = (kind, ms = 6000) => until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === kind) ?? null }, ms)

const NOTE = "QA phone/Garden.md"
const TEXT = ["# Garden", "", "Tomatoes along the fence.", "", "Basil between them.", "", ...Array.from({ length: 50 }, (_, i) => `Row ${i + 1}: notes on bed ${i + 1}.`), "", "Last line here.", ""].join("\n")
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
await api("PUT", "file", { path: NOTE, text: TEXT })
await op("companion.next", { timeout: 0 }) // (it's around: an ask wakes no session)
await op("companion.clear")

/** A page of a phone (or a desktop), the companion's socket in reach (to play what the server would say). */
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
  // (the playground's toast sits where the card goes: out of the pictures)
  await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important; }" })
  await wait(1000)
  return { ctx, page }
}
/** What of the companion a phone draws: cursors (none, ever), carets, the edge chips, the card. */
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
/** The screen's box of a line of the note with `text`. */
const lineBox = (page, text) => page.locator(".cm-line", { hasText: text }).first().boundingBox()
const near = (caret, box) => !!caret && !!box && caret.y >= box.y - 4 && caret.y + caret.h <= box.y + box.height + 4

// ---------- a phone
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, label: "phone" })
  let s = await seen(page)
  check("phone: at rest, nothing of it in the note (no cursor, no caret, no card)", s.cursors === 0 && s.carets === 0 && !s.card && !s.chip, s)

  // Pointing: its caret at the line's end, its name on it, the line lit a moment; then gone.
  await op("companion.look", { path: NOTE, find: "Basil" })
  s = await until(async () => { const x = await seen(page); return x.caret ? x : null }, 3000)
  const basil = await lineBox(page, "Basil between them")
  check("phone: a look shows its caret at that line, with its name", s?.caret?.doing === "pointing" && near(s.caret, basil) && s.caret.flag?.startsWith("Claude") && s.cursors === 0, { s, basil })
  check("phone: and lights the line a moment", !!s?.flash && Math.abs(s.flash.y - basil.y) < 8, s?.flash)
  await wait(400)
  await page.screenshot({ path: `${OUT}look.png` })
  s = await until(async () => { const x = await seen(page); return x.carets === 0 && !x.flash ? x : null }, 5000)
  check("phone: the look's caret and light go after a moment", !!s, await seen(page))

  // An ask from this phone: thinking, its dots on its caret at the ask's line.
  await page.getByRole("button", { name: "Edit", exact: true }).tap()
  await page.locator(".cm-line", { hasText: "Tomatoes along" }).first().tap({ position: { x: 4, y: 4 } })
  await page.keyboard.press("End")
  await page.keyboard.type(` @claude how far apart, run ${Date.now() % 1000}?`, { delay: 15 })
  await page.keyboard.press("Enter")
  const asked = await moment("ask", 10000)
  s = await until(async () => { const x = await seen(page); return x.caret?.doing === "thinking" ? x : null }, 4000)
  const tom = await lineBox(page, "Tomatoes along")
  check("phone: an ask sent from here, its caret thinks at that line, dots on its flag", !!asked && s?.caret?.dots && near(s.caret, tom), { asked: !!asked, s, tom })
  await wait(400)
  await page.screenshot({ path: `${OUT}thinking.png` })

  // Its words: a card at the bottom, inside the screen, above the bar, a finger's reply box; still thinking.
  await op("companion.say", { text: "About **a foot** apart. Basil stays smaller, so it fits between the tomatoes and shades their roots." })
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "say" ? x : null }, 4000).then(async (x) => (x ? (await wait(450), seen(page)) : x))
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

  // Writing: its caret where it types.
  await page.getByRole("button", { name: "Read", exact: true }).tap().catch(() => {})
  const typing = op("companion.edit", { path: NOTE, after: "Basil between them.", text: "Water both in the morning, at the roots, never the leaves; mulch keeps the soil even through the summer heat and spares a second watering." })
  s = await until(async () => { const x = await seen(page); return x.caret?.doing === "writing" ? x : null }, 4000, 30)
  check("phone: writing, its caret where it types, its name on it", !!s && s.caret.flag?.startsWith("Claude") && s.caret.y > (await lineBox(page, "Basil between them")).y - 4, s)
  await wait(150)
  await page.screenshot({ path: `${OUT}writing.png` })
  await typing
  s = await until(async () => { const x = await seen(page); return x.carets === 0 ? x : null }, 4000)
  check("phone: written, the caret goes", !!s, await seen(page))

  // Writing below the fold: a chip at the bottom edge says so; tapped, it scrolls there.
  await page.evaluate(() => { const p = document.querySelector("[data-pane]"); if (p) p.scrollTop = 0; scrollTo(0, 0) })
  await wait(300)
  const below = op("companion.edit", { path: NOTE, after: "Last line here.", text: "A last row, written while you were reading the top: peppers along the south wall, where the wall keeps the evening warm; three plants, staked early, picked green." })
  s = await until(async () => { const x = await seen(page); return x.chip ? x : null }, 4000, 30)
  check("phone: writing below the screen, a chip at the bottom says so", s?.chip?.dir === "down" && /Claude is writing/.test(s.chip.text) && s.chip.y + s.chip.h <= s.barTop && s.carets === 0, s)
  await wait(150)
  await page.screenshot({ path: `${OUT}chip.png` })
  if (s?.chip) await page.locator("[data-companion-edge]").tap()
  await wait(500)
  const last = await lineBox(page, "Last line here")
  check("phone: the chip tapped, the note scrolls to where it writes", !!last && last.y > 0 && last.y < 844, last)
  await below
  await wait(600)

  // A say swiped away: gone, and unseen it leaves a dot on its face, which opens what it said.
  await op("companion.say", { text: "Swipe me away." })
  const card = page.locator("[data-companion-card='say']")
  await card.waitFor({ timeout: 3000 })
  await wait(350)
  const head = await card.locator("[data-swipe]").last().boundingBox()
  const cdp = await ctx.newCDPSession(page), pt = (y) => [{ x: head.x + 60, y }]
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(head.y + 10) })
  for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(head.y + 10 + i * 18) }); await wait(16) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  s = await until(async () => { const x = await seen(page); return !x.card ? x : null }, 2000)
  check("phone: a card swiped down goes", !!s, await seen(page))
  // (one it said that went before it was seen: closed, it counts as seen)
  await page.evaluate(() => window.__play({ t: "said", said: [{ id: "qunseen", kind: "say", agent: "Claude", text: "Swipe me away, or read me later.", t: Date.now() }] }))
  const face = page.locator('[data-companion-presence]:visible button[data-agent="Claude"]')
  check("phone: what it said unseen, a dot on its face", await until(() => face.locator("[data-companion-unread]").count(), 3000) > 0)
  // (other agents' faces overlap it, as a stack: its own button, wherever it is in it)
  await face.dispatchEvent("click")
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "conversation" ? x : null }, 3000).then(async (x) => (x ? (await wait(450), seen(page)) : x))
  check("phone: its face tapped, its conversation at the bottom, what it said in it", !!s && s.card.text.includes("Swipe me away") && s.card.x >= 0 && s.card.x + s.card.w <= s.width && s.card.y + s.card.h <= s.barTop, s)
  await wait(400)
  await page.screenshot({ path: `${OUT}conversation.png` })
  await page.touchscreen.tap(200, 240)
  check("phone: a tap outside closes its conversation", await until(async () => (await seen(page)).card === null, 2000), await seen(page))

  // Its leave asked: a card with Deny and Approve, a finger's size.
  const base = { name: "Claude", tint: "orange", path: NOTE, line: 5, find: "Basil", t: Date.now() - 20_000 }
  await page.evaluate((a) => window.__play({ t: "agent", agent: a }), { ...base, state: "thinking", asks: { event: "chat:q", text: "Run vau tabs to see what's open?" } })
  s = await until(async () => { const x = await seen(page); return x.card?.kind === "ask" ? x : null }, 3000)
  const approve = await page.locator("[data-companion-card='ask'] [data-gate='approve']").boundingBox()
  check("phone: asking leave, a card with Deny and Approve by the thumb, no caret for it", !!s && /needs you/.test(s.card.text) && (approve?.height ?? 0) >= 44 && s.carets === 0, { s, approve })
  await wait(400)
  await page.screenshot({ path: `${OUT}ask.png` })
  await page.evaluate((a) => window.__play({ t: "agent", agent: a }), { ...base, state: "watching", seen: true, why: "not for me" })
  s = await until(async () => { const x = await seen(page); return x.carets === 0 && !x.card ? x : null }, 4000) ?? await seen(page)
  check("phone: at rest again, nothing of it (no cursor, caret, chip or card), however it was left", s.cursors === 0 && s.carets === 0 && !s.chip && !s.card, s)
  await ctx.close()
}

// ---------- reduced motion: its line lit without a flash
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", label: "still" })
  await op("companion.look", { path: NOTE, find: "Tomatoes" })
  const s = await until(async () => { const x = await seen(page); return x.caret && x.flash ? x : null }, 3000)
  check("reduced motion: its caret and the lit line, unanimated", !!s && s.flashAnim === "none", s)
  await ctx.close()
}

// ---------- a desktop: its cursor as before, its words in a bubble by it, nothing of the phone's
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
