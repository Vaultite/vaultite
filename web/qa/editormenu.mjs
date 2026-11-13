// The editor's right-click menu: each item does what its command does; none on Shift+right-click or a held finger.
// WRITES a "Qa editor menu" folder: throwaway server.
//   node web/qa/editormenu.mjs <base url> <vault path> [out dir]
// Paths: plugins/core/editing/menu.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, SELECT_WORD, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT, OUT = "/tmp/editormenu-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa editor menu", NOTE = `${VAULT}/${DIR}/Menu.md`, enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
const START = "alpha beta\ngamma\ndelta\nepsilon\nzeta\n"
writeFileSync(NOTE, START)
const stamp = `Pasted image ${new Date().getFullYear()}`
const disk = () => readFileSync(NOTE, "utf8")
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"] })
  const page = watch(await ctx.newPage()), ui = app(page)
  await page.goto(`${B}#file/${enc(`${DIR}/Menu.md`)}`)
  await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
  await ui.idle()
  const line = (n) => page.locator("[data-pane] .cm-content .cm-line").nth(n - 1)
  const select = async (n, word) => {
    await line(n).click(); await page.keyboard.press("Home")
    if (word) { await page.keyboard.press(SELECT_WORD) } else await page.keyboard.press("Shift+End")
    await ui.idle()
  }
  const items = () => page.locator("[role=menu]").first().locator(":scope > [role=menuitem]").allTextContents()
  const open = (n, opts = {}) => ui.menu.context(line(n), opts)
  const pick = async (n, path, at) => {
    await open(n, at ? { position: at } : {})
    for (const [i, name] of path.entries()) {
      const it = page.locator("[role=menu]").nth(i).getByRole("menuitem", { name, exact: false }).filter({ hasNotText: "link to" }).first()
      await it.click(); await ui.idle()
    }
  }
  const lines = () => disk().split("\n")
  const saved = async (want) => { await ui.saved(); return typeof want === "function" ? want(disk()) : disk().includes(want) }
  const shows = (text) => until(() => page.evaluate((t) => { const el = document.querySelector("[data-pane] .cm-content"); return (el?.cmView?.view ?? el?.cmTile?.view)?.state.doc.toString() === t }, text), 15_000)
  const reset = async (text = START) => { writeFileSync(NOTE, text); await shows(text) }

  await select(1)
  await open(1)
  let got = await items()
  await page.screenshot({ path: `${OUT}selection.png` })
  check("with a selection: links, submenus, clipboard, Search for", ["Add link", "Add external link", "Format", "Paragraph", "Insert", "Cut", "Copy", "Paste", "Paste as plain text", "Select all", "Search for “alpha beta”"]
    .every((x) => got.some((i) => i.startsWith(x))), got)
  await page.getByRole("menuitem", { name: "Format" }).hover(); await page.locator("[role=menu]").nth(1).waitFor(); await ui.idle()
  const fmt = await page.locator("[role=menu]").nth(1).locator("[role=menuitem]").allTextContents()
  await page.screenshot({ path: `${OUT}format.png` })
  const mod = process.platform === "darwin" ? "⌘" : "Ctrl+"
  check("Format ▸ every mark, with keys", [`Bold${mod}B`, `Italic${mod}I`, "Strikethrough", "Highlight", "Code", "Math", `Comment${mod}/`, "Clear formatting"].every((x) => fmt.some((i) => i.startsWith(x))), fmt)
  await ui.menu.close()

  for (const [name, want] of [["Bold", "**alpha beta**"], ["Italic", "*alpha beta*"], ["Strikethrough", "~~alpha beta~~"], ["Highlight", "==alpha beta=="], ["Code", "`alpha beta`"], ["Math", "$alpha beta$"], ["Comment", "%%alpha beta%%"]]) {
    await select(1); await pick(1, ["Format", name])
    check(`Format ▸ ${name}`, await saved((t) => t.startsWith(`${want}\n`)), lines()[0])
    await reset()
  }
  writeFileSync(NOTE, "**alpha** ==beta== `x`\n" + START.split("\n").slice(1).join("\n")); await shows(disk())
  await select(1); await pick(1, ["Format", "Clear formatting"], { x: 30, y: 10 })
  check("Format ▸ Clear formatting", await saved((t) => t.startsWith("alpha beta x\n")), lines()[0])
  await reset()

  for (const [name, want] of [["Bullet list", "- gamma"], ["Numbered list", "1. gamma"], ["Task list", "- [ ] gamma"], ["Heading 2", "## gamma"], ["Quote", "> gamma"]]) {
    await select(2); await pick(2, ["Paragraph", name])
    check(`Paragraph ▸ ${name}`, await saved((t) => t.split("\n")[1] === want), lines()[1])
    await reset()
  }
  writeFileSync(NOTE, START.replace("gamma", "## gamma")); await shows(disk())
  await line(2).click(); await pick(2, ["Paragraph", "Body"])
  check("Paragraph ▸ Body takes the heading off", await saved((t) => t.split("\n")[1] === "gamma"), lines()[1])
  await reset()

  for (const [name, want] of [["Footnote", (t) => /^gamma\[\^1\]$/m.test(t) && /\n\[\^1\]: $/.test(t)], ["Table", "| --- | --- |"], ["Callout", "> [!note]"],
    ["Horizontal rule", "\n---\n"], ["Code block", "```\n"], ["Math block", "$$\n"]]) {
    await line(2).click(); await page.keyboard.press("End"); await pick(2, ["Insert", name])
    check(`Insert ▸ ${name}`, await saved(want), disk())
    await reset()
  }

  await select(1); await pick(1, ["Add link"])
  check("Add link: [[selection]]", await saved("[[alpha beta]]"), lines()[0])
  await reset()
  await select(1); await pick(1, ["Add external link"])
  check("Add external link: [selection]()", await saved("[alpha beta]()"), lines()[0])
  await reset()

  await select(3); await pick(3, ["Copy"])
  check("Copy", (await page.evaluate(() => navigator.clipboard.readText())) === "delta")
  await select(4); await pick(4, ["Cut"])
  check("Cut: on the clipboard and out of the note", await saved((t) => t.split("\n")[3] === "") && (await page.evaluate(() => navigator.clipboard.readText())) === "epsilon", lines())
  await line(5).click(); await page.keyboard.press("End"); await pick(5, ["Paste"])
  check("Paste", await saved((t) => t.split("\n")[4] === "zetaepsilon"), lines())
  await page.evaluate(() => navigator.clipboard.writeText("plain"))
  await line(5).click(); await page.keyboard.press("End"); await pick(5, ["Paste as plain text"])
  check("Paste as plain text", await saved((t) => t.split("\n")[4] === "zetaepsilonplain"), lines())
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = c.height = 16; c.getContext("2d").fillRect(0, 0, 16, 16)
    await navigator.clipboard.write([new ClipboardItem({ "image/png": await new Promise((r) => c.toBlob(r, "image/png")) })])
  })
  await line(5).click(); await page.keyboard.press("End"); await pick(5, [/^Paste(?! as)/])
  check("Paste: a picture is saved as an attachment and embedded", await saved((t) => /!\[\[(Pasted image \d+\.png)\]\]/.test(t)), lines())
  await reset()
  await line(2).click(); await pick(2, ["Select all"])
  await open(2)
  got = await items()
  check("Select all: everything selected (the menu offers Cut)", got.includes("Cut" + "⌘X") || got.some((i) => i.startsWith("Cut")), got)
  await ui.menu.close()

  await select(1)
  await open(4)
  got = await items()
  check("outside the selection: no Cut, Copy or Search for", !got.some((i) => /^(Cut|Copy(?! link)|Search for)/.test(i)) && got.some((i) => i.startsWith("Paste")) && got.some((i) => i.startsWith("Insert")), got)
  await page.getByRole("menuitem", { name: "Insert" }).click(); await ui.idle()
  await page.locator("[role=menu]").nth(1).getByRole("menuitem", { name: "Horizontal rule" }).click(); await ui.idle()
  check("…and the cursor went where the click was", await saved("epsilon\n\n---\n"), disk())
  await reset()

  await select(1); await pick(1, ["Search for"])
  check("Search for: a search tab with the selection", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("view/search/alpha beta")), 4000), await page.evaluate(() => location.hash))
  await page.goto(`${B}#file/${enc(`${DIR}/Menu.md`)}`); await page.waitForSelector("[data-pane] .cm-content"); await ui.idle()

  await line(1).click({ button: "right", modifiers: ["Shift"] }); await ui.idle()
  check("Shift+right-click: no app menu", await page.locator("[role=menu]").count() === 0)

  for (const name of ["Toggle inline math", "Clear formatting", "Insert footnote", "Toggle task list", "Paste as plain text", "Search for selected text"]) {
    await select(1)
    await page.keyboard.press("ControlOrMeta+P"); await page.waitForSelector("[role=option]"); await page.keyboard.type(name); await ui.idle()
    const first = await page.locator("[role=option]").first().textContent()
    check(`palette: ${name}`, first?.includes(name), first)
    await page.keyboard.press("Escape"); await ui.idle()
  }

  await page.keyboard.press("ControlOrMeta+E"); await ui.idle()
  await page.evaluate(() => {
    const l = document.querySelector("[data-pane] .cm-content .cm-line")
    const r = document.createRange(); r.selectNodeContents(l); getSelection().removeAllRanges(); getSelection().addRange(r)
  })
  await open(1)
  got = await items()
  await page.screenshot({ path: `${OUT}reading.png` })
  check("reading view: Copy, Select all, Search for; nothing that edits", got.some((i) => i.startsWith("Copy")) && got.some((i) => i.startsWith("Select all")) && got.some((i) => i.startsWith("Search for"))
    && !got.some((i) => /^(Cut|Paste|Format|Insert|Add link)/.test(i)), got)
  await page.getByRole("menuitem", { name: "Copy" }).click(); await ui.idle()
  check("reading view: Copy", (await page.evaluate(() => navigator.clipboard.readText())).startsWith("alpha beta"))
  await ctx.close()

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" })
  const p = await phone.newPage(), pui = app(p)
  await p.goto(`${B}#view/files/file/${enc(`${DIR}/Menu.md`)}`)
  await p.waitForSelector(".vau-editor .cm-line", { timeout: 15000 }); await pui.idle()
  const cdp = await phone.newCDPSession(p)
  const b = await p.locator(".vau-editor .cm-line").first().boundingBox()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + 20, y: b.y + b.height / 2 }] })
  await pui.idle()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await pui.idle()
  check("phone: holding text opens no app menu", await p.locator("[role=menu]").count() === 0)
  await phone.close()
} finally {
  await browser.close()
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
  for (const d of ["Attachments", ""]) for (const f of existsSync(`${VAULT}/${d}`) ? readdirSync(`${VAULT}/${d}`) : []) if (f.startsWith(stamp) && f.endsWith(".png")) rmSync(`${VAULT}/${d}/${f}`)
}
await done()
