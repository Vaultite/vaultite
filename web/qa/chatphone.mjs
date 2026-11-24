// Claude Code's chat on a phone (plugins/core/claude-code): its composer fits, it draws once; a message shows at once, one
// that fails comes back to the box, none goes twice; a skeleton till its code comes. WRITES a note.   node web/qa/chatphone.mjs <base url> <vault path> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { routeSocket } from "./lib/sockets.mjs"
const { args: [B, , OUT = "/tmp/chatphone-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const at = (s) => new Date(Date.now() - 600_000 + s * 1000).toISOString()
const S = (id, state) => ({ id, state, cwd: "/Users/alice/lighthouse", account: "default", by: "app", model: "claude-opus-5-5", effort: "high",
  mode: "auto", started: Date.now() - 600_000, at: Date.now() - 5000, asks: [], seq: 1, told: 0, turn: null, background: 0 })
const user = (id, text, s) => ({ k: "user", id, text, at: at(s) })
const hello = (s, live) => JSON.stringify({ t: "hello", id: s.id, found: true, s, title: "Read the launch date", cwd: s.cwd, account: "default", model: s.model, effort: "high", tui: null,
  driven: "", history: { entries: live, start: 0, total: live.length } })
const FIRST = [user("u1", "Where does the launch date live?", 1), { k: "text", id: "m1:0", text: "In the page's front matter.", at: at(3) }]
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
const IGNORE = /favicon|Failed to load resource|WebSocket|ERR_INTERNET_DISCONNECTED|net::ERR/
const api = apiAt(B)

const ctx = await browser.newContext(PHONE)
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
await page.goto(`${B}#view/${encodeURIComponent("claude-session/new")}`)
const chip = page.locator('[data-composer] button[aria-label="Permission mode"]')
await chip.waitFor({ timeout: 15000 })
await wait(800)
await page.evaluate(() => { document.querySelector("[data-composer]").__qaKept = true })
const NOTE = "Notes/Chat redraw check.md"
await api("PUT", "file", { path: NOTE, text: "# Chat redraw check\n" })
await wait(2500)
await api("DELETE", `file?path=${encodeURIComponent(NOTE)}`).catch(() => {})
check("chat on a phone: a redraw once its code has come keeps the chat drawn, not drawn anew", await page.evaluate(() => document.querySelector("[data-composer]")?.__qaKept === true))
const shown = (await chip.innerText()).trim()
check("chat on a phone: the permission mode is a short word, auto by default", shown === "Auto", shown)
const fits = await page.evaluate(() => {
  const c = document.querySelector('[data-composer] button[aria-label="Permission mode"]'), row = c?.parentElement
  if (!c || !row) return null
  const a = c.getBoundingClientRect(), r = row.getBoundingClientRect()
  return { fits: a.right <= r.right + 0.5 && a.left >= r.left - 0.5, chip: [a.left, a.right], row: [r.left, r.right], scrolled: row.scrollLeft }
})
check("chat on a phone: the permission mode chip is whole on screen, not scrolled off its row", !!fits?.fits && fits.scrolled === 0, fits)
await page.screenshot({ path: `${OUT}composer.png` })
await chip.tap()
const auto = page.getByRole("menuitemradio", { name: /Auto mode/ })
check("chat on a phone: its menu has the modes, auto chosen", (await auto.getAttribute("aria-checked").catch(() => null)) === "true",
  await page.locator("[role=menu]").innerText().catch(() => ""))
await page.screenshot({ path: `${OUT}menu.png` })
await ctx.close()

async function open(context, id = "qa-chat") {
  const page = watch(await context.newPage(), { ignore: IGNORE }), ui = app(page)
  const ops = [], socks = new Map()
  await routeSocket(page, /\/api\/claude-code\/chat\/[^/]+$/, (ws) => {
    const sid = decodeURIComponent(new URL(ws.url()).pathname.split("/").pop())
    socks.set(sid, ws)
    ws.send(hello(S(sid, "idle"), sid === "qa-chat" ? FIRST : []))
  })
  await page.route("**/api/ops/claude-code.chat-*", (r) => new Promise((settle) => {
    ops.push({ op: r.request().url().split("/").pop(), body: r.request().postDataJSON(),
      release: (json) => settle(r.fulfill({ json })), fail: () => settle(r.abort("internetdisconnected")) })
  }))
  await page.goto("about:blank")
  await page.goto(`${B}#view/claude-session%2F${id}`)
  await page.locator(`[data-chat="${id === "new" ? "new" : id}"] [data-composer] textarea`).waitFor({ timeout: 30_000 })
  const held = (r) => r.url().includes("/api/ops/claude-code.chat-")
  return { page, ui, ops, sock: (sid = id) => socks.get(sid), idle: () => ui.idle({ held }) }
}
const field = (page) => page.locator("[data-composer] textarea")
const say = async (page, text) => { await field(page).fill(text); await page.locator("[data-send]").tap() }
const sending = (page) => page.locator("[data-out=sending]")
const users = (page) => page.locator("[data-entries] [data-entry=user]")
const cut = (page, chat) => page.evaluate((k) => localStorage.getItem(k) ?? "", `vaultite.chat.${chat}:sending`)

const c1 = await browser.newContext(PHONE)
{
  const { page, ops, sock, idle } = await open(c1)
  await say(page, "Move it to the config file")
  check("sent: the field clears at once", await field(page).inputValue() === "")
  check("sent: the message shows in the conversation at once, sending", await sending(page).count() === 1 && (await sending(page).innerText()).includes("Move it to the config file"))
  check("sent: its words are kept till the session has them (a reload loses nothing)", (await cut(page, "qa-chat")).includes("Move it to the config file"))
  await idle()
  check("sent: it says it's sending", (await sending(page).innerText()).includes("Sending…"))
  await page.screenshot({ path: `${OUT}chat-send-pending.png` })
  await field(page).press("Enter")
  await say(page, "And the changelog")
  await idle()
  check("sent: a second waits for the first: one request out", ops.length === 1, ops.map((o) => o.body.text))
  check("sent: both show, in order", (await sending(page).allInnerTexts()).map((t) => t.split("\n")[0]).join("|") === "Move it to the config file|And the changelog",
    await sending(page).allInnerTexts())
  ops[0].release({ id: "qa-chat", uuid: "sent-1" })
  await until(() => ops.length === 2, 5000)
  check("sent: the second goes once the first is taken", ops[1]?.body.text === "And the changelog", ops.map((o) => o.body.text))
  ops[1].release({ id: "qa-chat", uuid: "sent-2" })
  await idle()
  check("sent: taken, it no longer says sending", await page.locator("[data-out=sent]").count() === 2 && await sending(page).count() === 0)
  sock().send(JSON.stringify({ t: "put", e: user("sent-1", "Move it to the config file", 10) }))
  sock().send(JSON.stringify({ t: "put", e: user("sent-2", "And the changelog", 11) }))
  await idle()
  check("sent: once in the transcript, each shows once", await page.locator("[data-outgoing]").count() === 0 && await users(page).count() === 3, await users(page).allInnerTexts())
  check("sent: nothing went twice", ops.length === 2 && ops.every((o) => o.op === "claude-code.chat-send"), ops.map((o) => o.body.text))
  check("sent: nothing left to bring back", await cut(page, "qa-chat") === "")
  await page.close()
}
{
  const { page, ops, idle } = await open(c1)
  await say(page, "Ship it")
  await until(() => ops.length === 1, 5000)
  await field(page).fill("and tell me when")
  ops[0].fail()
  await until(async () => (await field(page).inputValue()) !== "and tell me when", 5000)
  await idle()
  check("failed: its words are back in the box, before what was typed since", await field(page).inputValue() === "Ship it\n\nand tell me when", await field(page).inputValue())
  check("failed: it's gone from the conversation", await page.locator("[data-outgoing]").count() === 0)
  const said = (await page.locator("[data-sonner-toast]").allInnerTexts()).join(" | ")
  check("failed: it says why, in plain words", said.includes("Couldn't send it: the server didn't answer"), said)
  await page.screenshot({ path: `${OUT}chat-send-failed.png` })
  await field(page).press("Enter")
  await until(() => ops.length === 2, 5000)
  check("failed: sending again sends it, once", ops.length === 2 && ops[1].body.text === "Ship it\n\nand tell me when", ops.map((o) => o.body.text))
  ops[1]?.release({ id: "qa-chat", uuid: "sent-3" })
  await page.close()
}
{
  const { page, ops } = await open(c1)
  await say(page, "Don't lose this")
  await until(() => ops.length === 1, 5000)
  await page.reload()
  await field(page).waitFor({ timeout: 30_000 })
  check("reload mid-send: the words are back in the box", await field(page).inputValue() === "Don't lose this", await field(page).inputValue())
  await page.close()
}
{
  const { page, ops, sock, idle } = await open(c1, "new")
  await say(page, "Plan the release")
  check("new chat: the field clears and the message shows while it starts", await field(page).inputValue() === "" && await sending(page).count() === 1)
  await idle()
  await page.screenshot({ path: `${OUT}chat-start-pending.png` })
  await page.locator("[data-composer] textarea").fill("one more")
  check("new chat: a second waits till it's started (Send off)", await page.locator("[data-send]").isDisabled())
  ops[0].release({ id: "qa-new" })
  await page.locator("[data-chat=qa-new]").waitFor({ timeout: 10_000 })
  await idle()
  check("new chat: started, its message stays drawn while the chat comes", await page.locator("[data-chat=qa-new] [data-out=sent]").count() === 1)
  sock("qa-new").send(JSON.stringify({ t: "put", e: user("first", "Plan the release", 20) }))
  await idle()
  check("new chat: once in the transcript, it shows once", await page.locator("[data-outgoing]").count() === 0 && await users(page).count() === 1)
  check("new chat: one start", ops.filter((o) => o.op === "claude-code.chat-start").length === 1)
  await page.close()
}
await c1.close()

{
  const c2 = await browser.newContext(PHONE)
  const page = watch(await c2.newPage(), { ignore: IGNORE }), ui = app(page)
  let release = () => {}
  const code = new Promise((r) => { release = r })
  await routeSocket(page, /\/api\/claude-code\/chat\/[^/]+$/, (ws) => ws.send(hello(S("qa-chat", "idle"), FIRST)))
  await page.route(/\/assets\/ChatTab-[^/]+\.js$/, async (r) => { await code; await r.continue() })
  await page.goto(`${B}#view/claude-session%2Fqa-chat`)
  await page.locator("[data-chat-loading]").waitFor({ timeout: 30_000 })
  await ui.idle({ held: (r) => /\/assets\/ChatTab-/.test(r.url()) })
  check("loading: the tab draws the chat's skeleton while its code comes, not a blank", await page.locator("[data-chat-loading] [aria-busy]").count() >= 1)
  await page.screenshot({ path: `${OUT}chat-tab-loading.png` })
  release()
  await page.locator("[data-chat=qa-chat] [data-entries]").waitFor({ timeout: 15_000 })
  check("loading: then the chat, the skeleton gone", await page.locator("[data-chat-loading]").count() === 0)
  await page.close()

  await c2.close()
  const c3 = await browser.newContext(PHONE)
  const home = watch(await c3.newPage(), { ignore: IGNORE })
  const fetched = home.waitForRequest(/\/assets\/ChatTab-[^/]+\.js$/, { timeout: 30_000 }).then(() => true, () => false)
  await home.goto("about:blank")
  await home.goto(B)
  check("phone: the chat's code comes by itself once the app has launched", await fetched)
  check("phone: ...with no chat open", await home.locator("[data-chat]").count() === 0)
  await c3.close()
}
await done()
