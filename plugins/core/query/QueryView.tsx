// ```block-query and a .base's views: the files a query matches as a table, cards, list, board or calendar. Sorting is
// here only; changing a value or moving a card writes that one property as a small edit.
import { memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Ellipsis, Info, Table2 } from "lucide-react"
import {
  addDays, cn, dateText, dow, edgeScroller, Empty, Loading, menuBelow, menuFor, numberText, openFile, Panel, parse, PinMap, range, resolver, setProperty, startDrag,
  today, typedValue, useDrag, useDropHit, useDropTarget, useLive, useRowsNear, useVaultChange, weekStart, type BlockCtx, type MapPin, type MenuItem,
} from "@vaultite"
import { byKeys, compare, comparer, dayOf, groupName, monthName, propKey, summaryText, text, type Result, type Row } from "./query"

export const TINT = "var(--indigo)"
type Resolve = ReturnType<typeof resolver>
const WIKI = /^\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/

/** "2026-09-27" -> "27 Sep" (the year when it isn't this one); with a time, the time too. */
function fmtDate(s: string) {
  const m = DAY.exec(s)!
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  const date = dateText(d, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
  return m[4] ? `${date}, ${dateText(d, { hour: "numeric", minute: "2-digit" })}` : date
}

/** A value drawn: a [[link]] as a link, a date as a date, a list as chips, yes/no, a URL. */
function Value({ v, resolve }: { v: unknown; resolve: Resolve }): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-tertiary">–</span>
  if (Array.isArray(v)) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {v.map((x, i) => (
          <span key={i} className="rounded-[5px] bg-foreground/[0.06] px-1.5 text-[12px] leading-[20px] whitespace-nowrap"><Value v={x} resolve={resolve} /></span>
        ))}
      </span>
    )
  }
  if (typeof v === "boolean") return <span className={v ? "" : "text-muted-foreground"}>{v ? "Yes" : "No"}</span>
  if (typeof v === "number") return <span className="tabular-nums">{numberText(v)}</span>
  if (typeof v !== "string") return <span className="text-muted-foreground">{text(v)}</span>
  const link = WIKI.exec(v.trim())
  if (link) {
    const file = resolve(link[1])?.file
    return file ? (
      <button type="button" className="cursor-pointer text-primary hover:underline"
        onClick={(e) => { e.stopPropagation(); openFile(file, { newTab: e.metaKey || e.ctrlKey }) }}>{link[2] ?? link[1]}</button>
    ) : <span className="text-muted-foreground">{link[2] ?? link[1]}</span>
  }
  if (/^https?:\/\/\S+$/.test(v)) {
    return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{v.replace(/^https?:\/\/(www\.)?/, "")}</a>
  }
  if (DAY.test(v)) return <span className="tabular-nums">{fmtDate(v)}</span>
  return <>{v}</>
}

/** Which values can be changed in place: plain text, numbers and yes/no of a frontmatter key (not links or lists). */
const editable = (key: string, v: unknown) =>
  !!propKey(key) && (v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && !WIKI.test(v.trim()) && !v.includes("\n")))

/** What was typed, as the value to write: a number stays a number, yes/no a boolean, nothing removes the key. */
function typed(s: string, was: unknown): unknown {
  const t = s.trim()
  if (!t) return undefined
  if ((typeof was === "number" || was === null) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (typeof was === "boolean" && /^(yes|no|true|false)$/i.test(t)) return /^(yes|true)$/i.test(t)
  return t
}

export type Sort = { key: string; desc: boolean } | null
type Save = (r: Row, key: string, v: unknown) => void

/** A database view's answer, live (asked again whenever a note changes), with this view's sort and values written from
 *  here shown at once until the files say the same. `save` writes one property. */
export function useQueryResult(url: string) {
  // (Hidden files aren't the data, but Templates' settings (its folder is left out) and property types (they sort). A
  // moment, not a counter: live requests of the same path are shared for 10 s, so a remount must ask afresh.)
  const [v, setV] = useState(() => Date.now())
  useVaultChange(() => setV(Date.now()), (p) => !p.startsWith(".") || p === ".vaultite" || p === ".vaultite/plugins" || p.startsWith(".vaultite/plugins/templates") || /^\.(vaultite|obsidian)\/types\.json$/.test(p))
  const { data, error } = useLive<Result>(url, v)
  // (useLive keeps the last answer while the next loads: no flicker on every change; drawn again, a view starts from
  // its last answer.)
  const res = data
  const [sort, setSort] = useState<Sort>(null)
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  useEffect(() => {
    if (!res) return
    const rows = new Map(res.groups.flatMap((g) => g.rows).map((r) => [r.path, r]))
    setEdits((e) => {
      const done = Object.keys(e).filter((k) => {
        const [path, key] = k.split("\0"), r = rows.get(path)
        return r && JSON.stringify(r.values[key] ?? null) === JSON.stringify(e[k] ?? null)
      })
      if (!done.length) return e
      const rest = { ...e }
      for (const k of done) delete rest[k]
      return rest
    })
  }, [res])

  const groups = useMemo(() => {
    if (!res) return []
    const val = (r: Row, k: string) => (`${r.path}\0${k}` in edits ? edits[`${r.path}\0${k}`] : r.values[k])
    return res.groups.map((g) => ({
      ...g,
      rows: (sort ? [...g.rows].sort((a, b) => {
        const va = val(a, sort.key), vb = val(b, sort.key)
        const blank = (x: unknown) => x === null || x === undefined || x === ""
        return blank(va) || blank(vb) ? compare(va, vb) : comparer(res.types?.[sort.key], typedValue)(va, vb) * (sort.desc ? -1 : 1)
      }) : g.rows).map((r) => ({ ...r, values: Object.fromEntries(Object.keys(r.values).map((k) => [k, val(r, k)])) })),
    }))
  }, [res, sort, edits])

  // (The views are memoized: drawn again when what they show changes, not for every change in the vault.)
  const save = useCallback<Save>(async (r, key, value) => {
    const prop = propKey(key)
    if (!prop) return
    setEdits((e) => ({ ...e, [`${r.path}\0${key}`]: value ?? null }))
    try {
      await setProperty(r.path, prop, value)
    } catch (err) {
      console.error(err)
      setEdits((e) => { const { [`${r.path}\0${key}`]: _, ...rest } = e; return rest })
    }
  }, [])
  return { res, error: error && !data ? error : res ? null : error, loading: !res && !error, groups, sort, setSort, save }
}

/** "12 files", "50 of 120 files". */
export const countText = (res: Result) => `${res.total > res.shown ? `${res.shown} of ${res.total}` : res.total} ${res.total === 1 ? "file" : "files"}`

/** What a database view draws, by its view: notes on what was left out, then the table, cards, list, board, calendar
 *  or map. `fill`: it has a box of its own to fill (a .base in its tab), so a map takes the height it's given. */
export function ResultBody({ res, groups, resolve, sort, setSort, save, month, setMonth, fill }: {
  res: Result; groups: Result["groups"]; resolve: Resolve; sort: Sort; setSort: (s: Sort) => void; save: Save
  month: string; setMonth: (m: string) => void; fill?: boolean
}) {
  const special = res.view === "board" || res.view === "calendar" || res.view === "map"
  return (
    <div className={cn("space-y-4 [contain:inline-size]", fill && res.view === "map" && "flex h-full flex-col")} data-query={res.view} data-keylist>
      {res.notes?.length ? (
        <div className="space-y-0.5 text-[13px] text-muted-foreground" data-query-notes>
          {res.notes.map((n) => <p key={n} className="flex gap-1.5"><Info className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.25} />{n}</p>)}
        </div>
      ) : null}
      {!res.total && !special ? <Empty>Nothing matches.</Empty>
        : res.view === "board" ? <Board groups={groups} res={res} resolve={resolve} save={save} />
        : res.view === "calendar" ? <Calendar groups={groups} res={res} resolve={resolve} month={month} setMonth={setMonth} save={save} />
        : res.view === "map" ? <MapResult groups={groups} res={res} resolve={resolve} fill={fill} />
        : res.view === "table" ? <Table groups={groups} res={res} resolve={resolve} sort={sort} setSort={setSort} save={save} />
        : groups.map((g, i) => (
          <div key={g.name ?? `-${i}`}>
            {(groups.length > 1 || g.name) && <GroupHead name={g.name} n={g.rows.length} />}
            {res.view === "cards" ? <Cards rows={g.rows} res={res} resolve={resolve} /> : <Lines rows={g.rows} res={res} resolve={resolve} />}
          </div>
        ))}
    </div>
  )
}

/** A calendar's month: the options' `month`, else this one; the arrows change it here (not in the file). */
export function useMonth(start: unknown) {
  return useState(() => (typeof start === "string" && /^\d{4}-\d{2}$/.test(start) ? start : today().slice(0, 7)))
}

export function QueryBlock({ store, path, host, options }: BlockCtx) {
  const [month, setMonth] = useMonth(options.month)
  const q = useMemo(() => {
    const { wide: _w, stack: _s, ...o } = options
    return JSON.stringify(o.view === "calendar" ? { ...o, month } : o)
  }, [options, month])
  // (`this`: the note embedding this one, else this one: the block's text side alike)
  const { res, error, groups, sort, setSort, save } = useQueryResult(`query?q=${encodeURIComponent(q)}&self=${encodeURIComponent(path)}${host ? `&this=${encodeURIComponent(host)}` : ""}`)
  // (Its views get the link resolver, not the store: the same one while the files and names didn't change.)
  const resolve = resolver(store)
  const title = typeof options.title === "string" && options.title ? options.title : "Query"
  return (
    <Panel title={title} icon={Table2} tint={TINT} className="min-w-0"
      action={res && <span className="text-[13px] text-muted-foreground tabular-nums">{countText(res)}</span>}>
      {error ? <p className="text-[15px] text-muted-foreground">Query: {error.replace(/^Error: /, "")}</p>
        : !res ? <Loading />
        : <ResultBody res={res} groups={groups} resolve={resolve} sort={sort} setSort={setSort} save={save} month={month} setMonth={setMonth} />}
    </Panel>
  )
}

/** A click opens the row's file. On a value that can be edited it waits a moment: a double-click edits it instead.
 *  (One timer for every table: a block drawn again between the two clicks still cancels the open.) */
let pending = 0
const opener = {
  open: (r: Row, e: React.MouseEvent, wait: boolean) => {
    window.clearTimeout(pending)
    if (e.detail > 1) return
    const newTab = e.metaKey || e.ctrlKey
    if (!wait) return openFile(r.path, { newTab })
    pending = window.setTimeout(() => openFile(r.path, { newTab }), 300)
  },
  cancel: () => window.clearTimeout(pending),
}

const GroupHead = ({ name, n }: { name: string | null; n: number }) => (
  <div className="mb-1 flex items-baseline gap-1.5 text-[13px] font-semibold text-muted-foreground" data-query-group>
    <span className="truncate">{name ?? "No value"}</span><span className="font-normal tabular-nums">{n}</span>
  </div>
)

/** One table for every group (so the columns line up), each group under a heading row. */
const Table = memo(function Table({ groups, res, resolve, sort, setSort, save }: {
  groups: { name: string | null; rows: Row[]; summaries?: Record<string, unknown> }[]; res: Result; resolve: Resolve; sort: Sort; setSort: (s: Sort) => void
  save: (r: Row, key: string, v: unknown) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const dropped = useRef(false) // Escape: the blur that follows doesn't save
  const { open, cancel } = opener
  // (every row, drawn as it comes near the screen: the groups take theirs in turn)
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  const [drawn, mark] = useRowsNear(total)
  const upTo = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.rows.length, 0))
  // Asc, desc, then the query's own order.
  const next = (key: string): Sort => (sort?.key !== key ? { key, desc: false } : !sort.desc ? { key, desc: true } : null)
  return (
    <div className="-mx-4 overflow-x-auto px-4" data-query-scroll data-no-edit>
      <table className="w-full min-w-max border-collapse text-[14px]">
        <thead>
            <tr className="border-b-[0.5px] border-border">
              {res.columns.map((c) => (
                <th key={c.key} className="py-1.5 pr-4 text-left font-normal last:pr-0">
                  <button type="button" onClick={() => setSort(next(c.key))} data-query-sort={c.key}
                    className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                    {c.label}
                    {sort?.key === c.key && (sort.desc ? <ArrowDown className="size-3" strokeWidth={2.5} /> : <ArrowUp className="size-3" strokeWidth={2.5} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
        {groups.map((g, gi) => upTo[gi] < drawn && (
        <tbody key={g.name ?? `-${gi}`}>
          {(groups.length > 1 || g.name) && (
            <tr><td colSpan={res.columns.length} className={cn("pb-0.5", gi ? "pt-4" : "pt-2")}><GroupHead name={g.name} n={g.rows.length} /></td></tr>
          )}
          {g.rows.slice(0, drawn - upTo[gi]).map((r) => (
            <tr key={r.path} tabIndex={-1} data-keyrow data-query-row={r.path} onClick={(e) => { if (!editing) open(r, e, !!(e.target as HTMLElement).closest("[data-editable]")) }}
              className="cursor-pointer border-b-[0.5px] border-border hover:bg-foreground/[0.03] [tbody:last-child>&:last-child]:border-0">
              {res.columns.map((c) => {
                const v = r.values[c.key]
                const id = `${r.path}\0${c.key}`
                const can = editable(c.key, v)
                return (
                  <td key={c.key} className="h-9 max-w-[280px] truncate py-1 pr-4 align-middle last:pr-0"
                    data-editable={can ? "" : undefined} data-tip={can && editing !== id ? "Double-click to edit" : undefined}
                    onDoubleClick={can ? (e) => { e.stopPropagation(); cancel(); dropped.current = false; setEditing(id) } : undefined}>
                    {editing === id ? (
                      <input autoFocus defaultValue={v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v)}
                        aria-label={`${c.label} of ${r.title}`} onClick={(e) => e.stopPropagation()}
                        className="h-7 w-full min-w-[120px] rounded-[5px] border-[0.5px] border-border bg-background px-1.5 text-[14px] outline-none focus:border-primary"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") { dropped.current = true; setEditing(null) }
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        }}
                        onBlur={(e) => {
                          setEditing(null)
                          if (dropped.current) return
                          const to = typed(e.target.value, v)
                          if (to !== (v ?? undefined)) save(r, c.key, to)
                        }} />
                    ) : c.key === "file" ? <span className="font-medium">{r.title}</span> : <Value v={v} resolve={resolve} />}
                  </td>
                )
              })}
            </tr>
          ))}
          {g.summaries && drawn >= upTo[gi] + g.rows.length && <SummaryRow res={res} values={g.summaries} group />}
        </tbody>
        ))}
        {res.summaries?.length && drawn >= total ? (
          <tfoot><SummaryRow res={res} values={Object.fromEntries(res.summaries.map((x) => [x.key, x.value]))} /></tfoot>
        ) : null}
      </table>
      {drawn < total && <div ref={mark} className="h-px" aria-hidden />}
    </div>
  )
})

/** Summaries under a table's columns (a group's: after its rows): the summary's name, then its value. */
function SummaryRow({ res, values, group }: { res: Result; values: Record<string, unknown>; group?: boolean }) {
  return (
    <tr className={cn(!group && "border-t-[0.5px] border-border")} data-query-summaries={group ? "group" : "all"}>
      {res.columns.map((c) => {
        const s = res.summaries?.find((x) => x.key === c.key)
        return (
          <td key={c.key} className={cn("py-1 pr-4 align-middle text-[13px] whitespace-nowrap last:pr-0", group ? "h-7" : "h-9")}>
            {s && <><span className="text-muted-foreground">{s.name}</span> <span className="font-medium tabular-nums">{summaryValue(values[c.key])}</span></>}
          </td>
        )
      })}
    </tr>
  )
}
const summaryValue = (v: unknown) => (typeof v === "number" ? numberText(Math.round(v * 100) / 100) : DAY.test(String(v ?? "")) ? fmtDate(String(v)) : summaryText(v) || "–")

// ---------- map

/** The files with a place (`coordinates`, or the key the view names) as pins on a map (a tap opens one); those without
 *  one listed under it. Offline (the map can't load), every file is a list. */
const MapResult = memo(function MapResult({ groups, res, resolve, fill }: { groups: Result["groups"]; res: Result; resolve: Resolve; fill?: boolean }) {
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const meta = others(res).filter((c) => c.key !== res.coordinates)
  const pins = useMemo<MapPin[]>(() => rows.filter((r) => r.pin).map((r) => ({
    id: r.path, title: r.title, ...r.pin!, meta: meta.map((c) => text(r.values[c.key])).filter(Boolean).join(" · ") || undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [rows])
  const [failed, setFailed] = useState(false)
  const unplaced = rows.filter((r) => !r.pin)
  return (
    <div className={cn(fill ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3")} data-query-mapview>
      {pins.length > 0 && !failed && (
        <div className={cn("relative overflow-hidden rounded-[10px] border-[0.5px] border-border", fill ? "min-h-[280px] flex-1" : "h-[360px]")} data-query-map>
          <Suspense fallback={<div className="absolute inset-0" aria-busy />}>
            <PinMap pins={pins} onOpen={(id, newTab) => openFile(id, { newTab })} onFail={() => setFailed(true)} />
          </Suspense>
        </div>
      )}
      {failed && <Lines rows={rows.filter((r) => r.pin)} res={res} resolve={resolve} />}
      {!pins.length && <Empty>{rows.length ? `None of these has a place: a ${res.coordinates ?? "coordinates"} property, [lat, lon].` : "Nothing matches."}</Empty>}
      {unplaced.length > 0 && pins.length > 0 && (
        <div className="text-[13px] text-muted-foreground" data-query-unplaced>
          <span>Without a place ({unplaced.length}): </span>
          {unplaced.slice(0, 12).map((r, i) => (
            <span key={r.path}>{i > 0 && ", "}<button type="button" className="cursor-pointer text-foreground hover:underline"
              onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}>{r.title}</button></span>
          ))}
          {unplaced.length > 12 && <span>, and {unplaced.length - 12} more</span>}
        </div>
      )}
    </div>
  )
})

const others = (res: Result) => res.columns.filter((c) => c.key !== "file")

const Cards = memo(function Cards({ rows, res, resolve }: { rows: Row[]; res: Result; resolve: Resolve }) {
  const [drawn, mark] = useRowsNear(rows.length)
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.slice(0, drawn).map((r) => (
        <button type="button" key={r.path} data-keyrow data-query-row={r.path} onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}
          className="min-w-0 cursor-pointer rounded-[10px] border-[0.5px] border-border bg-background/50 p-3 text-left hover:bg-foreground/[0.03]">
          <div className="truncate text-[15px] font-medium">{r.title}</div>
          <div className="mt-1 space-y-0.5 text-[13px]">
            {others(res).map((c) => (
              <div key={c.key} className="flex min-w-0 gap-2">
                <span className="shrink-0 text-muted-foreground">{c.label}</span>
                <span className="min-w-0 flex-1 truncate text-right"><Value v={r.values[c.key]} resolve={resolve} /></span>
              </div>
            ))}
          </div>
        </button>
      ))}
      {drawn < rows.length && <div ref={mark} className="col-span-full h-px" aria-hidden />}
    </div>
  )
})

const Lines = memo(function Lines({ rows, res, resolve }: { rows: Row[]; res: Result; resolve: Resolve }) {
  const [drawn, mark] = useRowsNear(rows.length)
  return (
    <>
      <div className="hairline">
        {rows.slice(0, drawn).map((r) => (
          <button type="button" key={r.path} data-keyrow data-query-row={r.path} onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}
            className={cn("relative isolate flex min-h-11 w-full min-w-0 cursor-pointer flex-col justify-center py-2 text-left",
              "before:absolute before:inset-y-0 before:-inset-x-2 before:-z-10 before:rounded-[8px] hover:before:bg-foreground/[0.04]")}>
            <span className="truncate text-[15px] leading-[20px]">{r.title}</span>
            {others(res).length > 0 && (
              <span className="flex min-w-0 flex-wrap gap-x-1.5 text-[13px] text-muted-foreground">
                {others(res).filter((c) => text(r.values[c.key])).map((c, i) => (
                  <span key={c.key} className="min-w-0 truncate">{i > 0 && "· "}<Value v={r.values[c.key]} resolve={resolve} /></span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      {drawn < rows.length && <div ref={mark} className="h-px" aria-hidden />}
    </>
  )
})

// ---------- board

/** A card's move menu: every other column (the one it's in checked). */
function moveItems(cols: Col[], at: string, move: (c: Col) => void): MenuItem[] {
  return cols.map((c) => ({ label: `Move to ${c.name ?? "No value"}`, checked: c.key === at, run: () => { if (c.key !== at) move(c) } }))
}

type Col = { key: string; name: string | null; value: unknown; rows: Row[] }

/** Columns of the `group` key's values; moving a card (drag, or its menu on phones) writes that key. */
const Board = memo(function Board({ groups, res, resolve, save }: {
  groups: { name: string | null; value?: unknown; rows: Row[] }[]; res: Result; resolve: Resolve; save: (r: Row, key: string, v: unknown) => void
}) {
  const key = res.group!
  const id = `query-board:${useId()}`
  const box = useRef<HTMLDivElement>(null)
  const drag = useDrag()
  const hit = useDropHit<string>(id)
  const cols = useMemo(() => {
    const out: Col[] = groups.map((g) => ({ key: (g.name ?? "").toLowerCase(), name: g.name, value: g.value ?? g.name, rows: [] }))
    if (!out.some((c) => !c.key)) out.push({ key: "", name: null, value: null, rows: [] })
    for (const r of groups.flatMap((g) => g.rows)) {
      const name = groupName(r.values[key]), k = name.toLowerCase()
      let col = out.find((c) => c.key === k)
      // A value no column has yet (written elsewhere, or just now): a column before "No value".
      if (!col) out.splice(out.findIndex((c) => !c.key), 0, col = { key: k, name, value: r.values[key], rows: [] })
      col.rows.push(r)
    }
    // A moved card goes where the query's order puts it, as it will be once the file is read again.
    for (const c of out) c.rows.sort(byKeys<Row>(res.sort ?? [], (x, k) => x.values[k], res.types, typedValue))
    return out
  }, [groups, key, res.sort])
  const colOf = (path: string) => cols.find((c) => c.rows.some((r) => r.path === path))
  const movable = (r: Row) => !!propKey(key) && !Array.isArray(r.values[key])
  const move = (r: Row, c: Col) => save(r, key, c.value === null || c.value === "" ? undefined : c.value)
  const [edge] = useState(() => edgeScroller("x"))
  useDropTarget<string>(id, (item, x, _y, el) => {
    if (item.from !== "row" || !item.path || !el || !box.current?.contains(el)) { edge.stop(); return null }
    edge.near(box.current, x)
    const to = el.closest<HTMLElement>("[data-board-col]")?.dataset.boardCol
    return to !== undefined && colOf(item.path)?.key !== to ? to : null
  }, (item, to) => {
    const r = cols.flatMap((c) => c.rows).find((x) => x.path === item.path), c = cols.find((x) => x.key === to)
    if (r && c) move(r, c)
  }, { end: edge.stop })
  const fields = others(res).filter((c) => c.key !== key)
  // (every card, drawn as the board's end comes near the screen: each column's next ones at once)
  const longest = Math.max(0, ...cols.map((c) => c.rows.length))
  const [drawn, mark] = useRowsNear(longest)
  return (
    <>
      <div ref={box} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" data-query-board data-no-edit>
        {cols.map((c) => (
          <div key={c.key} data-board-col={c.key}
            className={cn("flex w-[232px] shrink-0 flex-col rounded-[10px] bg-foreground/[0.035] p-1.5 transition-shadow",
              hit === c.key && "ring-2 ring-primary")}>
            <div className="flex items-baseline gap-1.5 px-1.5 pt-0.5 pb-1.5 text-[13px] font-semibold text-muted-foreground" data-query-group>
              <span className="truncate">{c.name ?? "No value"}</span><span className="font-normal tabular-nums">{c.rows.length}</span>
            </div>
            <div className="flex min-h-10 flex-col gap-1.5">
              {c.rows.slice(0, drawn).map((r) => {
                const can = movable(r)
                const menu = () => [
                  { label: "Open", run: () => openFile(r.path) },
                  ...(can ? moveItems(cols, c.key, (to) => move(r, to)).map((m, i) => (i ? m : { ...m, sep: true })) : []),
                ]
                return (
                  <div key={r.path} role="button" tabIndex={0} data-keyrow data-query-row={r.path} onContextMenu={menuFor(menu)}
                    onPointerDown={can ? (e) => startDrag(e, { from: "row", path: r.path, label: r.title }, { touch: true }) : undefined}
                    onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}
                    onKeyDown={(e) => { if (e.key === "Enter") openFile(r.path) }}
                    className={cn("group relative min-w-0 cursor-pointer rounded-[8px] bg-card p-2.5 text-left shadow-sm ring-[0.5px] ring-border hover:bg-background",
                      drag?.item.from === "row" && drag.item.path === r.path && "opacity-50")}>
                    <div className="truncate pr-6 text-[14px] font-medium">{r.title}</div>
                    {fields.some((f) => text(r.values[f.key])) && (
                      <div className="mt-1 space-y-0.5 text-[12px]">
                        {fields.filter((f) => text(r.values[f.key])).map((f) => (
                          <div key={f.key} className="flex min-w-0 gap-2">
                            <span className="shrink-0 text-muted-foreground">{f.label}</span>
                            <span className="min-w-0 flex-1 truncate text-right"><Value v={r.values[f.key]} resolve={resolve} /></span>
                          </div>
                        ))}
                      </div>
                    )}
                    {can && (
                      <button type="button" data-no-drag aria-label={`Move ${r.title}`} data-query-move
                        onClick={(e) => { e.stopPropagation(); menuBelow(e, moveItems(cols, c.key, (to) => move(r, to))) }}
                        className="absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-[5px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100">
                        <Ellipsis className="size-4" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {drawn < longest && <div ref={mark} className="h-px" aria-hidden />}
    </>
  )
})

// ---------- calendar

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
/** "2026-09-27" -> "Sun 27 Sep". */
const dayLabel = (d: string) => dateText(parse(d), { weekday: "short", day: "numeric", month: "short" })

/** A month by the query's date key: a grid of weeks (Monday first) with each file on its day, or, in a narrow card
 *  (a phone), the days that have files as a list. Drag an item to another day (desktop) to move its date there. */
const Calendar = memo(function Calendar({ groups, res, resolve, month, setMonth, save }: {
  groups: { name: string | null; rows: Row[] }[]; res: Result; resolve: Resolve; month: string; setMonth: (m: string) => void
  save: (r: Row, key: string, v: unknown) => void
}) {
  const key = res.date!
  const id = `query-calendar:${useId()}`
  const box = useRef<HTMLDivElement>(null)
  const drag = useDrag()
  const hit = useDropHit<string>(id)
  const now = today()
  // The files by day, as edited here (a moved item shows on its new day at once).
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of groups.flatMap((g) => g.rows)) {
      const d = dayOf(r.values[key])
      if (d?.startsWith(`${month}-`)) m.set(d, [...(m.get(d) ?? []), r])
    }
    for (const rows of m.values()) rows.sort(byKeys<Row>(res.sort ?? [], (x, k) => x.values[k], res.types, typedValue))
    return m
  }, [groups, key, month, res.sort])
  const first = `${month}-01`
  const next = addDays(first, 32).slice(0, 7), prev = addDays(first, -1).slice(0, 7)
  const last = addDays(`${next}-01`, -1)
  const days = range(weekStart(first), 7 * Math.ceil((dow(first) + Number(last.slice(8))) / 7))
  const movable = !!propKey(key)
  const dayOfRow = (path: string) => [...byDay].find(([, rs]) => rs.some((r) => r.path === path))?.[0]
  useDropTarget<string>(id, (item, _x, _y, el) => {
    if (!movable || item.from !== "row" || !item.path || !el || !box.current?.contains(el)) return null
    const d = el.closest<HTMLElement>("[data-cal-day]")?.dataset.calDay
    return d && d !== dayOfRow(item.path) ? d : null
  }, (item, d) => {
    const r = [...byDay.values()].flat().find((x) => x.path === item.path)
    if (!r) return
    // The day changes; a time after it stays ("2026-09-27 18:00" -> "2026-09-30 18:00").
    const was = r.values[key]
    save(r, key, typeof was === "string" && dayOf(was) ? d + was.trim().slice(10) : d)
  })
  const chip = (r: Row) => (
    <button type="button" key={r.path} data-keyrow data-query-row={r.path}
      onPointerDown={movable ? (e) => startDrag(e, { from: "row", path: r.path, label: r.title }) : undefined}
      onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })} data-tip={r.title} data-tip-trunc
      className={cn("block w-full min-w-0 cursor-pointer truncate rounded-[4px] px-1 text-left text-[12px] leading-[18px] hover:brightness-95",
        drag?.item.from === "row" && drag.item.path === r.path && "opacity-50")}
      style={{ background: `color-mix(in srgb, ${TINT} 14%, transparent)` }}>
      {r.title}
    </button>
  )
  const agenda = [...byDay].sort(([a], [b]) => a.localeCompare(b))
  return (
    <div ref={box} className="@container" data-query-calendar={month} data-no-edit>
      <div className="mb-2 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" data-cal-month>{monthName(month)}</span>
        {month !== now.slice(0, 7) && (
          <button type="button" onClick={() => setMonth(now.slice(0, 7))}
            className="h-7 cursor-pointer rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">Today</button>
        )}
        <button type="button" aria-label="Previous month" data-cal-prev onClick={() => setMonth(prev)}
          className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <ChevronLeft className="size-4" strokeWidth={2} />
        </button>
        <button type="button" aria-label="Next month" data-cal-next onClick={() => setMonth(next)}
          className="grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <ChevronRight className="size-4" strokeWidth={2} />
        </button>
      </div>
      {/* Wide enough: the month as a grid. */}
      <div className="hidden @md:block" data-cal-grid>
        <div className="grid grid-cols-7 text-[11px] font-semibold text-muted-foreground">
          {WEEKDAYS.map((w) => <div key={w} className="px-1 pb-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-[8px] border-[0.5px] border-border">
          {days.map((d, i) => {
            const rows = byDay.get(d) ?? []
            const out = !d.startsWith(`${month}-`)
            return (
              <div key={d} data-cal-day={out ? undefined : d}
                className={cn("min-h-[76px] min-w-0 border-border p-1", i % 7 && "border-l-[0.5px]", i >= 7 && "border-t-[0.5px]",
                  out && "bg-foreground/[0.025]", hit === d && "bg-primary/10 ring-2 ring-primary ring-inset")}>
                <div className="mb-0.5 flex">
                  <span data-cal-today={d === now ? "" : undefined}
                    className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1 text-[12px] tabular-nums",
                      d === now ? "bg-primary font-semibold text-primary-foreground" : out ? "text-tertiary" : "text-muted-foreground")}>
                    {Number(d.slice(8))}
                  </span>
                </div>
                <div className="space-y-0.5">{rows.map(chip)}</div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Narrow (a phone): the days that have files. */}
      <div className="@md:hidden" data-cal-agenda>
        {!agenda.length ? <p className="text-[15px] text-muted-foreground">Nothing this month.</p> : agenda.map(([d, rows]) => (
          <div key={d} className="mb-3 last:mb-0">
            <div className={cn("mb-0.5 text-[13px] font-semibold", d === now ? "text-primary" : "text-muted-foreground")}>
              {d === now ? `Today, ${dayLabel(d)}` : dayLabel(d)}
            </div>
            <Lines rows={rows} res={{ ...res, columns: res.columns.filter((c) => c.key !== key) }} resolve={resolve} />
          </div>
        ))}
      </div>
    </div>
  )
})
