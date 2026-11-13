// Files dragged in from outside onto a note are saved as attachments and embedded where they land; off a note, nothing.
// WRITES a "Qa drop" folder: throwaway server only.
//   node web/qa/filedrop.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/filedrop-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa drop", NOTE = `${DIR}/Short.md`, FILE = path.join(VAULT, NOTE)
rmSync(path.join(VAULT, DIR), { recursive: true, force: true })
mkdirSync(path.join(VAULT, DIR), { recursive: true })
const START = "---\ntags: qa\n---\nFirst line.\n\nSecond line.\n"
writeFileSync(FILE, START)
const text = () => readFileSync(FILE, "utf8")
const changed = (from) => until(() => text() !== from, 10000)
const found = (re) => { const out = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (re.test(e.name)) out.push(p) } }; walk(VAULT); return out }

const TMP = mkdtempSync(path.join(os.tmpdir(), "vau-filedrop-"))
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
const shot = path.join(TMP, "Screenshot 2026-11-08 at 01.13.36.png"), pdf = path.join(TMP, "Qa statement.pdf")
writeFileSync(shot, png)
writeFileSync(pdf, "%PDF-1.4\n%%EOF\n")

async function run(phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1300, height: 860 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  const cdp = await ctx.newCDPSession(page)
  const drag = async (data, x, y, types = ["dragEnter", "dragOver", "drop"]) => {
    for (const type of types) { await cdp.send("Input.dispatchDragEvent", { type, x, y, data: { items: [], dragOperationsMask: 1, ...data } }); await wait(120) }
  }
  const open = async () => {
    await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
    await page.waitForSelector(".vau-editor .cm-line", { timeout: 15000 })
    await wait(800)
  }
  const lineBox = (t) => page.evaluate((t) => { const l = [...document.querySelectorAll(".file-view .cm-line")].find((e) => e.textContent === t); const r = l?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } }, t)
  const pane = () => page.evaluate(() => { const r = (document.querySelector("[data-pane]") ?? document.querySelector("#main-scroll")).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  const tag = phone ? "phone: " : ""
  writeFileSync(FILE, START)
  await open()

  const p = await pane(), url = page.url()
  const below = { x: p.x + p.w / 2, y: p.y + p.h - 60 }
  await drag({ files: [shot] }, below.x, below.y, ["dragEnter", "dragOver"])
  const mark = await page.evaluate(() => { const m = document.querySelector(".cm-file-drop")?.getBoundingClientRect(); return m && { y: m.y, w: m.width } })
  const last = await lineBox("Second line.")
  check(`${tag}dragged below the text, the line shows under its end`, !!mark && mark.y > last.y + last.h - 4 && mark.w > 100, { mark, last })
  if (!phone) await page.screenshot({ path: `${OUT}filedrop-over.png` })
  let was = text()
  await drag({ files: [shot] }, below.x, below.y, ["drop"])
  check(`${tag}a screenshot dropped below a short note goes into it, at the end`, await changed(was) && /Second line\.\n!\[\[Screenshot 2026-11-08 at 01\.13\.36( \d+)?\.png\]\]$/.test(text()), text())
  check(`${tag}…saved in the vault`, found(/^Screenshot 2026-11-08 at 01\.13\.36( \d+)?\.png$/).length >= 1)
  check(`${tag}…and no tab opened outside the vault`, page.url() === url, page.url())
  check(`${tag}the line is gone after the drop`, await until(async () => !(await page.locator(".cm-file-drop").count()), 2000))

  writeFileSync(FILE, START); await wait(1200)
  const first = await lineBox("First line.")
  was = text()
  await drag({ files: [shot] }, phone ? first.x + 2 : Math.max(p.x + 4, first.x - 30), first.y + 3)
  check(`${tag}dropped beside a line's upper half: on a line of its own above it, the frontmatter untouched`, await changed(was)
    && /^---\ntags: qa\n---\n!\[\[Screenshot[^\]]*\.png\]\]\nFirst line\.\n/.test(text()), text())

  if (!phone) {
    writeFileSync(FILE, START); await wait(1200)
    const one = await lineBox("First line.")
    was = text()
    await drag({ files: [shot, pdf] }, one.x + 20, one.y + one.h - 3)
    check("two files dropped on a line's lower half: each on its own line after it", await changed(was)
      && /First line\.\n!\[\[Screenshot[^\]]*\.png\]\]\n!\[\[Qa statement( \d+)?\.pdf\]\]\n\nSecond line\./.test(text()), text())

    writeFileSync(FILE, START); await wait(1200)
    was = text()
    const data = "data:image/png;base64," + png.toString("base64")
    await drag({ items: [{ mimeType: "text/html", data: `<meta charset="utf-8"><img src="${data}" alt="">` }, { mimeType: "text/uri-list", data }] }, below.x, below.y)
    check("a browser's image dropped: saved as an attachment and embedded", await changed(was) && /Second line\.\n!\[\[Pasted image \d+\.png\]\]$/.test(text()), text())
    writeFileSync(FILE, START); await wait(1200)
    was = text()
    const far = `${B}nowhere/qa.png`
    await drag({ items: [{ mimeType: "text/uri-list", data: far }] }, below.x, below.y)
    check("an image the server can't download: embedded from the web", await changed(was) && text().endsWith(`![](${far})`), text())
    check("…and a toast says so", await until(async () => (await page.getByText("Couldn't download the image").count()) > 0, 3000))
    writeFileSync(FILE, START); await wait(1200)
    was = text()
    await drag({ items: [{ mimeType: "text/uri-list", data: "https://example.com/article" }] }, below.x, below.y)
    check("a link dropped: put in as it is", await changed(was) && text().endsWith("\nhttps://example.com/article"), text())

    writeFileSync(FILE, START); await wait(1200)
    await page.keyboard.press("ControlOrMeta+E"); await wait(800)
    const read = await lineBox("Second line.")
    was = text()
    await drag({ files: [shot] }, read.x + 10, read.y + 3)
    check("being read, a drop goes where it lands", await changed(was) && /First line\.\n\n!\[\[Screenshot[^\]]*\.png\]\]\nSecond line\./.test(text()), text())
    await page.keyboard.press("ControlOrMeta+E"); await wait(500)

    await page.goto(`${B}#new`); await wait(1200)
    const n = found(/^Screenshot/).length, blank = page.url()
    const q = await pane()
    await drag({ files: [shot] }, q.x + q.w / 2, q.y + q.h / 2)
    await wait(800)
    check("a drop where no note is: the page stays, nothing saved", page.url() === blank && found(/^Screenshot/).length === n, page.url())
  }
  await ctx.close()
}

try {
  await run(false)
  await run(true)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}
await done()
