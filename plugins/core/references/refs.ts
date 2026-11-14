import { z } from "zod"
import { type Citation, citationsIn } from "./cite.ts"
import { formatAll, type Formatted, type Style } from "./format.ts"
import { itemsFor, type Library, lookup, unite } from "./library.ts"
import { CslFields } from "./parse/normalize.ts"
import { type RefsPlace, refsPlace } from "./place.ts"
import { localeXml, resolveStyle, type StyleFiles } from "./styles.ts"
import { bibliographyFiles, fileEntries, type FileState, noteEntries, ownBibliographies, type VaultFiles } from "./vaultsources.ts"
import type { StyleInfo } from "./wire.ts"
import type { Zotero, ZoteroOptions } from "./zotero/source.ts"

export const Settings = z.looseObject({
  style: z.string().catch("apa").default("apa"),
  locale: z.string().catch("en-US").default("en-US"),
  bibliographies: z.array(z.string()).catch([]).default([]),
  findBibliographies: z.boolean().catch(true).default(true),
  zoteroLocal: z.boolean().catch(true).default(true),
  zoteroGroups: z.boolean().catch(true).default(true),
  folder: z.string().catch("").default(""),
  template: z.string().catch("").default(""),
  inDocument: z.boolean().catch(false).default(false),
})
export type Settings = z.infer<typeof Settings>

export type Host = VaultFiles & StyleFiles & {
  settings: () => Settings
  webKey: () => string
  fmOf: (rel: string) => CslFields | null
  textOf: (rel: string) => string | null
  exists: (rel: string) => boolean
  zotero: Zotero
}

export type NoteFormat = Formatted & { style: StyleInfo; cites: Citation[]; place: RefsPlace }

export const realCites = (cites: Citation[], lib: Library) => cites.filter((c) => !c.inText || c.items.every((i) => lookup(lib, i.key)))

export class References {
  host: Host
  files: FileState[] = []
  constructor(host: Host) { this.host = host }

  zoteroOptions(): ZoteroOptions {
    const s = this.host.settings()
    return { local: s.zoteroLocal, groups: s.zoteroGroups, webKey: this.host.webKey() }
  }

  library(forPath = ""): Library {
    const s = this.host.settings(), fm = forPath ? this.host.fmOf(forPath) : null
    void this.host.zotero.refresh(this.zoteroOptions())
    const states: FileState[] = []
    const own = forPath ? ownBibliographies(fm?.bibliography, forPath, this.host.exists) : []
    const shared = bibliographyFiles(this.host, s.bibliographies, s.findBibliographies).filter((p) => !own.includes(p))
    const notes = noteEntries(this.host)
    const lib = unite([fileEntries(this.host, own, states), fileEntries(this.host, shared, states),
      this.host.zotero.entries(this.zoteroOptions()), notes.entries], notes.notes)
    if (!forPath || !own.length) this.files = states
    return lib
  }

  styleFor(forPath = "", override = "") {
    const fm = forPath ? this.host.fmOf(forPath) : null
    const own = String(fm?.csl ?? fm?.["citation-style"] ?? "")
    return { ...resolveStyle(this.host, override || own || this.host.settings().style), own: !!own && !override }
  }

  langFor(forPath = "") {
    const fm = forPath ? this.host.fmOf(forPath) : null
    return String(fm?.lang ?? "") || this.host.settings().locale
  }

  async format(style: Style, lang: string, lib: Library, cites: Citation[]): Promise<Formatted> {
    const keys = cites.flatMap((c) => c.items.map((i) => i.key))
    const locales = { get: (l: string) => localeXml(this.host, l), fallback: localeXml(this.host, "en-US") ?? "" }
    const use = localeXml(this.host, lang) ? lang : "en-US"
    return formatAll(style, use, locales, itemsFor(lib, keys), cites)
  }

  async formatNote(path: string, text?: string, override = ""): Promise<NoteFormat> {
    const body = text ?? this.host.textOf(path) ?? ""
    const lib = this.library(path)
    const cites = realCites(citationsIn(body), lib)
    const { style, problem, own } = this.styleFor(path, override)
    const f = await this.format(style, this.langFor(path), lib, cites)
    return { ...f, style: { id: style.id, title: style.title, problem, own }, cites, place: refsPlace(body) }
  }
}
