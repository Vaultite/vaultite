// Claude Code's chat tab: its asks over the composer, pictures, a queued message, its machine not answering.
// A made-up session over its socket and the ops caught: no session runs.
//   node web/qa/chatprompts.mjs <base url>
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)

const at = (s) => new Date(Date.now() - 600_000 + s * 1000).toISOString()
const S = (state, more = {}) => ({ id: "qa-chat", state, cwd: "/Users/alice/lighthouse", account: "default", by: "app", model: "claude-opus-5-5", effort: "high",
  mode: "auto", started: Date.now() - 600_000, at: Date.now() - 5000, asks: [], seq: 1, told: 0, turn: null, ...more })
const user = (id, text, s) => ({ k: "user", id, text, at: at(s) })
const words = Array.from({ length: 40 }, (_, n) => ({ k: "text", id: `m${n}:0`, text: `Paragraph ${n}: the launch page builds from its front matter now.`, at: at(n + 2) }))
const PERMISSION = { k: "ask", id: "ask:t9", kind: "permission", tool: "Bash", title: "Run a command?", detail: "Deploy to preview", input: { command: "npm run deploy" }, always: "npm run commands", at: at(50) }
const QUESTION = { k: "ask", id: "ask:t8", kind: "question", tool: "AskUserQuestion", title: "Where should the date live?", at: at(50),
  questions: [{ question: "Where should the launch date live?", header: "Date", options: [{ label: "Front matter" }, { label: "Config file" }, { label: "Environment" }] }] }
const hello = (s, live) => JSON.stringify({ t: "hello", found: true, s, title: "Read the launch date", cwd: s.cwd, account: "default", model: s.model, effort: "high", tui: null, driven: "",
  history: { entries: live, start: 0 } })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
async function open(first) {
  const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
  const sent = []
  let sock = null
  await page.routeWebSocket(/\/api\/claude-code\/chat\/qa-chat$/, (ws) => { sock = ws; ws.send(first) })
  await page.route("**/api/ops/claude-code.chat-*", (r) => {
    const op = r.request().url().split("/").pop()
    sent.push({ op, body: r.request().postDataJSON() })
    return r.fulfill({ json: op === "claude-code.chat-interrupt" ? { id: "qa-chat", taken: [user("sent-1", "Also the changelog", 60)] } : { id: "qa-chat", uuid: `sent-${sent.length}` } })
  })
  await page.goto("about:blank")
  await page.goto(`${B}#view/claude-session%2Fqa-chat`)
  await page.locator("[data-chat=qa-chat] [data-entries]").waitFor({ timeout: 20000 })
  await wait(600)
  return { page, sent, sock: () => sock }
}
const answers = (sent) => sent.filter((s) => s.op === "claude-code.chat-answer").map((s) => s.body)

{
  const { page, sent } = await open(hello(S("waiting", { asks: [PERMISSION.id] }), [user("u1", "Deploy it", 1), ...words, PERMISSION]))
  check("permission: docked in the composer", await page.locator("[data-composer] [data-docked][data-ask=permission]").count() === 1)
  check("permission: not drawn in the conversation too", await page.locator("[data-entries] [data-ask=permission]").count() === 0)
  const hints = await page.locator("[data-docked] kbd").allInnerTexts()
  check("permission: its buttons show their keys (Always allow too)", hints.length === 3, hints)
  const scroller = page.locator("[data-chat=qa-chat] .overflow-y-auto").first()
  await scroller.evaluate((el) => { el.scrollTop = 0 })
  await wait(200)
  check("header: pinned while the conversation is scrolled", await page.locator("[data-chat-head]").isVisible() && (await page.locator("[data-chat-head]").boundingBox()).y < 60)
  await page.locator("body").click({ position: { x: 900, y: 300 } }).catch(() => {})
  await page.locator("[data-chat=qa-chat] [data-entries]").click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("Enter")
  await until(() => answers(sent).length, 3000)
  check("permission: Enter allows it", answers(sent)[0]?.allow === true, answers(sent))
  await page.close()
}
{
  const { page, sent } = await open(hello(S("waiting", { asks: [PERMISSION.id] }), [user("u1", "Deploy it", 1), PERMISSION]))
  await page.locator("[data-composer] textarea").focus()
  await page.keyboard.press("Escape")
  await until(() => answers(sent).length, 3000)
  check("permission: Esc in the empty composer denies it", answers(sent)[0]?.allow === false, answers(sent))
  await page.close()
}
{
  const { page, sent } = await open(hello(S("waiting", { asks: [QUESTION.id] }), [user("u1", "Move the date", 1), QUESTION]))
  await page.locator("[data-composer] textarea").focus()
  await page.keyboard.press("2")
  await until(() => answers(sent).length, 3000)
  check("question: 2 in the empty composer picks the second answer", JSON.stringify(answers(sent)[0]?.picks) === '["2"]', answers(sent))
  check("question: the digit isn't typed", await page.locator("[data-composer] textarea").inputValue() === "")
  check("question: one way to type an answer, the composer (no Type something, no Chat about this)",
    await page.locator("[data-docked] [data-typed], [data-docked] [data-chat-about]").count() === 0)
  await page.close()
}
{
  const { page, sent } = await open(hello(S("idle"), [user("u1", "Hello", 1), words[0]]))
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 300 } })
  await page.locator("[data-attach-input]").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png })
  await until(() => page.locator("[data-picture]").count(), 4000)
  check("pictures: the attach button adds one, a thumbnail over the field", await page.locator("[data-picture]").count() === 1)
  await page.locator("[data-composer] textarea").evaluate(async (el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }))
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png.toString("base64"))
  await until(async () => (await page.locator("[data-picture]").count()) === 2, 4000)
  check("pictures: a pasted one is added", await page.locator("[data-picture]").count() === 2)
  check("pictures: each says what it is, a pasted one so named, with its size", (await page.locator("[data-picture]").nth(0).innerText()).includes("shot.png") &&
    (await page.locator("[data-picture-name]").nth(1).innerText()) === "Pasted image" && /\d+(\.\d)? KB/.test(await page.locator("[data-picture]").nth(1).innerText()))
  await page.locator("[data-chat=qa-chat]").evaluate(async (el) => {
    const canvas = document.createElement("canvas"); canvas.width = 3000; canvas.height = 1000
    const g = canvas.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 3000, 1000)
    const big = await new Promise((ok) => canvas.toBlob(ok, "image/png"))
    const dt = new DataTransfer()
    dt.items.add(new File([big], "big.png", { type: "image/png" }))
    for (const type of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await until(async () => (await page.locator("[data-picture]").count()) === 3, 6000)
  check("pictures: a dropped one is added", await page.locator("[data-picture]").count() === 3)
  await page.locator("[data-picture]").nth(1).hover()
  await page.locator("[data-remove-picture]").nth(1).click()
  check("pictures: one is removed with its button", await page.locator("[data-picture]").count() === 2)
  await page.locator("[data-composer] textarea").fill("Look at these")
  await page.locator("[data-send]").click()
  await until(() => sent.find((s) => s.op === "claude-code.chat-send"), 4000)
  const msg = sent.find((s) => s.op === "claude-code.chat-send")?.body
  check("pictures: sent with the message as base64 with their type", msg?.images?.length === 2 && msg.images.every((i) => /^image\/(png|jpeg)$/.test(i.type) && !i.data.startsWith("data:") && i.data.length > 100),
    msg?.images?.map((i) => [i.type, i.data.length]))
  const big = msg?.images?.[1]
  const size = big && await page.evaluate(async ({ data, type }) => { const b = await createImageBitmap(await (await fetch(`data:${type};base64,${data}`)).blob()); return [b.width, b.height] }, big)
  check("pictures: a big one is made 2000 px on its long edge at most", !!size && Math.max(...size) <= 2000, size)
  check("pictures: gone from the composer once sent", await page.locator("[data-picture]").count() === 0)
  await page.locator("[data-attach-input]").setInputFiles({ name: "only.png", mimeType: "image/png", buffer: png })
  await until(() => page.locator("[data-picture]").count(), 4000)
  check("pictures: alone, the send button is on", await page.locator("[data-send]").isEnabled())
  await page.close()
}
{
  const { page, sock } = await open(hello(S("working"), [user("u1", "Do it", 1), words[0]]))
  await page.locator("[data-composer] textarea").fill("Also the changelog")
  await page.keyboard.press("Enter")
  await until(() => page.locator("[data-queued]").count(), 3000)
  check("queued: shown under the composer", (await page.locator("[data-queued]").innerText()).includes("Also the changelog"))
  sock().send(JSON.stringify({ t: "put", e: user("sent-1", "Also the changelog", 60) }))
  await wait(300)
  check("queued: not in the conversation while it waits", await page.locator("[data-entries] [data-entry=user]").count() === 1)
  sock().send(JSON.stringify({ t: "put", e: { k: "text", id: "m99:0", text: "On it.", at: at(61) } }))
  await until(async () => (await page.locator("[data-queued]").count()) === 0, 3000)
  check("queued: taken up, it's in the conversation", await page.locator("[data-entries] [data-entry=user]").count() === 2)
  await page.close()
}
{
  const { page, sock } = await open(hello(S("working"), [user("u1", "Do it", 1), words[0]]))
  await page.locator("[data-composer] textarea").fill("Also the changelog")
  await page.keyboard.press("Enter")
  await until(() => page.locator("[data-queued]").count(), 3000)
  await page.locator("[data-stop]").click()
  await until(async () => (await page.locator("[data-composer] textarea").inputValue()) !== "", 3000)
  check("stop: the queued message is back in the draft", await page.locator("[data-composer] textarea").inputValue() === "Also the changelog")
  sock().send(JSON.stringify({ t: "unreachable", reason: "Mini PC isn't answering" }))
  await until(() => page.locator("[data-chat-away]").count(), 3000)
  check("unreachable: said over the composer", (await page.locator("[data-chat-away]").innerText()).includes("Mini PC isn't answering"))
  await page.locator("[data-composer] textarea").fill("Hello there")
  check("unreachable: sending is off, the words kept", await page.locator("[data-send]").isDisabled() && await page.locator("[data-composer] textarea").inputValue() === "Hello there")
  await page.close()
}
{
  const { page } = await open(hello(S("idle"), [user("u1", "Do it", 1), words[0]]))
  await page.close()
  const p2 = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ })
  await p2.routeWebSocket(/\/api\/claude-code\/chat\/qa-chat$/, (ws) => { for (let n = 0; n < 3; n++) ws.send(JSON.stringify({ t: "error", reason: "no" })) })
  await p2.goto("about:blank")
  await p2.goto(`${B}#view/claude-session%2Fqa-chat`)
  await until(() => p2.locator("[data-chat-unread]").count(), 10000)
  check("failed: the header keeps its last title and place", (await p2.locator("[data-chat-title]").innerText()) === "Read the launch date" &&
    (await p2.locator("[data-chat-where]").innerText()).includes("lighthouse"))
  check("failed: Try now and Open in terminal", await p2.locator("[data-chat-unread] [data-retry]").count() === 1 && (await p2.locator("[data-chat-unread]").innerText()).includes("Open in terminal"))
  await p2.close()
}
await ctx.close()
await done()
