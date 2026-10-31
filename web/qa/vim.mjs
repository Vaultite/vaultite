// The Vim plugin in the editor: turned on from elsewhere, open editors take its keys at once, plus the app's own (]],
// gf, :e, the leader, the vimrc); a phone never gets it. WRITES "Qa vim/", plugins/vim/, plugins.json: throwaway.
//   node web/qa/vim.mjs <base url> [out dir]
import { apiAt, palette, qa, SHOTS, until, wait, command } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, errs, watch, noErrors, done } = await qa(import.meta.url)
const NOTE = "Qa vim/Note.md", CODE = "Qa vim/code.ts", OTHER = "Qa vim/Other page.md", MD = "Qa vim/Motions.md"
const VIMRC = ".vaultite/plugins/vim/init.vim"
const json = { "Content-Type": "application/json" }
// The notes it works on are the user's own (the app's client): an agent's new note would get `origin: ai` (Provenance,
// 321233a), and the text compared here is what was typed.
const put = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: { ...json, "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
// The vimrc: a settings file, written in place (PUT) or made at its path (POST); never deleted (hidden files are off).
const putRc = async (text) => {
  const r = await fetch(`${B}api/file`, { method: "PUT", headers: json, body: JSON.stringify({ path: VIMRC, text }) })
  if (r.status === 404) await put(VIMRC, text)
}
// Vim is built in, off until in plugins.json's `enabled`: switched there, the rest of the list kept.
const vim = async (on) => {
  const api = apiAt(B), conf = await api("GET", "config/plugins")
  return api("PATCH", "config/plugins", { enabled: [...(conf.enabled ?? []).filter((x) => x !== "vim"), ...(on ? ["vim"] : [])] })
}

for (const p of [NOTE, CODE, OTHER, MD]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await putRc("")
await put(NOTE, "first line\nsecond line\nthird line\n")
await put(CODE, "const a = 1\nconst b = 2\n")
await put(OTHER, "The other page.\n")
await put(MD, "Intro text\n\n## First heading\n\nSee [[Other page]] here.\n\n## Second heading\n\nMore text\nand more\n")
await vim(false)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(B).origin })
const page = watch(await ctx.newPage())
const ed = page.locator(".vau-editor")
const lineEl = (text) => ed.locator(".cm-line", { hasText: text }).first()
// Vim in the focused editor: its mode in the status bar (or the block cursor of normal mode).
const vimOn = async () => (await page.locator("[data-vim-mode]").count()) + (await page.locator(".cm-fat-cursor").count())
const mode = () => page.locator("[data-vim-mode]").first().getAttribute("data-vim-mode").catch(() => null)
// The text of the line the block cursor is on.
const cursorLine = () => page.evaluate(() => {
  const c = document.querySelector(".cm-fat-cursor")?.getBoundingClientRect()
  if (!c) return null
  const y = c.top + c.height / 2
  return [...document.querySelectorAll(".cm-line")].find((x) => { const r = x.getBoundingClientRect(); return y >= r.top && y <= r.bottom })?.textContent ?? null
})
const tabFile = () => page.evaluate(() => decodeURIComponent(location.hash))
const livePreview = async () => {
  await command(page, "Switch to live preview", 700)
}

await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1500)
await livePreview()
await lineEl("first line").click(); await wait(200)
check("off by default: no Vim in the editor", await vimOn() === 0)
await page.keyboard.press("End"); await page.keyboard.type("!")
check("off: typing types", await until(async () => (await read(NOTE)).replace(/^---\n[\s\S]*?\n---\n\n?/, "").startsWith("first line!\n"))) // (after its origin header)

await vim(true); await wait(2500)
await lineEl("second line").click(); await wait(200)
check("turned on elsewhere: the open editor takes Vim's keys", await vimOn() > 0)
await page.keyboard.press("Escape"); await wait(100)
check("the status bar says Normal", await mode() === "normal")
await page.keyboard.type("0x")
check("normal mode: x deletes a letter", await until(async () => (await read(NOTE)).includes("\necond line\n")))
await page.keyboard.type("dd")
check("dd deletes the line", await until(async () => !(await read(NOTE)).includes("econd line")))
await page.keyboard.type("I"); await wait(100)
check("the status bar says Insert", await mode() === "insert")
await page.keyboard.type("hello "); await page.keyboard.press("Escape")
check("I...<Esc> inserts, back in normal mode", await until(async () => (await read(NOTE)).includes("hello third line")))
await page.keyboard.type("z"); await wait(300); await page.keyboard.press("Escape")
check("normal mode: letters aren't typed", !(await read(NOTE)).includes("zhello"))
await page.keyboard.type(":w"); await page.keyboard.press("Enter"); await wait(300)
check(":w is fine (the editor saves itself)", await page.locator(".cm-vim-panel input").count() === 0 && !errs.length)
check("Escape leaves the tab open", await page.locator(".vau-editor").count() === 1)
// yy: the system clipboard.
await page.keyboard.type("yy"); await wait(300)
check("yy copies the line to the system clipboard", (await page.evaluate(() => navigator.clipboard.readText())).includes("hello third line"))
await page.evaluate(() => navigator.clipboard.writeText("from elsewhere"))
await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await wait(300)
await page.keyboard.type("P")
check("p pastes what was copied elsewhere", await until(async () => (await read(NOTE)).includes("from elsewhere")))
await page.screenshot({ path: `${OUT}vim-note.png` })

// Markdown motions, links and folds.
await page.goto(`${B}#file/${encodeURIComponent(MD)}`); await wait(1500)
await lineEl("Intro text").click(); await wait(200)
await page.keyboard.press("Escape"); await page.keyboard.type("gg"); await wait(100)
await page.keyboard.type("]]"); await wait(200)
check("]] goes to the next heading", (await cursorLine())?.includes("First heading"))
await page.keyboard.type("]]"); await wait(200)
check("]] again: the one after", (await cursorLine())?.includes("Second heading"))
await page.keyboard.type("[["); await wait(200)
check("[[ goes back", (await cursorLine())?.includes("First heading"))
await page.keyboard.type("gl"); await wait(200)
check("gl goes to the next link", (await cursorLine())?.includes("Other page"))
await page.keyboard.type("gf")
check("gf follows the link under the cursor", await until(async () => (await tabFile()).includes("Other page")))
await page.goBack(); await wait(1500)
await lineEl("Second heading").click(); await wait(200)
await page.keyboard.press("Escape"); await page.keyboard.type("za"); await wait(400)
check("za folds the heading's section", await page.locator(".cm-foldPlaceholder").count() > 0)
await page.keyboard.type("zR"); await wait(300)
check("zR opens every fold", await page.locator(".cm-foldPlaceholder").count() === 0)

// : commands drive the app.
await page.keyboard.type(":e Other page"); await page.keyboard.press("Enter")
check(":e opens a file by name", await until(async () => (await tabFile()).includes("Other page")))
await lineEl("The other page").click(); await page.keyboard.press("Escape")
await page.keyboard.type(":vs"); await page.keyboard.press("Enter")
check(":vs splits right", await until(async () => await page.locator("[data-pane]").count() === 2))
// (the keyboard goes into the new pane's editor once it's drawn, Vim's keys there once its extensions are in)
check("...the keyboard goes with it", await until(() => page.evaluate(() => !!document.activeElement?.closest("section[data-focused] .cm-vimMode"))))
await page.keyboard.type(":q"); await page.keyboard.press("Enter")
check(":q closes the tab (and its pane)", await until(async () => await page.locator("[data-pane]").count() === 1))

// Space: the leader, handed to the app.
await lineEl("The other page").click(); await page.keyboard.press("Escape")
await page.keyboard.press("Space"); await wait(800)
check("Space in normal mode: the keys hint lists what follows", await page.locator('[role=status][aria-label="Keys"]').count() === 1)
await page.screenshot({ path: `${OUT}vim-leader.png` })
await page.keyboard.type("ff"); await wait(600)
check("Space F F opens the quick switcher", await page.locator("[role=dialog] input").count() > 0)
await page.keyboard.press("Escape"); await wait(400)

// Ctrl+W L: the pane on the right.
await page.keyboard.type(":vs"); await page.keyboard.press("Enter"); await wait(1500)
const paneOf = () => page.evaluate(() => document.activeElement?.closest("[data-pane]")?.getAttribute("data-pane"))
const panes = await page.locator("[data-pane]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pane")))
await page.keyboard.press("Control+w"); await page.keyboard.press("h"); await wait(600)
const left = await paneOf()
await page.keyboard.press("Control+w"); await page.keyboard.press("l"); await wait(600)
const right = await paneOf()
check("Ctrl+W H and Ctrl+W L move between panes", panes.length === 2 && left && right && left !== right)
// Ctrl+W J and K: below and above (:sp).
await page.keyboard.type(":sp"); await page.keyboard.press("Enter"); await wait(1500)
const below = await paneOf()
await page.keyboard.press("Control+w"); await page.keyboard.press("k"); await wait(600)
const above = await paneOf()
await page.keyboard.press("Control+w"); await page.keyboard.press("j"); await wait(600)
check("Ctrl+W K and Ctrl+W J move between panes above and below", !!above && above !== below && (await paneOf()) === below, [above, below])
await page.keyboard.type(":q"); await page.keyboard.press("Enter"); await wait(1000)
await page.keyboard.type(":q"); await page.keyboard.press("Enter"); await wait(1000)

// The vimrc maps keys, and runs again when it changes.
await putRc('" a test\nnmap Q dd\n'); await wait(2500)
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(1500)
await lineEl("first line").click(); await page.keyboard.press("Escape")
await page.keyboard.type("Q"); await wait(1200)
const afterQ = await read(NOTE)
check(`init.vim: nmap Q dd works${afterQ.includes("first line") ? ` (${JSON.stringify(afterQ)}, mode ${await mode()})` : ""}`, !afterQ.includes("first line"))
await putRc('" changed\n'); await wait(2500)
const before = await read(NOTE)
await ed.locator(".cm-line").first().click(); await page.keyboard.press("Escape")
await page.keyboard.type("Q"); await wait(1200)
check("init.vim changed: the old mapping is gone", (await read(NOTE)) === before)
check("a good vimrc reports nothing", !(await page.locator("[data-sonner-toast]").filter({ hasText: "init.vim" }).count()))

await page.goto(`${B}#file/${encodeURIComponent(CODE)}`); await wait(1500)
await lineEl("const b").click(); await wait(200)
check("a code file gets Vim too", await vimOn() > 0)
await page.keyboard.press("Escape"); await page.keyboard.type("0cwlet"); await page.keyboard.press("Escape")
check("code: cw changes a word", await until(async () => (await read(CODE)).includes("let b = 2")))
await page.keyboard.type("gg0"); await page.keyboard.press("Control+v"); await page.keyboard.type("j"); await page.keyboard.press("Shift+I")
await page.keyboard.type("// "); await page.keyboard.press("Escape")
check("Ctrl+V, I...<Esc> inserts on every line of the block", await until(async () => (await read(CODE)).startsWith("// const a = 1\n// let b = 2")))
await page.screenshot({ path: `${OUT}vim-code.png` })

// Vim's settings (its settings sheet): off on this device.
await palette(page, "Vim settings", 700); await wait(800)
const offHere = page.locator('dialog[open] [role=radiogroup][aria-label="Vim\'s keys on this device"] [role=radio]', { hasText: "Off" })
check("Vim's settings sheet has its panel", await offHere.count() === 1)
await page.screenshot({ path: `${OUT}vim-settings.png` })
await offHere.click(); await wait(500)
await page.goto(`${B}#file/${encodeURIComponent(CODE)}`); await wait(1500)
await lineEl("let b").click(); await wait(200)
check("off on this device: no Vim here", await vimOn() === 0)
await page.evaluate(() => { try { const k = Object.keys(localStorage).find((x) => x.includes("prefs")); if (k) { const p = JSON.parse(localStorage.getItem(k)); if (p.device) delete p.device["vim.keys"]; localStorage.setItem(k, JSON.stringify(p)) } } catch {} })

await vim(false); await wait(2500)
await page.goto(`${B}#file/${encodeURIComponent(CODE)}`); await wait(1500)
await lineEl("let b").click(); await page.keyboard.press("End"); await page.keyboard.type("x")
check("off again: typing types", await until(async () => (await read(CODE)).includes("let b = 2x")))

// A phone: Vim needs a keyboard, so the vault's setting doesn't reach it.
await vim(true)
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
const pp = watch(await phone.newPage())
await pp.goto(`${B}#file/${encodeURIComponent(NOTE)}`); await wait(2500)
check("phone: no Vim even when it's on", await pp.locator(".vau-editor").count() >= 1 && await pp.locator(".cm-fat-cursor").count() === 0)

// The app as on Linux (its platform; any machine): Ctrl is the app's Mod, and in normal mode its shortcuts win over
// Vim's (Ctrl+P the palette, Ctrl+E reading), not Vim's own (Ctrl+V a visual block).
const linux = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" })
await linux.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "Linux x86_64" }))
const lp = watch(await linux.newPage(), { label: "linux" })
const LINUX = "Qa vim/Linux keys.md"
await put(LINUX, "first line\nsecond line\nthird line\n")
const lpMode = () => lp.locator("[data-vim-mode]").first().getAttribute("data-vim-mode").catch(() => null)
const normal = async () => { await lp.locator(".vau-editor .cm-line", { hasText: "second line" }).first().click(); await lp.keyboard.press("Escape"); await wait(200) }
await lp.goto(`${B}#file/${encodeURIComponent(LINUX)}`); await wait(2000)
if (!(await lp.locator(".vau-editor .cm-content[contenteditable=true]").count())) { await lp.keyboard.press("Control+e"); await wait(800) }
await normal()
check("Linux, normal mode: Vim's", (await lpMode()) === "normal", await lpMode())
await lp.keyboard.press("Control+p")
check("Linux, normal mode: Ctrl+P opens the palette, not Vim's line up", await until(() => lp.locator("[role=dialog] input").count(), 3000))
await lp.keyboard.press("Escape"); await wait(300)
await normal()
await lp.keyboard.press("Control+v")
check("Linux, normal mode: Ctrl+V is still Vim's visual block", await until(async () => /block/.test((await lpMode()) ?? ""), 3000), await lpMode())
await lp.keyboard.press("Escape"); await wait(200)
await lp.keyboard.press("Control+e")
check("Linux, normal mode: Ctrl+E switches to reading", await until(async () => (await lp.locator(".vau-editor .cm-content[contenteditable=false]").count()) > 0, 3000))
await linux.close()
await fetch(`${B}api/file?path=${encodeURIComponent(LINUX)}`, { method: "DELETE" })
await vim(false)
noErrors()

for (const p of [NOTE, CODE, OTHER, MD]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await putRc("")
await done()
