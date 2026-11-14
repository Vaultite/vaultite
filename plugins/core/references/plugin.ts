import path from "node:path"
import { z } from "zod"
import { Plugin } from "../../../core/plugins.ts"
import { type Item, readText } from "../../../core/vault.ts"
import { referencesOps } from "./ops.ts"
import { CslFields } from "./parse/normalize.ts"
import { type Host, References, Settings } from "./refs.ts"
import { referencesRoutes } from "./routes.ts"
import { pageText } from "./textside.ts"
import { KeptLibrary } from "./zotero/sync.ts"
import { Zotero } from "./zotero/source.ts"

export const plugin = new Plugin(import.meta.url)

const Secrets = z.looseObject({ zoteroKey: z.string().optional().catch(undefined) }).catch({})
const KeptLibraries = z.array(KeptLibrary).catch([])
const fieldsOf = (fm: Item | undefined) => { const r = CslFields.safeParse(fm ?? {}); return r.success ? r.data : null }

const zotero = new Zotero({
  load: (web) => KeptLibraries.parse(plugin.kept(web ? "zotero-web" : "zotero-local", [])),
  save: (web, libs) => { plugin.keep(web ? "zotero-web" : "zotero-local", libs.length ? libs : null, { shared: true }) },
})

const host: Host = {
  settings: () => Settings.parse(plugin.settings()),
  webKey: () => Secrets.parse(plugin.secrets()[plugin.id] ?? {}).zoteroKey?.trim() ?? "",
  others: function* () { for (const [rel, st] of plugin.vault.others) yield [rel, `${st.ns}:${st.size}`] },
  read: (rel) => readText(plugin.vault.abs(rel)),
  builtIn: (file) => readText(path.join(plugin.dir, "styles", file)),
  notes: function* () {
    for (const e of plugin.vault.entries.values()) {
      if (e.type !== "reference" || e.archived) continue
      const fm = fieldsOf(e.fm)
      if (fm) yield { rel: e.rel, fm }
    }
  },
  fmOf: (rel) => fieldsOf(plugin.vault.entries.get(rel)?.fm),
  textOf: (rel) => plugin.vault.entries.get(rel)?.text ?? null,
  exists: (rel) => plugin.vault.others.has(rel) || plugin.vault.entries.has(rel),
  zotero,
}

export const refs = new References(host)

plugin.provide("page-text", (ctx: { path: string; text: string }) => pageText(refs, ctx.path, ctx.text))
referencesRoutes(plugin, refs)
referencesOps(plugin, refs)
