// The Inbox (plugins/core/inbox): events (posted, an agent's hook about a terminal, `vau notify`) toast and count on
// the header's button; results (a file in Inbox/, one through the API) too; the Inbox view (Done with Undo, File to…,
// read and unread, the right-click menu); the sidebar panel (unread only; show_read); the block on Today; a phone.
// Screenshots in the out dir. WRITES Inbox/, Notes/Filed/, sidebars.json (put back) and starts a shell: throwaway
// server only (then `tmux -L vaultite-<port> kill-server`).
//   node web/qa/inbox.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { devices } from "playwright-core"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/inbox-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = apiAt(B)
const read = (rel) => { try { return readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }
const sidebars = read(".vaultite/sidebars.json")
const vau = (...args) => execFileSync("node", [new URL("../../bin/vau", import.meta.url).pathname, ...args], { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, ""), VAULTITE_TERMINAL: "" }, encoding: "utf8" })
await api("DELETE", "inbox/events")
rmSync(path.join(VAULT, "Inbox"), { recursive: true, force: true })
rmSync(path.join(VAULT, "Notes/Filed"), { recursive: true, force: true })
await until(async () => !(await api("GET", "inbox")).length)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png` })
const toasts = (p = page) => p.locator("[data-sonner-toast]")
const toastWith = (text, p = page) => until(async () => (await toasts(p).allInnerTexts()).find((t) => t.includes(text)))
const count = () => page.locator("aside [data-inbox-button]").getAttribute("data-count").then(Number).catch(() => -1)
const enc = encodeURIComponent

// Without the Inbox panel in a sidebar, so the header has its button (8. puts the panel in).
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "pages:pages", "files:files"], right: [], collapsed: [] }))
await page.goto(`${B}#file/${enc("Dashboards/Today.md")}`)
await page.waitForSelector("aside [data-inbox-button]")
await wait(800)
check("the Inbox button is in the sidebar's header, nothing new", (await count()) === 0, await count())

// 1. An event: a toast, a count.
await api("POST", "inbox/events", { source: "backup", kind: "done", title: "Backup finished", body: "12 GB in 4 min" })
check("an event toasts", !!(await toastWith("Backup finished: 12 GB in 4 min")), await toasts().allInnerTexts())
check("and counts on the button", (await until(async () => (await count()) === 1)) === true, await count())
await shot(page, "1-toast-and-badge")

// 2. An agent's hook about a terminal: Open goes to it, which reads it.
const term = `qa${Date.now().toString(36)}`
await page.goto(`${B}#view/terminal%2F${term}`)
await until(() => page.locator(".xterm").count())
await wait(1500)
await page.goto(`${B}#file/${enc("Dashboards/Today.md")}`)
await wait(800)
await api("POST", `inbox/hook?agent=claude&terminal=${term}&state=waiting&prev=working`, { hook_event_name: "Notification", message: "Claude needs your permission to use Bash", session_id: "qa-session" })
const waitingToast = await toastWith("Claude Code is waiting for you")
check("an agent waiting: a toast naming it and what it asks", !!waitingToast && waitingToast.includes("permission to use Bash"), await toasts().allInnerTexts())
await page.locator("[data-sonner-toast]", { hasText: "is waiting for you" }).getByRole("button", { name: "Open" }).click()
check("Open goes to its terminal", !!(await until(() => page.evaluate((t) => location.hash.includes(`terminal%2F${t}`) || location.hash.includes(`terminal/${t}`), term))), await page.evaluate(() => location.hash))
let ev = await api("GET", "inbox/events")
check("and reads it", ev.events.find((e) => e.kind === "waiting")?.read === true, ev.events)

// 3. While the user looks at that terminal, its news is read at once, never toasted.
await page.bringToFront()
const before = (await toasts().allInnerTexts()).length
await api("POST", `inbox/hook?agent=claude&terminal=${term}&state=idle&prev=working`, {})
await wait(1500)
ev = await api("GET", "inbox/events")
const finished = ev.events.find((e) => e.kind === "done" && e.terminal === term)
const focused = await page.evaluate(() => document.hasFocus())
if (focused) {
  check("watching its terminal: read, not toasted", finished?.read === true && !(await toasts().allInnerTexts()).some((t) => t.includes("Claude Code finished")), [finished, await toasts().allInnerTexts(), before])
} else console.log("skip (the page has no focus here): watching its terminal")

// 4. vau notify is an event too.
vau("notify", "Wrote the weekly review", "--action-open", "Welcome.md")
check("vau notify: a toast with Open", !!(await toastWith("Wrote the weekly review")))

// 5. Results: a file written in Inbox/, one through the API (an agent's, like MCP's inbox_add).
await page.goto(`${B}#file/${enc("Dashboards/Today.md")}`)
await wait(1000)
mkdirSync(path.join(VAULT, "Inbox"), { recursive: true })
const now = new Date().toISOString().slice(0, 19).replace("T", " ")
writeFileSync(path.join(VAULT, "Inbox", "Plant care apps compared.md"), `---\ntype: inbox\nstatus: new\nfrom: Claude\ncreated: '${now}'\n---\n\n## Findings\n\n- Three tools.\n`)
check("a result written as a file toasts", !!(await toastWith("In your inbox: Plant care apps compared")), await toasts().allInnerTexts())
await api("POST", "inbox", { title: "A field guide to tiling", body: "Worth reading.", from: "Web clipper", source: "https://example.com/tiling" })
await api("POST", "inbox", { title: "Notes to file away", body: "Some notes.", from: "Codex" })
check("and one added through the API", !!(await toastWith("In your inbox: A field guide to tiling")))
const c = await until(async () => { const n = await count(); return n >= 4 ? n : 0 })
check("the button counts results and unread events", c >= 4, await count())

// 6. The Inbox view, from the button: both kinds; it reads the events.
await page.locator("aside [data-inbox-button]").click()
await page.waitForSelector("[data-inbox-view]")
check("the view lists results to review", (await page.locator("[data-inbox-view] [data-result]").count()) === 3, await page.locator("[data-inbox-view] [data-result]").count())
const readList = page.locator("[data-inbox-view] [data-inbox-read]")
check("and the unread events, the read ones folded under Read", (await page.locator("[data-inbox-view] [data-event]").count()) >= 1 && (await page.locator("[data-inbox-view] [data-inbox-fold]").count()) === 0 &&
  (await readList.getAttribute("data-inbox-read")) === "closed", [await page.locator("[data-inbox-view] [data-event]").count(), await page.locator("[data-inbox-view] [data-inbox-fold]").count()])
await wait(400)
await shot(page, "2-inbox-view")
check("open, it reads the events: the count is the results", (await until(async () => (await count()) === 3)) === true, await count())

// 6b. Opened from the view, then back to it: read, so folded under Read (the view's tab is kept drawn meanwhile).
const evRow = (title) => page.locator("[data-inbox-view] [data-event]", { hasText: title })
check("still drawn as new while the view is open", (await evRow("Wrote the weekly review").getAttribute("data-unread")) === "true")
await evRow("Wrote the weekly review").locator("button").first().click()
await until(() => page.evaluate(() => location.hash.includes("Welcome")))
await page.locator("aside [data-inbox-button]").click()
await page.waitForSelector("[data-inbox-view]")
check("opened, then back: read, folded away", !!(await until(async () => (await evRow("Wrote the weekly review").count()) === 0)), await evRow("Wrote the weekly review").count())
await readList.getByRole("button", { name: /^Read \d/ }).click()
check("Read, open: there, drawn as read", (await evRow("Wrote the weekly review").getAttribute("data-unread")) === null, await evRow("Wrote the weekly review").getAttribute("data-unread"))

// 6c. Right-click: Mark as unread stays so while the view is seen; Mark as read.
await evRow("Wrote the weekly review").click({ button: "right" })
await page.getByRole("menuitem", { name: "Mark as unread" }).click()
await wait(2000)
let one = (await api("GET", "inbox/events")).events.find((e) => e.title === "Wrote the weekly review")
check("Mark as unread: unread, and seeing the view doesn't read it", one?.read === false && one.kept === true && (await evRow("Wrote the weekly review").getAttribute("data-unread")) === "true", one)
check("it counts on the button", (await count()) === 4, await count())
await evRow("Wrote the weekly review").click({ button: "right" })
await page.getByRole("menuitem", { name: "Mark as read" }).click()
one = (await until(async () => { const e = (await api("GET", "inbox/events")).events.find((x) => x.title === "Wrote the weekly review"); return e?.read ? e : null }))
check("Mark as read: read, drawn as read", !!one && (await evRow("Wrote the weekly review").getAttribute("data-unread")) === null, one)
await page.locator("[data-inbox-view] [data-result]").first().click({ button: "right" })
check("a result's right-click has Done", (await page.getByRole("menuitem", { name: "Done" }).count()) === 1)
await page.keyboard.press("Escape")
await shot(page, "2b-inbox-menus")

// 7. Done (into the archive, with Undo), File to…
const row = (title) => page.locator("[data-inbox-view] [data-result]", { hasText: title })
await row("Plant care apps compared").getByRole("button", { name: "Done" }).click()
check("Done: status done, moved into Inbox/.archive/, archived in the file", !!(await until(() => /status: done[\s\S]*archived: true/.test(read("Inbox/.archive/Plant care apps compared.md")))) &&
  !existsSync(path.join(VAULT, "Inbox/Plant care apps compared.md")), read("Inbox/.archive/Plant care apps compared.md"))
check("and it leaves the list", !!(await until(async () => (await row("Plant care apps compared").count()) === 0)))
await page.locator("[data-sonner-toast]", { hasText: "Marked" }).getByRole("button", { name: "Undo" }).click()
check("Undo: new again, out of the archive", !!(await until(() => read("Inbox/Plant care apps compared.md").includes("status: new") && !read("Inbox/Plant care apps compared.md").includes("archived"))), read("Inbox/Plant care apps compared.md"))
await row("A field guide to tiling").getByRole("button", { name: "More" }).click()
check("no Archive in the menu (Done is it)", (await page.getByRole("menuitem", { name: "Archive" }).count()) === 0)
await page.keyboard.press("Escape")
await row("A field guide to tiling").getByRole("button", { name: "Done" }).click()
check("Done: into Inbox/.archive/", !!(await until(() => read("Inbox/.archive/A field guide to tiling.md").includes("archived: true"))))
// What's dealt with goes last, folded: open it, and Back to review brings one back (out of the archive).
const dealt = page.locator("[data-inbox-view] [data-inbox-settled]")
check("Done: last, folded", !!(await until(async () => (await dealt.getAttribute("data-inbox-settled")) === "closed")) &&
  (await page.locator("[data-inbox-view] section").last().getAttribute("data-inbox-settled")) !== null)
await dealt.getByRole("button", { name: /^Done \d/ }).click()
check("Done: open, the archived one in it", !!(await until(() => dealt.locator("[data-result]", { hasText: "A field guide to tiling" }).count())))
await shot(page, "3a-inbox-dealt")
// (Dispatched: with only unread events the list is short, so the toasts can cover this row.)
await dealt.locator("[data-result]", { hasText: "A field guide to tiling" }).getByRole("button", { name: "Back to review" }).dispatchEvent("click")
check("Back to review: out of the archive, to review again", !!(await until(() => read("Inbox/A field guide to tiling.md") && !read("Inbox/A field guide to tiling.md").includes("archived") && read("Inbox/A field guide to tiling.md").includes("status: new"))) &&
  !!(await until(() => row("A field guide to tiling").count())))
await row("Notes to file away").getByRole("button", { name: "More" }).click()
await page.getByRole("menuitem", { name: "File to…" }).click()
await wait(300)
await page.keyboard.type("Notes/Filed"); await wait(300)
await page.keyboard.press("Shift+Enter")
const filed = await until(() => read("Notes/Filed/Notes to file away.md"))
check("File to…: moved, without its inbox keys", !!filed && !/type: inbox|status:/.test(filed) && filed.includes("from: Codex") && !existsSync(path.join(VAULT, "Inbox/Notes to file away.md")), filed)
await wait(500)
await shot(page, "3-after-actions")

// 8. The sidebar panel, shown through sidebars.json.
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "inbox:inbox", "pages:pages", "files:files"], right: [], collapsed: [] }))
await api("POST", "inbox/events", { source: "codex", kind: "done", title: "Codex finished", body: "lighthouse" })
const panel = await until(() => page.locator("aside [data-inbox-panel]").count())
check("the panel shows", !!panel)
check("and the header's button steps aside", !!(await until(async () => (await page.locator("aside [data-inbox-button]").count()) === 0)))
check("with results and events", (await page.locator("aside [data-inbox-panel] [data-result]").count()) >= 1 && (await page.locator("aside [data-inbox-panel] [data-event]").count()) >= 1)
await wait(400)
await page.locator("aside[data-side=left]").screenshot({ path: `${OUT}4-sidebar-panel.png` })

// 8a. Done on the result being read: the next one to review takes its tab, rather than the tab closing (Undo: back).
const panelIds = () => page.locator("aside [data-inbox-panel] [data-result]").evaluateAll((els) => els.map((e) => e.dataset.result))
const ids = await panelIds()
const reading = ids[0], after = ids[1]
await page.goto(`${B}#file/${enc(`${reading}.md`)}`)
await wait(800)
await page.locator(`aside [data-inbox-panel] [data-result="${reading}"]`).hover()
await page.locator(`aside [data-inbox-panel] [data-result="${reading}"]`).getByRole("button", { name: "Done" }).click()
const hashNow = () => page.evaluate(() => decodeURIComponent(location.hash))
check("Done on the result being read: the next one shows in its place", !!after && !!(await until(async () => (await hashNow()) === `#file/${after}.md`)) &&
  !!(await until(() => read(`Inbox/.archive/${reading.split("/").pop()}.md`).includes("archived: true"))), [ids, await hashNow()])
await page.locator("[data-sonner-toast]", { hasText: "done" }).last().getByRole("button", { name: "Undo" }).click()
check("Undo puts it back to review", !!(await until(() => read(`${reading}.md`).includes("status: new"))))
await wait(500)

// 8b. Only unread events, no "Show N earlier"; with show_read, read ones greyed, past 8 rows folded into it.
for (let i = 1; i <= 10; i++) await api("POST", "inbox/events", { source: "backup", kind: "done", title: `Backup ${i} finished` })
await api("POST", "inbox/events/read", {})
await api("POST", "inbox/events", { source: "codex", kind: "waiting", title: "Codex is waiting" })
// Kept unread (as if marked so by hand): the Inbox tab behind the panel would read it.
await api("POST", "inbox/events/unread", { ids: [(await api("GET", "inbox/events")).events.find((e) => e.title === "Codex is waiting").id] })
const prow = (sel = "") => page.locator(`aside [data-inbox-panel] [data-event]${sel}`)
const fold = page.locator("aside [data-inbox-panel] [data-inbox-fold]")
const total = (await api("GET", "inbox/events")).events.length
const waiting = prow().filter({ hasText: "Codex is waiting" })
check("by default only the unread event, no Show earlier", !!(await until(async () => (await waiting.count()) === 1 && (await prow().count()) === 1)) && (await fold.count()) === 0, [await waiting.count(), await prow().count(), await fold.count()])
const op = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity)
check("the unread event shows, not greyed", (await waiting.count()) === 1 && (await op(waiting)) === "1", await waiting.count())
await page.locator("aside[data-side=left]").screenshot({ path: `${OUT}4b-sidebar-unread-only.png` })
await api("PATCH", "config/plugin/inbox", { show_read: true })
check("show_read: the last day's read ones too, past 8 rows folded", !!(await until(async () => (await prow().count()) === 8 && (await fold.innerText().catch(() => "")) === `Show ${total - 8} earlier`)), [await prow().count(), await fold.innerText().catch(() => "")])
check("read ones are greyed out", (await op(prow("[data-kind=done]").first())) === "0.5", await op(prow("[data-kind=done]").first()))
await page.locator("aside[data-side=left]").screenshot({ path: `${OUT}4c-sidebar-show-read.png` })
await fold.click()
check("Show earlier: every event", !!(await until(async () => (await prow().count()) === total)), await prow().count())
check("then Show less", (await fold.innerText()) === "Show less")
await fold.click()
check("which folds them again", !!(await until(async () => (await prow().count()) === 8)), await prow().count())
await api("PATCH", "config/plugin/inbox", { show_read: null })
check("show_read off again: only the unread one", !!(await until(async () => (await prow().count()) === 1 && (await fold.count()) === 0)), await prow().count())

// 9. The block on Today.
await page.goto(`${B}#file/${enc("Dashboards/Today.md")}`)
await wait(1200)
const block = page.locator("[data-inbox-results]").first()
check("the block on Today lists what's new", (await block.count()) === 1, await block.count())
await page.locator("section", { has: page.locator("[data-inbox-results]") }).first().screenshot({ path: `${OUT}5-today-block.png` }).catch(() => {})
const text = await api("GET", `render?path=${enc("Dashboards/Today.md")}`)
check("as text too", text.includes("## Inbox") && text.includes("Plant care apps compared"), text.slice(text.indexOf("## Inbox"), text.indexOf("## Inbox") + 300))

// 10. A phone: the block, and the button at the top of the tab list.
const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
await phone.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const ph = watch(await phone.newPage(), { label: "phone" })
await ph.goto(`${B}#file/${enc("Dashboards/Today.md")}`)
await ph.waitForSelector("[data-phone-bar]")
await wait(1500)
const pblock = ph.locator("[data-inbox-results]").first()
await pblock.scrollIntoViewIfNeeded().catch(() => {})
check("phone: the block", (await pblock.count()) === 1)
const wide = await ph.evaluate(() => document.documentElement.scrollWidth <= 390)
check("phone: no sideways scroll", wide)
await shot(ph, "6-phone-today")
await ph.locator("[data-tabs-button]").tap()
const pbutton = await until(() => ph.locator("[data-sheet-bar] [data-inbox-button]").count())
check("phone: the Inbox button in the tab list's bottom bar", !!pbutton)
await wait(800) // the tab list slides up
await shot(ph, "7-phone-tabs")
if (pbutton) {
  await ph.locator("[data-sheet-bar] [data-inbox-button]").tap()
  check("phone: it opens the Inbox", !!(await until(() => ph.locator("[data-inbox-view]").count())))
  await wait(500)
  await shot(ph, "8-phone-inbox")
}

if (sidebars) writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), sidebars); else rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
await browser.close()
await done()
