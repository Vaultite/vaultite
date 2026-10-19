// Conflicts: a note changed elsewhere in the lines being typed. The clash shows in place (yours, theirs, each with Keep,
// and Keep both), the rest merged, both sides kept in File history, nothing written until it's settled, and each choice
// undone from its toast; the agent that wrote it named. A save whose answer was lost isn't a conflict with itself. At a
// phone's width the choices are finger-sized and nothing scrolls sideways.
// WRITES to the vault (Qa conflicts/, removed at the end): throwaway server only.
//   node web/qa/conflicts.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, done } = await qa(import.meta.url)
const P = "Qa conflicts/Note.md"
const abs = `${VAULT}/${P}`
const read = () => readFileSync(abs, "utf8")
const START = "Line one.\n\nLine three.\n\nLine five.\n"
const reset = () => { mkdirSync(`${VAULT}/Qa conflicts`, { recursive: true }); writeFileSync(abs, START) }
// An agent's write (Activity names it Claude Code), on top of what's on disk.
const agentWrite = (fn) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" },
  body: JSON.stringify({ path: P, text: fn(read()) }) })

/** Open the note, type `typed` at the end of line 3 and let it save; then the agent changes line 1 and line 3, and more
 *  is typed: a clash. */
async function clash(page, more = " More") {
  reset()
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(P)}`)
  await until(() => page.locator(".cm-content").count(), 8000)
  // (a phone opens notes to read: Edit first)
  if (!(await page.locator(".cm-content[contenteditable=true]").count())) { await page.locator("button[aria-label=Edit]").first().click(); await wait(500) }
  await page.locator(".cm-line", { hasText: "Line three." }).click()
  await page.keyboard.press("End"); await page.keyboard.type(" Mine.")
  await until(() => read().includes("Mine."), 4000)
  await agentWrite((t) => t.replace("Line one.", "Line one, edited.").replace("Line three. Mine.", "Line three. Theirs."))
  await page.keyboard.type(more)
  return until(() => page.locator(".cm-clash").count(), 9000)
}

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errs = []
// (a plugin asking to write on its own, on a fresh server: not now)
const notNow = (p) => p.addLocatorHandler(p.locator("dialog[open] button", { hasText: "Not now" }), (b) => b.click())
await notNow(page)
page.on("pageerror", (e) => errs.push(String(e)))
const out = {}

// Shown in place, nothing written, the rest merged, both kept in history.
out.shown = !!(await clash(page))
out.banner = await page.locator("[role=alert]").first().innerText().catch(() => "")
out.diskHeld = read().includes("Theirs.") && !read().includes("More")
out.merged = await page.locator(".cm-line", { hasText: "Line one, edited." }).count()
out.mine = await page.locator(".cm-line.cm-clash-line").allInnerTexts()
out.theirs = await page.locator(".cm-clash-theirs .cm-clash-text").innerText().catch(() => "")
out.label = await page.locator(".cm-clash-theirs .cm-clash-label").innerText().catch(() => "")
const vs = await (await fetch(`${B}api/history?path=${encodeURIComponent(P)}`)).json()
const texts = await Promise.all(vs.versions.map(async (v) => (await fetch(`${B}api/history/version?path=${encodeURIComponent(P)}&t=${v.t}`)).text()))
out.historyMine = texts.some((t) => t.includes("Mine. More"))
out.historyTheirs = texts.some((t) => t.includes("Theirs.") && !t.includes("More"))
await page.screenshot({ path: `${OUT}conflicts-desktop.png` })

// Keep theirs: saved; Undo brings the clash back; Keep both: both lines.
await page.locator(".cm-clash-theirs button", { hasText: "Keep" }).first().click()
out.theirsSaved = !!(await until(() => read().includes("Line three. Theirs.") && !read().includes("More") && read().includes("Line one, edited."), 4000))
out.toast = await page.locator("[data-sonner-toast]", { hasText: "history" }).first().innerText().catch(() => "")
out.bannerGone = !(await until(() => page.locator("[role=alert]", { hasText: "while you typed" }).count(), 1000))
await page.locator("[data-sonner-toast]", { hasText: "history" }).locator("button", { hasText: "Undo" }).first().click()
out.undone = !!(await until(() => page.locator(".cm-clash").count(), 3000))
await page.locator(".cm-clash button", { hasText: "Keep both" }).click()
out.both = !!(await until(() => read().includes("Line three. Mine. More\nLine three. Theirs."), 4000))
out.bothClean = !(await page.locator(".cm-clash").count())

// Keep yours.
await clash(page)
await page.locator(".cm-clash-mine button", { hasText: "Keep" }).click()
out.yours = !!(await until(() => read().includes("Line three. Mine. More") && !read().includes("Theirs.") && read().includes("Line one, edited."), 4000))

// Switched to source mode and back mid-conflict: still shown, then settled.
await clash(page)
const view = async (name) => {
  await page.locator("[role=status] button[aria-label^='Current view']").click(); await wait(200)
  await page.locator("[role=menu] button", { hasText: name }).first().click(); await wait(800)
}
await view("Source mode")
out.inSource = await page.locator(".cm-clash").count()
await view("Live preview")
out.backLive = await page.locator(".cm-clash").count()
await page.locator(".cm-clash-theirs button", { hasText: "Keep" }).first().click()
out.afterSwitch = !!(await until(() => read().includes("Line three. Theirs.") && !read().includes("More"), 4000))

// Where it can't be shown in place (a property, its frontmatter hidden): the banner's choice, undone from its toast.
const FM = "Qa conflicts/Fm.md"
writeFileSync(`${VAULT}/${FM}`, "---\nstatus: draft\n---\n\nBody.\n")
const readFm = () => readFileSync(`${VAULT}/${FM}`, "utf8")
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(FM)}`)
await until(() => page.locator(".cm-content").count(), 8000); await wait(500)
if (!(await page.locator("input[placeholder=Empty]").count())) { await page.locator("text=Properties").first().click(); await wait(400) }
const value = page.locator("input[placeholder=Empty]").first()
await value.fill("draft, mine"); await value.press("Enter")
await fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "x-vaultite-client": "cli", "x-vaultite-agent": "claude-code" },
  body: JSON.stringify({ path: FM, text: "---\nstatus: final\n---\n\nBody.\n" }) })
const fallback = page.locator("[role=alert]", { hasText: "while you typed" })
out.fallback = !!(await until(() => fallback.count(), 9000)) && !(await page.locator(".cm-clash").count())
out.fallbackText = await fallback.first().innerText().catch(() => "")
await fallback.locator("button", { hasText: "Keep Claude Code's" }).click()
out.fbTheirs = !!(await until(() => readFm().includes("status: final"), 3000)) && !(await fallback.count())
await page.locator("[data-sonner-toast]", { hasText: "history" }).locator("button", { hasText: "Undo" }).first().click()
out.fbBack = !!(await until(() => fallback.count(), 3000))
await fallback.locator("button", { hasText: "Keep yours" }).click()
out.fbYours = !!(await until(() => readFm().includes("status: draft, mine"), 4000))

// A save that reached the server but whose answer was lost: no conflict with itself.
reset()
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(P)}`)
await until(() => page.locator(".cm-content").count(), 8000)
await page.locator(".cm-line", { hasText: "Line three." }).click()
await page.keyboard.press("End")
let dropped = 0
await page.route("**/api/file", async (route) => {
  if (route.request().method() !== "PUT" || dropped) return route.fallback()
  dropped++
  await route.fetch()
  await route.abort("failed")
})
await page.keyboard.type(" Cut off mid-sen")
await until(() => dropped, 4000)
await wait(300)
await page.unroute("**/api/file")
await page.keyboard.type("tence and more.")
out.lostAnswer = !!(await until(() => read().includes("Line three. Cut off mid-sentence and more."), 6000))
out.lostNoClash = !(await page.locator(".cm-clash").count()) && !(await page.locator("[role=alert]", { hasText: "while you typed" }).count())

// A phone: finger-sized choices, nothing sideways.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })
await notNow(phone)
phone.on("pageerror", (e) => errs.push(String(e)))
out.phoneShown = !!(await clash(phone))
out.phoneButtons = await phone.locator(".cm-clash button").evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)))
out.phoneWide = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
await phone.screenshot({ path: `${OUT}conflicts-phone.png` })
if (out.phoneShown) await phone.locator(".cm-clash-theirs button", { hasText: "Keep" }).first().tap()
out.phoneKept = !!(await until(() => read().includes("Line three. Theirs.") && !read().includes("More"), 4000))

check("a clash shows in place, with a banner naming who and where", out.shown && /Claude Code edited line 3 while you typed/.test(out.banner), out.banner)
check("nothing is written until it's settled; the rest is merged", out.diskHeld && out.merged >= 1)
check("yours and theirs are both drawn", out.mine.join("\n").includes("Mine. More") && out.theirs === "Line three. Theirs." && out.label === "Claude Code's", [out.mine, out.theirs, out.label])
check("both sides are kept in File history", out.historyMine && out.historyTheirs)
check("Keep theirs saves it, says where yours is, the banner goes", out.theirsSaved && /history/.test(out.toast) && out.bannerGone, out.toast)
check("Undo brings the clash back; Keep both keeps both", out.undone && out.both && out.bothClean)
check("Keep yours saves yours with the rest merged", out.yours)
check("a switch to source mode and back keeps the conflict", out.inSource >= 2 && out.backLive >= 2 && out.afterSwitch, [out.inSource, out.backLive])
check("not shown in place: the banner's choice, Undo brings it back", out.fallback && /Claude Code edited the properties while you typed/.test(out.fallbackText) && out.fbTheirs && out.fbBack && out.fbYours, [out.fallbackText, out.fbTheirs, out.fbBack, out.fbYours])
check("a save whose answer was lost is no conflict", out.lostAnswer && out.lostNoClash, read())
check("phone: shown, 44px choices, nothing sideways, a tap settles it", out.phoneShown && out.phoneButtons.length >= 3 && out.phoneButtons.every((h) => h >= 44) && !out.phoneWide && out.phoneKept, out.phoneButtons)
check("no page errors", !errs.length, errs)
rmSync(`${VAULT}/Qa conflicts`, { recursive: true, force: true })
await done()
