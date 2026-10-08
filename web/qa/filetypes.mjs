// Every kind of file opens: code in the editor (highlighted, line numbers, typing saves a small edit), an image (fit,
// click for its real size), a PDF (the browser's viewer; phones a card), audio, a Jupyter notebook (read, and its JSON
// in source mode), a Keynote deck and a binary file as a card (Download; "Open in default app" only in the desktop app),
// a big log read-only, a PDF embedded in a note, the tree's icons, the quick switcher, rename and delete from the tree,
// range requests, and the phone sheet at 390 and 320px. WRITES to the vault (it makes a "Qa files" folder): throwaway
// server only.
//   node web/qa/filetypes.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import zlib from "node:zlib"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa files"
const at = (name) => `${VAULT}/${DIR}/${name}`
const enc = encodeURIComponent

// ---------- sample files ----------
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
/** A w×h PNG of one colour. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x60)])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))])
}
/** A small PDF with `n` pages, each with a line of text. */
function pdf(n) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`]
  for (let i = 0; i < n; i++) {
    const text = `BT /F1 24 Tf 72 700 Td (Page ${i + 1} of a made-up statement) Tj ET`
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + n * 2} 0 R >> >> >>`)
    objs.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
  }
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  let out = "%PDF-1.4\n"
  const offs = objs.map((o, i) => { const off = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return off })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}
/** A second of silence. */
function wav() {
  const rate = 8000, data = Buffer.alloc(rate), h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34)
  h.write("data", 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data.fill(128)])
}
const PY = `import csv\n\n\ndef total(rows):\n    """Sum the amounts."""\n    return sum(float(r["amount"]) for r in rows)\n\n\nif __name__ == "__main__":\n    print(total([]))\n`
writeFileSync(at("sample.py"), PY)
writeFileSync(at("config.yaml"), "name: Lighthouse\nport: 8080\nfeatures:\n  - search\n  - sync\n")
writeFileSync(at("run.sh"), "#!/bin/sh\necho \"hello\"\n")
writeFileSync(at("Makefile"), "all:\n\techo done\n")
writeFileSync(at("readme.txt"), "Plain text notes about Lighthouse.\n")
writeFileSync(at("odd.qqq"), "Text with a name the app doesn't know.\n")
writeFileSync(at("data.bin"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10]))
writeFileSync(at("chart.png"), png(40, 30))
writeFileSync(at("logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="gray"/></svg>')
writeFileSync(at("statement.pdf"), pdf(2))
writeFileSync(at("memo.wav"), wav())
writeFileSync(at("Budget.xlsx"), Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(200, 7)]))
writeFileSync(at("Slides.key"), Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(200, 7)]))
writeFileSync(at("big.log"), "line of a long log file\n".repeat(60000)) // about 1.4 MB: read-only
writeFileSync(at("analysis.ipynb"), JSON.stringify({
  metadata: { kernelspec: { language: "python", name: "python3" }, language_info: { name: "python" } }, nbformat: 4, nbformat_minor: 5,
  cells: [
    { cell_type: "markdown", source: ["## Spending by month\n", "A made-up **analysis**."] },
    { cell_type: "code", execution_count: 1, source: ["import pandas as pd\n", "df = pd.read_csv('Transactions.csv')\n", "print(len(df))"],
      outputs: [{ output_type: "stream", name: "stdout", text: ["42\n"] }] },
    { cell_type: "code", execution_count: 2, source: ["df.head()"],
      outputs: [{ output_type: "execute_result", data: { "text/html": ["<table><tr><th>date</th><th>amount</th></tr><tr><td>2026-01-01</td><td>-5.20</td></tr></table>"], "text/plain": ["..."] } }] },
    { cell_type: "code", execution_count: 3, source: ["df.plot()"],
      outputs: [{ output_type: "display_data", data: { "image/png": png(20, 10).toString("base64"), "text/plain": ["<Figure>"] } }] },
  ],
}, null, 1))
writeFileSync(at("Embeds.md"), "# Embeds\n\nThe statement:\n\n![[statement.pdf|300]]\n\nAnd a memo:\n\n![[memo.wav]]\n")
await wait(1500) // the server hears them

const out = { errs: [] }
const ok = (name, v) => { out[name] = v }

// ---------- desktop ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(String(e)))
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && out.errs.push(m.text()))
  page.on("dialog", (d) => d.accept())
  const shot = (name) => page.screenshot({ path: `${OUT}filetypes-desktop-${name}.png` })
  const open = async (name) => { await page.goto(`${B}#file/${enc(`${DIR}/${name}`)}`); await wait(1500) }
  const status = () => page.locator("[role=status]").last().innerText().catch(() => "")
  await page.goto(B); await wait(1500)
  // The tree: every file listed, each with its icon.
  await page.locator("aside [role=tree] button", { hasText: new RegExp(`^${DIR}$`) }).first().click(); await wait(400)
  const icons = await page.evaluate((dir) => Object.fromEntries([...document.querySelectorAll(`aside [data-tree-path^="${dir}/"]`)].map((row) =>
    [row.dataset.treePath.split("/").pop(), row.querySelector("svg.lucide:not(.lucide-chevron-right)")?.getAttribute("class")?.split(" ").find((c) => c.startsWith("lucide-")) ?? null])), DIR)
  ok("treeIcons", icons)
  ok("iconsRight", icons["sample.py"] === "lucide-file-code" && icons["chart.png"] === "lucide-file-image" && icons["statement.pdf"] === "lucide-file-type"
    && icons["analysis.ipynb"] === "lucide-notebook-text" && icons["Budget.xlsx"] === "lucide-file-spreadsheet" && /^lucide-file-(audio|headphone)$/.test(icons["memo.wav"])
    && icons["run.sh"] === "lucide-file-terminal" && icons["config.yaml"] === "lucide-file-cog" && icons["Makefile"] === "lucide-file-code")
  await shot("tree")

  // Code: highlighted, line numbers, typing saves only the change.
  await page.locator("aside [role=tree] button", { hasText: /^sample\.py$/ }).first().click(); await wait(1800)
  ok("pyHash", await page.evaluate(() => location.hash))
  ok("pyEditor", await page.locator(".vau-editor.is-code").count())
  ok("pyLineNumbers", await page.locator(".cm-lineNumbers .cm-gutterElement").count())
  ok("pyHighlighted", await page.evaluate(() => [...document.querySelectorAll(".is-code .cm-line span")].filter((s) => getComputedStyle(s).color !== getComputedStyle(s.closest(".cm-line")).color).length))
  ok("pyNoTitle", await page.locator("article h1, article textarea[aria-label='File name']").count() === 0)
  ok("pyStatus", await status())
  ok("pyTab", await page.locator("[role=tablist] [role=tab]", { hasText: "sample.py" }).count())
  await shot("code")
  await page.locator(".cm-line", { hasText: "print(total([]))" }).click(); await page.keyboard.press("End"); await page.keyboard.type("  # done")
  await wait(2200)
  const py = readFileSync(at("sample.py"), "utf8")
  ok("pySaved", py === PY.replace("print(total([]))", "print(total([]))  # done"))
  // Tab indents with the file's own unit (4 spaces here).
  await page.keyboard.press("Enter"); await page.keyboard.type("x = 1"); await page.keyboard.press("Home"); await page.keyboard.press("Tab"); await wait(2000)
  ok("pyIndent", readFileSync(at("sample.py"), "utf8").includes("\n        x = 1") || readFileSync(at("sample.py"), "utf8").includes("\n    x = 1"))

  // Other text: a YAML file, an unknown name that is text, a binary file, a big log.
  await open("config.yaml")
  ok("yamlEditor", await page.locator(".vau-editor.is-code").count())
  await open("odd.qqq")
  ok("unknownTextEditor", await page.locator(".vau-editor.is-code").count())
  await open("data.bin")
  ok("binaryCard", await page.locator("[data-file-card]").count())
  await open("big.log")
  ok("bigReadOnly", (await page.locator("article [role=status]", { hasText: "read-only" }).count()) && (await page.locator(".cm-content[contenteditable=false]").count()))

  // An image: fit, click for its real size.
  await open("chart.png")
  ok("imgLoaded", await page.evaluate(() => document.querySelector("[data-image-view] img")?.naturalWidth ?? 0))
  ok("imgStatus", await status())
  await page.locator("[data-image-view] img").click(); await wait(200)
  ok("imgZoom", await page.locator("[data-image-view] img[data-zoomed]").count())
  await shot("image")
  await open("logo.svg")
  ok("svgLoaded", await page.evaluate(() => document.querySelector("[data-image-view] img")?.naturalWidth ?? 0))

  // A PDF in the browser's viewer.
  await open("statement.pdf")
  ok("pdfFrame", await page.locator("article iframe[src*='api/raw']").count())
  ok("pdfFrameHeight", await page.evaluate(() => document.querySelector("article iframe")?.getBoundingClientRect().height ?? 0))
  ok("pdfStatus", await status())
  await shot("pdf")

  // Audio.
  await open("memo.wav")
  ok("audio", await page.locator("article audio").count())
  ok("audioStatus", await status())

  // A notebook: read, then its JSON.
  await open("analysis.ipynb")
  ok("nbCells", await page.locator("[data-notebook] [data-cell=code]").count())
  ok("nbHighlighted", await page.locator("[data-notebook] .nb-code .tok-keyword").count())
  ok("nbImage", await page.locator("[data-notebook] img[src^='data:image/png']").count())
  ok("nbHtml", await page.locator("[data-notebook] iframe[sandbox]").count())
  await shot("notebook")
  await page.keyboard.press("ControlOrMeta+e"); await wait(800)
  ok("nbSource", await page.locator(".cm-line", { hasText: '"cell_type": "markdown"' }).count())
  await page.keyboard.press("ControlOrMeta+e"); await wait(500)

  // A file no viewer or plugin draws (a Keynote deck): a card with Download; "Open in default app" only in the desktop
  // app on this machine. (A workbook is Spreadsheets': web/qa/formats.mjs.)
  await open("Slides.key")
  ok("cardDownload", await page.locator("[data-file-card] a[download]", { hasText: "Download" }).getAttribute("href"))
  ok("cardNoOpenHere", await page.locator("[data-file-card] button", { hasText: "Open in default app" }).count() === 0)
  await page.evaluate(() => { document.documentElement.dataset.electron = "" })
  await open("data.bin"); await open("Slides.key")
  ok("cardOpenHereInApp", await page.locator("[data-file-card] button", { hasText: "Open in default app" }).count() === 1)
  await page.evaluate(() => { delete document.documentElement.dataset.electron })
  await shot("card")

  // A PDF embedded in a note.
  await open("Embeds.md")
  ok("pdfEmbed", await page.locator(".cm-editor iframe[src*='statement.pdf']").count())
  ok("audioEmbed", await page.locator(".cm-editor audio").count())
  await shot("embeds")

  // The quick switcher finds files by their full name.
  await page.keyboard.press("ControlOrMeta+o"); await wait(300)
  await page.keyboard.type("statement.pdf"); await wait(500)
  ok("switcher", await page.locator("[role=dialog] [role=option], [role=listbox] [role=option]").allInnerTexts().then((t) => t.slice(0, 3)))
  await page.keyboard.press("Escape")

  // Range requests (players seek with them).
  ok("range", await page.evaluate(async (p) => { const r = await fetch(`api/raw?path=${encodeURIComponent(p)}`, { headers: { Range: "bytes=0-9" } }); return [r.status, (await r.arrayBuffer()).byteLength] }, `${DIR}/memo.wav`))

  // Rename and delete from the tree.
  await page.locator(`aside [data-tree-path="${DIR}/readme.txt"]`).click({ button: "right" }); await wait(200)
  await page.locator("[role=menu] button", { hasText: "Rename" }).click(); await wait(200)
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("notes.txt"); await page.keyboard.press("Enter"); await wait(1500)
  ok("renamed", existsSync(at("notes.txt")) && !existsSync(at("readme.txt")))
  await page.locator(`aside [data-tree-path="${DIR}/data.bin"]`).click({ button: "right" }); await wait(200)
  await page.locator("[role=menu] button", { hasText: "Delete" }).click(); await wait(1500)
  ok("deleted", !existsSync(at("data.bin")))
  await ctx.close()
}

// ---------- phones ----------
for (const width of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => out.errs.push(`${width}: ${e}`))
  const res = {}
  for (const name of ["sample.py", "chart.png", "statement.pdf", "analysis.ipynb", "Slides.key", "memo.wav"]) {
    await page.goto(`${B}#view/files/file/${enc(`${DIR}/${name}`)}`); await wait(1800)
    res[name] = await page.evaluate((w) => {
      const d = document.querySelector("dialog")
      const wide = [...(d?.querySelectorAll("*") ?? [])].filter((el) => el.getBoundingClientRect().right > w + 1 && !el.closest(".cm-scroller")).length
      return { sheet: !!d?.open, overflow: document.documentElement.scrollWidth > w || wide > 0, title: document.getElementById("sheet-title")?.textContent }
    }, width)
    await page.screenshot({ path: `${OUT}filetypes-${width}-${name.replace(/\W/g, "-")}.png` })
  }
  res.pdfOpenLink = await page.goto(`${B}#view/files/file/${enc(`${DIR}/statement.pdf`)}`).then(() => wait(1500)).then(() => page.locator("dialog a", { hasText: "Open" }).count())
  out[`phone${width}`] = res
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(out, null, 1))
