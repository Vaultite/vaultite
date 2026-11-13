import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { messageOf } from "../../../core/values.ts"

const desktopAllows = (paths: string[]) => process.emit("message", { type: "allow", paths }, undefined)

export default async ($: VaultTest) => {
  const { VAULT, api, check, tmp } = $
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
    for (const type of ["xlsb", "xls", "ods"] as const) {
      const md = workbookMarkdown(fx.xlsx(type))
      check(`${type}: read as the same sheets`, md.includes("## Budget\n| Item | Amount |") && /\| Lamp oil \| \$?42\.50? \|/.test(md) && md.includes("| Bob Lee | Monday |"), md)
    }

    // SheetJS is ours (plugins/core/spreadsheets/xlsx): the release PROVENANCE.md names plus its marked lines, and a broken
    // or crafted file fails at once, where 0.20.3 as released looped forever or ran out of memory (its patches).
    const XD = path.join(import.meta.dirname, "../../../plugins/core/spreadsheets/xlsx")
    const lib = fs.readFileSync(path.join(XD, "xlsx.mjs"), "utf8")
    const released = crypto.createHash("sha256").update(lib.split("\n").filter((l) => !l.includes("// vaultite: ")).join("\n")).digest("hex")
    check("SheetJS: the release PROVENANCE.md names, but for the lines marked as ours",
      fs.readFileSync(path.join(XD, "PROVENANCE.md"), "utf8").includes(released) && lib.split("// vaultite: ").length - 1 === 6, released)
    const X = createRequire(import.meta.url)(path.join(XD, "xlsx.mjs")) as typeof import("../../../plugins/core/spreadsheets/xlsx/xlsx.mjs")
    const fails = (file: Buffer) => { try { return `read: ${workbookMarkdown(file).slice(0, 80)}` } catch (e) { return String(messageOf(e) ?? e) } }
    check("a broken workbook fails, never reads as something", /Corrupt|Unsupported|Bad /.test(fails(fx.xlsx().subarray(0, 300))) &&
      /Corrupt|Unsupported/.test(fails(Buffer.from(`PK\x03\x04${"\x07".repeat(200)}`, "latin1"))), [fails(fx.xlsx().subarray(0, 300))])
    const cut = fx.brokenXlsx()
    check("SheetJS patch 1: a cut deflate stream ends the read", fails(cut) === "Truncated or corrupt ZIP data", fails(cut))
    const huge = fx.xlsx()
    for (let i = 0; i < huge.length - 4; i++) {
      if (huge.readUInt32LE(i) === 0x04034b50) huge.writeUInt32LE(0xfffffff0, i + 22)
      if (huge.readUInt32LE(i) === 0x02014b50) huge.writeUInt32LE(0xfffffff0, i + 24)
    }
    const rss = process.memoryUsage().rss
    check("SheetJS patch 2: entries claiming 4 GB read as what they hold, without the 4 GB",
      fails(huge).includes("| Lamp oil | $42.50 |") && process.memoryUsage().rss - rss < 500e6, fails(huge))
    const bin = X.CFB.read(fx.xlsx("xlsb"), { type: "buffer" }), ws = X.CFB.find(bin, "/xl/worksheets/sheet1.bin")
    ws.content = Buffer.concat([Buffer.from([0x33, 4, 0xff, 0xff, 0xff, 0x7f]), Buffer.from(ws.content)]) // BrtMdb: 2^31 entries in 4 bytes
    const many = workbookMarkdown(Buffer.from(X.CFB.write(bin, { type: "buffer", fileType: "zip" })))
    check("SheetJS patch 3: a corrupt count stops at its record's end (that sheet empty, the others read)",
      many.includes("## Budget\n_(empty sheet)_") && many.includes("| Bob Lee | Monday |"), many)
    const rec = (type: number, data: number[]) => { const b = Buffer.alloc(4 + data.length); b.writeUInt16LE(type); b.writeUInt16LE(data.length, 2); b.set(data, 4); return b }
    const nan = Buffer.concat([rec(0x0009, [2, 0, 0x10, 0]), rec(0x0006, Array(16).fill(0)), rec(0x000a, [])]) // BIFF2: a Formula record with no formula
    check("SheetJS patch 4: a formula record shorter than its formula fails", fails(nan) === "Corrupt formula", fails(nan))

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

    // Audiobooks: what the player reads from a file's tags (chapters, title, cover), and bookmarks kept beside the place.
    const { readMeta } = await import("../../../plugins/core/player/meta.ts")
    fs.writeFileSync(path.join(VAULT, "Shelf/Log.m4b"), fx.m4b())
    fs.writeFileSync(path.join(VAULT, "Shelf/Log.mp3"), fx.mp3())
    const audiobook = readMeta(path.join(VAULT, "Shelf/Log.m4b"))
    check("m4b: title, author, cover and Nero chapters", audiobook.title === "The keeper's log" && audiobook.artist === "Alice Park" && audiobook.cover?.mime === "image/jpeg" &&
      JSON.stringify(audiobook.chapters) === JSON.stringify([{ t: 0, title: "Opening" }, { t: 61.5, title: "The storm" }, { t: 3725, title: "Morning" }]), audiobook)
    const tag = readMeta(path.join(VAULT, "Shelf/Log.mp3"))
    check("mp3: ID3 title, UTF-16 author, the picture, CHAP frames in time order", tag.title === "The keeper's log" && tag.artist === "Alice Park" && tag.cover?.bytes.length === 9 &&
      tag.chapters.map((c) => `${c.t} ${c.title}`).join("|") === "0 Opening|90 The storm", tag)
    // (a tag can name any type: a page served from the app's origin would run with its access)
    fs.writeFileSync(path.join(VAULT, "Shelf/Page.mp3"), Buffer.from(fx.mp3().toString("latin1").replace("image/jpeg", "text/html;"), "latin1"))
    const cover = await $.app.run("GET", ["player", "cover"], { path: "Shelf/Page.mp3" }, {})
    const coverType = cover.body instanceof $.Text ? cover.body.type : ""
    check("player/cover: a picture is only ever served as an image", cover.status === 200 && /^image\/(jpeg|png|gif|webp)$/.test(coverType), coverType)
    let m: Any
    ;[code, m] = await api("GET", "player/meta?path=Shelf/Log.m4b")
    check("player/meta: chapters, and whether there's a cover", code === 200 && m.chapters.length === 3 && m.cover === true && m.artist === "Alice Park", m)
    ;[code] = await api("GET", "player/meta?path=Shelf/Lease.docx")
    check("player/meta: only audio and video", code === 400, code)
    ;[code] = await api("PUT", "player/places", { path: "Shelf/Log.m4b", t: 120, d: 4000 })
    ;[code, m] = await api("PUT", "player/marks", { path: "Shelf/Log.m4b", marks: [{ t: 3000, note: " The lamp " }, { t: 62.4 }, { t: -1 }] })
    check("player/marks: sorted, rounded, trimmed, the place kept", code === 200 && JSON.stringify(m.place.marks) === JSON.stringify([{ t: 62 }, { t: 3000, note: "The lamp" }]) && m.place.t === 120, m)
    ;[, m] = await api("PUT", "player/places", { path: "Shelf/Log.m4b", t: 150, d: 4000 })
    check("player/places: a new place keeps the bookmarks", m.place.t === 150 && m.place.marks?.length === 2, m)
    const marksFile = path.join(VAULT, ".vaultite/plugins/player/marks.json"), marksAt = fs.statSync(marksFile).mtimeMs
    ;[, m] = await api("PUT", "player/places", { path: "Shelf/Log.m4b", t: 180, d: 4000 })
    check("player: bookmarks are the user's file, a place playing is kept by the server (nothing written)", m.place.t === 180 &&
      JSON.parse(fs.readFileSync(marksFile, "utf8")).marks["Shelf/Log.m4b"].length === 2 && fs.statSync(marksFile).mtimeMs === marksAt &&
      !fs.existsSync(path.join(VAULT, ".vaultite/plugins/player/places.json")))
    // places.json from before: positions taken in (the newer winning), bookmarks into marks.json, then it goes.
    fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/player/places.json"), JSON.stringify({ places: {
      "Shelf/Log.m4b": { t: 5, at: 1, marks: [{ t: 1 }] }, "Shelf/Old.mp3": { t: 42, d: 100, at: Date.now(), marks: [{ t: 7, note: "Here" }] } } }))
    const [, was] = await api("GET", "player/places")
    check("player: places.json from before is taken in, then removed", was.places["Shelf/Log.m4b"].t === 180 && was.places["Shelf/Log.m4b"].marks.length === 2 &&
      was.places["Shelf/Old.mp3"].t === 42 && was.places["Shelf/Old.mp3"].marks[0].note === "Here" && !fs.existsSync(path.join(VAULT, ".vaultite/plugins/player/places.json")), was)

    // Outside the vault: nothing until allowed; then its info (and, in server.ts, its bytes).
    const out = path.join(tmp, "elsewhere", "Plan.pdf")
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, "%PDF-1.4 made up")
    ;[code] = await api("GET", `file/info?path=${out}`)
    check("outside: a file not allowed is a 404", code === 404, code)
    desktopAllows([out])
    let info: Any
    ;[code, info] = await api("GET", `file/info?path=${out}`)
    check("outside: an allowed file's info", code === 200 && info.kind === "pdf" && info.size === 16, info)
    check("outside: allowedPath only for allowed files", O.allowedPath(out) === out && (() => { try { O.allowedPath(path.join(tmp, "x.pdf")); return false } catch { return true } })())
    fs.writeFileSync(out.replace(".pdf", ".bin"), Buffer.from([0x41, 0, 0x42]))
    desktopAllows([out.replace(".pdf", ".bin")])
    ;[code] = await api("GET", `file?path=${out.replace(".pdf", ".bin")}`)
    check("outside: a binary file isn't read as text", code === 415, code)
    // (an editor's save: only its edit and the base's fingerprint, as web/src/core/autosave.ts sends it)
    const note = path.join(tmp, "elsewhere", "Note.md")
    fs.writeFileSync(note, "Written outside.\n")
    desktopAllows([note])
    const { textHash } = await import("../../../core/texthash.ts")
    let saved: Any
    ;[code, saved] = await api("PUT", "file", { path: note, edit: { at: 17, cut: 0, add: "Edited.\n" }, baseHash: textHash("Written outside.\n"), lean: true })
    check("outside: an editor's edit-only save is written", code === 200 && fs.readFileSync(note, "utf8") === "Written outside.\nEdited.\n", [code, saved])
    ;[code] = await api("PUT", "file", { path: note, edit: { at: 0, cut: 0, add: "x" }, baseHash: textHash("something else") })
    check("outside: an edit of a base that changed on disk asks for the base (412)", code === 412, code)
    const base = "One\nTwo\nThree\n", disk = "One\nTwo by them\nThree\n"
    const saves: [string, (p: string) => object][] = [
      ["an edit of the base on disk", (p) => ({ path: p, edit: { at: 0, cut: 3, add: "Uno" }, baseHash: textHash(disk), lean: true })],
      ["an edit of a base that changed", (p) => ({ path: p, edit: { at: 0, cut: 3, add: "Uno" }, baseHash: textHash(base), lean: true })],
      ["a bad edit", (p) => ({ path: p, edit: { at: -1, cut: 0, add: "x" }, baseHash: textHash(disk) })],
      ["text with a base that merges", (p) => ({ path: p, text: base.replace("Three", "Three by me"), base })],
      ["text with a base that conflicts", (p) => ({ path: p, text: base.replace("Two", "Two by me"), base })],
      ["text that isn't text", (p) => ({ path: p, text: 3 })],
    ]
    const inVault = "Notes/Saved alike.md", outFile = path.join(tmp, "elsewhere", "Saved alike.md")
    fs.writeFileSync(outFile, disk)
    desktopAllows([outFile])
    for (const [what, body] of saves) {
      fs.mkdirSync(path.join(VAULT, "Notes"), { recursive: true })
      fs.writeFileSync(path.join(VAULT, inVault), disk); fs.writeFileSync(outFile, disk)
      const [a] = await api("PUT", "file", body(inVault)), [b] = await api("PUT", "file", body(outFile))
      const same = fs.readFileSync(path.join(VAULT, inVault), "utf8") === fs.readFileSync(outFile, "utf8")
      check(`save: ${what} gets the same answer in the vault and outside it`, a === b && same, [a, b, same])
    }
  }
}
