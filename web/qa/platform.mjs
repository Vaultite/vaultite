// The app as the computer it runs on expects (core/platform.ts): keys drawn as ⌘O on a Mac and Ctrl+O elsewhere in
// tooltips, keycaps and the palette; Linux's defaults (back on Alt+←, workspaces on Alt+n, Ctrl+Shift+C/V in the
// terminal); Reveal in Finder or Show in folder; a middle click on a link that doesn't paste. Chrome takes the server's
// computer's platform. Runs a shell and switches workspaces: throwaway server only.
//   node web/qa/platform.mjs <base url>
import { execFileSync } from "node:child_process"
import path from "node:path"
import { BACK_KEY, qa, terminalText, until, wait } from "./lib/qa.mjs"

const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const MAC = process.platform === "darwin"
// The Search field in the sidebar (the sandbox starts without it).
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a], { encoding: "utf8" })
vau("plugin", "on", "workspaces")
for (const where of [[], ["--vault"]]) if (!/^\s+\d+\. search:search/m.test(vau("panels", ...where))) vau("panels", "show", "search", ...where)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] })
const page = watch(await ctx.newPage(), { console: true })
await page.goto(`${B}#notes`)
await page.waitForSelector("[role=tree]", { timeout: 30000 })
const platform = await page.evaluate(() => navigator.platform)
check(`Chrome says ${MAC ? "a Mac" : "not a Mac"}`, /Mac/.test(platform) === MAC, platform)

const tip = (sel) => page.locator(sel).first().getAttribute("data-tip")
const back = await tip("[aria-label='Navigate back']")
check(`back's tooltip names ${MAC ? "⌘⌥←" : "Alt+←"}`, back === `Navigate back (${MAC ? "⌘⌥←" : "Alt+←"})`, back)
const side = await tip("[data-sidebar-toggle='']")
check(`the sidebar toggle's tooltip names ${MAC ? "⌘\\" : "Ctrl+\\"}`, side?.endsWith(MAC ? "(⌘\\)" : "(Ctrl+\\)"), side)
// (vau changes the workspace of the window it last heard from: this page's, now that it's open)
if (!(await page.locator("[data-sidebar-search]").count())) { vau("panels", "show", "search"); await page.waitForSelector("[data-sidebar-search]", { timeout: 10000 }) }
await page.locator("[data-sidebar-search]").hover(); await wait(300)
const caps = await page.locator("[data-sidebar-search] kbd").allTextContents()
check("the search field's keycaps are the quick switcher's", caps.join(" ") === (MAC ? "⌘ O" : "Ctrl O"), caps)

// A note open: the view toggle's tooltip, then Back on its keys.
const notes = await page.evaluate(async () => (await (await fetch("api/state")).json()).notes?.filter((n) => /\[\[/.test(n.body ?? "")).map((n) => `${n.id}.md`) ?? [])
const [a, b] = notes
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(a)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 20000 }); await wait(800)
const view = await tip("[data-pane] button[aria-label=Edit], [data-pane] button[aria-label=Read]")
check(`the view button's tooltip names ${MAC ? "⌘E" : "Ctrl+E"}`, view?.endsWith(MAC ? "(⌘E)" : "(Ctrl+E)"), view)
await page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(b)}`)
await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)).includes(b), 5000); await wait(600)
await page.locator("body").click({ position: { x: 640, y: 20 } }).catch(() => {})
await page.keyboard.press(BACK_KEY)
check("back's keys go back", await until(async () => decodeURIComponent(await page.evaluate(() => location.hash)).includes(a), 5000), await page.evaluate(() => location.hash))

// The palette: keycaps as text in the quick switcher's footer, Ctrl+P (off a Mac the palette's own key) not taken as ↑.
await page.keyboard.press("ControlOrMeta+O"); await wait(500)
const foot = await page.locator("[role=dialog]").last().textContent()
check(`the quick switcher's footer says ${MAC ? "⌘↵" : "Ctrl+↵"}`, foot.includes(MAC ? "⌘↵" : "Ctrl+↵"), foot.slice(-200))
await page.keyboard.press("Escape")
await page.keyboard.press("ControlOrMeta+P"); await wait(300)
await page.keyboard.type("Switch to workspace 2"); await wait(400)
const row = await page.locator("[role=dialog]").last().textContent()
check(`workspace 2 is on ${MAC ? "⌃2" : "Alt 2"}`, (MAC ? /Switch to workspace 2\s*⌃\s*2/ : /Switch to workspace 2\s*Alt\s*2/).test(row), row.slice(0, 200))
await page.keyboard.press("Escape")
const lit = () => page.locator("[data-workspace-switcher]").first().getAttribute("data-workspace-switcher")
await page.keyboard.press(MAC ? "Control+2" : "Alt+2")
check("its keys switch to it", await until(async () => (await lit()) === "2", 5000), await lit())
await page.keyboard.press(MAC ? "Control+1" : "Alt+1")
await until(async () => (await lit()) === "1", 5000)
await page.keyboard.press("ControlOrMeta+P"); await wait(300)
if (!MAC) {
  await page.keyboard.press("Control+P"); await wait(300)
  check("Ctrl+P closes the palette (not ⌃P's move up, a Mac's)", !(await page.getByPlaceholder(/command/i).count()))
}
await page.keyboard.press("Escape")

// A file's menu: Reveal in Finder, or Show in folder (the server's own computer).
await page.locator("[role=tree] [role=treeitem]").filter({ hasText: a.split("/").pop().replace(/\.md$/, "") }).first().click({ button: "right" })
const items = await until(async () => (await page.locator("[role=menu] [role=menuitem]").count()) > 0, 3000) ? await page.locator("[role=menu]").allTextContents() : []
const more = page.getByRole("menuitem", { name: /^More/ })
if (await more.count()) { await more.first().hover(); await wait(300) }
const all = (await page.locator("[role=menu]").allTextContents()).join(" ")
check(`a file's menu has ${MAC ? "Reveal in Finder" : "Show in folder"}`, all.includes(MAC ? "Reveal in Finder" : "Show in folder") && (MAC || !all.includes("Finder")), [items.join(" ").slice(0, 200), all.slice(0, 300)])
await page.keyboard.press("Escape"); await page.keyboard.press("Escape")

// A middle click on a link opens it in a new tab without pasting (X11's PRIMARY pastes when the button comes up).
await page.evaluate(() => {
  window.__middle = null
  addEventListener("mouseup", (e) => { if (e.button === 1) window.__middle = e.defaultPrevented })
})
const link = page.locator("[data-pane] .cm-content [data-wiki]").first()
if (await link.count()) {
  await link.click({ button: "middle" }); await wait(500)
  check("a middle click on a link prevents the paste", await page.evaluate(() => window.__middle === true), await page.evaluate(() => window.__middle))
} else check("a note with a link to middle-click", false, a)

// The terminal: off a Mac, Ctrl+Shift+C copies the selection (no ^C to the shell) and Ctrl+Shift+V pastes it.
if (!MAC) {
  const sid = `qaplat${Date.now().toString(36)}`
  await page.goto("about:blank"); await page.goto(`${B}#view/terminal%2F${sid}`)
  const text = () => terminalText(page)
  await until(async () => /%|\$|❯/.test(await text()), 10000)
  await page.locator(".xterm").click()
  await page.keyboard.type("echo zebra")
  await until(async () => (await text()).includes("echo zebra"), 3000)
  // (drawn on a canvas: the input textarea sits at the cursor, a cell wide, just after "zebra")
  const word = await page.evaluate(() => {
    const box = document.querySelector(".xterm-helper-textarea")?.getBoundingClientRect()
    return box && box.width ? { x: box.left - 2.5 * box.width, y: box.top + box.height / 2 } : null
  })
  if (word) await page.mouse.dblclick(word.x, word.y)
  await page.keyboard.press("Control+Shift+C"); await wait(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => String(e)))
  check("Ctrl+Shift+C copies the selection", clip.trim() === "zebra", clip)
  check("...and sends no ^C (the line is still there)", !(await text()).includes("^C") && /echo zebra\s*$/m.test(await text()), (await text()).slice(-200))
  await page.keyboard.press("Control+Shift+V")
  check("Ctrl+Shift+V pastes", await until(async () => (await text()).includes("echo zebrazebra"), 3000), (await text()).slice(-200))
  await page.keyboard.press("Control+U"); await page.keyboard.type("exit"); await page.keyboard.press("Enter"); await wait(500)
}

await ctx.close()
await done()
