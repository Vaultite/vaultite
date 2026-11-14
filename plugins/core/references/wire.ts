export type Row = { key: string; authors: string; year: string; title: string; container: string; type: string; from: string; note: string | null }
export type Links = { doi: string; url: string; zotero: string }
export type Shown = Row & { html: string; links: Links }
export type StyleInfo = { id: string; title: string; problem: string; own: boolean }

export type NoteAnswer = {
  style: StyleInfo
  entries: Shown[]
  missing: string[]
  hanging: boolean
  numbered: boolean
  citations: { from: number; to: number; source: string; html: string; keys: string[] }[]
  place: "div" | "heading" | "end"
}
export type CiteAnswer = NoteAnswer & { sources: string[] }
export type SearchAnswer = { results: Row[] }
export type EntryAnswer = (Shown & { found: true; abstract: string }) | { found: false; key: string }

export type ZoteroState = { state: "off" | "ready" | "unreachable" | "refused" | "error"; detail: string; items: number; libraries: string[]; at: number; bbt: string | null }
export type FileState = { path: string; count: number; problems: string[] }
export type StatusAnswer = {
  items: number
  notes: number
  style: StyleInfo
  locale: string
  files: FileState[]
  zotero: { local: ZoteroState & { on: boolean }; web: ZoteroState & { on: boolean } }
}

export type NoteMade = { path: string; created: boolean }
export type StyleChoices = { choices: { value: string; label: string }[] }
