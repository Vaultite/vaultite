// The Inbox across two throwaway servers that list each other: a session on the owner that asks or answers toasts on the
// follower, and its Approve or reply reaches its terminal, on a phone too. Starts a shell: throwaway servers only.
//   node web/qa/inboxmachines.mjs <follower base url> <owner's id> <owner base url> [out dir]
import { mkdirSync } from "node:fs"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OWNER, OWNER_URL, OUT = "/tmp/inbox-machines-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B), there = apiAt(OWNER_URL)
const owner = (await api("GET", "machines")).find((m) => m.id === OWNER)
if (!owner?.online) { console.error(`the owner '${OWNER}' isn't listed or doesn't answer`); process.exit(2) }
await api("DELETE", "inbox/events")

// A shell on the owner showing what Claude Code shows when it asks permission (its keys go to the shell).
const term = `qm${Date.now().toString(36)}`
await there("POST", `terminals/${term}`)
await wait(1500)
await there("POST", `terminals/${term}/send`, { text: "printf 'Do you want to proceed?\\n'", enter: true })
const screen = async () => ((await there("GET", `terminals/${term}/screen`))?.lines ?? []).join("\n")
await until(async () => (await screen()).includes("Do you want to proceed?"))

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png` })
const toastWith = (text, p = page) => until(async () => (await p.locator("[data-sonner-toast]").allInnerTexts()).find((t) => t.includes(text)), 15000)
await page.goto(B)
await page.waitForSelector("aside [data-inbox-button]")
await wait(1500)

// 1. It asks permission there: a toast here, its sheet with Approve and Deny, which answer it there.
await there("POST", `inbox/hook?agent=claude&terminal=${term}`,
  { hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash", session_id: "qm-session" })
check("a permission asked on the other machine toasts here", !!(await toastWith("permission to use Bash")), await page.locator("[data-sonner-toast]").allInnerTexts())
const row = (await api("GET", "inbox/events")).events.find((e) => e.terminal === `${term}@${OWNER}`)
check("its row here names that machine", row?.id.endsWith(`@${OWNER}`) && row.machine === OWNER && row.kind === "session" && row.state === "open" && row.ask === "permission", row)
await page.locator("[data-sonner-toast]", { hasText: "permission to use Bash" }).getByRole("button", { name: "Open" }).click()
const sheet = page.locator("[data-session-sheet]")
check("its sheet: Approve and Deny, on that machine", !!(await until(() => sheet.locator("[data-gate=approve]").count())) && (await sheet.innerText()).includes(`on ${owner.label}`), await sheet.innerText().catch(() => ""))
await wait(400)
await shot(page, "1-follower-permission")
const before = await screen()
await sheet.locator("[data-gate=approve]").click()
check("Approve presses its keys there (Enter: a new prompt line)", !!(await until(async () => (await screen()).split("\n").length > before.split("\n").length || (await screen()) !== before, 8000)), (await screen()).slice(-200))
check("and it's working there (answered)", !!(await until(async () => (await there("GET", "inbox/events")).events.find((e) => e.terminal === term)?.state === "working", 8000)))

// 2. Its turn ends with something to read: a toast here, its answer in the sheet, the reply typed into it there.
await there("POST", `inbox/hook?agent=claude&terminal=${term}`,
  { hook_event_name: "Stop", session_id: "qm-session", cwd: "/tmp/lighthouse", last_assistant_message: "Tests pass on **both** machines. Which branch should I merge into?" })
check("its answer toasts here", !!(await toastWith("Tests pass on both machines")))
await page.keyboard.press("Escape")
await page.locator("[data-sonner-toast]", { hasText: "Tests pass on both machines" }).getByRole("button", { name: "Open" }).click()
await until(() => sheet.locator("[data-reply]").count())
check("its sheet shows the answer, drawn", (await sheet.locator("strong", { hasText: "both" }).count()) === 1)
check("where the reply goes: its terminal there, still running", !!(await until(async () => (await sheet.locator("[data-reply-plan]").getAttribute("data-reply-plan")) === "type")))
await shot(page, "2-follower-answer")
await sheet.locator("[data-reply]").fill("echo from-the-follower")
await sheet.getByRole("button", { name: "Send" }).click()
check("Send types it into its terminal there", !!(await until(async () => (await screen()).includes("from-the-follower"), 10000)), (await screen()).slice(-200))
check("working there, and here", !!(await until(async () => (await there("GET", "inbox/events")).events.find((e) => e.terminal === term)?.state === "working" &&
  (await api("GET", "inbox/events")).events.find((e) => e.terminal === `${term}@${OWNER}`)?.state === "working", 8000)))

// 3. A phone on the follower: the same row opens its sheet, in the phone's width.
await page.keyboard.press("Escape") // (a sheet left open reads what comes to it)
await wait(500)
await there("POST", `inbox/hook?agent=claude&terminal=${term}`,
  { hook_event_name: "Stop", session_id: "qm-session", last_assistant_message: "Merged into main. Should I deploy it now?" })
const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
const ph = watch(await phone.newPage(), { label: "phone" })
await ph.goto(`${B}#view/inbox`)
const prow = ph.locator("[data-inbox-view] [data-event]", { hasText: "Merged into main" })
check("phone: the other machine's session is in the inbox", !!(await until(() => prow.count(), 10000)))
await prow.locator("button").first().tap()
check("phone: its sheet, with the reply", !!(await until(() => ph.locator("[data-session-sheet] [data-reply]").count())) && await ph.evaluate(() => document.documentElement.scrollWidth <= 390))
await wait(600)
await shot(ph, "3-follower-phone")

await there("DELETE", `terminals/${term}`).catch(() => {})
await browser.close()
await done()
