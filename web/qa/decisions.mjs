// Decisions in the inbox: a report's questions as their own items (inbox.report --decision, inbox.ask), answered with a
// tap, Accept all defaults, the report quiet under Reports today, a session's progress on its row; desktop and 390px.
// Writes Inbox/ and .vaultite/sidebars.json (put back): throwaway server only.
//   node web/qa/decisions.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { devices } from "playwright-core"
import { apiAt, qa, until } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/decisions-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = apiAt(B)
const read = (rel) => { try { return readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }
const enc = (p) => encodeURIComponent(p)
// (no terminal or session: an answer has no agent to go to, so nothing starts)
const vau = (...args) => execFileSync("node", [fileURLToPath(new URL("../../bin/vau", import.meta.url)), ...args],
  { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, ""), VAULTITE_TERMINAL: "", CLAUDE_CODE_SESSION_ID: "" }, encoding: "utf8" })

const sidebars = read(".vaultite/sidebars.json")
writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), JSON.stringify({ left: ["search:search", "inbox:inbox", "pages:pages", "files:files"], right: [], collapsed: [] }))

vau("inbox", "report", "Lighthouse header redesigned", "--work", "feature", "--tldr", "The Lighthouse page has its new header, live on the preview.",
  "--summary", "Moved the logo left and gave the header a quieter colour.\n\n- `web/src/Header.tsx`\n- Branch `lighthouse-header`, commit 3f2a1c0",
  "--decision", "Keep the old footer under the new header? | Keep it* | Drop it",
  "--decision", JSON.stringify({ question: "Ship the new header to the phone layout too?", options: ["Ship it", "Desktop only"], default: "Desktop only", why: "The phone's header is narrower: the logo would sit above the title." }),
  "--decision", JSON.stringify({ question: "Which account should tonight's deploy use?", options: ["Work", "Personal"], default: "Personal", blocking: true }))
vau("inbox", "ask", "Release Beacon 2.4 tonight, or wait for Monday?", "--options", "Tonight", "Monday", "--default", "Monday", "--blocking", "--from", "Codex")
vau("inbox", "ask", "Keep the old footer under the new header", "--options", "Keep it", "Drop it", "--default", "Keep it")
vau("inbox", "progress", "Two of five fixes in; CI runs on the third", "--session", "qa-progress-1", "--agent", "codex")
const report = readdirSync(path.join(VAULT, "Inbox/.archive")).find((f) => f.includes("Lighthouse header redesigned"))
check("report: archived as it came, not an inbox item", !!report && !readdirSync(path.join(VAULT, "Inbox")).some((f) => f.includes("Lighthouse header")), readdirSync(path.join(VAULT, "Inbox")))
const listed = JSON.parse(vau("inbox", "decisions", "--json")).decisions
check("decisions: one file each, the one asked twice merged, the ones an agent waits on first", listed.length === 4 && listed[0].blocking && listed[1].blocking && !listed[2].blocking, listed.map((d) => d.question))

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = watch(await ctx.newPage())
await page.goto(`${B}#view/inbox`)
const rows = page.locator("[data-inbox-view] [data-decision]")
check("page: the decisions on top", await until(async () => (await rows.count()) === 4, 10000), await rows.count())
check("page: the ones it waits on say so, first", (await rows.first().getAttribute("data-blocking")) === "true" && (await rows.nth(0).innerText()).includes("Waits on you"))
check("page: a default taken reads Went with", (await rows.nth(2).innerText()).includes("Went with"), await rows.nth(2).innerText())
const panel = page.locator("[data-inbox-panel] [data-decision]")
check("panel: the decisions first", (await panel.count()) === 4, await panel.count())
await page.locator("[data-inbox-view]").screenshot({ path: `${OUT}1-page.png` })
await page.locator("aside[data-side=left]").screenshot({ path: `${OUT}2-panel.png` })

// A tap answers: the row leaves, the file keeps the answer.
const ship = page.locator("[data-inbox-view] [data-decision]", { hasText: "phone layout" })
await ship.getByRole("button", { name: "Ship it" }).click()
check("answer: the row leaves at once", await until(async () => (await ship.count()) === 0, 3000))
check("answer: kept in its file, archived", await until(() => /answer: Ship it/.test(read("Inbox/.archive/Ship the new header to the phone layout too.md")), 5000),
  readdirSync(path.join(VAULT, "Inbox/.archive")))
check("answer: a toast with Undo", await until(async () => (await page.locator("[data-sonner-toast]").allInnerTexts()).some((t) => t.includes("Ship it") && t.includes("Undo")), 4000))

// Its report: TL;DR, its decisions with their buttons, the details folded.
await page.goto(`${B}#file/${enc(`Inbox/.archive/${report}`)}`)
const block = page.locator("[data-decisions-block]")
check("report: its decisions drawn, one answered", await until(async () => (await block.locator("[data-decided]").count()) === 1 && (await block.locator("[data-decision]").count()) === 3, 10000),
  await block.innerText().catch(() => ""))
await page.locator("[data-pane]").first().screenshot({ path: `${OUT}3-report.png` })

// Accept all defaults: a blocking one asks first.
await page.goto(`${B}#view/inbox`)
await until(async () => (await rows.count()) === 3, 10000)
await page.locator("[data-inbox-view] [data-accept-all]").click()
const confirm = page.getByRole("button", { name: "Accept defaults" })
check("accept all: asks, since agents wait", await until(() => confirm.isVisible().catch(() => false), 3000))
await page.screenshot({ path: `${OUT}4-accept-all.png` })
await confirm.click()
check("accept all: none left", await until(async () => (await rows.count()) === 0, 5000), await rows.count())
const reports = page.locator("[data-inbox-reports]")
check("reports today: folded, the report one line", (await reports.count()) === 1 && (await reports.innerText()).includes("Reports today"))
await reports.locator("button").first().click()
check("reports today: its TL;DR", (await reports.innerText()).includes("The Lighthouse page has its new header"), await reports.innerText())
await page.locator("[data-inbox-view]").screenshot({ path: `${OUT}5-page-after.png` })

// The phone: 44px buttons, 17px questions.
vau("inbox", "decide", `Inbox/.archive/${readdirSync(path.join(VAULT, "Inbox/.archive")).find((f) => f.startsWith("Release Beacon"))}`, "--undo")
vau("inbox", "decide", "Inbox/.archive/Ship the new header to the phone layout too.md", "--undo")
const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
const ph = watch(await phone.newPage())
await ph.goto(`${B}#view/inbox`)
const prow = ph.locator("[data-inbox-view] [data-decision]")
await until(async () => (await prow.count()) === 2, 10000)
const button = await prow.first().locator("[data-option]").first().boundingBox()
const q = await prow.first().locator("[data-question]").evaluate((el) => getComputedStyle(el).fontSize)
check("phone: 44px buttons, 17px questions", button && button.height >= 44 && q === "17px", { button, q })
await ph.screenshot({ path: `${OUT}6-phone.png` })

if (sidebars) writeFileSync(path.join(VAULT, ".vaultite/sidebars.json"), sidebars); else rmSync(path.join(VAULT, ".vaultite/sidebars.json"), { force: true })
await done()
