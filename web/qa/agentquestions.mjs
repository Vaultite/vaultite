// An agent's questions laid out as Claude Code's picker (the inbox's sheet, the chat tab): options numbered, Type
// something, Chat about this; what each sends (caught here), on a desktop and a phone. WRITES inbox events: throwaway only.
//   node web/qa/agentquestions.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/agentquestions-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
await api("DELETE", "inbox/events")

// Sessions asking, as their host tells it (no terminal: what they're sent is caught before it goes anywhere).
const ask = (session, title, questions) => api("POST", "inbox/sessions", { agent: "claude", session, state: "waiting", ask: "question", title, questions })
await ask("qa-one", "Fruit for the party", [{ question: "Which fruit should it buy?", header: "Fruit",
  options: [{ label: "Apple", description: "Crisp, keeps a week" }, { label: "Banana" }, { label: "Cherry" }, { label: "Date" }] }])
await ask("qa-two", "Pizza order", [{ question: "Which base?", header: "Base", options: [{ label: "Thin" }, { label: "Deep" }] },
  { question: "Which toppings?", header: "Toppings", multi: true, options: [{ label: "Cheese" }, { label: "Basil" }, { label: "Olive" }] }])
await ask("qa-dialog", "Read outside the folder", [{ question: "Allow this read outside the working directories?", closed: true,
  options: [{ label: "Yes, and keep allowing" }, { label: "No, and block them" }, { label: "No, and ask again next time" }] }])
const events = await until(async () => { const es = (await api("GET", "inbox/events")).events.filter((e) => e.ask === "question"); return es.length === 3 ? es : null }, 8000)
check("three sessions asking", !!events, events)
const id = (title) => events.find((e) => e.title === title).id

/** A context whose inbox.answer calls are kept, not sent. */
async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts)
  await ctx.addInitScript(() => { if (location.protocol !== "about:" && !sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true, label: ctxOpts.isMobile ? "phone" : undefined, ignore: /favicon|Failed to load resource|WebSocket/ })
  const sent = []
  await page.route("**/api/ops/inbox.answer", (r) => { sent.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "pick", title: "x", terminal: null }) }) })
  const sheetOf = async (title) => {
    await page.goto("about:blank")
    await page.goto(`${B}#view/inbox`)
    const row = page.locator(`[data-inbox-view] [data-event="${id(title)}"] [data-keyrow]`)
    await until(() => row.count(), 8000)
    await row.click()
    const sheet = page.locator(`[data-session-sheet="${id(title)}"]`)
    await until(() => sheet.locator("[data-questions]").count(), 5000)
    await wait(400)
    return sheet
  }
  return { page, sent, sheetOf }
}

// 1. Desktop: one question.
const d = await open({ viewport: { width: 1280, height: 800 } })
let sheet = await d.sheetOf("Fruit for the party")
const rows = await sheet.locator("[data-question='0'] [data-option]").allInnerTexts()
check("one question: its options numbered, then Type something, as its picker", rows.length === 5 && rows[0].startsWith("1.") && rows[3].startsWith("4.") && rows[4].startsWith("5.") &&
  (await sheet.locator("[data-option='5'] input").getAttribute("placeholder")) === "Type something", rows)
check("then Chat about this, numbered after it", (await sheet.locator("[data-chat-about]").innerText()).replace(/\s+/g, " ").trim() === "6. Chat about this")
check("its own answer is that row: no reply box beside it, Open session still there", (await sheet.locator("[data-reply]").count()) === 0 &&
  (await sheet.getByRole("button", { name: "Open session" }).count()) === 1)
await d.page.screenshot({ path: `${OUT}1-one-question.png` })
await sheet.locator("[data-option='5'] input").fill("Mango, ripe")
check("typed: its row is chosen, with a send button", (await sheet.locator("[data-option='5']").getAttribute("data-typed")) === "on" && (await sheet.locator("[data-send-typed]").count()) === 1)
await d.page.screenshot({ path: `${OUT}2-one-question-typed.png` })
await sheet.locator("[data-option='5'] input").press("Enter")
await until(() => d.sent.length === 1)
check("Enter answers with what's typed (its picker's Type something)", JSON.stringify(d.sent[0]) === JSON.stringify({ id: id("Fruit for the party"), answer: "pick", picks: [""], typed: ["Mango, ripe"] }), d.sent)
await sheet.locator("[data-option='2']").click()
await until(() => d.sent.length === 2)
check("a tap answers with that option", JSON.stringify(d.sent[1]) === JSON.stringify({ id: id("Fruit for the party"), answer: "pick", picks: ["2"] }), d.sent[1])
await sheet.locator("[data-chat-about]").click()
await until(() => d.sent.length === 3)
check("Chat about this is its own answer", JSON.stringify(d.sent[2]) === JSON.stringify({ id: id("Fruit for the party"), answer: "chat" }), d.sent[2])

// 2. Several questions, one a multi-select: each picked or typed, then Send answers; a reply puts them aside.
sheet = await d.sheetOf("Pizza order")
const send = sheet.locator("[data-send-answers]")
check("several: Send answers waits for every answer; a reply box for something else", await send.isDisabled() &&
  (await sheet.locator("[data-reply]").getAttribute("placeholder")) === "Or tell it something else instead")
check("several: each has its Type something (3 and 4), one Chat about this", (await sheet.locator("[data-question='0'] [data-option='3'] input").count()) === 1 &&
  (await sheet.locator("[data-question='1'] [data-option='4'] input").count()) === 1 && (await sheet.locator("[data-chat-about]").count()) === 1)
await sheet.locator("[data-question='0'] [data-option='3'] input").fill("Sourdough")
await sheet.locator("[data-question='1'] [data-option='1']").click()
await sheet.locator("[data-question='1'] [data-option='3']").click()
await sheet.locator("[data-question='1'] [data-option='4'] input").fill("Feta")
check("a multi-select's typed row is ticked with its picks", (await sheet.locator("[data-question='1'] [data-option='4']").getAttribute("data-typed")) === "on" &&
  (await sheet.locator("[data-question='1'] [aria-checked=true]").count()) === 2)
await d.page.screenshot({ path: `${OUT}3-several.png` })
await send.click()
await until(() => d.sent.length === 4)
check("Send answers: picks and what's typed, each question's", JSON.stringify(d.sent[3]) === JSON.stringify({ id: id("Pizza order"), answer: "pick", picks: ["", "1,3"], typed: ["Sourdough", "Feta"] }), d.sent[3])
await sheet.locator("[data-question='0'] [data-option='1']").click()
await send.click()
await until(() => d.sent.length === 5)
check("an option picked after typing is the answer (the typed one no longer is)", JSON.stringify(d.sent[4].picks) === '["1","1,3"]' && JSON.stringify(d.sent[4].typed) === '["","Feta"]', d.sent[4])

// 3. A dialog read off its screen: only its options.
sheet = await d.sheetOf("Read outside the folder")
check("a dialog: only its options, no Type something nor Chat about this; a reply box", (await sheet.locator("[data-option]").count()) === 3 &&
  (await sheet.locator("[data-chat-about]").count()) === 0 && (await sheet.locator("[data-reply]").count()) === 1)
await d.page.screenshot({ path: `${OUT}4-dialog.png` })
await d.page.context().close()

// 4. A phone: the same, in its width, with a finger's targets and text the keyboard doesn't zoom.
const p = await open({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
sheet = await p.sheetOf("Fruit for the party")
const sizes = await sheet.evaluate((el) => ({
  rows: [...el.querySelectorAll("[data-option], [data-chat-about]")].map((r) => Math.round(r.getBoundingClientRect().height)),
  input: parseFloat(getComputedStyle(el.querySelector("[data-option='5'] input")).fontSize),
  wide: document.documentElement.scrollWidth <= 390,
}))
check("phone: every row a 44px target, typed text at 17px, no sideways scroll", sizes.rows.length === 6 && sizes.rows.every((h) => h >= 44) && sizes.input >= 16 && sizes.wide, sizes)
await sheet.locator("[data-option='5'] input").fill("Mango")
await p.page.screenshot({ path: `${OUT}5-phone.png` })
await sheet.locator("[data-send-typed]").tap()
await until(() => p.sent.length === 1)
check("phone: its send button answers with what's typed", JSON.stringify(p.sent[0]?.typed) === '["Mango"]', p.sent)

// 5. The chat tab (a session the keeper runs, its socket played here): the same picker, answered with chat-answer.
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  const page = watch(await ctx.newPage(), { console: true, label: "chat", ignore: /favicon|Failed to load resource|WebSocket/ })
  const sent = []
  await page.route("**/api/ops/claude-code.chat-answer", (r) => { sent.push(r.request().postDataJSON()); r.fulfill({ status: 200, contentType: "application/json", body: '{"id":"qa-chat","state":"working"}' }) })
  const asked = { k: "ask", id: "ask1", kind: "question", tool: "AskUserQuestion", title: "Which toppings?", at: Date.now(),
    questions: [{ question: "Which toppings?", multi: true, options: [{ label: "Cheese" }, { label: "Basil" }, { label: "Olive" }] }] }
  const s = { id: "qa-chat", state: "waiting", cwd: "/tmp", account: "default", by: "app", model: "sonnet", effort: "medium", mode: "default", started: Date.now(), at: Date.now(), asks: ["ask1"], seq: 1, told: 0, turn: null }
  await page.routeWebSocket(/\/api\/claude-code\/chat\/qa-chat$/, (ws) => ws.send(JSON.stringify({ t: "hello", found: true, s, title: "Pizza", cwd: "/tmp", account: "default",
    model: "sonnet", effort: "medium", tui: null, driven: "", history: { entries: [asked], start: 0 } })))
  await page.goto(`${B}#view/claude-session%2Fqa-chat`)
  const card = page.locator("[data-entry=ask][data-ask=question]")
  await until(() => card.locator("[data-questions]").count(), 8000)
  await wait(400)
  check("chat tab: the same picker, its options numbered, Type something and Chat about this", (await card.locator("[data-option]").count()) === 4 &&
    (await card.locator("[data-option='4'] input").getAttribute("placeholder")) === "Type something" && (await card.locator("[data-chat-about]").innerText()).includes("5."))
  await card.locator("[data-option='1']").click()
  await card.locator("[data-option='4'] input").fill("Feta")
  await page.screenshot({ path: `${OUT}6-chat-tab.png` })
  await card.locator("[data-send-answers]").click()
  await until(() => sent.length === 1)
  check("chat tab: a multi-select's picks go with what's typed", JSON.stringify(sent[0]) === JSON.stringify({ id: "qa-chat", ask: "ask1", picks: ["1"], typed: ["Feta"] }), sent[0])
  // (answered, the card waits for the session's news: a fresh one for the next)
  await page.reload()
  await until(() => card.locator("[data-chat-about]").count(), 8000)
  await card.locator("[data-chat-about]").click()
  await until(() => sent.length === 2)
  check("chat tab: Chat about this", JSON.stringify(sent[1]) === JSON.stringify({ id: "qa-chat", ask: "ask1", chat: true }), sent[1])
  await ctx.close()
}

await api("DELETE", "inbox/events")
await done()
