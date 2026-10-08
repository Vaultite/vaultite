// Presentations' server side: each slide's text and speaker notes as Markdown, for /api/render and search.
import { Plugin, unzip, xmlDecode, zipText } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

/** The relationships of a part (`ppt/slides/slide1.xml` -> its rels): id -> [type, target as a path in the zip]. */
function rels(zip: Map<string, () => Buffer>, part: string) {
  const dir = part.slice(0, part.lastIndexOf("/"))
  const xml = zipText(zip, `${dir}/_rels/${part.slice(dir.length + 1)}.rels`) ?? ""
  const out = new Map<string, [string, string]>()
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const at = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1] ?? ""
    const target = at("Target")
    const abs = target.startsWith("/") ? target.slice(1) : resolve(dir, target)
    out.set(at("Id"), [at("Type"), abs])
  }
  return out
}

function resolve(dir: string, rel: string) {
  const parts = dir.split("/")
  for (const p of rel.split("/")) {
    if (p === "..") parts.pop()
    else if (p !== ".") parts.push(p)
  }
  return parts.join("/")
}

/** A slide's (or notes page's) text: each paragraph a line. */
function paragraphs(xml: string) {
  return [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>|<a:br\/>/g)].map((t) => (t[1] !== undefined ? xmlDecode(t[1]) : "\n")).join("").trim())
    .filter(Boolean)
}

/** A .pptx deck's text as Markdown. */
export function deckMarkdown(bytes: Buffer): string {
  const zip = unzip(bytes)
  const pres = zipText(zip, "ppt/presentation.xml")
  if (pres === null) throw new Error("not a PowerPoint deck (no ppt/presentation.xml)")
  const presRels = rels(zip, "ppt/presentation.xml")
  // The deck's order; slides it doesn't list (a broken file) after, by number.
  let slides = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => presRels.get(m[1])?.[1]).filter((p): p is string => !!p && zip.has(p))
  if (!slides.length) {
    slides = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  }
  const out: string[] = []
  slides.forEach((part, i) => {
    out.push(`## Slide ${i + 1}`)
    const lines = paragraphs(zipText(zip, part) ?? "")
    out.push(lines.length ? lines.join("\n\n") : "_(no text)_")
    const notesPart = [...rels(zip, part).values()].find(([type]) => type.endsWith("/notesSlide"))?.[1]
    const notes = notesPart ? paragraphs(zipText(zip, notesPart) ?? "").filter((l) => !/^\d+$/.test(l)) : []
    if (notes.length) out.push(`Notes: ${notes.join("\n")}`)
  })
  return out.join("\n\n") || "_(empty deck)_"
}

plugin.provide("text:pptx", (bytes: Buffer | string) => deckMarkdown(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)))
