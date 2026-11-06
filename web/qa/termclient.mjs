// The terminal's page side (vt/term.ts): an input method's composition, mouse reporting (Shift selects instead), copy,
// links, regex find, a lost WebGL context, Windows' right-click and Ctrl+Shift+C/V. Runs shells: throwaway server only.
//   node web/qa/termclient.mjs <base url>
import { WEBGL, qa, terminalText, until, wait, TERMINAL_FIND_KEY } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
const MAC = process.platform === "darwin"
const ids = []

/** A page with a new terminal, its prompt up and the keyboard in it. `windows`: the page says it's on Windows. */
async function open({ windows = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] })
  await ctx.addInitScript((win) => {
    if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") }
    if (win) Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" })
    window.__opened = []
    window.open = (url) => { window.__opened.push(String(url)); return null }
  }, windows)
  const page = watch(await ctx.newPage())
  const id = `qa${Date.now().toString(36)}${ids.length}`
  ids.push([page, id])
  await page.goto(`${B}#view/terminal%2F${id}`)
  await until(() => page.$("[data-term-screen] canvas"), 15000)
  await until(async () => /\$|%/.test(await terminalText(page)), 15000)
  await page.click("[data-term-screen]")
  return page
}
const typeLine = async (page, s) => { await page.keyboard.type(s); await page.keyboard.press("Enter") }
/** The centre of the cell at column x of the last row whose text matches `re`, in page px. */
async function cellOf(page, re, x) {
  return page.evaluate(({ src, x }) => {
    const el = document.querySelector("[data-terminal]"), lines = el.terminalText().split("\n"), re = new RegExp(src)
    const y = lines.findLastIndex((l) => re.test(l)), c = el.terminalCell()
    return y < 0 ? null : { x: c.x + (x + 0.5) * c.width, y: c.y + (y + 0.5) * c.height, line: lines[y] }
  }, { src: re.source, x })
}

try {
  const page = await open()
  check("it draws with WebGL", (await page.getAttribute("[data-term]", "data-term-renderer")) === "webgl")
  check("its input field says its cell height", (await page.evaluate(() => parseFloat(document.querySelector("[data-term-input]").style.lineHeight))) > 8)

  // ---------- an input method: composing shows nothing in the shell; the composed text is typed once
  const cdp = await page.context().newCDPSession(page)
  await page.keyboard.type("echo ime:")
  await cdp.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 })
  await wait(300)
  check("composing: nothing typed yet", !/にほ/.test(await terminalText(page)))
  await cdp.send("Input.insertText", { text: "日本" })
  await page.keyboard.press("Enter")
  check("composed text reaches the shell once", !!(await until(async () => /^ime:日本\s*$/m.test(await terminalText(page)), 5000)), (await terminalText(page)).slice(-200))

  // ---------- mouse reporting: a program that asks (1000 + 1006) gets clicks; Shift selects instead
  await typeLine(page, "clear; printf '\\e[?1000h\\e[?1006h'; cat -v")
  await wait(500)
  const at = await cellOf(page, /\$ clear/, 4) ?? { x: 400, y: 200 }
  await page.mouse.click(at.x, at.y + 60)
  check("a click is reported in SGR (cat -v shows it)", !!(await until(async () => /\^\[\[<0;\d+;\d+M\^\[\[<0;\d+;\d+m/.test(await terminalText(page)), 4000)), (await terminalText(page)).slice(-200))
  const before = (await terminalText(page)).split("^[[<").length
  await page.keyboard.down("Shift"); await page.mouse.click(at.x, at.y + 60); await page.keyboard.up("Shift")
  await wait(400)
  check("a Shift-click isn't reported", (await terminalText(page)).split("^[[<").length === before)
  await page.keyboard.press("Control+C")
  await typeLine(page, "printf '\\e[?1000l\\e[?1006l'; clear")
  await wait(500)

  // ---------- copy: a double click selects a word, the copy key copies it
  await typeLine(page, "echo copy-me-4821 trailing")
  const word = await until(() => cellOf(page, /^copy-me-4821 trailing/, 3), 4000)
  await page.mouse.dblclick(word.x, word.y)
  await wait(200)
  await page.keyboard.press(MAC ? "Meta+C" : "Control+Shift+C")
  await wait(200)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check("a double click and copy take the word", clip === "copy-me-4821", clip)

  // ---------- links: hovered, a web address is underlined and marks the terminal; a click opens it
  await typeLine(page, "clear; echo see https://example.com/qa-link-77 here")
  const link = await until(() => cellOf(page, /^see https/, 10), 4000)
  await page.mouse.move(link.x, link.y)
  check("hovering a link marks it", !!(await until(() => page.$("[data-term][data-term-link]"), 2000)))
  check("the pointer is a hand over it", (await page.evaluate(() => getComputedStyle(document.querySelector("[data-term]")).cursor)) === "pointer")
  await page.mouse.click(link.x, link.y)
  const opened = await until(() => page.evaluate(() => window.__opened.join(" ")), 3000)
  check("a click opens it", /example\.com\/qa-link-77/.test(opened ?? "") || (await page.locator("[role=tab]", { hasText: "example.com" }).count()) > 0, opened)
  await page.mouse.move(5, 400)
  check("moving off unmarks it", !!(await until(async () => !(await page.$("[data-term][data-term-link]")), 2000)))

  // ---------- find with a regular expression
  await page.click("[data-term-screen]")
  await typeLine(page, "echo alpha-1 beta-22 gamma-333")
  await wait(300)
  await page.keyboard.press(TERMINAL_FIND_KEY)
  await until(() => page.$("[data-terminal-find] input"), 3000)
  await page.click("[data-terminal-find] [aria-label='Regular expression']")
  await page.fill("[data-terminal-find] input", "(beta|gamma)-\\d{2,}\\b")
  const count = await until(async () => { const t = await page.locator("[data-terminal-find]").textContent(); return /of 4/.test(t ?? "") && t }, 3000)
  check("a regular expression finds its matches (beta-22, gamma-333, on the command line and its output)", !!count, await page.locator("[data-terminal-find]").textContent())
  await page.fill("[data-terminal-find] input", "alpha-1")
  check("plain text finds through Ghostty's search", !!(await until(async () => /of [1-9]/.test((await page.locator("[data-terminal-find]").textContent()) ?? ""), 3000)))
  await page.keyboard.press("Escape")

  // ---------- WebGL lost: Canvas2D draws on
  await page.evaluate(() => document.querySelector("[data-term] canvas").getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext())
  check("a lost context: it draws with Canvas2D", !!(await until(async () => (await page.getAttribute("[data-term]", "data-term-renderer")) === "canvas", 3000)))
  await page.click("[data-term-screen]")
  await typeLine(page, "echo after-loss-ok")
  check("and still shows what it prints", !!(await until(async () => /^after-loss-ok/m.test(await terminalText(page)), 4000)))
  const ink = await page.evaluate(() => {
    const c = document.querySelector("[data-term] canvas"), o = new OffscreenCanvas(c.width, c.height), g = o.getContext("2d")
    g.drawImage(c, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data, set = new Set()
    for (let i = 0; i < d.length; i += 4 * 97) set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`)
    return set.size
  })
  check("its canvas has text on it", ink > 2, ink)

  // ---------- Windows: right-click copies a selection, else pastes; Ctrl+Shift+C/V
  const win = await open({ windows: true })
  await typeLine(win, "echo win-word-55 rest")
  const w = await until(() => cellOf(win, /^win-word-55 rest/, 2), 4000)
  await win.mouse.dblclick(w.x, w.y)
  await win.mouse.click(w.x, w.y, { button: "right" })
  check("Windows: a right-click copies the selection", !!(await until(async () => (await win.evaluate(() => navigator.clipboard.readText())) === "win-word-55", 2000)))
  await win.keyboard.type("echo pasted:")
  await win.mouse.click(w.x, w.y, { button: "right" })
  await until(async () => /echo pasted:win-word-55/.test(await terminalText(win)), 3000) // (the clipboard is read async)
  await win.keyboard.press("Enter")
  check("Windows: a right-click with nothing selected pastes", !!(await until(async () => /^pasted:win-word-55\s*$/m.test(await terminalText(win)), 4000)), (await terminalText(win)).slice(-200))
  await wait(600) // (not a third click: a line)
  await win.mouse.dblclick(w.x, w.y)
  await win.keyboard.press("Control+Shift+C")
  const copied = await until(async () => { const c = await win.evaluate(() => navigator.clipboard.readText()); return c === "win-word-55" && c }, 2000)
  check("Ctrl+Shift+C copies", !!copied, await win.evaluate(() => navigator.clipboard.readText()))
  // (Ctrl+Shift+V is left to the browser's paste event, which a headless browser doesn't send: sent here)
  await win.keyboard.type("echo v:")
  await win.keyboard.press("Control+Shift+V")
  await win.evaluate(() => { const d = new DataTransfer(); d.setData("text/plain", "from-clip-9"); document.querySelector("[data-term-input]").dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })) })
  await win.keyboard.press("Enter")
  check("Ctrl+Shift+V types nothing itself; the paste comes", !!(await until(async () => /^v:from-clip-9\s*$/m.test(await terminalText(win)), 4000)), (await terminalText(win)).slice(-200))
} finally {
  for (const [p, id] of ids) await p.evaluate((s) => { new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${s}?end=1`) }, id).catch(() => {})
  await wait(300)
}
await done()
