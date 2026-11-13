import { memo, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Ellipsis, Info, Plus } from "lucide-react"
import {
  addDays, Bar, cn, dateText, dow, edgeScroller, Empty, isMac, Loading, menuBelow, menuFor, numberText, openFile, parse, PinMap, range, rawUrl, Resizer, resolver, rowFileMenu, setProperty, startDrag,
  textKey, today, typedValue, useDrag, useDropHit, useDropTarget, useKeptCount, useLive, useRowsNear, useVaultChange, weekStart, type MapPin, type MenuItem,
} from "@vaultite"
import { byKeys, dayOf, groupName, monthName, propKey, summaryText, text, type Group, type Result, type Row } from "./query"

export const TINT = "var(--indigo)"
type Resolve = ReturnType<typeof resolver>
const WIKI = /^\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/
function fmtDate(s: string) {
  const m = DAY.exec(s)!
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  const date = dateText(d, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
  return m[4] ? `${date}, ${dateText(d, { hour: "numeric", minute: "2-digit" })}` : date
}

function Value({ v, resolve, from }: { v: unknown; resolve: Resolve; from: string }): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-tertiary">–</span>
  if (Array.isArray(v)) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {v.map((x, i) => (
          <span key={i} className="rounded-[5px] bg-foreground/[0.06] px-1.5 text-[12px] leading-[20px] whitespace-nowrap"><Value v={x} resolve={resolve} from={from} /></span>
        ))}
      </span>
    )
  }
  if (typeof v === "boolean") return <span className={v ? "" : "text-muted-foreground"}>{v ? "Yes" : "No"}</span>
  if (typeof v === "number") return <span className="tabular-nums">{numberText(v)}</span>
  if (typeof v !== "string") return <span className="text-muted-foreground">{text(v)}</span>
  const link = WIKI.exec(v.trim())
  if (link) {
    const file = resolve(link[1], from)?.file
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

const editable = (key: string, v: unknown) =>
  !!propKey(key) && (v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && !WIKI.test(v.trim()) && !v.includes("\n")))

function typed(s: string, was: unknown): unknown {
  const t = s.trim()
  if (!t) return undefined
  if ((typeof was === "number" || was === null) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (typeof was === "boolean" && /^(yes|no|true|false)$/i.test(t)) return /^(yes|true)$/i.test(t)
  return t
}

export type SortKey = { key: string; desc: boolean }
type Save = (r: Row, key: string, v: unknown) => void

export function useQueryResult(url: string, sort?: SortKey[] | null) {
  const [v, setV] = useState(() => Date.now())
  useVaultChange(() => setV(Date.now()), (p) => !p.startsWith(".") || p === ".vaultite" || p === ".vaultite/plugins" || p.startsWith(".vaultite/plugins/templates") || /^\.(vaultite|obsidian)\/types\.json$/.test(p))
  const { data, error } = useLive<Result>(url, v)
  const res = data
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

  const want = sort && res && JSON.stringify(sort) !== JSON.stringify(res.sort) ? sort : null
  const groups = useMemo(() => {
    if (!res) return []
    const val = (r: Row, k: string) => (`${r.path}\0${k}` in edits ? edits[`${r.path}\0${k}`] : r.values[k])
    const first = res.groups.find((g) => g.rows.length)?.rows[0]
    const by = want && first && want.every((s) => s.key in first.values) ? byKeys<Row>(want, val, res.types, typedValue) : null
    return res.groups.map((g) => ({
      ...g,
      rows: (by ? [...g.rows].sort(by) : g.rows).map((r) => ({ ...r, values: Object.fromEntries(Object.keys(r.values).map((k) => [k, val(r, k)])) })),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, JSON.stringify(want), edits])

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
  const rows = useKeptCount(`query:${textKey(url)}`, res ? res.groups.reduce((n, g) => n + g.rows.length, 0) : undefined)
  return { res, error: error && !data ? error : res ? null : error, loading: !res && !error, groups, save, rows }
}

const widths = ["42%", "30%", "55%", "36%", "48%"]
export function ResultSkeleton({ view, rows }: { view: string; rows: number }) {
  if (!rows || (view !== "table" && view !== "list")) return <Loading />
  const each = Array.from({ length: rows }, (_, i) => i)
  if (view === "list") return (
    <div className="loading-in hairline" aria-busy>
      {each.map((i) => (
        <div key={i} className="flex min-h-11 min-w-0 flex-col justify-center py-2">
          <span className="text-[15px] leading-[20px]"><Bar w={widths[i % widths.length]} /></span>
          <span className="text-[13px]"><Bar w="30%" /></span>
        </div>
      ))}
    </div>
  )
  return (
    <table className="loading-in w-full border-collapse text-[14px]" aria-busy>
      <thead>
        <tr className="border-b-[0.5px] border-border">
          {[0, 1, 2].map((c) => <th key={c} className="py-1.5 pr-4 text-left last:pr-0"><span className="text-[13px]"><Bar w="4em" /></span></th>)}
        </tr>
      </thead>
      <tbody>
        {each.map((i) => (
          <tr key={i} className="border-b-[0.5px] border-border last:border-0">
            {[0, 1, 2].map((c) => <td key={c} className="h-9 py-1 pr-4 align-middle last:pr-0"><Bar w={c ? "50%" : widths[i % widths.length]} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export const countText = (res: Result) => `${res.total > res.shown ? `${res.shown} of ${res.total}` : res.total} ${res.total === 1 ? "file" : "files"}`
  + (res.archivedHidden ? ` · ${res.archivedHidden} archived hidden` : "")

export type TableCtl = {
  sort: SortKey[]; sizes: Record<string, number>
  menu: (c: Result["columns"][number]) => MenuItem[]
  move: (key: string, before: string | null) => void
  resize: (key: string, px: number | null) => void
  renaming: string | null
  rename: (key: string, name: string | null) => void
}

const rowMenu = (e: React.MouseEvent) => {
  const row = (e.target as Element).closest<HTMLElement>("[data-query-row]")
  if (!row || e.defaultPrevented || (e.target as Element).closest("input, textarea, [contenteditable]")) return
  menuFor(() => rowFileMenu(row.dataset.queryRow!))(e)
}

export function ResultBody({ res, groups, resolve, ctl, save, month, setMonth, fill, add }: {
  res: Result; groups: Result["groups"]; resolve: Resolve; ctl?: TableCtl; save: Save
  month: string; setMonth: (m: string) => void; fill?: boolean
  add?: (props: Record<string, unknown>) => void
}) {
  const special = res.view === "board" || res.view === "calendar" || res.view === "map"
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const fold = (g: Group) => setFolded((was) => { const next = new Set(was), k = g.name ?? "\0"; if (!next.delete(k)) next.add(k); return next })
  const shown = useMemo(() => (special || !folded.size ? groups
    : groups.map((g) => (folded.has(g.name ?? "\0") ? { ...g, rows: [], summaries: undefined, n: g.rows.length } : g))), [groups, folded, special])
  const heads = groups.length > 1 || !!groups[0]?.name
  return (
    <div className={cn("space-y-4 [contain:inline-size]", fill && res.view === "map" && "flex h-full flex-col")} data-query={res.view} data-keylist onContextMenu={rowMenu}>
      {res.notes?.length ? (
        <div className="space-y-0.5 text-[13px] text-muted-foreground" data-query-notes>
          {res.notes.map((n) => <p key={n} className="flex gap-1.5"><Info className="mt-[3px] size-3.5 shrink-0" strokeWidth={2.25} />{n}</p>)}
        </div>
      ) : null}
      {!res.total && !special ? <Empty>Nothing matches.</Empty>
        : !res.shown && !groups.length && res.view !== "calendar" && res.view !== "map" ? <Empty>Every group is hidden: the Group menu shows them.</Empty>
        : res.view === "board" ? <Board groups={groups} res={res} resolve={resolve} save={save} add={add} />
        : res.view === "calendar" ? <Calendar groups={groups} res={res} resolve={resolve} month={month} setMonth={setMonth} save={save} />
        : res.view === "map" ? <MapResult groups={groups} res={res} resolve={resolve} fill={fill} />
        : res.view === "table" ? <Table groups={shown} res={res} resolve={resolve} ctl={ctl} save={save} fold={heads ? fold : undefined} />
        : shown.map((g, i) => (
          <div key={g.name ?? `-${i}`}>
            {heads && <GroupHead g={g} fold={fold} />}
            {g.rows.length ? res.view === "cards" ? <Cards rows={g.rows} res={res} resolve={resolve} /> : <Lines rows={g.rows} res={res} resolve={resolve} /> : null}
          </div>
        ))}
    </div>
  )
}

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

type Shown = Group & { n?: number }
const GroupHead = ({ g, fold }: { g: Shown; fold?: (g: Group) => void }) => {
  const folded = g.n !== undefined
  return (
    <button type="button" aria-expanded={!folded} disabled={!fold} onClick={(e) => { e.stopPropagation(); fold?.(g) }}
      className={cn("-ml-1 mb-1 flex max-w-full items-center gap-1 rounded-[6px] py-0.5 pr-1.5 pl-1 text-left text-[13px] font-semibold text-muted-foreground",
        fold && "cursor-pointer hover:bg-foreground/[0.05] hover:text-foreground")} data-query-group={g.name ?? ""} data-folded={folded || undefined}>
      <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", !folded && "rotate-90")} strokeWidth={2.25} aria-hidden />
      <span className="truncate">{g.name ?? "No value"}</span><span className="ml-0.5 font-normal tabular-nums">{g.n ?? g.rows.length}</span>
    </button>
  )
}

// Obsidian's narrowest column.
const MIN_WIDTH = 40

type Cursor = { path: string; key: string; i: number }

const Table = memo(function Table({ groups, res, resolve, ctl, save, fold }: {
  groups: Shown[]; res: Result; resolve: Resolve; ctl?: TableCtl
  save: (r: Row, key: string, v: unknown) => void; fold?: (g: Group) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const dropped = useRef(false)
  const seed = useRef<string | null>(null)
  const { open, cancel } = opener
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const [at, setAt] = useState<Cursor | null>(null)
  const row = !at || !flat.length ? -1 : (() => { const j = flat.findIndex((r) => r.path === at.path); return j >= 0 ? j : Math.min(at.i, flat.length - 1) })()
  const col = at ? Math.max(0, res.columns.findIndex((c) => c.key === at.key)) : 0
  const total = flat.length
  const [near, mark] = useRowsNear(total)
  const drawn = Math.max(near, row + 1)
  const upTo = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.rows.length, 0))
  const id = `query-cols:${useId()}`
  const table = useRef<HTMLTableElement>(null)
  const lifted = useDrag((d) => d?.item)
  const hit = useDropHit<string>(id)
  const [sideways] = useState(() => edgeScroller("x"))
  useDropTarget<string>(id, (item, x, y, el) => {
    if (item.from !== "column" || item.column?.table !== id) return null
    const wide = table.current?.closest<HTMLElement>("[data-query-scroll]")
    if (wide) sideways.over(wide, x, y)
    if (!el || !table.current?.contains(el)) return null
    const ths = [...table.current.querySelectorAll<HTMLElement>("thead th[data-query-col]")]
    const before = ths.find((th) => { const r = th.getBoundingClientRect(); return x < r.left + r.width / 2 })?.dataset.queryCol ?? ""
    const keys = res.columns.map((c) => c.key), from = keys.indexOf(item.column.key), to = before ? keys.indexOf(before) : keys.length
    return to === from || to === from + 1 ? null : before
  }, (item, before) => ctl?.move(item.column!.key, before || null), { end: sideways.stop })
  const [live, setLive] = useState<{ key: string; px: number } | null>(null)
  const from = useRef({ x: 0, w: 0 })
  const width = (k: string) => (live?.key === k ? live.px : ctl?.sizes[k])
  const sized = res.columns.some((c) => width(c.key))
  const box = (k: string, last: boolean) => { const w = width(k); return w ? { width: Math.max(w - (last ? 0 : 16), 8) } : undefined }
  const gid = useId()
  const cellId = (i: number, ci: number) => `${gid}c${i}-${ci}`
  const go = (i: number, ci: number) => {
    if (!flat.length) return
    const r = Math.max(0, Math.min(flat.length - 1, i)), c = Math.max(0, Math.min(res.columns.length - 1, ci))
    setAt({ path: flat[r].path, key: res.columns[c].key, i: r })
  }
  const along = (i: number, ci: number, by: number) => {
    const n = res.columns.length, to = Math.max(0, Math.min(flat.length * n - 1, i * n + ci + by))
    go(Math.floor(to / n), to % n)
  }
  const edit = (r: Row, key: string, first: string | null = null) => {
    cancel(); dropped.current = false; seed.current = first
    setAt({ path: r.path, key, i: Math.max(0, flat.indexOf(r)) })
    setEditing(`${r.path}\0${key}`)
  }
  useEffect(() => {
    if (row >= 0 && document.activeElement === table.current) document.getElementById(cellId(row, col))?.scrollIntoView({ block: "nearest", inline: "nearest" })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, col])
  const keys = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing || !flat.length || e.altKey) return
    const mod = isMac ? e.metaKey : e.ctrlKey, i = Math.max(0, row), last = flat.length - 1, end = res.columns.length - 1
    const to = ({ ArrowUp: [mod ? 0 : i - 1, col], ArrowDown: [mod ? last : i + 1, col], ArrowLeft: [i, mod ? 0 : col - 1],
      ArrowRight: [i, mod ? end : col + 1], Home: [mod ? 0 : i, 0], End: [mod ? last : i, end] } as Record<string, number[]>)[e.key]
    if (to && !e.shiftKey) { e.preventDefault(); go(to[0], to[1]); return }
    const r = flat[i], key = res.columns[col].key, can = editable(key, r.values[key])
    if ((e.key === "Enter" || e.key === "F2") && !e.shiftKey) {
      e.preventDefault()
      if (can && !mod) edit(r, key)
      else if (e.key === "Enter") openFile(r.path, { newTab: mod })
      return
    }
    if (!can || e.ctrlKey || e.metaKey) return
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault()
      if (r.values[key] !== null && r.values[key] !== undefined && r.values[key] !== "") save(r, key, undefined)
    } else if ([...e.key].length === 1) { e.preventDefault(); edit(r, key, e.key) }
  }
  const sortOf = (k: string) => ctl?.sort.find((s) => s.key === k)
  return (
    <div className="-mx-4 overflow-x-auto px-4" data-query-scroll data-no-edit>
      <table ref={table} role="grid" tabIndex={0} aria-activedescendant={row >= 0 && !editing ? cellId(row, col) : undefined}
        onKeyDown={keys} onFocus={(e) => { if (e.target === e.currentTarget && !at) go(0, 0) }}
        className={cn("group/grid min-w-max border-collapse text-[14px] outline-none", !sized && "w-full")}>
        <thead>
            <tr className="border-b-[0.5px] border-border">
              {res.columns.map((c, ci) => {
                const last = ci === res.columns.length - 1, s = sortOf(c.key), w = width(c.key)
                return (
                  <th key={c.key} data-query-col={c.key} style={w ? { width: w, minWidth: w, maxWidth: w } : undefined}
                    onPointerDown={ctl ? (e) => startDrag(e, { from: "column", column: { table: id, key: c.key }, label: c.label }, { touch: true }) : undefined}
                    onContextMenu={ctl ? menuFor(() => ctl.menu(c)) : undefined}
                    className={cn("relative py-1.5 pr-4 text-left font-normal last:pr-0",
                      lifted?.column?.table === id && lifted.column.key === c.key && "opacity-50",
                      hit === c.key && "shadow-[inset_2px_0_0_var(--primary)]", hit === "" && last && "shadow-[inset_-2px_0_0_var(--primary)]")}>
                    {ctl?.renaming === c.key ? (
                      <input autoFocus defaultValue={c.label} aria-label={`Name of ${c.label}`} data-query-rename={c.key}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur()
                          if (e.key === "Escape") { e.stopPropagation(); ctl.rename(c.key, null) }
                        }}
                        onBlur={(e) => ctl.rename(c.key, e.target.value === c.label ? null : e.target.value)}
                        className="h-6 w-full min-w-[80px] rounded-[5px] border-[0.5px] border-border bg-background px-1 text-[13px] font-semibold outline-none focus:border-primary" />
                    ) : (
                      <div className={cn(w && "truncate")} style={box(c.key, last)}>
                        <button type="button" onClick={ctl ? (e) => menuBelow(e, ctl.menu(c)) : undefined} data-query-sort={c.key} aria-haspopup={ctl ? "menu" : undefined}
                          className="inline-flex max-w-full cursor-pointer items-center gap-1 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                          <span className="truncate">{c.label}</span>
                          {s && (s.desc ? <ArrowDown className="size-3 shrink-0" strokeWidth={2.5} /> : <ArrowUp className="size-3 shrink-0" strokeWidth={2.5} />)}
                        </button>
                      </div>
                    )}
                    {ctl && (
                      <span data-no-drag className="absolute inset-y-0 -right-[3px] z-10 w-[6px] pointer-coarse:hidden" data-query-resize={c.key}>
                        <Resizer label={`Resize ${c.label}`} className="absolute inset-0" onReset={() => ctl.resize(c.key, null)} resetTip="fit its contents"
                          onStart={(x) => { from.current = { x, w: (table.current?.querySelector<HTMLElement>(`th[data-query-col="${CSS.escape(c.key)}"]`)?.getBoundingClientRect().width ?? 120) } }}
                          onDrag={(x) => setLive({ key: c.key, px: Math.max(MIN_WIDTH, Math.round(from.current.w + x - from.current.x)) })}
                          onEnd={() => setLive((l) => { if (l) ctl.resize(l.key, l.px); return null })} onCancel={() => setLive(null)} />
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
        {groups.map((g, gi) => (upTo[gi] < drawn || (!g.rows.length && upTo[gi] <= drawn)) && (
        <tbody key={g.name ?? `-${gi}`}>
          {(groups.length > 1 || g.name) && (
            <tr><td colSpan={res.columns.length} className={cn("pb-0.5", gi ? "pt-4" : "pt-2")}><GroupHead g={g} fold={fold} /></td></tr>
          )}
          {g.rows.slice(0, drawn - upTo[gi]).map((r, ri) => (
            <tr key={r.path} data-query-row={r.path} onClick={(e) => { if (!editing) open(r, e, !!(e.target as HTMLElement).closest("[data-editable]")) }}
              className="cursor-pointer border-b-[0.5px] border-border hover:bg-foreground/[0.03] [tbody:last-child>&:last-child]:border-0">
              {res.columns.map((c, ci) => {
                const v = r.values[c.key]
                const id = `${r.path}\0${c.key}`
                const can = editable(c.key, v)
                const last = ci === res.columns.length - 1, w = box(c.key, last), i = upTo[gi] + ri, cur = i === row && ci === col
                const shown = editing === id ? (
                  <input autoFocus defaultValue={seed.current ?? (v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v))}
                    aria-label={`${c.label} of ${r.title}`} onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
                    className={cn("h-7 w-full rounded-[5px] border-[0.5px] border-border bg-background px-1.5 text-[14px] outline-none focus:border-primary", !w && "min-w-[120px]")}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === "Escape") { dropped.current = true; go(i, ci) }
                      else if (e.key === "Enter") go(e.shiftKey ? i - 1 : i + 1, ci)
                      else if (e.key === "Tab") along(i, ci, e.shiftKey ? -1 : 1)
                      else return
                      e.preventDefault(); e.stopPropagation()
                      table.current?.focus({ preventScroll: true })
                    }}
                    onBlur={(e) => {
                      setEditing(null)
                      seed.current = null
                      if (dropped.current) return
                      const to = typed(e.target.value, v)
                      if (to !== (v ?? undefined)) save(r, c.key, to)
                    }} />
                ) : c.key === "file" ? <span className="font-medium">{r.title}</span> : <Value v={v} resolve={resolve} from={r.path} />
                return (
                  <td key={c.key} id={cellId(i, ci)} role="gridcell" aria-selected={cur || undefined}
                    className={cn("relative h-9 py-1 pr-4 align-middle last:pr-0", !w && "whitespace-nowrap",
                      cur && "before:pointer-events-none before:absolute before:inset-y-0.5 before:-left-1.5 before:right-2.5 before:rounded-[6px] before:ring-primary last:before:-right-1.5 group-focus-visible/grid:before:ring-2")}
                    data-editable={can ? "" : undefined} data-tip={can && editing !== id ? "Double-click to edit" : undefined}
                    onMouseDown={() => { if (!cur) setAt({ path: r.path, key: c.key, i }) }}
                    onDoubleClick={can ? (e) => { e.stopPropagation(); edit(r, c.key) } : undefined}>
                    {w ? <div className="truncate" style={w}>{shown}</div> : shown}
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

function cardPicture(v: string, from: string, resolve: Resolve): { color: string } | { src: string } | null {
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return { color: v }
  if (/^https?:\/\/\S+$/.test(v)) return { src: v }
  const name = /^!?\[\[([^\]|#]+)/.exec(v)?.[1] ?? v
  const file = resolve(name.trim(), from)?.file ?? null
  return file && /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic|heif)$/i.test(file) ? { src: rawUrl(file) } : null
}

const Cards = memo(function Cards({ rows, res, resolve }: { rows: Row[]; res: Result; resolve: Resolve }) {
  const [drawn, mark] = useRowsNear(rows.length)
  const look = res.cards ?? {}
  const ratio = look.ratio ?? 0.5
  const pictured = rows.some((r) => r.image)
  return (
    <div className={cn("grid gap-2", !look.size && "grid-cols-1 sm:grid-cols-2")} data-query-cards
      style={look.size ? { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${look.size}px), 1fr))` } : undefined}>
      {rows.slice(0, drawn).map((r) => {
        const pic = r.image ? cardPicture(r.image, r.path, resolve) : null
        return (
          <button type="button" key={r.path} data-keyrow data-query-row={r.path} onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}
            className="min-w-0 cursor-pointer overflow-hidden rounded-[10px] border-[0.5px] border-border bg-background/50 text-left hover:bg-foreground/[0.03]">
            {pictured && (
              <div className="w-full bg-foreground/[0.04]" style={{ aspectRatio: 1 / ratio, ...(pic && "color" in pic ? { background: pic.color } : {}) }} data-query-card-image>
                {pic && "src" in pic && <img src={pic.src} alt="" loading="lazy" draggable={false}
                  className={cn("size-full", look.fit === "contain" ? "object-contain" : "object-cover")} />}
              </div>
            )}
            <div className="p-3">
              <div className="truncate text-[15px] font-medium">{r.title}</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                {others(res).map((c) => (
                  <div key={c.key} className="flex min-w-0 gap-2">
                    <span className="shrink-0 text-muted-foreground">{c.label}</span>
                    <span className="min-w-0 flex-1 truncate text-right"><Value v={r.values[c.key]} resolve={resolve} from={r.path} /></span>
                  </div>
                ))}
              </div>
            </div>
          </button>
        )
      })}
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
                  <span key={c.key} className="min-w-0 truncate">{i > 0 && "· "}<Value v={r.values[c.key]} resolve={resolve} from={r.path} /></span>
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

function moveItems(cols: Col[], at: string, move: (c: Col) => void): MenuItem[] {
  return cols.map((c) => ({ label: `Move to ${c.name ?? "No value"}`, checked: c.key === at, run: () => { if (c.key !== at) move(c) } }))
}

type Col = { key: string; name: string | null; value: unknown; rows: Row[] }

const Board = memo(function Board({ groups, res, resolve, save, add }: {
  groups: { name: string | null; value?: unknown; rows: Row[] }[]; res: Result; resolve: Resolve; save: (r: Row, key: string, v: unknown) => void
  add?: (props: Record<string, unknown>) => void
}) {
  const key = res.group!
  const id = `query-board:${useId()}`
  const box = useRef<HTMLDivElement>(null)
  const lifted = useDrag((d) => d?.item)
  const hit = useDropHit<string>(id)
  const cols = useMemo(() => {
    const out: Col[] = groups.map((g) => ({ key: (g.name ?? "").toLowerCase(), name: g.name, value: g.value ?? g.name, rows: [] }))
    if (!out.some((c) => !c.key)) out.push({ key: "", name: null, value: null, rows: [] })
    for (const r of groups.flatMap((g) => g.rows)) {
      const name = groupName(r.values[key]), k = name.toLowerCase()
      let col = out.find((c) => c.key === k)
      if (!col) out.splice(out.findIndex((c) => !c.key), 0, col = { key: k, name, value: r.values[key], rows: [] })
      col.rows.push(r)
    }
    for (const c of out) c.rows.sort(byKeys<Row>(res.sort ?? [], (x, k) => x.values[k], res.types, typedValue))
    return out
  }, [groups, key, res.sort])
  const colOf = (path: string) => cols.find((c) => c.rows.some((r) => r.path === path))
  const movable = (r: Row) => !!propKey(key) && !Array.isArray(r.values[key])
  const move = (r: Row, c: Col) => save(r, key, c.value === null || c.value === "" ? undefined : c.value)
  const [edge] = useState(() => edgeScroller("x")), [down] = useState(() => edgeScroller())
  useDropTarget<string>(id, (item, x, y, el) => {
    if (item.from !== "row" || !item.path || !el || !box.current?.contains(el)) { edge.stop(); down.stop(); return null }
    edge.near(box.current, x)
    if (box.current.parentElement) down.over(box.current.parentElement, x, y)
    const near = (c: Element) => { const r = c.getBoundingClientRect(); return Math.max(r.left - x, 0, x - r.right) }
    const col = el.closest<HTMLElement>("[data-board-col]") ?? [...box.current.querySelectorAll<HTMLElement>("[data-board-col]")].sort((a, b) => near(a) - near(b))[0]
    const to = col?.dataset.boardCol
    return to !== undefined && colOf(item.path)?.key !== to ? to : null
  }, (item, to) => {
    const r = cols.flatMap((c) => c.rows).find((x) => x.path === item.path), c = cols.find((x) => x.key === to)
    if (r && c) move(r, c)
  }, { end: () => { edge.stop(); down.stop() } })
  const fields = others(res).filter((c) => c.key !== key)
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
              <span className="truncate">{c.name ?? "No value"}</span><span className="flex-1 font-normal tabular-nums">{c.rows.length}</span>
              {add && propKey(key) && (
                <button type="button" aria-label={`New in ${c.name ?? "No value"}`} data-tip="New" data-board-add={c.key}
                  onClick={() => add(c.value === null || c.value === "" ? {} : { [propKey(key)!]: c.value })}
                  className="-my-1 grid size-6 shrink-0 cursor-pointer place-items-center self-center rounded-[5px] hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-9">
                  <Plus className="size-3.5" strokeWidth={2.25} />
                </button>
              )}
            </div>
            <div className="flex min-h-10 flex-col gap-1.5">
              {c.rows.slice(0, drawn).map((r) => {
                const can = movable(r)
                const menu = () => [
                  { label: "Open", run: () => openFile(r.path) },
                  ...(can ? moveItems(cols, c.key, (to) => move(r, to)).map((m, i) => (i ? m : { ...m, sep: true })) : []),
                  ...rowFileMenu(r.path).map((m, i) => (i ? m : { ...m, sep: true })),
                ]
                return (
                  <div key={r.path} role="button" tabIndex={0} data-keyrow data-query-row={r.path} onContextMenu={menuFor(menu)}
                    onPointerDown={can ? (e) => startDrag(e, { from: "row", path: r.path, label: r.title }, { touch: true }) : undefined}
                    onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })}
                    onKeyDown={(e) => { if (e.key === "Enter") openFile(r.path) }}
                    className={cn("group relative min-w-0 cursor-pointer rounded-[8px] bg-card p-2.5 text-left shadow-sm ring-[0.5px] ring-border hover:bg-background",
                      lifted?.from === "row" && lifted.path === r.path && "opacity-50")}>
                    <div className="truncate pr-6 text-[14px] font-medium">{r.title}</div>
                    {fields.some((f) => text(r.values[f.key])) && (
                      <div className="mt-1 space-y-0.5 text-[12px]">
                        {fields.filter((f) => text(r.values[f.key])).map((f) => (
                          <div key={f.key} className="flex min-w-0 gap-2">
                            <span className="shrink-0 text-muted-foreground">{f.label}</span>
                            <span className="min-w-0 flex-1 truncate text-right"><Value v={r.values[f.key]} resolve={resolve} from={r.path} /></span>
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

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const dayLabel = (d: string) => dateText(parse(d), { weekday: "short", day: "numeric", month: "short" })

const DAY_ROWS = 3

const Calendar = memo(function Calendar({ groups, res, resolve, month, setMonth, save }: {
  groups: { name: string | null; rows: Row[] }[]; res: Result; resolve: Resolve; month: string; setMonth: (m: string) => void
  save: (r: Row, key: string, v: unknown) => void
}) {
  const key = res.date!
  const id = `query-calendar:${useId()}`
  const box = useRef<HTMLDivElement>(null)
  const lifted = useDrag((d) => d?.item)
  const hit = useDropHit<string>(id)
  const now = today()
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
    const was = r.values[key]
    save(r, key, typeof was === "string" && dayOf(was) ? d + was.trim().slice(10) : d)
  })
  const chip = (r: Row) => (
    <button type="button" key={r.path} data-keyrow data-query-row={r.path}
      onPointerDown={movable ? (e) => startDrag(e, { from: "row", path: r.path, label: r.title }) : undefined}
      onClick={(e) => openFile(r.path, { newTab: e.metaKey || e.ctrlKey })} data-tip={r.title} data-tip-trunc
      className={cn("block w-full min-w-0 cursor-pointer truncate rounded-[4px] px-1 text-left text-[12px] leading-[18px] hover:brightness-95",
        lifted?.from === "row" && lifted.path === r.path && "opacity-50")}
      style={{ background: `color-mix(in srgb, ${TINT} 14%, transparent)` }}>
      {r.title}
    </button>
  )
  const agenda = [...byDay].sort(([a], [b]) => a.localeCompare(b))
  const [open, setOpen] = useState<string | null>(null)
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
                <div className="space-y-0.5">
                  {(open === d ? rows : rows.slice(0, DAY_ROWS)).map(chip)}
                  {rows.length > DAY_ROWS && open !== d && (
                    <button type="button" data-cal-more onClick={() => setOpen(d)}
                      className="block w-full cursor-pointer rounded-[4px] px-1 text-left text-[12px] leading-[18px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                      {rows.length - DAY_ROWS} more
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
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
