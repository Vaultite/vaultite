import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, tmp } = $
  const { conf } = $.vars
  // Binary formats (Spreadsheets, Documents, Presentations, E-books): their text for /api/render and search, from made-up
  // files (tools/fixtures/formats/make.ts); and files from outside the vault, only once the desktop app allowed them.
  {
    const fx = await import("../../fixtures/formats/make.ts")
    const { docxMarkdown } = await import("../../../plugins/core/documents/plugin.ts")
    const { deckMarkdown } = await import("../../../plugins/core/presentations/plugin.ts")
    const { epubMarkdown } = await import("../../../plugins/core/ebooks/plugin.ts")
    const { workbookMarkdown } = await import("../../../plugins/core/spreadsheets/plugin.ts")
    const { unzip, xmlDecode } = await import("../../../core/unzip.ts")
    const O = await import("../../../core/outside.ts")

    check("unzip: entries of a zip held in memory", [...unzip(fx.epub()).keys()].includes("OEBPS/content.opf"))
    check("xmlDecode: named and numeric entities", xmlDecode("a &amp; b &#233; &#x2014; &lt;i&gt; &bogus;") === "a & b é — <i> &bogus;")
    const doc = docxMarkdown(fx.docx())
    check("docx: title and headings, list items together, a table, tabs; deleted text left out",
      doc.startsWith("# Lighthouse lease\n\n# Terms\n\nThe tenant gives 60 days' notice & pays on the 1st.\n\n- Keys returned\n- Walls repainted") &&
      doc.includes("| Item | Cost |\n| --- | --- |\n| Deposit | 1200 |") && doc.includes("Signed by Alice Park\tand Bob Lee") && !doc.includes("struck"), doc)
    const deck = deckMarkdown(fx.pptx())
    check("pptx: slides in the deck's order, with their notes (not the slide number)",
      deck === "## Slide 1\n\nLighthouse pitch\n\nQ3 & beyond\n\nNotes: Open with the storm story\n\n## Slide 2\n\nRoadmap\n\nShip the lighthouse beacon", deck)
    const book = epubMarkdown(fx.epub())
    check("epub: title, author, chapters in the spine's order, no scripts",
      book.startsWith("# The keeper's log\n\nBy Alice Park\n\n# The storm\n\nThe lamp burned all night & the gulls slept.\n\n# Morning") && !book.includes("alert"), book)
    const sheet = workbookMarkdown(fx.xlsx())
    check("xlsx: each sheet a table, values as Excel shows them",
      sheet.includes("## Budget\n| Item | Amount |\n| --- | --- |\n| Lamp oil | $42.50 |") && sheet.includes("## Visitors") && sheet.includes("| Bob Lee | Monday |"), sheet)

    fs.mkdirSync(path.join(VAULT, "Shelf"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Shelf/Lease.docx"), fx.docx())
    fs.writeFileSync(path.join(VAULT, "Shelf/Pitch.pptx"), fx.pptx())
    fs.writeFileSync(path.join(VAULT, "Shelf/Log.epub"), fx.epub())
    fs.writeFileSync(path.join(VAULT, "Shelf/Budget.xlsx"), fx.xlsx())
    fs.writeFileSync(path.join(VAULT, "Shelf/Broken.docx"), "not a zip")
    let [code, txt] = await api("GET", "render?path=Shelf/Lease.docx")
    check("render: a Word document as its text", code === 200 && txt.includes("# Lease") && txt.includes("| Deposit | 1200 |"), txt)
    ;[code, txt] = await api("GET", "render?path=Shelf/Budget.xlsx")
    check("render: a workbook's sheets", code === 200 && txt.includes("| Lamp oil | $42.50 |"), txt)
    ;[, txt] = await api("GET", "render?path=Shelf/Broken.docx")
    check("render: a broken file says so", /couldn't be read/.test(txt), txt)
    fs.writeFileSync(path.join(VAULT, "Shelf/Note.md"), "# Shelf\n\n![[Pitch.pptx]]\n")
    ;[, txt] = await api("GET", "render?path=Shelf/Note.md")
    check("render: ![[Pitch.pptx]] in a note is the deck's text", txt.includes("Ship the lighthouse beacon"), txt)
    let hits: Any
    ;[, hits] = await api("GET", "search?q=harbour")
    check("search: finds a book's text", hits.some((h: Any) => h.path === "Shelf/Log.epub"), hits)
    ;[, hits] = await api("GET", "search?q=Deposit")
    check("search: finds a Word document's table", hits.some((h: Any) => h.path === "Shelf/Lease.docx"), hits)
    ;[, hits] = await api("GET", "search?q=beacon")
    check("search: finds a slide's text", hits.some((h: Any) => h.path === "Shelf/Pitch.pptx"), hits)
    // Off, a plugin's files aren't read.
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: [...(conf("plugins").disabled ?? []), "documents"] }, null, 2) + "\n")
    ;[, hits] = await api("GET", "search?q=Deposit")
    check("search: a plugin off reads nothing", !hits.some((h: Any) => h.path === "Shelf/Lease.docx"), hits)
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ ...conf("plugins"), disabled: (conf("plugins").disabled ?? []).filter((x: string) => x !== "documents") }, null, 2) + "\n")

    // Outside the vault: nothing until allowed; then its info (and, in server.ts, its bytes).
    const out = path.join(tmp, "elsewhere", "Plan.pdf")
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, "%PDF-1.4 made up")
    ;[code] = await api("GET", `file/info?path=${out}`)
    check("outside: a file not allowed is a 404", code === 404, code)
    O.allow([out])
    let info: Any
    ;[code, info] = await api("GET", `file/info?path=${out}`)
    check("outside: an allowed file's info", code === 200 && info.kind === "pdf" && info.size === 16, info)
    check("outside: allowedPath only for allowed files", O.allowedPath(out) === out && (() => { try { O.allowedPath(path.join(tmp, "x.pdf")); return false } catch { return true } })())
    fs.writeFileSync(out.replace(".pdf", ".bin"), Buffer.from([0x41, 0, 0x42]))
    O.allow([out.replace(".pdf", ".bin")])
    ;[code] = await api("GET", `file?path=${out.replace(".pdf", ".bin")}`)
    check("outside: a binary file isn't read as text", code === 415, code)
  }
}
