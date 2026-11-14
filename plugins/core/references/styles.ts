import type { Style } from "./format.ts"

export type StyleFiles = {
  builtIn: (file: string) => string
  others: () => Iterable<[string, string]>
  read: (rel: string) => string
}

export const BUILT_IN = [
  { id: "apa", title: "APA 7th edition", aliases: ["apa7"] },
  { id: "chicago-author-date", title: "Chicago 18th edition (author-date)", aliases: ["chicago"] },
  { id: "modern-language-association", title: "MLA 9th edition", aliases: ["mla"] },
  { id: "harvard-cite-them-right", title: "Harvard (Cite them right)", aliases: ["harvard"] },
  { id: "ieee", title: "IEEE", aliases: [] },
  { id: "nlm-citation-sequence", title: "Vancouver (NLM)", aliases: ["vancouver", "nlm"] },
]
export const DEFAULT_STYLE = "apa"

const titleIn = (xml: string) => /<title>([^<]*)<\/title>/.exec(xml)?.[1]?.trim() ?? ""
const parentIn = (xml: string) => /<link[^>]*rel="independent-parent"[^>]*href="[^"]*\/([^/"]+)"/.exec(xml)?.[1] ?? /<link[^>]*href="[^"]*\/([^/"]+)"[^>]*rel="independent-parent"/.exec(xml)?.[1] ?? null

export type StyleChoice = { value: string; label: string }

export function styleChoices(files: StyleFiles): StyleChoice[] {
  const own: StyleChoice[] = []
  for (const [rel] of files.others()) {
    if (!/\.csl$/i.test(rel)) continue
    let title = ""
    try { title = titleIn(files.read(rel)) } catch { title = "" }
    own.push({ value: rel, label: title ? `${title} (${rel.split("/").pop()})` : rel })
  }
  return [...BUILT_IN.map((s) => ({ value: s.id, label: s.title })), ...own]
}

const builtInId = (name: string) => {
  const n = name.toLowerCase().replace(/\.csl$/, "")
  return BUILT_IN.find((s) => s.id === n || s.aliases.includes(n))?.id ?? null
}

function vaultStyle(files: StyleFiles, name: string): [string, string] | null {
  const want = name.replace(/^\/+/, "").toLowerCase(), bare = want.replace(/\.csl$/, "")
  for (const [rel, stamp] of files.others()) {
    const r = rel.toLowerCase()
    if (!r.endsWith(".csl")) continue
    if (r === want || r === `${bare}.csl` || r.split("/").pop() === `${bare.split("/").pop()}.csl`) return [rel, stamp]
  }
  return null
}

export type Resolved = { style: Style; problem: string }
type Found = { xml: string; own: [string, string] | null; id: string; problem: "" } | { problem: string }

function findStyle(files: StyleFiles, name: string): Found {
  const n = name.trim()
  const own = n ? vaultStyle(files, n) : null
  const id = n ? builtInId(n) : DEFAULT_STYLE
  if (!own && !id) return { problem: `No style "${name}": APA instead` }
  try { return { xml: own ? files.read(own[0]) : files.builtIn(`${id}.csl`), own, id: id ?? DEFAULT_STYLE, problem: "" } } catch { return { problem: `${name} couldn't be read: APA instead` } }
}

export function resolveStyle(files: StyleFiles, name: string, depth = 0): Resolved {
  const found = findStyle(files, name)
  const apa = (problem: string): Resolved => ({ style: resolveStyle(files, DEFAULT_STYLE, depth + 1).style, problem })
  if (!("xml" in found)) return apa(found.problem)
  const parent = parentIn(found.xml)
  if (parent && depth < 2) {
    const p = resolveStyle(files, parent, depth + 1)
    if (p.problem) return apa(`${name} is a journal's style based on ${parent}, which isn't in the vault: APA instead`)
    return { style: { ...p.style, id: found.own ? found.own[0] : name, title: titleIn(found.xml) || p.style.title }, problem: "" }
  }
  const style: Style = { id: found.own ? found.own[0] : found.id, title: titleIn(found.xml) || name, xml: found.xml, stamp: found.own ? found.own[1] : "app",
    notes: /<style[^>]*class="note"/.test(found.xml) }
  return { style, problem: "" }
}

export function localeXml(files: StyleFiles, lang: string): string | null {
  if (!lang || /^en(-US)?$/i.test(lang)) return files.builtIn("locales-en-US.xml")
  for (const [rel] of files.others()) {
    if (rel.toLowerCase().endsWith(`locales-${lang.toLowerCase()}.xml`)) {
      try { return files.read(rel) } catch { return null }
    }
  }
  return null
}
