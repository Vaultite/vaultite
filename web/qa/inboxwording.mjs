// The inbox's verbs with no phone or watch paired (pin, settle, snooze, wake), in vau and the app, no device named.
// WRITES Inbox/ and the inbox's events: throwaway server only.
//   node web/qa/inboxwording.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/inboxwording-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const vau = (...args) => {
  try { return { code: 0, out: execFileSync("node", [fileURLToPath(new URL("../../bin/vau", import.meta.url)), ...args], { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, ""), VAULTITE_TERMINAL: "" }, encoding: "utf8", stdio: "pipe" }) } }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` } }
}
await api("DELETE", "inbox/events")
for (const r of await api("GET", "inbox")) await api("DELETE", `inbox/${encodeURIComponent(r.id)}`).catch(() => {})

const paired = await api("GET", "inbox/devices").catch(() => null)
check("no phone or watch is paired here", Array.isArray(paired?.devices ?? paired) && (paired?.devices ?? paired).length === 0, paired)

let r = vau("inbox", "push", "Try push")
check("vau inbox push: says push isn't set up, or that no phone has signed up; never that it was sent", !/^Sent to/m.test(r.out) && /isn't set up|no phone has signed up/.test(r.out), r)
await api("POST", "inbox", { title: "Lighthouse launch notes", body: "Ship on Friday.", from: "Claude" })
r = vau("inbox", "wake", "Inbox/Lighthouse launch notes.md")
check("vau inbox wake: on what isn't snoozed, says so", r.code === 0 && /^Not snoozed/.test(r.out), r)
vau("inbox", "snooze", "Inbox/Lighthouse launch notes.md", "--until", "tomorrow")
r = vau("inbox", "wake", "Inbox/Lighthouse launch notes.md")
check("vau inbox wake: on what's snoozed, woken", r.code === 0 && /^Woken/.test(r.out), r)
const ev = (await api("POST", "inbox/events", { source: "browser", kind: "waiting", title: "Alice Park asks for the deck" })).event
r = vau("inbox", "answer", ev.id, "settle")
check("vau inbox answer settle: Settled, not Denied", r.code === 0 && /^Settled: Alice Park asks for the deck/.test(r.out), r)
r = vau("inbox", "clear", "--done")
check("vau inbox clear --done: the settled events", r.code === 0 && /settled events/.test(r.out), r)

await api("POST", "inbox", { title: "Plant care apps compared", body: "Three of them.", from: "Claude" })
await api("POST", "inbox", { title: "Snoozed for later", body: "Later.", from: "Claude" })
vau("inbox", "snooze", "Inbox/Snoozed for later.md", "--until", "tomorrow")
const OLD = /\b(Done|Mark done|Unsnooze|Done with this)\b/
for (const [name, opts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["phone", { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }]]) {
  const ctx = await browser.newContext(opts)
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { label: name, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(`${B}#view/inbox`)
  const row = page.locator("[data-inbox-view] [data-result]", { hasText: "Plant care apps compared" })
  await until(() => row.count(), 8000)
  const view = page.locator("[data-inbox-view]")
  const labels = async () => (await view.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join(" | ")
  check(`${name}: the row's buttons say Settle`, (await row.getByRole("button", { name: "Settle" }).count()) === 1 && !OLD.test(await labels()), await labels())
  check(`${name}: the page names no phone or watch`, !/\b(phone|watch|iPhone)\b/i.test(await view.innerText()), (await view.innerText()).slice(0, 300))
  if (name === "desktop") {
    await row.click({ button: "right" })
    const menu = page.getByRole("menu").last()
    await until(() => menu.count())
    const items = await menu.innerText()
    check("desktop: a result's menu has Settle, Pin and Snooze, not Done", /Settle/.test(items) && /Pin/.test(items) && /Snooze/.test(items) && !OLD.test(items), items)
    await page.keyboard.press("Escape")
  }
  await view.getByRole("button", { name: /^Snoozed \d/ }).click()
  const later = view.locator("[data-snoozed]", { hasText: "Snoozed for later" })
  check(`${name}: what's snoozed has Wake`, !!(await until(() => later.count())) && (await later.getByRole("button", { name: "Wake" }).count()) === 1, await later.count())
  check(`${name}: the folded lists are Snoozed and Settled`, !/\bDone \d/.test(await view.innerText()), (await view.innerText()).slice(-200))
  await wait(300)
  await page.screenshot({ path: `${OUT}${name}.png` })
  await ctx.close()
}

await browser.close()
await done()
