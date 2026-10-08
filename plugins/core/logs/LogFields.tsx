// ```block-log: a log's fields, on top of its file (Logs/<Area>/<date> <title>.md). The file's text below is its notes;
// other blocks an area adds (its `blocks`, drawn by the plugin that brings the area) sit under it.
import type { ReactNode } from "react"
import { fmtMin, Group, KV, openDetail, pluginById, resolver, type Store } from "@vaultite"
import { fieldText, isRecord, type Log } from "./types"

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v)
const Link = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
    {href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
  </a>
)
// Who wrote it: Claude, the user, or an importer (a plugin: "From Hevy").
const WRITERS: Record<string, string> = { claude: "Logged by Claude", manual: "Logged by you" }
const sourceText = (s: string) => WRITERS[s] ?? `From ${pluginById(s)?.name ?? s}`
// Values of these fields are words ("conversation", "planned"): shown capitalised.
const WORDS = new Set(["kind", "status"])
export const human = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ")
// Lists of records (a workout's exercises, a session's climbs) are left to the plugins that draw them (the area's
// `blocks`): isRecord.

/** A log's fields (its area's, then any others), and where it came from. */
export function LogFields({ store, log }: { store: Store; log: Log }) {
  const area = store.areas.find((a) => a.slug === log.area)
  const link = resolver(store)
  const fields = area?.fields ?? []
  const d = log.data ?? {}
  const value = (v: unknown, unit?: string): ReactNode => (isUrl(v) ? <Link href={v} /> : fieldText(v, unit))
  const rows: [string, ReactNode][] = []
  if (log.duration_min) rows.push(["Duration", fmtMin(log.duration_min)])
  // A text value that names something in the vault (a person, a colleague, a book) links to it. Not a log: their titles
  // repeat (every "Morning workout"), and a place named like the session's title would link to the session itself.
  const logIds = new Set(store.logs.map((l) => l.id))
  const shown = (k: string, v: unknown, unit?: string): ReactNode => {
    const found = typeof v === "string" ? link(v) : null
    const t = found && !logIds.has(found.id) ? found : null
    if (t) return <button type="button" onClick={() => openDetail(t.detail)} className="cursor-pointer text-primary hover:underline">{t.title}</button>
    if (WORDS.has(k) && typeof v === "string") return human(v === "doing" ? "in progress" : v)
    return value(v, unit)
  }
  for (const f of fields) {
    const v = d[f.key]
    if (v == null || v === "" || isRecord(v)) continue
    rows.push([f.label, shown(f.key, v, f.unit)])
  }
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === "" || fields.some((f) => f.key === k) || isRecord(v)) continue
    rows.push([human(k), shown(k, v)])
  }
  if (log.source) rows.push(["Source", sourceText(log.source)])

  return rows.length ? <Group>{rows.map(([k, v]) => <KV key={k} label={k}>{v}</KV>)}</Group> : null
}
