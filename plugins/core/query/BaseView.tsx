// An Obsidian base (its tab, an embed, a ```base fence) with QueryView's pieces, views as tabs, Obsidian's toolbar. A change
// here is a small edit to its YAML (baseedit.ts), shown at once, written to its file (an embed's too) or its fence.
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Calculator, CalendarDays, Columns3, Ellipsis, EyeOff, LayoutGrid, List, Map as MapIcon, PencilLine, Table2, X, type LucideIcon } from "lucide-react"
import { cn, menuBelow, notify, notifyError, Panel, put, readFile, resolver, today, type BlockCtx, type FormatCtx, type MenuItem } from "@vaultite"
import { countText, ResultBody, ResultSkeleton, TINT, useQueryResult, type TableCtl } from "./QueryView"
import { parse as parseYaml } from "yaml"
import { addView, firstView, freeViewName, removeView, setColumnSize, setDisplayName, setOrder, setSort, setSummary, setViewType } from "./baseedit"
import { obj, pickView, viewNames, viewsOf, type BaseConfig } from "./bases"
import { keyOf, label, sortOf, type Result } from "./query"
import { SUMMARIES } from "./expr"
import { BarButton, BUTTONS, filterCount, FilterMenu, Popover, PropertiesMenu, SortMenu, type BaseEdit } from "./Toolbar"

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
  const { res: answer, error, groups, save, rows } = useQueryResult(url, sort)
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
  const [open, setOpen] = useState<"sort" | "filter" | "properties" | null>(null)
  const refs = { sort: useRef<HTMLButtonElement>(null), filter: useRef<HTMLButtonElement>(null), properties: useRef<HTMLButtonElement>(null) }
  const be: BaseEdit | null = cfg && at !== null ? { cfg, at, res, columns, edit } : null
  const NAMES = { sort: "Sort", filter: "Filter", properties: "Properties" } as const
  const counts = { sort: sort?.length ?? 0, filter: cfg && at !== null ? filterCount(cfg, at) : 0, properties: 0 }
  const tools = be && res && (
    <div className="flex shrink-0 items-center gap-0.5" data-base-tools>
      {(["sort", "filter", "properties"] as const).filter((k) => k !== "properties" || res.view !== "calendar").map((k) => (
        <BarButton key={k} refTo={refs[k]} icon={BUTTONS[k]} name={NAMES[k]} count={counts[k]} open={open === k} onClick={() => setOpen(open === k ? null : k)} />
      ))}
      {open && (
        <Popover anchor={refs[open]} label={NAMES[open]} close={() => setOpen(null)} wide={open === "filter"}>
          {open === "sort" ? <SortMenu e={be} /> : open === "filter" ? <FilterMenu key={current} e={be} /> : <PropertiesMenu e={be} />}
        </Popover>
      )}
    </div>
  )

  const fill = place === "page" || place === "sheet"
  // (a narrow bar keeps its room for the views and the buttons)
  const count = res && <span className="hidden shrink-0 text-[13px] text-muted-foreground tabular-nums @sm:inline" data-base-count>{countText(res)}</span>
  const tabs = views.length > 1 && (
    // (the tabs scroll sideways; their right edge fades, so one cut off there reads as more to scroll to)
    <div className="-ml-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto pr-4 pl-1 [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] [scrollbar-width:none]" role="tablist" data-base-views>
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
    : <ResultBody res={res} groups={groups} resolve={resolve} ctl={ctl} save={save} month={month} setMonth={setMonth} fill={fill} />
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
        action={<div className="flex items-center gap-1.5">{count}{tools}{more}</div>}>
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
        {count}
        {tools}
        {more}
      </div>
      <div className={cn("min-w-0 px-4", fill ? "flex min-h-0 flex-1 flex-col overflow-y-auto py-3" : "pt-1 pb-4")} data-base-body>{body}</div>
    </div>
  )
}

/** A column's display name in the base, if it has one. */
function named(cfg: BaseConfig, key: string): string | null {
  for (const [k, v] of Object.entries(obj(cfg.properties) ?? {})) {
    const d = obj(v)?.displayName
    if (keyOf(k) === key && typeof d === "string" && d.trim()) return d.trim()
  }
  return null
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
