/**
 * Made-up Office files and books for the tests (tools/test_vault.ts): the smallest .docx, .pptx and .epub that hold
 * what their plugins read as text (headings, lists, tables, slides in the deck's order, speaker notes, chapters in the
 * spine's order), and a real .xlsx written by SheetJS. Nothing about anyone.
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
