// An Obsidian base (its tab, an embed, a ```base fence) with QueryView's pieces, views as tabs, Obsidian's toolbar. A change
// here is a small edit to its YAML (baseedit.ts), shown at once, written to its file (an embed's too) or its fence.
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Calculator, CalendarDays, Columns3, Ellipsis, EyeOff, LayoutGrid, List, Map as MapIcon, PencilLine, Plus, Search, Table2, X, type LucideIcon } from "lucide-react"
import { cn, freeName, getStore, menuBelow, newNoteFolder, notify, notifyError, openNew, Panel, post, put, readFile, reload, resolver, today, type BlockCtx, type FormatCtx, type MenuItem } from "@vaultite"
import { ResultBody, ResultSkeleton, TINT, useQueryResult, type TableCtl } from "./QueryView"
import { parse as parseYaml, stringify } from "yaml"
import { addView, firstView, freeViewName, removeView, setColumnSize, setDisplayName, setOrder, setSort, setSummary, setViewType } from "./baseedit"
import { obj, pickView, viewNames, viewsOf, type BaseConfig } from "./bases"
import { keyOf, label, sortOf, text as shownText, type Result } from "./query"
import { SUMMARIES } from "./expr"
import { newItem } from "./newitem"
import { BarButton, BUTTONS, filterCount, FilterMenu, groupOf, GroupMenu, named, Popover, PropertiesMenu, ResultsButton, ResultsMenu, SortMenu, type BaseEdit } from "./Toolbar"

const ICONS: Record<string, LucideIcon> = { table: Table2, cards: LayoutGrid, list: List, map: MapIcon, kanban: Columns3, board: Columns3, calendar: CalendarDays }
const iconOf = (type: string) => ICONS[type.toLowerCase()] ?? Table2
/** The layouts a view can have, as Obsidian names them (calendar is this app's). */
const LAYOUTS: { type: string; label: string }[] = [
  { type: "table", label: "Table" }, { type: "cards", label: "Cards" }, { type: "list", label: "List" },
  { type: "kanban", label: "Board" }, { type: "map", label: "Map" }, { type: "calendar", label: "Calendar" },
]
/** The summaries a column's menu offers (Obsidian's; Count is this app's). */
const SUMMARY_NAMES = SUMMARIES.filter((s) => s !== "Count")

type Props = {
  store: BlockCtx["store"]; text: string
  /** The file it's in: the .base itself, or the note with the fence (left out of what it lists). */
  path: string
  /** The file `this` is (embedded: the note embedding it). */
  host?: string
  /** The view to start on (an embed's #View). */
  view?: string
  /** Where it's drawn: its tab (fills its box), embedded, or a fence in a note. */
  place: "page" | "sheet" | "embed" | "fence"
  /** Its own tab, editing: the file's text changed (saved by its editor). */
  onChange?: (text: string) => void
  /** A fence: its text in the note changed (absent: the note can't be, and changes here are only shown). */
  setText?: (text: string) => void
}

/** A .base's text changed on disk as a small edit of what's there now (an embed, or its tab while it's read). */
async function writeFile(path: string, fn: (t: string) => string) {
  const f = await readFile(path)
  const text = fn(f.text)
  if (text !== f.text) await put("file", { path, text, base: f.text })
}

export function BaseView({ store, text, path, host, view, place, onChange, setText }: Props) {
  const [picked, setShow] = useState<string | null>(view ?? null)
  // (a calendar's month: its arrows', else the view's `month`, else this one; the arrows don't change the file)
  const [moved, setMonth] = useState<string | null>(null)
  // A change made here, shown until the text it was written to comes back (or for good, where it can't be written).
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [text])
  const cur = draft ?? text
  // (an Undo, or a width let go, changes the text as it is by then)
  const latest = useRef(cur)
  latest.current = cur
  // Once changed here, the answer is asked for by its text: the file may not be saved yet.
  const [byText, setByText] = useState(place === "fence")
  // The views, from the text as it is now (a view just added has its tab at once); the server's when it doesn't parse.
  const cfg = useMemo<BaseConfig | null>(() => {
    try { const c = parseYaml(cur || "{}", { uniqueKeys: false }); return c && typeof c === "object" && !Array.isArray(c) ? c : {} } catch { return null }
  }, [cur])
  // (a view picked here that's gone, renamed or removed in the source: the first)
  const show = picked && cfg && !view && !pickView(cfg, picked).found ? null : picked
  const local = cfg ? viewNames(cfg) : null
  const at = cfg ? pickView(cfg, show).index : null
  const vcfg = cfg && at !== null ? viewsOf(cfg)[at] : null
  // (a calendar's month, as its arrows have it)
  const calendar = local !== null && at !== null && local[at]?.type.toLowerCase() === "calendar"
  const own = calendar ? vcfg?.month : null
  const month = moved ?? (typeof own === "string" && /^\d{4}-\d{2}$/.test(own) ? own : today().slice(0, 7))
  // A .base is asked for by its path (the server reads the file: a short address, whatever its size); a fence, or one
  // changed here, by its text.
  const url = useMemo(() => {
    const at = `&this=${encodeURIComponent(host ?? path)}${show ? `&view=${encodeURIComponent(show)}` : ""}${calendar ? `&month=${month}` : ""}`
    if (!byText) return `query?base=${encodeURIComponent(path)}${at}`
    return `query?q=${encodeURIComponent(JSON.stringify({ base: cur, ...(show ? { show } : {}), ...(calendar ? { month } : {}) }))}&self=${encodeURIComponent(path)}${at}`
  }, [byText, path, host, cur, show, month, calendar])
  const sort = useMemo(() => (vcfg ? sortOf(vcfg.sort) : null), [vcfg])
  const { res: answer, error, groups: all, save, rows } = useQueryResult(url, sort)
  // Search (null: closed): the rows whose name or shown values have every word typed; the file is left as it is.
  const [q, setQ] = useState<string | null>(null)
  const resolve = resolver(store)
  const views = local ?? answer?.views ?? []
  const current = at ?? answer?.current ?? 0
  // The columns as the view now says (an order or a name just changed), while its answer is on its way.
  const res = useMemo<Result | null>(() => {
    if (!answer || !cfg || !vcfg) return answer
    const have = new Map(answer.columns.map((c) => [c.key, c]))
    const first = answer.groups.find((g) => g.rows.length)?.rows[0]
    const order = Array.isArray(vcfg.order) ? [...new Set(vcfg.order.map((k) => keyOf(String(k))))] : []
    const keys = order.length && order.every((k) => have.has(k) || (first && k in first.values)) ? order : answer.columns.map((c) => c.key)
    const columns = keys.map((k) => ({ key: k, label: named(cfg, k) ?? label(k) }))
    return JSON.stringify(columns) === JSON.stringify(answer.columns) ? answer : { ...answer, columns }
  }, [answer, cfg, vcfg])

  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean)
  const groups = useMemo(() => {
    if (!words.length || !res) return all
    const hit = (r: Result["groups"][number]["rows"][number]) => {
      const hay = [r.title, ...res.columns.map((c) => shownText(r.values[c.key]))].join(" ").toLowerCase()
      return words.every((w) => hay.includes(w))
    }
    // (a board keeps its columns, a calendar its days; elsewhere a group nothing's left in goes, and its summaries
    // (worked out over every row) with it)
    const keep = res.view === "board" || res.view === "calendar"
    return all.map((g) => ({ ...g, rows: g.rows.filter(hit), summaries: undefined })).filter((g) => keep || g.rows.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, res, q])
  const searched = words.length && res ? { ...res, summaries: undefined, shown: groups.reduce((n, g) => n + g.rows.length, 0) } : res

  // Where a change goes: the tab's editor, the fence in its note, else the file itself; a fence that can't be
  // changed keeps it here only.
  const lasting = !!onChange || place !== "fence" || !!setText
  const edit = (fn: (t: string) => string, done?: string) => {
    const was = latest.current
    let next: string
    try { next = fn(was) } catch (e) { notifyError(e, "Couldn't change the base"); return }
    if (next === was) return
    const before = was
    latest.current = next
    setDraft(next)
    setByText(true)
    if (onChange) onChange(next)
    else if (place === "fence") setText?.(next)
    else void writeFile(path, fn).catch((e) => notifyError(e, "Couldn't change the base"))
    if (done) notify(done, { action: { label: "Undo", run: () => edit(() => before) } })
  }

  const [renaming, setRenaming] = useState<string | null>(null)
  // (the view's columns: its order as just changed, else the ones drawn)
  const columns = useMemo(() => {
    const order = Array.isArray(vcfg?.order) ? vcfg.order.map((k) => keyOf(String(k))) : []
    return order.length ? [...new Set(order)] : res?.columns.map((c) => c.key) ?? []
  }, [vcfg, res])
  const ctl = useMemo<TableCtl | undefined>(() => {
    if (!cfg || at === null || !res) return undefined
    const sizes: Record<string, number> = {}
    for (const [k, n] of Object.entries(obj(vcfg?.columnSize) ?? {})) if (typeof n === "number" && n > 0) sizes[keyOf(k)] = n
    const sums = obj(vcfg?.summaries) ?? {}
    const sumOf = (k: string) => Object.entries(sums).find(([x]) => keyOf(x) === k)?.[1]
    const custom = Object.keys(obj(cfg.summaries) ?? {})
    const by = sort ?? []
    return {
      sort: by, sizes, renaming,
      menu: (c) => {
        const s = by.find((x) => x.key === c.key), first = by[0]?.key === c.key, now = sumOf(c.key)
        return [
          { label: "Sort ascending", icon: ArrowUp, checked: first && !by[0].desc, run: () => edit((t) => setSort(t, at, [{ key: c.key, desc: false }])) },
          { label: "Sort descending", icon: ArrowDown, checked: first && by[0].desc, run: () => edit((t) => setSort(t, at, [{ key: c.key, desc: true }])) },
          ...(s ? [{ label: "Remove sort", icon: X, run: () => edit((t) => setSort(t, at, by.filter((x) => x.key !== c.key))) }] : []),
          { label: "Rename", icon: PencilLine, sep: true, run: () => setRenaming(c.key) },
          { label: "Summarize", icon: Calculator, run: () => {}, items: [
            ...(now ? [{ label: "None", run: () => edit((t) => setSummary(t, at, c.key, null)) }] : []),
            ...[...SUMMARY_NAMES, ...custom].map((n, i) => ({ label: n, checked: String(now ?? "").toLowerCase() === n.toLowerCase(), sep: i === SUMMARY_NAMES.length && i > 0,
              run: () => edit((t) => setSummary(t, at, c.key, n)) })),
          ] },
          { label: "Hide property", icon: EyeOff, sep: true, disabled: columns.length < 2,
            run: () => edit((t) => setOrder(t, at, columns.filter((k) => k !== c.key)), `Hid ${c.label}`) },
        ] as MenuItem[]
      },
      move: (key, before) => {
        const rest = columns.filter((k) => k !== key), i = before ? rest.indexOf(before) : rest.length
        rest.splice(i < 0 ? rest.length : i, 0, key)
        edit((t) => setOrder(t, at, rest))
      },
      resize: (key, px) => edit((t) => setColumnSize(t, at, key, px)),
      rename: (key, name) => { setRenaming(null); if (name !== null) edit((t) => setDisplayName(t, key, name)) },
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, at, vcfg, res, sort, renaming, columns, cur])

  const menu = (e: React.MouseEvent): void => {
    const names = views.map((v) => v.name), type = views[current]?.type.toLowerCase() ?? "table"
    const items: MenuItem[] = [
      { label: "Layout", icon: iconOf(type), run: () => {}, items: LAYOUTS.map((l) => ({
        label: l.label, icon: iconOf(l.type), checked: l.type === type || (l.type === "kanban" && type === "board"),
        run: () => edit((t) => setViewType(t, current, l.type)),
      })) },
      { label: "New view", icon: Table2, run: () => { const name = freeViewName(names, "Table"); edit((t) => addView(t, "table", name, current)); setShow(name) } },
      ...(current > 0 ? [{ label: "Show first when embedded", run: () => edit((t) => firstView(t, current)) }] : []),
      ...(views.length > 1 ? [{ label: "Delete view", danger: true, sep: true, run: () => { edit((t) => removeView(t, current), `Deleted ${names[current]}`); setShow(null) } }] : []),
    ]
    menuBelow(e, items)
  }

  // The toolbar's menus: one open at a time, under its button.
  type Menu = "results" | "group" | "sort" | "filter" | "properties"
  const [open, setOpen] = useState<Menu | null>(null)
  const refs = { results: useRef<HTMLButtonElement>(null), group: useRef<HTMLButtonElement>(null), sort: useRef<HTMLButtonElement>(null),
    filter: useRef<HTMLButtonElement>(null), properties: useRef<HTMLButtonElement>(null) }
  const be: BaseEdit | null = cfg && at !== null ? { cfg, at, res, columns, edit } : null
  const NAMES = { results: "Results", group: "Group", sort: "Sort", filter: "Filter", properties: "Properties" } as const
  const counts = { group: 0, sort: sort?.length ?? 0, filter: cfg && at !== null ? filterCount(cfg, at) : 0, properties: 0 }
  // (a calendar's days and a map's places are its own layout: neither groups, a calendar has no columns)
  const bar = (["group", "sort", "filter", "properties"] as const).filter((k) => !(k === "group" && (res?.view === "calendar" || res?.view === "map")) && !(k === "properties" && res?.view === "calendar"))
  const searchRef = useRef<HTMLButtonElement>(null)
  const tools = be && res && (
    <div className="flex shrink-0 items-center gap-0.5" data-base-tools>
      {q !== null && (
        <label className="relative mr-0.5 flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" strokeWidth={2.25} />
          <input type="search" autoFocus value={q} placeholder="Search" aria-label="Search this view" spellCheck={false} autoComplete="off" data-base-search
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (q) setQ(""); else { setQ(null); searchRef.current?.focus() } } }}
            className="h-7 w-32 rounded-[6px] border-[0.5px] border-border bg-background pr-2 pl-7 text-[13px] outline-none focus:border-primary @md:w-44 pointer-coarse:h-9 pointer-coarse:text-[16px] [&::-webkit-search-cancel-button]:hidden" />
        </label>
      )}
      <ResultsButton refTo={refs.results} res={searched ?? res} open={open === "results"} onClick={() => setOpen(open === "results" ? null : "results")} />
      {bar.map((k) => (
        <BarButton key={k} refTo={refs[k]} icon={BUTTONS[k]} name={NAMES[k]} count={counts[k]} on={k === "group" && !!vcfg && !!groupOf(vcfg)} open={open === k} onClick={() => setOpen(open === k ? null : k)} />
      ))}
      <BarButton refTo={searchRef} icon={Search} name="Search" on={!!q} open={q !== null} onClick={() => setQ(q === null ? "" : null)} />
      <button type="button" aria-label="New" data-tip="New file in this view" data-base-new onClick={() => void newFile()}
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-9 pointer-coarse:px-2">
        <Plus className="size-4" strokeWidth={2} /><span className="hidden @md:inline">New</span>
      </button>
      {open && (
        <Popover anchor={refs[open]} label={NAMES[open]} close={() => setOpen(null)} wide={open === "filter"}>
          {open === "results" ? <ResultsMenu e={be} path={path} title={views[current]?.name ?? "Results"} />
            : open === "group" ? <GroupMenu e={be} />
            : open === "sort" ? <SortMenu e={be} /> : open === "filter" ? <FilterMenu key={current} e={be} /> : <PropertiesMenu e={be} />}
        </Popover>
      )}
    </div>
  )

  // New: a file the view will list (its folder, properties and tags from the filters), opened beside it to fill in.
  const newFile = async () => {
    if (!cfg || at === null) return
    try {
      const { folder: asked, props } = newItem(cfg, at)
      const s = getStore(), folder = asked ?? newNoteFolder(s, host ?? path)
      const name = s ? freeName(s.files, folder, "Untitled") : "Untitled"
      const fm = Object.keys(props).length ? `---\n${stringify(props)}---\n` : ""
      const f = await post<{ path: string }>("file", { path: `${folder ? `${folder}/` : ""}${name}.md`, text: fm, unique: true })
      await reload()
      openNew(f.path, { newTab: true })
    } catch (e) { notifyError(e, "Couldn't make a new file") }
  }

  const fill = place === "page" || place === "sheet"
  const tabs = views.length > 1 && (
    // (the tabs scroll sideways; their right edge fades, so one cut off there reads as more to scroll to)
    <div className="-ml-1 flex min-w-0 flex-1 gap-0.5 edge-fade-x overflow-x-auto pr-4 pl-1 [scrollbar-width:none]" role="tablist" data-base-views>
      {views.map((v, i) => {
        const Icon = iconOf(v.type)
        return (
          <button key={`${i}:${v.name}`} type="button" role="tab" aria-selected={i === current} data-base-view={v.name}
            onClick={() => { setShow(i === 0 && !view ? null : v.name); setOpen(null) }}
            className={cn("flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] pointer-coarse:h-9",
              i === current ? "bg-foreground/[0.07] font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
            <Icon className="size-3.5" strokeWidth={2.25} />{v.name}
          </button>
        )
      })}
    </div>
  )
  const body = error ? <p className="text-[15px] text-muted-foreground" data-base-error>Base: {error.replace(/^Error: /, "")}</p>
    : !res ? <ResultSkeleton view={views[current]?.type.toLowerCase() ?? "table"} rows={rows} />
    : words.length && !groups.some((g) => g.rows.length) ? <p className="py-2 text-[15px] text-muted-foreground" data-base-no-match>Nothing matches "{q!.trim()}".</p>
    : <ResultBody res={searched!} groups={groups} resolve={resolve} ctl={ctl} save={save} month={month} setMonth={setMonth} fill={fill} />
  const more = lasting && place !== "embed" && res && (
    <button type="button" aria-label="View options" data-tip="View options" data-base-menu onClick={menu}
      className="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-9">
      <Ellipsis className="size-4" strokeWidth={2} />
    </button>
  )

  // A fence in a note: a card like a database view's, titled by its view.
  if (place === "fence") {
    return (
      <Panel title={views[current]?.name ?? "Base"} icon={iconOf(views[current]?.type ?? "table")} tint={TINT} className="@container min-w-0"
        action={<div className="flex items-center gap-1.5">{tools}{more}</div>}>
        {tabs && <div className="-mt-1 mb-3 flex">{tabs}</div>}
        {body}
      </Panel>
    )
  }
  return (
    <div className={cn("flex min-w-0 flex-col", fill && "absolute inset-0")} data-base={path}>
      <div className={cn("@container flex min-h-10 shrink-0 items-center gap-2 px-3", fill ? "border-b-[0.5px] border-border" : "pt-0.5")} data-base-bar>
        {tabs || <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium" data-base-view={views[0]?.name}>
          {views[0] && (() => { const Icon = iconOf(views[0].type); return <><Icon className="size-3.5 shrink-0" strokeWidth={2.25} /><span className="truncate">{views[0].name}</span></> })()}
        </div>}
        {tools}
        {more}
      </div>
      <div className={cn("min-w-0 px-4", fill ? "flex min-h-0 flex-1 flex-col overflow-y-auto py-3" : "pt-1 pb-4")} data-base-body>{body}</div>
    </div>
  )
}

/** A .base file, as the app draws files a plugin owns (FormatCtx). */
export function BaseFile(ctx: FormatCtx) {
  return <BaseView store={ctx.store} text={ctx.text} path={ctx.path} host={ctx.host} view={ctx.subpath}
    place={ctx.place} onChange={ctx.editable && ctx.place !== "embed" ? ctx.onChange : undefined} />
}

/** A ```base fence: its text is a base; `this` is the note (the one embedding it, when it's embedded). */
export function BaseFence(ctx: BlockCtx) {
  return <BaseView store={ctx.store} text={ctx.text} path={ctx.path} host={ctx.host} place="fence" setText={ctx.setText} />
}
