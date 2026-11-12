import { LanguageDescription, HighlightStyle, type LanguageSupport } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { highlightTree, tags as t } from "@lezer/highlight"
import { StyleModule } from "style-mod"
import { ink } from "../lib/ink.ts"

const ALIAS: Record<string, string> = { env: "properties", conf: "properties", cfg: "properties", plist: "xml", jsonl: "json", ndjson: "json",
  geojson: "json", webmanifest: "json", map: "json", zsh: "sh", fish: "sh", mdx: "markdown", tsv: "", txt: "", log: "" }

function describe(name: string): LanguageDescription | null {
  const base = name.split("/").pop()!
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : ""
  if (ext in ALIAS) return ALIAS[ext] ? LanguageDescription.matchFilename(languages, `x.${ALIAS[ext]}`) : null
  if (/^\.env(\.|$)/i.test(base)) return LanguageDescription.matchFilename(languages, "x.properties")
  return LanguageDescription.matchFilename(languages, base) ?? LanguageDescription.matchLanguageName(languages, ext, false)
}

const loaded = new Map<string, Promise<LanguageSupport | null>>()
export function languageFor(name: string): Promise<LanguageSupport | null> {
  const d = describe(name)
  if (!d) return Promise.resolve(null)
  let p = loaded.get(d.name)
  if (!p) { p = d.load().catch(() => null); loaded.set(d.name, p) }
  return p
}

export function languageNamed(name: string): Promise<LanguageSupport | null> {
  const d = LanguageDescription.matchLanguageName(languages, name, true)
  return d ? languageFor(`x.${d.extensions[0] ?? name}`) : Promise.resolve(null)
}

export const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], color: ink("var(--purple)") },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: ink("var(--green)") },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: ink("var(--orange)") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: ink("var(--muted-foreground)"), fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: ink("var(--yellow)") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName], color: ink("var(--blue)") },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: ink("var(--teal)") },
  { tag: [t.tagName, t.angleBracket], color: ink("var(--red)") },
  { tag: [t.definition(t.variableName), t.constant(t.variableName), t.standard(t.variableName)], color: ink("var(--indigo)") },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: ink("var(--pink)") },
  { tag: [t.heading], fontWeight: "bold", color: ink("var(--h2)") },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: ink("var(--blue)"), textDecoration: "underline" },
  { tag: [t.inserted], color: ink("var(--green)") },
  { tag: [t.deleted, t.invalid], color: ink("var(--red)") },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator], color: ink("var(--muted-foreground)") },
])

let mounted = false
export async function highlightInto(el: HTMLElement, lang: string) {
  const support = await languageNamed(lang)
  if (!support) return
  if (!mounted && codeStyle.module) { StyleModule.mount(document, codeStyle.module); mounted = true }
  const text = el.textContent ?? ""
  const out = document.createDocumentFragment()
  let at = 0
  highlightTree(support.language.parser.parse(text), codeStyle, (from, to, cls) => {
    if (from > at) out.append(text.slice(at, from))
    const span = document.createElement("span")
    span.className = cls
    span.textContent = text.slice(from, to)
    out.append(span)
    at = to
  })
  if (at < text.length) out.append(text.slice(at))
  if (el.textContent === text) el.replaceChildren(out)
}

export const indentOf = (doc: string) => ownIndent(doc) ?? "  "

export function ownIndent(doc: string, note = false): string | null {
  let tabs = 0, min = 0, fence = "", i = 0
  for (const line of doc.split("\n", 2000)) {
    if (note && i++ === 0 && line === "---") { fence = "---"; continue }
    if (fence) {
      if (fence === "---" ? line === "---" || line === "..." : line.trimStart().startsWith(fence)) fence = ""
      continue
    }
    const open = note ? /^\s*(`{3,}|~{3,})/.exec(line) : null
    if (open) { fence = open[1]; continue }
    const m = /^([ \t]+)\S/.exec(line)
    if (!m) continue
    if (m[1][0] === "\t") { tabs++; continue }
    if (m[1].length >= 2 && (!min || m[1].length < min)) min = m[1].length
  }
  if (tabs && !min) return "\t"
  return min ? " ".repeat(Math.min(min, 8)) : null
}
