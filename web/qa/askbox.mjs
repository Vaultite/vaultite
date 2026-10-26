// The Ask box (plugins/core/terminal/AskBox.tsx, terminal:ask): the command opens it with its field focused; the field
// grows with what's typed and Shift+Enter is a new line; Esc or a click off closes it, keeping what's typed for the next
// (caret at its end) until it's asked; the row under it picks the agent (remembered); Enter asks in a new terminal in the background (terminal.ask, here on haiku): the box closes, no tab opens, the
// Terminals list has it, and a toast "Asked Claude: <first words>" has Open, which opens its tab. On a phone it fits the
// screen with 44px targets. An image or file pasted in shows above the field (its x takes it off) and goes with the
// question: saved as an attachment, its path in terminal.ask's files. Run by hand on a server with Claude Code, its session answers (tools/qa.ts' stand-in only
// starts): throwaway server only, the session ended after.
//   node web/qa/askbox.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [arg, OUT = "/tmp/askbox-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = arg.endsWith("/") ? arg : `${arg}/`
const api = apiAt(B, { "X-Vaultite-Client": "cli" })
/** As the app's own Approve: only the user's surfaces answer a terminal's question. */
const asApp = apiAt(B, { "X-Vaultite-Client": "app/qa" })
mkdirSync(OUT, { recursive: true })
const PROMPT = "Reply with just the word pong."
const box = (p) => p.locator("[data-ask-box]")
const sessions = async () => (await api("POST", "ops/terminal.list", {})).sessions ?? []
const started = []
/** What each ask sent (terminal.ask's body). */
const asked = []

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage(), { label: "desktop" })
  // A cheap model for the session it starts (the box asks with the agent's default).
  await page.route("**/api/ops/terminal.ask", (r) => { const b = JSON.parse(r.request().postData() ?? "{}"); asked.push(b); return r.continue({ postData: JSON.stringify({ ...b, model: "haiku" }) }) })
  await page.goto(B)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)

  await palette(page, "Ask an agent in the background", 400)
  check("the command opens the box, its field focused", await box(page).count() === 1 &&
    await page.evaluate(() => document.activeElement?.matches("[data-ask-box] textarea")))
  check("it asks Claude by default", (await box(page).locator("textarea").getAttribute("placeholder")) === "Ask Claude…")
  const h0 = (await box(page).locator("textarea").boundingBox()).height
  await page.keyboard.type("one")
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type("more") }
  const h1 = (await box(page).locator("textarea").boundingBox()).height
  check("Shift+Enter is a new line, and the field grows with it", (await box(page).locator("textarea").inputValue()) === "one\nmore\nmore\nmore" && h1 > h0 + 40, [h0, h1])
  await page.screenshot({ path: `${OUT}desktop.png` })
  await page.keyboard.press("Escape")
  check("Esc closes it", await until(async () => (await box(page).count()) === 0, 2000))
  await palette(page, "Ask an agent in the background", 400)
  const kept = await box(page).locator("textarea").evaluate((t) => ({ value: t.value, caret: t.selectionStart, focused: document.activeElement === t }))
  check("what was typed is kept, the caret at its end", kept.value === "one\nmore\nmore\nmore" && kept.caret === kept.value.length && kept.focused, kept)
  await page.keyboard.type(" again")
  await page.mouse.click(10, 790)
  check("a click off closes it", await until(async () => (await box(page).count()) === 0, 2000))
  await palette(page, "Ask an agent in the background", 400)
  check("and keeps it too", (await box(page).locator("textarea").inputValue()) === "one\nmore\nmore\nmore again")
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Escape")
  await until(async () => (await box(page).count()) === 0, 2000)

  // The agent picker: a menu of the agents that are on, its pick remembered for the next box.
  await palette(page, "Ask an agent in the background", 400)
  await box(page).getByRole("button", { name: "Agent" }).click()
  const menu = page.locator("[role=menu]").last()
  await until(() => menu.count(), 2000)
  const rows = await menu.innerText()
  check("the agent chip's menu lists the agents", /Claude Code/.test(rows), rows)
  await page.keyboard.press("Escape")
  await wait(200)
  check("its menu closing leaves the box open", await box(page).count() === 1)

  // Pasted files: shown above the field, kept when the box closes, one taken off by its x.
  const paste = (files) => page.evaluate(async (files) => {
    const d = new DataTransfer()
    for (const f of files) d.items.add(f.png
      ? new File([await (await fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")).blob()], "image.png", { type: "image/png" })
      : new File([f.text], f.name, { type: "text/plain" }))
    document.querySelector("[data-ask-box] textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }))
  }, files)
  const thumbs = () => box(page).locator("[data-ask-file]")
  await paste([{ png: true }, { name: "notes.txt", text: "some notes" }])
  check("pasted files show above the field: an image's thumbnail, a file's name", await until(async () => (await thumbs().count()) === 2, 2000) &&
    (await thumbs().nth(0).locator("img").count()) === 1 && (await thumbs().nth(1).innerText()).includes("notes.txt"))
  check("…and type nothing in it", (await box(page).locator("textarea").inputValue()) === "")
  await page.screenshot({ path: `${OUT}attached.png` })
  await page.keyboard.press("Escape")
  await until(async () => (await box(page).count()) === 0, 2000)
  await palette(page, "Ask an agent in the background", 400)
  check("closing the box keeps them", (await thumbs().count()) === 2)
  await thumbs().nth(1).hover()
  await box(page).getByRole("button", { name: "Remove notes.txt" }).click()
  check("its x takes one off", await until(async () => (await thumbs().count()) === 1, 2000))

  // Enter: a session in the background, a toast with Open.
  const before = new Set((await sessions()).map((s) => s.id))
  await box(page).locator("textarea").click()
  await page.keyboard.type(PROMPT)
  await page.keyboard.press("Enter")
  check("Enter closes the box", await until(async () => (await box(page).count()) === 0, 10000))
  const toast = page.locator("[data-sonner-toast]", { hasText: "Asked Claude:" }).first()
  check("a toast says what was asked, with Open", await until(() => toast.count(), 5000) && (await toast.innerText()).includes(PROMPT) &&
    await toast.getByRole("button", { name: "Open" }).count() === 1, await toast.innerText().catch(() => ""))
  const fresh = await until(async () => (await sessions()).find((s) => !before.has(s.id) && s.agent === "claude"), 10000)
  if (fresh) started.push(fresh.id)
  const files = asked.at(-1)?.files ?? []
  const saved = files.length === 1 && /^Attachments\/Pasted image \d{14}\.png$/.test(files[0]) &&
    (await fetch(`${B}api/file?path=${encodeURIComponent(files[0])}`, { headers: { "X-Vaultite-Client": "cli" } })).status === 415
  check("the image went with it, saved as an attachment (the one taken off didn't)", saved, asked.at(-1))
  check("the Terminals list has the new session, with no tab", !!fresh && !fresh.tabs?.length, fresh)
  const hash = await page.evaluate(() => location.hash)
  check("no tab opened for it", !hash.includes(fresh?.id ?? "-"), hash)
  // (before the toast times out)
  await toast.getByRole("button", { name: "Open" }).click().catch(() => {})
  check("Open opens its terminal's tab", await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)).includes(`terminal/${fresh?.id}`), 5000), await page.evaluate(() => location.hash))
  // A folder Claude Code hasn't trusted asks first (in the inbox, for the user): approved here.
  if (fresh) {
    // (the trust question shows once Claude Code has started; a folder trusted before has none)
    let last = ""
    const answered = async () => { const t = last = ((await api("POST", "ops/terminal.screen", { id: fresh.id, lines: 40 })).lines ?? []).join("\n"); return /a stand-in for QA|⏺ pong[\s\S]*haiku/i.test(t) ? t : null }
    await until(async () => (await asApp("POST", `terminals/${fresh.id}/answer`, { answer: "approve" }))?.answer === "approve" || await answered(), 20000, 1000)
    const screen = await until(answered, 60000, 1500)
    check(/stand-in/.test(screen ?? "") ? "the session runs claude (QA's stand-in)" : "the session runs Claude Code on haiku and answers", !!screen, last.slice(-1500))
  }
  await page.screenshot({ path: `${OUT}opened.png` })
  await palette(page, "Ask an agent in the background", 400)
  check("once asked, the next box starts empty", (await box(page).locator("textarea").inputValue()) === "" && (await thumbs().count()) === 0)
  await page.keyboard.press("Escape")
  await ctx.close()

  // A phone: the box fits the screen, its targets 44px, its text 17px.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const pp = watch(await phone.newPage(), { label: "phone" })
  await pp.goto(B)
  await pp.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)
  await palette(pp, "Ask an agent in the background", 400)
  const fit = await pp.evaluate(() => {
    const b = document.querySelector("[data-ask-box]")?.getBoundingClientRect(), t = document.querySelector("[data-ask-box] textarea")
    const buttons = [...document.querySelectorAll("[data-ask-box] button")].map((x) => Math.round(x.getBoundingClientRect().height))
    return b && { left: b.left, right: b.right, width: innerWidth, font: t && getComputedStyle(t).fontSize, buttons, scroll: document.documentElement.scrollWidth }
  })
  check("phone: the box fits the screen, 17px text, 44px targets", !!fit && fit.left >= 8 && fit.right <= fit.width - 8 && fit.font === "17px" &&
    fit.buttons.every((h) => h >= 44) && fit.scroll <= fit.width, fit)
  await pp.screenshot({ path: `${OUT}phone.png` })
  await phone.close()
} finally {
  for (const id of started) await api("POST", "ops/terminal.end", { id }).catch(() => {})
  for (const f of asked.flatMap((b) => b.files ?? [])) await fetch(`${B}api/file?path=${encodeURIComponent(f)}`, { method: "DELETE" }).catch(() => {})
}
await done()
