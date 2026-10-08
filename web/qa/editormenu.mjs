// The editor's right-click menu (plugins/core/editing/menu.ts): with a selection, Add link, Format ▸,
// Paragraph ▸, Insert ▸, the clipboard and Search for "…"; every Format, Paragraph and Insert item changes the note as
// its command does, with the command's keys shown; Cut, Copy, Paste (a picture too), Paste as plain text and Select all work; a
// right-click outside the selection puts the cursor there; without a selection there's no Cut, Copy or Search for;
// reading view has only Copy, Select all and Search for; Shift+right-click and a finger held on a phone get no app
// menu. The new commands are in the palette. WRITES a "Qa editor menu" folder: throwaway server only.
//   node web/qa/editormenu.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/editormenu-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa editor menu", NOTE = `${VAULT}/${DIR}/Menu.md`, enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
const START = "alpha beta\ngamma\ndelta\nepsilon\nzeta\n"
writeFileSync(NOTE, START)
// (the pasted picture's name starts with the minute it was pasted in: removed at the end)
const stamp = `Pasted image ${new Date().getFullYear()}`
const disk = () => readFileSync(NOTE, "utf8")
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: "dark", permissions: ["clipboard-read", "clipboard-write"] })
  await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${enc(`${DIR}/Menu.md`)}`)
  await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
  await wait(600)
  const line = (n) => page.locator("[data-pane] .cm-content .cm-line").nth(n - 1)
  /** Select line n's text (or `from`..`to` of it: the keyboard). */
  const select = async (n, word) => {
    await line(n).click(); await page.keyboard.press("Home")
    if (word) { await page.keyboard.press("Shift+Alt+ArrowRight") } else await page.keyboard.press("Shift+End")
    await wait(100)
  }
  const items = () => page.locator("[role=menu]").first().locator(":scope > [role=menuitem]").allTextContents()
  const open = async (n, opts = {}) => { await line(n).click({ button: "right", ...opts }); await wait(200) }
  /** Right-click line n, then a submenu's item. */
  const pick = async (n, path) => {
    await open(n)
    for (const [i, name] of path.entries()) {
      const it = page.locator("[role=menu]").nth(i).getByRole("menuitem", { name, exact: false }).first()
      await it.click(); await wait(150)
    }
    await wait(250)
  }
  const lines = () => disk().split("\n")
  const saved = (want) => until(() => typeof want === "function" ? want(disk()) : disk().includes(want), 4000)
  /** The note as it started (the editor merges it in from the disk). */
  const reset = async (text = START) => { writeFileSync(NOTE, text); await wait(900) }

  // ---- with a selection ----
  await select(1)
  await open(1)
  let got = await items()
  await page.screenshot({ path: `${OUT}selection.png` })
  check("with a selection: links, submenus, clipboard, Search for", ["Add link", "Add external link", "Format", "Paragraph", "Insert", "Cut", "Copy", "Paste", "Paste as plain text", "Select all", "Search for “alpha beta”"]
    .every((x) => got.some((i) => i.startsWith(x))), got)
  await page.getByRole("menuitem", { name: "Format" }).hover(); await wait(400)
  const fmt = await page.locator("[role=menu]").nth(1).locator("[role=menuitem]").allTextContents()
  await page.screenshot({ path: `${OUT}format.png` })
  const mod = process.platform === "darwin" ? "⌘" : "Ctrl+"
  check("Format ▸ every mark, with keys", [`Bold${mod}B`, `Italic${mod}I`, "Strikethrough", "Highlight", "Code", "Math", `Comment${mod}/`, "Clear formatting"].every((x) => fmt.some((i) => i.startsWith(x))), fmt)
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(150)

  for (const [name, want] of [["Bold", "**alpha beta**"], ["Italic", "*alpha beta*"], ["Strikethrough", "~~alpha beta~~"], ["Highlight", "==alpha beta=="], ["Code", "`alpha beta`"], ["Math", "$alpha beta$"], ["Comment", "%%alpha beta%%"]]) {
    await select(1); await pick(1, ["Format", name])
    check(`Format ▸ ${name}`, await saved((t) => t.startsWith(`${want}\n`)), lines()[0])
    await reset()
  }
  writeFileSync(NOTE, "**alpha** ==beta== `x`\n" + START.split("\n").slice(1).join("\n")); await wait(900)
  await select(1); await pick(1, ["Format", "Clear formatting"])
  check("Format ▸ Clear formatting", await saved((t) => t.startsWith("alpha beta x\n")), lines()[0])
  await reset()

  for (const [name, want] of [["Bullet list", "- gamma"], ["Numbered list", "1. gamma"], ["Task list", "- [ ] gamma"], ["Heading 2", "## gamma"], ["Quote", "> gamma"]]) {
    await select(2); await pick(2, ["Paragraph", name])
    check(`Paragraph ▸ ${name}`, await saved((t) => t.split("\n")[1] === want), lines()[1])
    await reset()
  }
  writeFileSync(NOTE, START.replace("gamma", "## gamma")); await wait(900)
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

  // ---- the clipboard ----
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
  await page.keyboard.press("Escape"); await wait(150)

  // ---- a right-click elsewhere moves the cursor; no selection: no Cut, Copy or Search ----
  await select(1)
  await open(4)
  got = await items()
  check("outside the selection: no Cut, Copy or Search for", !got.some((i) => /^(Cut|Copy|Search for)/.test(i)) && got.some((i) => i.startsWith("Paste")) && got.some((i) => i.startsWith("Insert")), got)
  await page.getByRole("menuitem", { name: "Insert" }).click(); await wait(150)
  await page.locator("[role=menu]").nth(1).getByRole("menuitem", { name: "Horizontal rule" }).click(); await wait(300)
  check("…and the cursor went where the click was", await saved("epsilon\n\n---\n"), disk())
  await reset()

  // ---- Search for ----
  await select(1); await pick(1, ["Search for"])
  check("Search for: a search tab with the selection", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("view/search/alpha beta")), 4000), await page.evaluate(() => location.hash))
  await page.goto(`${B}#file/${enc(`${DIR}/Menu.md`)}`); await page.waitForSelector("[data-pane] .cm-content"); await wait(600)

  // ---- Shift+right-click: the browser's own ----
  await open(1, { modifiers: ["Shift"] })
  check("Shift+right-click: no app menu", await page.locator("[role=menu]").count() === 0)

  // ---- the palette has the new commands ----
  for (const name of ["Toggle inline math", "Clear formatting", "Insert footnote", "Toggle task list", "Paste as plain text", "Search for selected text"]) {
    await select(1)
    await page.keyboard.press("ControlOrMeta+P"); await page.waitForSelector("[role=option]"); await page.keyboard.type(name); await wait(200)
    const first = await page.locator("[role=option]").first().textContent()
    check(`palette: ${name}`, first?.includes(name), first)
    await page.keyboard.press("Escape"); await wait(150)
  }

  // ---- reading view: Copy, Select all, Search for ----
  await page.keyboard.press("ControlOrMeta+E"); await wait(600)
  await page.evaluate(() => {
    const l = document.querySelector("[data-pane] .cm-content .cm-line")
    const r = document.createRange(); r.selectNodeContents(l); getSelection().removeAllRanges(); getSelection().addRange(r)
  })
  await open(1)
  got = await items()
  await page.screenshot({ path: `${OUT}reading.png` })
  check("reading view: Copy, Select all, Search for; nothing that edits", got.some((i) => i.startsWith("Copy")) && got.some((i) => i.startsWith("Select all")) && got.some((i) => i.startsWith("Search for"))
    && !got.some((i) => /^(Cut|Paste|Format|Insert|Add link)/.test(i)), got)
  await page.getByRole("menuitem", { name: "Copy" }).click(); await wait(200)
  check("reading view: Copy", (await page.evaluate(() => navigator.clipboard.readText())).startsWith("alpha beta"))
  await ctx.close()

  // ---- a phone: a held finger keeps the system's own (no app menu on text) ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" })
  const p = await phone.newPage()
  await p.goto(`${B}#view/files/file/${enc(`${DIR}/Menu.md`)}`)
  await p.waitForSelector(".vau-editor .cm-line", { timeout: 15000 }); await wait(600)
  const cdp = await phone.newCDPSession(p)
  const b = await p.locator(".vau-editor .cm-line").first().boundingBox()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + 20, y: b.y + b.height / 2 }] })
  await wait(700)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await wait(300)
  check("phone: holding text opens no app menu", await p.locator("[role=menu]").count() === 0)
  await phone.close()
} finally {
  await browser.close()
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
  for (const d of ["Attachments", ""]) for (const f of existsSync(`${VAULT}/${d}`) ? readdirSync(`${VAULT}/${d}`) : []) if (f.startsWith(stamp) && f.endsWith(".png")) rmSync(`${VAULT}/${d}/${f}`)
}
await done()
