// Code files in the editor: the language for a file name (@codemirror/language-data: each language's parser is its own
// chunk, loaded when a file needs it) and the colours, from the scheme's tokens so every scheme recolours code.
import { LanguageDescription, HighlightStyle, type LanguageSupport } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { tags as t } from "@lezer/highlight"

/** Names language-data doesn't know by their extension. */
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
/** The language for a file (null: plain text). */
export function languageFor(name: string): Promise<LanguageSupport | null> {
  const d = describe(name)
  if (!d) return Promise.resolve(null)
  let p = loaded.get(d.name)
  if (!p) { p = d.load().catch(() => null); loaded.set(d.name, p) }
  return p
}

/** A language by its name (a notebook's kernel: "python", "julia", "r"). */
export function languageNamed(name: string): Promise<LanguageSupport | null> {
  const d = LanguageDescription.matchLanguageName(languages, name, true)
  return d ? languageFor(`x.${d.extensions[0] ?? name}`) : Promise.resolve(null)
}

export const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], color: "var(--purple)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: "var(--green)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--orange)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: "var(--yellow)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.macroName], color: "var(--blue)" },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--teal)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--red)" },
  { tag: [t.definition(t.variableName), t.constant(t.variableName), t.standard(t.variableName)], color: "var(--indigo)" },
  { tag: [t.meta, t.annotation, t.processingInstruction], color: "var(--pink)" },
  { tag: [t.heading], fontWeight: "bold", color: "var(--h2)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: "var(--blue)", textDecoration: "underline" },
  { tag: [t.inserted], color: "var(--green)" },
  { tag: [t.deleted, t.invalid], color: "var(--red)" },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator], color: "var(--muted-foreground)" },
])

/** The file's own indentation: a tab, or the smallest run of leading spaces (2 or 4...). */
export const indentOf = (doc: string) => ownIndent(doc) ?? "  "

/** The indentation a file already uses (a tab, or the smallest run of leading spaces), or null when no line is
 *  indented. A note's frontmatter and code blocks don't count: they're YAML's and the code's, not the writer's. */
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
