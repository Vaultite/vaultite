// The History tab: the pages visited, newest first, by day (a page once a day, at its last visit), searched, opened with
// a click, removed one or several at a time (Undo puts them back), and Clear browsing history for a time range.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Copy, Globe, Search, Trash2 } from "lucide-react"
import {
  Button, choose, confirmDialog, dateText, FilterField, fmtDay, fmtLongDay, iso, menuFor, notify, notifyError, plural, rowMenu,
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

/** Put back what was removed, from a toast's Undo. */
const undoable = (text: string, gone: Removed[]) => {
  if (!gone.length) return
  notify(text, { action: { label: "Undo", run: () => restoreVisits(gone).then(() => {}) } })
}
const pages = (n: number) => plural(n, "page")

export async function removeRows(rows: Pick<Row, "ids">[]) {
  try {
    const gone = await removeVisits({ visits: rows.flatMap((r) => r.ids) })
    undoable(`Removed ${pages(rows.length)} from history`, gone)
  } catch (e) { notifyError(e, "Couldn't remove them from history") }
}

export async function forgetSite(host: string) {
  try {
    const gone = await removeSite(host)
    undoable(gone.length ? `Removed ${host} from history` : `No history of ${host}`, gone)
  } catch (e) { notifyError(e, `Couldn't remove ${host} from history`) }
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
      try {
        const n = await clearHistory(r.ms ? Date.now() - r.ms : null, null)
        notify(n ? `Cleared ${plural(n, "visit")}` : "Nothing to clear")
      } catch (e) { notifyError(e, "Couldn't clear the history") }
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

  const days = useMemo(() => byDay(visits ?? []), [visits])
  const rows = useMemo(() => new Map(days.flatMap((d) => d.rows.map((r) => [r.key, r] as const))), [days])
  useSelectable(HISTORY_LIST, { noun: ["page", "pages"], menu: (keys) => {
    const picked = keys.flatMap((k) => rows.get(k) ?? [])
    return [
      { label: `Open ${pages(picked.length)}`, icon: Globe, run: () => { for (const r of picked) openPage(r.url) } },
      { label: "Remove from history", icon: Trash2, danger: true, sep: true, run: () => void removeRows(picked) },
    ]
  } })

  if (!hasHistory()) return <p className="mx-auto max-w-[720px] px-4 pt-6 text-[13px] text-tertiary">The history is kept by Vaultite's desktop app.</p>
  return (
    <div className="mx-auto max-w-[720px] px-4 pt-3 pb-10" data-web-history>
      <div className="mb-3 flex items-center gap-2">
        <FilterField value={q} onChange={setQ} placeholder="Search history" />
        <Button look="quiet" size="small" onClick={askClear} data-web-clear-history>Clear browsing history…</Button>
      </div>
      {visits && !visits.length && (
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
              {d.rows.map((r) => <HistoryRow key={r.key} row={r} openPage={openPage} filter={setQ} />)}
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

function HistoryRow({ row: r, openPage, filter }: { row: Row; openPage: (url: string) => void; filter: (q: string) => void }) {
  const picked = useSelected(HISTORY_LIST, r.key)
  const host = hostOf(r.url)
  const own = (): MenuItem[] => [
    { label: "Open", icon: Globe, run: () => openPage(r.url) },
    { label: "Copy link", icon: Copy, run: () => void navigator.clipboard.writeText(r.url) },
    { label: `More from ${host}`, icon: Search, run: () => filter(host) },
    { label: "Remove from history", icon: Trash2, danger: true, sep: true, run: () => void removeRows([r]) },
    { label: `Remove all of ${host}`, icon: Trash2, danger: true, run: () => void forgetSite(r.host || host) },
  ]
  return (
    <SidebarRow icon={siteIcon(r.url)} open tip={r.url} data-select-key={r.key} data-web-history-row={r.url} {...selectedAttr(picked)}
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

