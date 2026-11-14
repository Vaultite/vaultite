import type { Engine } from "citeproc"
import type { Citation } from "./cite.ts"
import { authorsShort, type CslItem } from "./csl.ts"

export type Style = { id: string; title: string; notes: boolean; xml: string; stamp: string }
export type Locales = { get: (lang: string) => string | null; fallback: string }
export type Formatted = {
  citations: string[]
  entries: { key: string; html: string }[]
  missing: string[]
  hanging: boolean
  numbered: boolean
}

type Loaded = { Engine: typeof Engine }
let loading: Promise<Loaded> | null = null
const load = () => (loading ??= import("citeproc").then((m) => m.default))

const engines = new Map<string, { engine: Engine; items: Map<string, CslItem> }>()

async function engineFor(style: Style, lang: string, locales: Locales) {
  const id = `${style.id}\u0000${style.stamp}\u0000${lang}`
  const had = engines.get(id)
  if (had) return had
  const { Engine } = await load()
  const items = new Map<string, CslItem>()
  const sys = {
    retrieveLocale: (l: string) => locales.get(l) ?? (l.startsWith("en") ? locales.fallback : false),
    retrieveItem: (key: string) => items.get(key),
  }
  const engine = new Engine(sys, style.xml, lang || undefined)
  engine.opt.development_extensions.wrap_url_and_doi = true
  const made = { engine, items }
  for (const k of engines.keys()) if (k.startsWith(`${style.id}\u0000`)) engines.delete(k)
  engines.set(id, made)
  return made
}

const NO_FORM = "[NO_PRINTED_FORM]"
type CiteRef = { id: string; locator?: string; label?: string; prefix?: string; suffix?: string; "suppress-author"?: boolean }

function citationOf(c: Citation, i: number, known: Map<string, CslItem>) {
  const items = c.items.filter((it) => known.has(it.key))
  return {
    citationID: `c${i}`,
    citationItems: items.map((it) => {
      const out: CiteRef = { id: it.key }
      if (it.locator) { out.locator = it.locator; out.label = it.label || "page" }
      if (it.prefix) out.prefix = `${it.prefix} `
      if (it.suffix) out.suffix = /^[,.;:]/.test(it.suffix) ? it.suffix : `, ${it.suffix}`
      if (it.suppressAuthor) out["suppress-author"] = true
      return out
    }),
    properties: c.inText ? { noteIndex: 0, mode: "composite" as const } : { noteIndex: 0 },
  }
}

export const missingText = (keys: string[]) => keys.map((k) => `@${k}`).join("; ")

export async function formatAll(style: Style, lang: string, locales: Locales, known: Map<string, CslItem>, cites: Citation[]): Promise<Formatted> {
  const { engine, items } = await engineFor(style, lang, locales)
  items.clear()
  for (const [k, v] of known) items.set(k, { ...v, id: k })
  const keys = [...new Set(cites.flatMap((c) => c.items.map((i) => i.key)))]
  const usable = cites.flatMap((c, i) => { const one = citationOf(c, i, known); return one.citationItems.length ? [one] : [] })
  engine.updateItems(keys.filter((k) => known.has(k)))
  const built = new Map(engine.rebuildProcessorState(usable, "html").map(([id, , text]) => [id, text]))
  const citations = cites.map((c, i) => {
    const missing = c.items.flatMap((it) => (known.has(it.key) ? [] : [it.key]))
    const text = built.get(`c${i}`) ?? ""
    const named = text.includes(NO_FORM) ? text.replace(NO_FORM, authorsShort(known.get(c.items[0].key) ?? { id: "", type: "document" })) : text
    return [named, missing.length ? `<span class="csl-missing">${missingText(missing)}</span>` : ""].filter(Boolean).join("; ")
  })
  const bib = engine.makeBibliography()
  const entries = bib ? bib[0].entry_ids.map((ids, n) => ({ key: ids[0], html: bib[1][n].trim() })) : []
  const missing = keys.filter((k) => !known.has(k))
  return { citations, entries, missing, hanging: !!bib && !!bib[0].hangingindent, numbered: !!bib && !!bib[0]["second-field-align"] }
}

export async function formatKeys(style: Style, lang: string, locales: Locales, known: Map<string, CslItem>, keys: string[]) {
  const cites: Citation[] = keys.map((key) => ({ from: 0, to: 0, inText: false, source: `[@${key}]`,
    items: [{ key, prefix: "", suffix: "", locator: "", label: "", suppressAuthor: false }] }))
  return formatAll(style, lang, locales, known, cites)
}

const ENTITIES: [RegExp, string][] = [[/&#38;|&amp;/g, "&"], [/&#60;|&lt;/g, "<"], [/&#62;|&gt;/g, ">"], [/&#34;|&quot;/g, "\""], [/&#39;|&apos;/g, "'"], [/&#160;|&nbsp;/g, " "]]

export function markdownOf(html: string): string {
  let t = html
    .replace(/<div class="csl-left-margin">(.*?)<\/div>\s*<div class="csl-right-inline">/g, "$1 ")
    .replace(/<\/?(?:i|em)>/g, "*").replace(/<\/?(?:b|strong)>/g, "**")
    .replace(/<a href="([^"]*)">([^<]*)<\/a>/g, (_m, href: string, text: string) => (text === href ? href : `[${text}](${href})`))
    .replace(/<span class="csl-missing">([^<]*)<\/span>/g, "$1 (not in the library)")
    .replace(/<[^>]+>/g, "")
  for (const [re, ch] of ENTITIES) t = t.replace(re, ch)
  return t.replace(/\*\*\*\*/g, "").replace(/\s+/g, " ").trim()
}
