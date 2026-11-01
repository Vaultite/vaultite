// The Inbox's Pin: pinned threads and results on top under Pinned, a row's menu pins, done unpins, on a phone too. WRITES
// Inbox/ and the inbox's events: throwaway server only.
//   node web/qa/inboxpin.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/inboxpin-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
await api("DELETE", "inbox/events")
for (const r of await api("GET", "inbox")) await api("DELETE", `inbox/${encodeURIComponent(r.id)}`).catch(() => {})

await api("POST", "inbox", { title: "Lighthouse launch notes", body: "## Findings\n- Ship on Friday", from: "Claude" })
await api("POST", "inbox", { title: "Plant care apps compared", body: "Three of them.", from: "Claude" })
const msg = (await api("POST", "inbox/events", { source: "backup", kind: "info", title: "Backup finished", body: "12 GB in 4 min" })).event
const ask = (await api("POST", "inbox/events", { source: "browser", kind: "waiting", title: "Alice Park asks for the deck" })).event
await api("POST", "inbox/events/pin", { ids: [msg.id] })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await page.goto(`${B}#view/inbox`)
const pinned = page.locator("[data-inbox-view] [data-inbox-pinned]")
check("a pinned message is under Pinned, on top", !!(await until(async () => (await pinned.locator(`[data-event="${msg.id}"]`).count()) === 1, 8000)))
check("Pinned is the first list", await page.locator("[data-inbox-view] section").first().evaluate((s) => s.hasAttribute("data-inbox-pinned")))

// A result's right-click: Pin, then it's under Pinned (not To review), one toast with Undo.
const res = page.locator("[data-inbox-view] [data-inbox-results] [data-result]", { hasText: "Lighthouse launch notes" })
await res.click({ button: "right" })
await page.getByRole("menuitem", { name: "Pin", exact: true }).click()
check("a result pinned from its menu goes under Pinned", !!(await until(async () => (await pinned.locator("[data-result]", { hasText: "Lighthouse launch notes" }).count()) === 1)))
check("with a toast", !!(await until(async () => (await page.locator("[data-sonner-toast]").allInnerTexts()).some((t) => t.includes("Pinned “Lighthouse launch notes”")))))
const file = (await api("GET", "inbox")).find((r) => r.title === "Lighthouse launch notes")
check("its file says pinned", file?.pinned === true, file)
await wait(500)
await page.screenshot({ path: `${OUT}1-desktop-pinned.png` })

// The menu of a pinned row says Unpin.
await pinned.locator(`[data-event="${msg.id}"]`).click({ button: "right" })
check("a pinned row's menu has Unpin", (await page.getByRole("menuitem", { name: "Unpin" }).count()) === 1)
await page.keyboard.press("Escape")

// Done unpins: the result leaves Pinned, archived.
await pinned.locator("[data-result]", { hasText: "Lighthouse launch notes" }).getByRole("button", { name: "Done" }).click()
check("done, it leaves Pinned", !!(await until(async () => (await pinned.locator("[data-result]").count()) === 0)))
check("and isn't pinned any more", !!(await until(async () => (await api("GET", "inbox")).find((r) => r.title === "Lighthouse launch notes")?.pinned !== true)))

// A phone: Pinned on top, no sideways scroll.
await api("POST", "inbox/events/pin", { ids: [ask.id] })
const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
await phone.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const ph = watch(await phone.newPage(), { label: "phone" })
await ph.goto(`${B}#view/inbox`)
const ppinned = ph.locator("[data-inbox-view] [data-inbox-pinned]")
check("phone: Pinned on top, with both", !!(await until(async () => (await ppinned.locator("[data-event]").count()) === 2, 8000)))
check("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= 390))
await wait(500)
await ph.screenshot({ path: `${OUT}2-phone-pinned.png` })

await browser.close()
await done()
