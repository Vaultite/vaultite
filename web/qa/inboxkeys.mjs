// The Inbox by keyboard, Gmail's keys: J and K move along its rows, E marks one done (the keyboard goes on to the next),
// B snoozes, P pins, Shift+U and Shift+I unread and read, G I opens it. WRITES Inbox/ and the inbox's events: throwaway server only.
//   node web/qa/inboxkeys.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/inboxkeys-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
await api("DELETE", "inbox/events")
for (const r of await api("GET", "inbox")) await api("DELETE", `inbox/${encodeURIComponent(r.id)}`).catch(() => {})

const ask = (await api("POST", "inbox/events", { source: "browser", kind: "waiting", title: "Alice Park asks for the deck" })).event
await api("POST", "inbox", { title: "Lighthouse launch notes", body: "Ship on Friday.", from: "Claude" })
await api("POST", "inbox", { title: "Plant care apps compared", body: "Three of them.", from: "Claude" })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await page.goto(`${B}#file/Start%20here.md`)
await page.waitForSelector("[data-pane]")
await wait(800)
await page.locator("body").click({ position: { x: 700, y: 400 } })
await page.keyboard.press("Escape")
await page.keyboard.press("g")
await page.keyboard.press("i")
check("G I opens the Inbox", !!(await until(() => page.locator("[data-inbox-view] [data-inbox-results]").count(), 8000)))
await wait(500)

/** The selection key of the row the keyboard is on. */
const on = () => page.evaluate(() => document.activeElement?.closest("[data-select-key]")?.getAttribute("data-select-key") ?? null)
await page.locator("[data-inbox-view] h1").click()
await page.keyboard.press("j")
check("J puts the keyboard on the first row", (await on()) === `e:${ask.id}`, await on())
await page.keyboard.press("j")
const second = await on()
check("J again, the next row (a result)", second?.startsWith("r:Inbox/"), second)
await page.keyboard.press("k")
check("K goes back up", (await on()) === `e:${ask.id}`, await on())
await page.keyboard.press("j")
await page.screenshot({ path: `${OUT}1-keyboard-on-row.png` })

// E: done, and the keyboard is on the next row.
await page.keyboard.press("e")
const archived = await until(async () => (await api("GET", "inbox")).find((r) => `r:${r.id}` === second.replace("Inbox/", "Inbox/.archive/") && r.status === "done"))
check("E marks the result done", !!archived)
const after = await until(async () => { const k = await on(); return k && k !== second ? k : null })
check("and the keyboard goes on to the next row", !!after && after.startsWith("r:Inbox/") && after !== second, after)

// B: the Snooze choices under the row; picking one snoozes it.
await page.keyboard.press("b")
const menu = page.getByRole("menuitem", { name: /Tomorrow/ })
check("B shows the Snooze choices", !!(await until(() => menu.count())))
await page.screenshot({ path: `${OUT}2-snooze-menu.png` })
await menu.click()
check("and one picked snoozes it", !!(await until(async () => (await api("GET", "inbox")).find((r) => `r:${r.id}` === after)?.snoozed)))

// P: pins the thread, again unpins it.
await page.locator(`[data-inbox-view] [data-event="${ask.id}"] [data-keyrow]`).focus()
await page.keyboard.press("p")
check("P pins it", !!(await until(async () => (await api("GET", "inbox/events")).events.find((e) => e.id === ask.id)?.pinned === true)))
await until(() => page.locator(`[data-inbox-pinned] [data-event="${ask.id}"]`).count())
await page.locator(`[data-inbox-view] [data-event="${ask.id}"] [data-keyrow]`).focus()
await page.keyboard.press("p")
check("P again unpins it", !!(await until(async () => !(await api("GET", "inbox/events")).events.find((e) => e.id === ask.id)?.pinned)))

// Shift+U and Shift+I: unread and read the thread.
await page.locator(`[data-inbox-view] [data-event="${ask.id}"] [data-keyrow]`).focus()
await page.keyboard.press("Shift+I")
check("Shift+I reads it", !!(await until(async () => (await api("GET", "inbox/events")).events.find((e) => e.id === ask.id)?.read === true)))
await page.keyboard.press("Shift+U")
check("Shift+U unreads it", !!(await until(async () => (await api("GET", "inbox/events")).events.find((e) => e.id === ask.id)?.read === false)))

// Typing elsewhere, the keys are letters: a note's editor gets its J.
await page.goto(`${B}#file/Start%20here.md`)
await wait(1000)
check("off the Inbox, J isn't its", (await page.evaluate(() => !!document.activeElement?.closest("[data-inbox-view]"))) === false)

await browser.close()
await done()
