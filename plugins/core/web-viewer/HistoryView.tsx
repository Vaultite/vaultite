// The History tab: the pages visited, newest first, by day (a page once a day, at its last visit), searched, opened with
// a click, removed one or several at a time (Undo puts them back), and Clear browsing history for a time range.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, Globe, Search, Trash2 } from "lucide-react"
import {
  Button, cell, choose, confirmDialog, dateText, FilterField, fmtDay, fmtLongDay, iso, menuFor, notify, notifyError, plural, removals, rowMenu,
  selectClick, selectedAttr, SidebarHeading, SidebarRow, useSelectable, useSelected, type MenuItem,
} from "@vaultite"
import { hostOf } from "./address"
import { clearHistory, hasHistory, listHistory, removeSite, removeVisits, restoreVisits, useHistoryChanged, type Removed, type Visit } from "./history"
import { siteIcon } from "./icons"

export const HISTORY_LIST = "web-history"
const PAGE = 300
const TIME = { hour: "numeric", minute: "2-digit" } as const

/** A page as the list shows it: its last visit that day, and every visit of it that day (what removing it takes). */
type Row = { key: string; url: string; title: string; host: string; at: number; ids: number[] }
type Day = { day: string; rows: Row[] }

function byDay(visits: Visit[]): Day[] {
  const days: Day[] = [], rows = new Map<string, Row>()
  for (const v of visits) {
    const day = iso(new Date(v.at)), key = `${day} ${v.url}`
    const had = rows.get(key)
    if (had) { had.ids.push(v.id); continue }
    const row: Row = { key, url: v.url, title: v.title, host: v.host, at: v.at, ids: [v.id] }
    rows.set(key, row)
    if (days[days.length - 1]?.day !== day) days.push({ day, rows: [] })
    days[days.length - 1].rows.push(row)
  }
  return days
}

/** Rows removed from here: gone at once, back if it fails or on Undo. A whole range cleared: hidden from `cleared`. */
const removing = removals()
const cleared = cell<number | null>(null)

/** Put back what was removed, from a toast's Undo. */
const undoable = (text: string, gone: Removed[], keys: string[]) => {
  if (!gone.length) return
  notify(text, { action: { label: "Undo", run: () => { removing.back(keys); return restoreVisits(gone).then(() => {}) } } })
}
const pages = (n: number) => plural(n, "page")

function removeRows(rows: Pick<Row, "ids" | "key">[]) {
  const keys = rows.map((r) => r.key)
  let gone: Removed[] = []
  void removing.remove(keys, async () => { gone = await removeVisits({ visits: rows.flatMap((r) => r.ids) }) }, "Couldn't remove them from history")
    .then((ok) => ok && undoable(`Removed ${pages(rows.length)} from history`, gone, keys))
}

/** Remove a site's history (`rows`: the ones of it shown, which go at once). */
function forgetSite(host: string, rows: Row[]) {
  const keys = rows.map((r) => r.key)
  let gone: Removed[] = []
  void removing.remove(keys, async () => { gone = await removeSite(host) }, `Couldn't remove ${host} from history`)
    .then((ok) => ok && undoable(gone.length ? `Removed ${host} from history` : `No history of ${host}`, gone, keys))
}

const RANGES: { id: string; label: string; ms: number | null }[] = [
  { id: "hour", label: "The last hour", ms: 3600_000 },
  { id: "day", label: "The last 24 hours", ms: 86_400_000 },
  { id: "week", label: "The last 7 days", ms: 7 * 86_400_000 },
  { id: "month", label: "The last 4 weeks", ms: 28 * 86_400_000 },
  { id: "all", label: "All time", ms: null },
]
/** Clear browsing history…: pick a time range, then confirm (it can't be undone). */
export function askClear() {
  choose({
    title: "Clear browsing history", heading: "Clear the history of", placeholder: "Time range",
    items: RANGES.map((r) => ({ id: r.id, label: r.label })),
    onPick: async (it) => {
      const r = RANGES.find((x) => x.id === it.id)!
      const ok = await confirmDialog({
        title: `Clear ${r.ms ? r.label.toLowerCase() : "all"} of your browsing history?`,
        body: "The pages visited then leave the history and the address bar's suggestions. Logins, bookmarks and open pages stay.",
        confirm: "Clear", danger: true,
      })
      if (!ok) return
      const since = r.ms ? Date.now() - r.ms : null
      cleared.set(since ?? 0)
      try {
        const n = await clearHistory(since, null)
        notify(n ? `Cleared ${plural(n, "visit")}` : "Nothing to clear")
      } catch (e) { notifyError(e, "Couldn't clear the history") } finally { cleared.set(null) }
    },
  })
}

export function HistoryView({ openPage, onImport }: { openPage: (url: string) => void
  /** Import another browser's history (shown while there's none). */
  onImport?: () => void }) {
  const [q, setQ] = useState("")
  const [text, setText] = useState("")
  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [more, setMore] = useState(false)
  const loading = useRef(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setTimeout(() => setText(q.trim()), 150); return () => clearTimeout(t) }, [q])

  // The newest visits again, as many as were listed (a visit, a delete, Undo).
  const shown = useRef(0)
  const reload = useCallback(() => {
    void listHistory({ text, limit: Math.min(1000, Math.max(PAGE, shown.current)) }).then((r) => {
      shown.current = r.visits.length
      setVisits(r.visits)
      setMore(r.more)
    }, () => setVisits([]))
  }, [text])
  useEffect(() => { shown.current = 0; reload() }, [reload])
  useHistoryChanged(reload)
  const loadMore = useCallback(() => {
    if (!visits?.length || !more || loading.current) return
    loading.current = true
    void listHistory({ text, before: visits[visits.length - 1].at, limit: PAGE }).then((r) => {
      setVisits((v) => { const next = [...(v ?? []), ...r.visits]; shown.current = next.length; return next })
      setMore(r.more)
    }, () => {}).finally(() => { loading.current = false })
  }, [visits, more, text])
  useEffect(() => {
    const el = end.current
    if (!el) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore() }, { rootMargin: "600px" })
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore])

  const all = useMemo(() => byDay(visits ?? []), [visits])
  const since = cleared.use()
  const { list: kept, leaving } = removing.use(useMemo(() => all.flatMap((d) => d.rows), [all]), (r) => r.key)
  const days = useMemo(() => {
    const keep = new Set(kept)
    return all.map((d) => ({ ...d, rows: d.rows.filter((r) => keep.has(r) && (since === null || r.at < since)) })).filter((d) => d.rows.length)
  }, [all, kept, since])
  const rows = useMemo(() => new Map(days.flatMap((d) => d.rows.map((r) => [r.key, r] as const))), [days])
  useSelectable(HISTORY_LIST, { noun: ["page", "pages"], menu: (keys) => {
    const picked = keys.flatMap((k) => rows.get(k) ?? [])
    return [
      { label: `Open ${pages(picked.length)}`, icon: Globe, run: () => { for (const r of picked) openPage(r.url) } },
      { label: "Remove from history", icon: Trash2, danger: true, sep: true, run: () => removeRows(picked) },
    ]
  } })

  if (!hasHistory()) return <p className="mx-auto max-w-[720px] px-4 pt-6 text-[13px] text-tertiary">The history is kept by Vaultite's desktop app.</p>
  return (
    <div className="mx-auto max-w-[720px] px-4 pt-3 pb-10" data-web-history>
      <div className="mb-3 flex items-center gap-2">
        <FilterField value={q} onChange={setQ} placeholder="Search history" />
        <Button look="quiet" size="small" onClick={askClear} data-web-clear-history>Clear browsing history…</Button>
      </div>
      {visits && !days.length && (
        <div className="px-1.5 pt-6 text-[13px] text-muted-foreground" data-web-history-empty>
          {text ? `Nothing in the history matches "${text}".` : "No history yet. The pages you visit are kept here, on this computer."}
          {!text && onImport && <Button look="secondary" size="small" className="ml-2" onClick={onImport}>Import from another browser…</Button>}
        </div>
      )}
      <div data-select-list={HISTORY_LIST} data-size-up className="flex flex-col gap-3">
        {days.map((d) => (
          <section key={d.day} data-web-history-day={d.day}>
            <SidebarHeading title={dayTitle(d.day)} open />
            <div className="flex flex-col gap-px">
              {d.rows.map((r) => <HistoryRow key={r.key} row={r} openPage={openPage} filter={setQ} leaving={leaving(r.key)} siteRows={(h) => [...rows.values()].filter((x) => (x.host || hostOf(x.url)) === h)} />)}
            </div>
          </section>
        ))}
      </div>
      <div ref={end} aria-hidden className="h-px" />
    </div>
  )
}

function dayTitle(day: string) {
  const name = fmtDay(day)
  return name === "Today" || name === "Yesterday" ? `${name} · ${fmtLongDay(day)}` : fmtLongDay(day)
}

function HistoryRow({ row: r, openPage, filter, leaving, siteRows }: { row: Row; openPage: (url: string) => void; filter: (q: string) => void; leaving?: ""
  /** The rows shown of a site (what removing it takes off at once). */
  siteRows: (host: string) => Row[] }) {
  const picked = useSelected(HISTORY_LIST, r.key)
  const host = hostOf(r.url)
  const own = (): MenuItem[] => [
    { label: "Open", icon: Globe, run: () => openPage(r.url) },
    { label: "Copy link", icon: Copy, run: () => void navigator.clipboard.writeText(r.url) },
    { label: `More from ${host}`, icon: Search, run: () => filter(host) },
    { label: "Remove from history", icon: Trash2, danger: true, sep: true, run: () => removeRows([r]) },
    { label: `Remove all of ${host}`, icon: Trash2, danger: true, run: () => forgetSite(r.host || host, siteRows(r.host || host)) },
  ]
  return (
    <SidebarRow icon={siteIcon(r.url)} open tip={r.url} data-select-key={r.key} data-web-history-row={r.url} data-leaving={leaving} {...selectedAttr(picked)}
      label={(
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{r.title || host}</span>
          <span className="min-w-0 shrink-[2] truncate text-[12px] text-tertiary">{host}</span>
        </span>
      )}
      onClick={(e) => { if (!selectClick(e, HISTORY_LIST, r.key)) openPage(r.url) }}
      onContextMenu={menuFor(rowMenu(HISTORY_LIST, r.key, own))}>
      <span className="mr-1 shrink-0 text-[12px] text-tertiary tabular-nums">{dateText(r.at, TIME)}</span>
    </SidebarRow>
  )
}

