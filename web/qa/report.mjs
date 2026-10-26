// An agent's report (inbox.report) and the reply from it (inbox.reply) into its terminal, desktop and 390px. Writes
// Inbox/, Attachments/ and starts terminals: throwaway server only (then `tmux -L vaultite-<port> kill-server`).
//   node web/qa/report.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { devices } from "playwright-core"
import { apiAt, qa, until } from "./lib/qa.mjs"
import { fileURLToPath } from "node:url"
const { args: [B, OUT = "/tmp/report-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = apiAt(B)
const read = (rel) => { try { return readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }
const enc = (p) => encodeURIComponent(p)
// An agent's terminal, as a report's is: QA's stand-in claude runs in it (a reply is typed only into a running agent).
const term = "claude-q7r8s9t0"
const vauIn = (terminal, ...args) => execFileSync("node", [fileURLToPath(new URL("../../bin/vau", import.meta.url)), ...args],
  { env: { ...process.env, VAULTITE_URL: B.replace(/\/$/, ""), VAULTITE_TERMINAL: terminal, CLAUDE_CODE_SESSION_ID: "" }, encoding: "utf8" })
const vau = (...args) => vauIn(term, ...args)

await api("POST", `terminals/${term}`)
check("its terminal runs the agent", await until(async () => (await api("GET", "terminals/sessions")).sessions?.some((s) => s.id === term && s.agent === "claude" && s.busy), 10000))
const shot = path.join(os.tmpdir(), "vaultite-qa-shot.png")
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x800:rate=1", "-frames:v", "1", shot])
const title = "Lighthouse page redesigned"
const named = `Feature needs you · ${title}`
const file = `Inbox/${named}.md`
vau("inbox", "report", title, "--work", "feature", "--tldr", "The Lighthouse page has a new header. Two questions before it ships.", "--summary", "The **Lighthouse** page has a new header.\n- Moved the logo\n- New colours", "--questions", "Keep the old footer?", "Ship it today?",
  "--agent", "claude", "--images", shot)
check("report: written, naming its terminal", read(file).includes(`terminal: ${term}`) && read(file).includes("```block-reply"), read(file))

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = watch(await ctx.newPage())
await page.goto(`${B}#file/${enc(file)}`)
const box = page.locator("textarea[data-reply]")
check("reply box: drawn at the report's end", await until(() => box.isVisible().catch(() => false), 10000))
check("reply box: says who it answers", (await page.getByText("Reply to Claude Code").count()) > 0)
check("report: its questions", (await page.getByText("Keep the old footer?").count()) > 0)
check("report: its tl;dr drawn on top, a callout", (await page.locator(".cm-callout, [data-callout]").first().innerText().catch(() => "")).includes("In short") ||
  (await page.getByText("In short").count()) > 0)
check("report: its screenshot", await until(() => page.locator("img[src*='vaultite-qa-shot']").count().then((n) => n > 0), 5000))
await page.screenshot({ path: `${OUT}report-desktop.png`, fullPage: false })
await box.click()
await box.fill("Keep the footer, ship it")
const scrolled = () => page.evaluate(() => document.querySelector("#main-scroll")?.scrollTop ?? 0)
const before = await scrolled()
await page.keyboard.press("ControlOrMeta+Enter")
check("reply: shown at once, the box emptied", (await page.locator("[data-reply-sending]").count()) > 0 && (await box.inputValue()) === "")
const screen = await until(async () => {
  const s = await api("GET", `terminals/${term}/screen?lines=20`)
  return s.lines?.join("\n").includes("Keep the footer, ship it") ? s : null
}, 8000)
check("reply: typed into its terminal", !!screen, screen)
const archived = `Inbox/.archive/${named}.md`
check("reply: kept in the report with when, which is done", await until(() => /> \[!note\] You replied · \d{4}-\d\d-\d\d \d\d:\d\d\n> Keep the footer, ship it/.test(read(archived)), 8000), read(archived) || read(file))
check("reply: the report stays open, in the archive", await until(() => page.url().includes(enc("Inbox/.archive/")) && box.isVisible(), 5000), page.url())
check("reply: still scrolled where it was read, not back at the top", before > 100 && await until(async () => Math.abs((await scrolled()) - before) < 40, 4000), { before, after: await scrolled() })
await page.screenshot({ path: `${OUT}report-replied.png` })

// A report naming a plain shell (anyone who writes the vault can write one): the box says a new session gets the reply,
// and it does; nothing is typed into the shell, which would run it.
const shell = "q7r8s9t1"
await api("POST", `terminals/${shell}`)
vauIn(shell, "inbox", "report", "Beacon footer kept", "--work", "change", "--tldr", "Kept the Beacon footer.", "--summary", "Kept the footer.", "--agent", "claude")
const inShell = await until(() => readdirSync(path.join(VAULT, "Inbox")).find((f) => f.endsWith(".md") && read(`Inbox/${f}`).includes(`terminal: ${shell}`)), 5000)
await page.goto(`${B}#file/${enc(`Inbox/${inShell}`)}`)
const plan = page.locator("[data-reply-plan]")
check("a shell's report: the box says a new session gets the reply", await until(async () => (await plan.getAttribute("data-reply-plan").catch(() => null)) === "new", 10000) &&
  (await plan.innerText()).startsWith("Starts a new session"), await plan.innerText().catch(() => null))
await box.fill("echo qa-shell-ran")
await page.keyboard.press("ControlOrMeta+Enter")
check("… and says it started one", !!(await until(async () => (await page.locator("[data-sonner-toast]").allInnerTexts()).some((t) => t.includes("Started a new session with your reply")), 10000)),
  await page.locator("[data-sonner-toast]").allInnerTexts())
const shellLines = (await api("GET", `terminals/${shell}/screen?lines=20`)).lines ?? []
check("… never typing into the shell", !shellLines.join("\n").includes("qa-shell-ran"), shellLines)
const fresh = await until(() => /^terminal: (claude-\S+)$/m.exec(read(`Inbox/.archive/${inShell}`))?.[1], 5000)
for (const t of [shell, fresh]) if (t) await api("DELETE", `terminals/${t}`).catch(() => {})

const phone = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } })
const ph = watch(await phone.newPage())
await ph.goto(`${B}#file/${enc(archived)}`)
const pbox = ph.locator("textarea[data-reply]")
await until(() => pbox.isVisible().catch(() => false), 10000)
await pbox.scrollIntoViewIfNeeded()
const send = ph.getByRole("button", { name: "Send" })
const [bw, sb] = [await pbox.boundingBox(), await send.boundingBox()]
check("phone: the box is full width, its buttons 44px", bw && bw.width > 300 && sb && sb.height >= 44, { bw, sb })
await ph.screenshot({ path: `${OUT}report-phone.png` })

await api("DELETE", `terminals/${term}`).catch(() => {})
await done()
