// Reply drafts (plugins/core/inbox/Reply.tsx, drafts.ts): a reply typed and not sent stays a draft on this device until
// the server has it (a send that never answers, or fails, keeps it); its row and its box say "Draft, not sent", and
// leaving its box with it unsent says so, with Back to it. Desktop and a phone, light and dark. Screenshots in the out dir.
// WRITES Inbox/, the inbox's events and sidebars.json (put back): throwaway server only.
//   node web/qa/replydrafts.mjs <base url> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/replydrafts-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = apiAt(B)
const SIDEBARS = path.join(VAULT, ".vaultite/sidebars.json")
let sidebars = ""
try { sidebars = readFileSync(SIDEBARS, "utf8") } catch { /* none */ }
await api("DELETE", "inbox/events")
rmSync(path.join(VAULT, "Inbox"), { recursive: true, force: true })
mkdirSync(path.join(VAULT, "Inbox"), { recursive: true })
// The Inbox panel in the left sidebar, so its rows show a draft too.
writeFileSync(SIDEBARS, JSON.stringify({ left: ["inbox:inbox", "files:files"], right: [], collapsed: [] }))

// A session that answered, and an agent's report with its reply box.
const term = `qd${Date.now().toString(36)}`
await api("POST", `inbox/hook?agent=claude&terminal=${term}`, { hook_event_name: "Stop", session_id: "qa-drafts", cwd: "/tmp/lighthouse",
  last_assistant_message: "The release is ready. Should I tag it now, or wait for the docs?" })
const REPORT = "Inbox/Lighthouse release notes.md"
writeFileSync(path.join(VAULT, REPORT), "---\ntype: inbox\nstatus: new\nfrom: Claude\nagent: claude\nsession: qa-report-session\ncreated: '2026-10-01 18:00:00'\n---\n\n" +
  "> [!tip] TL;DR\n> Drafted the release notes for Lighthouse 0.6.\n\nThe notes are in the repo.\n\n```block-reply\n```\n")
const row = await until(async () => (await api("GET", "inbox/events")).events.find((e) => e.terminal === term))
check("the session's row is in the inbox", !!row, row)
await until(async () => (await api("GET", "inbox")).some((r) => `${r.id}.md` === REPORT))
const KEY = `vaultite.reply:${row.id}`, RKEY = `vaultite.reply:${REPORT}`
const SAID = "Tag it now, the docs can follow."

const fresh = (ctx, drafts = {}) => ctx.addInitScript((d) => {
  if (location.protocol === "about:" || sessionStorage.getItem("qa")) return
  localStorage.clear()
  for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v)
  sessionStorage.setItem("qa", "1")
}, drafts)
const toastWith = (p, text, ms) => until(async () => (await p.locator("[data-sonner-toast]").allInnerTexts()).find((t) => t.includes(text)), ms)
const stored = (p, k) => p.evaluate((k) => localStorage.getItem(k), k)
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png` })

// ---------- desktop, light
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light" })
await fresh(ctx)
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket|ops\/inbox\.reply\b/ })
await page.goto(`${B}#view/inbox`)
const evRow = page.locator(`[data-inbox-view] [data-event="${row.id}"]`)
await until(() => evRow.count(), 8000)
check("no draft: no tag on its row", (await evRow.locator("[data-reply-draft]").count()) === 0)
await evRow.locator("button").first().click()
const sheet = page.locator("[data-session-sheet]")
await until(() => sheet.locator("[data-reply]").count())
await sheet.locator("[data-reply]").fill(SAID)
check("typed: the box says it's a draft, not sent", !!(await until(() => sheet.locator("[data-reply-draft]").count())))
await page.keyboard.press("Escape")
const left = await toastWith(page, "Reply not sent: saved as a draft")
check("left with it unsent: a toast says so, with Back to it", !!left && left.includes("Back to it"), left)
check("its row in the Inbox says Draft, not sent", (await evRow.locator("[data-reply-draft]").innerText().catch(() => "")).includes("Draft, not sent"))
check("and its row in the sidebar's panel", !!(await until(() => page.locator(`[data-inbox-panel] [data-event="${row.id}"] [data-reply-draft]`).count())))
await wait(300)
await shot(page, "1-desktop-light-inbox")
await page.locator("[data-sonner-toast]", { hasText: "Reply not sent" }).getByRole("button", { name: "Back to it" }).click()
check("Back to it: its sheet, the reply still in the box", !!(await until(async () => (await sheet.locator("[data-reply]").inputValue().catch(() => "")) === SAID)))
await wait(300)
await shot(page, "2-desktop-light-sheet")

// A send that never answers (the app killed or suspended mid-send): the draft stays, no second send.
let posts = 0
await page.route("**/api/ops/inbox.reply", () => { posts++ }) // (never answered)
await sheet.getByRole("button", { name: "Send" }).click()
check("sending: shown at once, the box waits", !!(await until(() => sheet.locator("[data-reply-sending]").count())) && await sheet.locator("[data-reply]").isDisabled())
check("sending: its draft still stored", (await stored(page, KEY)) === SAID, await stored(page, KEY))
await sheet.locator("[data-reply]").press("Control+Enter").catch(() => {})
await wait(300)
check("sending: no second send", posts === 1, posts)
await page.unroute("**/api/ops/inbox.reply")
await page.goto("about:blank")
await page.goto(`${B}#view/inbox`)
await until(() => evRow.count(), 8000)
check("reopened after a send that never answered: still a draft on its row", !!(await until(() => evRow.locator("[data-reply-draft]").count())))
await evRow.locator("button").first().click()
check("and back in its box", !!(await until(async () => (await sheet.locator("[data-reply]").inputValue().catch(() => "")) === SAID)))

// A failed send: the reply stays in the box and stored, and a toast says so.
await page.route("**/api/ops/inbox.reply", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "the machine is offline" }) }))
await sheet.getByRole("button", { name: "Send" }).click()
check("failed: a toast says it", !!(await toastWith(page, "Couldn't send the reply")))
check("failed: the reply back in the box, still a draft", !!(await until(async () => (await sheet.locator("[data-reply]").inputValue()) === SAID))
  && (await stored(page, KEY)) === SAID && (await sheet.locator("[data-reply-draft]").count()) === 1)
await page.unroute("**/api/ops/inbox.reply")

// Sent: the draft goes, and leaving says nothing.
await page.route("**/api/ops/inbox.reply", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ how: "type" }) }))
await sheet.getByRole("button", { name: "Send" }).click()
check("sent: the box empty, no draft", !!(await until(async () => (await sheet.locator("[data-reply]").inputValue()) === "" && !(await sheet.locator("[data-reply-draft]").count())
  && (await stored(page, KEY)) === null)), await stored(page, KEY))
await page.keyboard.press("Escape")
await wait(900)
check("sent: no tag on its row, no draft toast", !(await evRow.locator("[data-reply-draft]").count())
  && !(await page.locator("[data-sonner-toast]", { hasText: "Reply not sent" }).count()))
await page.unroute("**/api/ops/inbox.reply")

// A report's box, left by opening another tab: the same.
await page.goto(`${B}#file/${encodeURIComponent(REPORT)}`)
const box = page.locator("[data-reply]")
await until(() => box.count(), 8000)
await box.fill("Add the upgrade steps too.")
await page.evaluate(() => { location.hash = "#view/inbox" })
check("a report's box left unsent: the toast", !!(await toastWith(page, "Reply not sent: saved as a draft")))
const resRow = page.locator(`[data-inbox-view] [data-result="${REPORT.replace(/\.md$/, "")}"]`)
check("its row in the Inbox says Draft, not sent", !!(await until(() => resRow.locator("[data-reply-draft]").count())))
await wait(300)
await shot(page, "3-desktop-light-report-row")

// Emptied: no draft.
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, REPORT)
await until(async () => (await box.inputValue().catch(() => "")) === "Add the upgrade steps too.")
await box.fill("")
check("emptied: no draft", !!(await until(async () => (await stored(page, RKEY)) === null && !(await page.locator("[data-reply-draft]").count()))))
await ctx.close()

// ---------- desktop, dark (drafts as the app left them)
const drafts = { [KEY]: SAID, [RKEY]: "Add the upgrade steps too." }
const dark = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" })
await fresh(dark, drafts)
const dp = watch(await dark.newPage(), { label: "dark" })
await dp.goto(`${B}#view/inbox`)
check("dark: both rows say Draft, not sent", !!(await until(async () => (await dp.locator("[data-inbox-view] [data-reply-draft]").count()) === 2, 8000)))
await wait(300)
await shot(dp, "4-desktop-dark-inbox")
await dp.locator(`[data-inbox-view] [data-event="${row.id}"] button`).first().click()
await until(() => dp.locator("[data-session-sheet] [data-reply-draft]").count())
await wait(300)
await shot(dp, "5-desktop-dark-sheet")
await dark.close()

// ---------- a phone, light and dark
for (const scheme of ["light", "dark"]) {
  const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, colorScheme: scheme })
  await fresh(phone, drafts)
  const ph = watch(await phone.newPage(), { label: `phone ${scheme}` })
  await ph.goto(`${B}#view/inbox`)
  await ph.waitForSelector("[data-phone-bar]")
  const prow = ph.locator(`[data-inbox-view] [data-event="${row.id}"]`)
  check(`phone ${scheme}: both rows say Draft, not sent`, !!(await until(async () => (await ph.locator("[data-inbox-view] [data-reply-draft]").count()) === 2, 8000)))
  check(`phone ${scheme}: no sideways scroll`, await ph.evaluate(() => document.documentElement.scrollWidth <= 390))
  await wait(300)
  await shot(ph, `6-phone-${scheme}-inbox`)
  await prow.locator("button").first().tap()
  const ps = ph.locator("[data-session-sheet]")
  check(`phone ${scheme}: its sheet, the reply in the box and marked a draft`, !!(await until(async () => (await ps.locator("[data-reply]").inputValue().catch(() => "")) === SAID))
    && (await ps.locator("[data-reply-draft]").count()) === 1)
  await ps.locator("[data-reply]").scrollIntoViewIfNeeded()
  await wait(400)
  await shot(ph, `7-phone-${scheme}-sheet`)
  await ph.locator("[data-sheet-done]").tap()
  const t = await toastWith(ph, "Reply not sent: saved as a draft")
  check(`phone ${scheme}: closing the sheet says it's not sent, with Back to it`, !!t && t.includes("Back to it"), t)
  await wait(300)
  await shot(ph, `8-phone-${scheme}-left`)
  await phone.close()
}

await api("DELETE", "inbox/events")
rmSync(path.join(VAULT, "Inbox"), { recursive: true, force: true })
if (sidebars) writeFileSync(SIDEBARS, sidebars); else rmSync(SIDEBARS, { force: true })
await done()
