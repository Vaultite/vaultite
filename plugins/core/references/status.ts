import type { References } from "./refs.ts"
import type { FileState } from "./vaultsources.ts"
import type { StyleInfo } from "./wire.ts"
import type { ZoteroState } from "./zotero/source.ts"

export type Status = {
  items: number
  notes: number
  style: StyleInfo
  locale: string
  files: FileState[]
  zotero: { local: ZoteroState & { on: boolean }; web: ZoteroState & { on: boolean } }
}

export function statusOf(refs: References): Status {
  const lib = refs.library()
  const { style, problem } = refs.styleFor()
  const o = refs.zoteroOptions(), z = refs.host.zotero.states
  const off: ZoteroState = { state: "off", detail: "", items: 0, libraries: [], at: 0, bbt: null }
  return {
    items: lib.entries.size, notes: lib.notes.size, style: { id: style.id, title: style.title, problem, own: false }, locale: refs.langFor(),
    files: refs.files,
    zotero: { local: { ...z.get("local") ?? off, on: o.local }, web: { ...z.get("web") ?? off, on: !!o.webKey } },
  }
}

const zoteroLine = (name: string, s: ZoteroState & { on: boolean }) => {
  if (!s.on) return `- ${name}: off`
  if (s.state === "ready") return `- ${name}: ${s.items} references (${s.libraries.join(", ")})${s.bbt ? `, Better BibTeX ${s.bbt}` : ""}`
  if (s.state === "off") return `- ${name}: not read yet`
  return `- ${name}: ${s.detail}${s.items ? ` (citing the ${s.items} it had)` : ""}`
}

export function statusText(s: Status): string {
  const files = s.files.length ? s.files.map((f) => `- ${f.path}: ${f.count} references${f.problems.length ? `; ${f.problems.length} problems: ${f.problems.slice(0, 3).join("; ")}` : ""}`) : ["- none"]
  return [`${s.items} references in the library; ${s.notes} literature notes.`, `Style: ${s.style.title}${s.style.problem ? ` (${s.style.problem})` : ""}; language ${s.locale}.`, "",
    "Bibliography files:", ...files, "", "Zotero:", zoteroLine("On this computer", s.zotero.local), zoteroLine("zotero.org", s.zotero.web)].join("\n")
}
