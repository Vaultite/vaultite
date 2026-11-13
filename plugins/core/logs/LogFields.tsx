import type { ReactNode } from "react"
import { fmtMin, Group, KV, openDetail, pluginById, resolver, type Store } from "@vaultite"
import { fieldText, isRecord, type Log } from "./types"

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v)
const Link = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
    {href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
  </a>
)
const WRITERS: Record<string, string> = { claude: "Logged by Claude", manual: "Logged by you" }
const sourceText = (s: string) => WRITERS[s] ?? `From ${pluginById(s)?.name ?? s}`
const WORDS = new Set(["kind", "status"])
export const human = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ")

export function LogFields({ store, log }: { store: Store; log: Log }) {
  const area = store.areas.find((a) => a.slug === log.area)
  const link = resolver(store)
  const fields = area?.fields ?? []
  const d = log.data ?? {}
  const value = (v: unknown, unit?: string): ReactNode => (isUrl(v) ? <Link href={v} /> : fieldText(v, unit))
  const rows: [string, ReactNode][] = []
  if (log.duration_min) rows.push(["Duration", fmtMin(log.duration_min)])
  const logIds = new Set(store.logs.map((l) => l.id))
  const shown = (k: string, v: unknown, unit?: string): ReactNode => {
    const found = typeof v === "string" ? link(v, `${log.id}.md`) : null
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
