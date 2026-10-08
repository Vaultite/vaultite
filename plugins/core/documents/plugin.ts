// Documents' server side: a .docx's paragraphs, headings, lists and tables as Markdown for /api/render and search
// (no comments, headers, footers or tracked deletions).
import { Plugin, unzip, xmlDecode, zipText } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

const PARA = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g
const RUN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g

/** A paragraph's text: its runs (not deleted ones: those are <w:delText>), tabs and line breaks. */
function runs(xml: string) {
  let out = ""
  for (const m of xml.matchAll(RUN)) out += m[1] !== undefined ? xmlDecode(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n"
  return out.replace(/[ \t]+$/gm, "")
}

/** The heading level of a paragraph's style (Heading1, heading 2, Title), or 0. */
function level(xml: string) {
  const style = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? ""
  if (/^title$/i.test(style)) return 1
  const h = /^heading\s*(\d)$/i.exec(style)
  return h ? Math.min(6, Number(h[1])) : 0
}

function paragraph(xml: string) {
  const text = runs(xml).trim()
  if (!text) return ""
  const h = level(xml)
  if (h) return `${"#".repeat(h)} ${text.replace(/\n/g, " ")}`
  if (/<w:numPr>/.test(xml)) return `- ${text.replace(/\n/g, " ")}`
  return text
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim()

function table(xml: string) {
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
    [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => cell([...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => runs(p[0])).join(" "))))
  const width = Math.max(0, ...rows.map((r) => r.length))
  if (!width) return ""
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, j) => r[j] ?? "").join(" | ")} |`
  return [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n")
}

/** A .docx file's text as Markdown. */
export function docxMarkdown(bytes: Buffer): string {
  const xml = zipText(unzip(bytes), "word/document.xml")
  if (xml === null) throw new Error("not a Word document (no word/document.xml)")
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml
  const out: string[] = []
  for (const m of body.matchAll(PARA)) {
    const md = m[0].startsWith("<w:tbl") ? table(m[0]) : paragraph(m[0])
    if (md) out.push(md)
  }
  // Items of one list together; everything else a paragraph apart.
  return out.reduce((s, b, i) => s + (i === 0 ? "" : b.startsWith("- ") && out[i - 1].startsWith("- ") ? "\n" : "\n\n") + b, "") || "_(empty document)_"
}

plugin.provide("text:docx", (bytes: Buffer | string) => docxMarkdown(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)))
