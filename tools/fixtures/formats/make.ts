/**
 * Made-up Office files and books for the tests (tools/test_vault.ts): the smallest .docx, .pptx and .epub that hold
 * what their plugins read as text (headings, lists, tables, slides in the deck's order, speaker notes, chapters in the
 * spine's order), a real .xlsx written by SheetJS, and audiobooks' tags (an .m4b's atoms, an .mp3's ID3: title, author,
 * chapters, cover). Nothing about anyone.
 */
import { createRequire } from "node:module"
import { zipFiles } from "../../../plugins/core/ai-import/zip.ts"

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const p = (text: string, style = "", list = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list ? "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>" : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const tc = (text: string) => `<w:tc>${p(text)}</w:tc>`

export function docx(): Buffer {
  const body = [
    p("Lighthouse lease", "Title"),
    p("Terms", "Heading1"),
    p("The tenant gives 60 days&apos; notice &amp; pays on the 1st."),
    p("Keys returned", "", true), p("Walls repainted", "", true),
    `<w:tbl><w:tr>${tc("Item")}${tc("Cost")}</w:tr><w:tr>${tc("Deposit")}${tc("1200")}</w:tr></w:tbl>`,
    `<w:p><w:r><w:delText>struck clause</w:delText></w:r><w:r><w:t>Signed by Alice Park</w:t><w:tab/><w:t>and Bob Lee</w:t></w:r></w:p>`,
  ].join("")
  // A whole package, as Word writes one: its parts' types and the relationships that lead to the document (the app's
  // renderer, docx-preview, follows them; the text reader goes straight to word/document.xml).
  return zipFiles({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": rels(rel("rId1", "officeDocument", "word/document.xml")),
    "word/_rels/document.xml.rels": rels(),
    "word/document.xml": `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  })
}

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const slide = (...paras: string[]) => `<?xml version="1.0"?><p:sld ${A}><p:cSld><p:spTree>${paras.map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}</p:spTree></p:cSld></p:sld>`
const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
const rels = (...r: string[]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join("")}</Relationships>`

/** Two slides, the second first in the deck (slide2.xml is shown first), and speaker notes on one. */
export function pptx(): Buffer {
  return zipFiles({
    "ppt/presentation.xml": `<?xml version="1.0"?><p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(rel("rId2", "slide", "slides/slide1.xml"), rel("rId3", "slide", "slides/slide2.xml")),
    "ppt/slides/slide1.xml": slide("Roadmap", "Ship the lighthouse beacon"),
    "ppt/slides/slide2.xml": slide("Lighthouse pitch", "Q3 &amp; beyond"),
    "ppt/slides/_rels/slide2.xml.rels": rels(rel("rId1", "notesSlide", "../notesSlides/notesSlide1.xml")),
    "ppt/notesSlides/notesSlide1.xml": slide("Open with the storm story", "1"),
  })
}

/** Chapters listed in the spine in another order than the manifest's. */
export function epub(): Buffer {
  const xhtml = (title: string, text: string) => `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><script>alert(1)</script></head><body><h1>${title}</h1><p>${text}</p></body></html>`
  return zipFiles({
    mimetype: "application/epub+zip",
    "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OEBPS/content.opf": '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The keeper&apos;s log</dc:title><dc:creator>Alice Park</dc:creator></metadata>' +
      '<manifest><item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    "OEBPS/text/one.xhtml": xhtml("The storm", "The lamp burned all night &amp; the gulls slept."),
    "OEBPS/text/two.xhtml": xhtml("Morning", "Fog lifted over the harbour."),
  })
}

/** A workbook of two sheets, a number formatted as money. */
export function xlsx(): Buffer {
  const X = createRequire(import.meta.url)("xlsx") as typeof import("xlsx")
  const book = X.utils.book_new()
  const budget = X.utils.aoa_to_sheet([["Item", "Amount"], ["Lamp oil", 42.5], ["Paint", 18]])
  budget.B2.z = "$#,##0.00"
  X.utils.book_append_sheet(book, budget, "Budget")
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([["Visitor", "Day"], ["Bob Lee", "Monday"]]), "Visitors")
  return X.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

// ---------- audiobooks: only their tags (no sound), as the player's meta.ts reads them

const COVER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const box = (type: string, ...body: Buffer[]) => { const b = Buffer.concat(body); const h = Buffer.alloc(8); h.writeUInt32BE(8 + b.length); h.write(type, 4, "latin1"); return Buffer.concat([h, b]) }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
const item = (type: string, kind: number, value: Buffer) => box(type, box("data", u32(kind), u32(0), value))

/** An .m4b's moov: iTunes tags (title, author, a JPEG cover) and Nero's chapter list. */
export function m4b(): Buffer {
  const chapters: [number, string][] = [[0, "Opening"], [61.5, "The storm"], [3725, "Morning"]]
  const chpl = Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, chapters.length]), ...chapters.map(([t, title]) => {
    const b = Buffer.alloc(9); b.writeBigUInt64BE(BigInt(Math.round(t * 1e7))); b[8] = Buffer.byteLength(title)
    return Buffer.concat([b, Buffer.from(title)])
  })])
  const ilst = box("ilst", item("©nam", 1, Buffer.from("The keeper's log")), item("©ART", 1, Buffer.from("Alice Park")), item("covr", 13, COVER))
  const meta = box("meta", u32(0), box("hdlr", Buffer.alloc(25)), ilst)
  return Buffer.concat([box("ftyp", Buffer.from("M4B "), u32(0)), box("moov", box("udta", box("chpl", chpl), meta)), box("mdat", Buffer.alloc(16))])
}

/** An .mp3's ID3v2.3 tag: title, author (UTF-16), a cover and CHAP frames with their TIT2, then a frame of silence. */
export function mp3(): Buffer {
  const frame = (id: string, body: Buffer) => { const h = Buffer.alloc(10); h.write(id, 0, "latin1"); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]) }
  const text = (s: string) => Buffer.concat([Buffer.from([3]), Buffer.from(s)])
  const chap = (id: string, ms: number, end: number, title: string) => {
    const times = Buffer.alloc(16); times.writeUInt32BE(ms); times.writeUInt32BE(end, 4); times.writeInt32BE(-1, 8); times.writeInt32BE(-1, 12)
    return frame("CHAP", Buffer.concat([Buffer.from(id + "\0", "latin1"), times, frame("TIT2", text(title))]))
  }
  const frames = Buffer.concat([
    frame("TIT2", text("The keeper's log")),
    frame("TPE1", Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from("Alice Park", "utf16le")])),
    frame("APIC", Buffer.concat([Buffer.from([0]), Buffer.from("image/jpeg\0", "latin1"), Buffer.from([3]), Buffer.from("\0"), COVER])),
    chap("ch1", 90_000, 200_000, "The storm"), chap("ch0", 0, 90_000, "Opening"),
  ])
  const size = frames.length, head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
  return Buffer.concat([head, frames, Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(413)])
}
