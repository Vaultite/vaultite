// An Obsidian base drawn (its tab, an embed, a ```base fence) with QueryView's pieces, views as tabs. Its … menu edits
// the file as small edits keeping unknown keys (baseedit.ts), so Obsidian still reads it.
import { useMemo, useState } from "react"
import { CalendarDays, Columns3, Ellipsis, LayoutGrid, List, Map as MapIcon, Table2, type LucideIcon } from "lucide-react"
import { cn, Loading, menuBelow, notify, notifyError, Panel, resolver, type BlockCtx, type FormatCtx, type MenuItem } from "@vaultite"
import { countText, ResultBody, TINT, useMonth, useQueryResult } from "./QueryView"
import { parse as parseYaml } from "yaml"
import { addView, firstView, freeViewName, removeView, setViewType } from "./baseedit"
import { pickView, viewNames, type BaseConfig } from "./bases"

const ICONS: Record<string, LucideIcon> = { table: Table2, cards: LayoutGrid, list: List, map: MapIcon, kanban: Columns3, board: Columns3, calendar: CalendarDays }
const iconOf = (type: string) => ICONS[type.toLowerCase()] ?? Table2
/** The layouts a view can have, as Obsidian names them (calendar is this app's). */
const LAYOUTS: { type: string; label: string }[] = [
  { type: "table", label: "Table" }, { type: "cards", label: "Cards" }, { type: "list", label: "List" },
  { type: "kanban", label: "Board" }, { type: "map", label: "Map" }, { type: "calendar", label: "Calendar" },
]

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
  /** Its own tab, editing: the menu that changes the file. */
  onChange?: (text: string) => void
}

export function BaseView({ store, text, path, host, view, place, onChange }: Props) {
  const [picked, setShow] = useState<string | null>(view ?? null)
  const [month, setMonth] = useMonth(null)
  // The views, from the text as it is now (a view just added has its tab at once); the server's when it doesn't parse.
  const cfg = useMemo<BaseConfig | null>(() => {
    try { const c = parseYaml(text || "{}"); return c && typeof c === "object" && !Array.isArray(c) ? c : {} } catch { return null }
  }, [text])
  // (a view picked here that's gone, renamed or removed in the source: the first)
  const show = picked && cfg && !view && !pickView(cfg, picked).found ? null : picked
  const local = cfg ? viewNames(cfg) : null
  const at = cfg ? pickView(cfg, show).index : null
  // (a calendar's month, as its arrows have it)
  const calendar = local !== null && at !== null && local[at]?.type.toLowerCase() === "calendar"
  // A .base is asked for by its path (the server reads the file: a short address, whatever its size; an edit here is
  // saved at once and heard back); a fence by its text.
  const url = useMemo(() => {
    const at = `&this=${encodeURIComponent(host ?? path)}${show ? `&view=${encodeURIComponent(show)}` : ""}${calendar ? `&month=${month}` : ""}`
    if (place !== "fence") return `query?base=${encodeURIComponent(path)}${at}`
    return `query?q=${encodeURIComponent(JSON.stringify({ base: text, ...(show ? { show } : {}), ...(calendar ? { month } : {}) }))}&self=${encodeURIComponent(path)}${at}`
  }, [place, path, host, text, show, month, calendar])
  const { res, error, groups, sort, setSort, save } = useQueryResult(url)
  const resolve = resolver(store)
  const views = local ?? res?.views ?? []
  const current = at ?? res?.current ?? 0

  const edit = (fn: (t: string) => string, done?: string) => {
    if (!onChange) return
    try {
      const next = fn(text)
      if (next === text) return
      const before = text
      onChange(next)
      if (done) notify(done, { action: { label: "Undo", run: () => onChange(before) } })
    } catch (e) { notifyError(e, "Couldn't change the base") }
  }
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

  const fill = place === "page" || place === "sheet"
  const count = res && <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums" data-base-count>{countText(res)}</span>
  const tabs = views.length > 1 && (
    // (the tabs scroll sideways; their right edge fades, so one cut off there reads as more to scroll to)
    <div className="-ml-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto pr-4 pl-1 [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)] [scrollbar-width:none]" role="tablist" data-base-views>
      {views.map((v, i) => {
        const Icon = iconOf(v.type)
        return (
          <button key={`${i}:${v.name}`} type="button" role="tab" aria-selected={i === current} data-base-view={v.name}
            onClick={() => setShow(i === 0 && !view ? null : v.name)}
            className={cn("flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] pointer-coarse:h-9",
              i === current ? "bg-foreground/[0.07] font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground")}>
            <Icon className="size-3.5" strokeWidth={2.25} />{v.name}
          </button>
        )
      })}
    </div>
  )
  const body = error ? <p className="text-[15px] text-muted-foreground" data-base-error>Base: {error.replace(/^Error: /, "")}</p>
    : !res ? <Loading />
    : <ResultBody res={res} groups={groups} resolve={resolve} sort={sort} setSort={setSort} save={save} month={month} setMonth={setMonth} fill={fill} />

  // A fence in a note: a card like a database view's, titled by its view.
  if (place === "fence") {
    return (
      <Panel title={views[current]?.name ?? "Base"} icon={iconOf(views[current]?.type ?? "table")} tint={TINT} className="min-w-0" action={count}>
        {tabs && <div className="-mt-1 mb-3 flex">{tabs}</div>}
        {body}
      </Panel>
    )
  }
  return (
    <div className={cn("flex min-w-0 flex-col", fill && "absolute inset-0")} data-base={path}>
      <div className={cn("flex min-h-10 shrink-0 items-center gap-2 px-3", fill ? "border-b-[0.5px] border-border" : "pt-0.5")} data-base-bar>
        {tabs || <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium" data-base-view={views[0]?.name}>
          {views[0] && (() => { const Icon = iconOf(views[0].type); return <><Icon className="size-3.5 shrink-0" strokeWidth={2.25} /><span className="truncate">{views[0].name}</span></> })()}
        </div>}
        {count}
        {onChange && res && (
          <button type="button" aria-label="View options" data-tip="View options" data-base-menu onClick={menu}
            className="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-9">
            <Ellipsis className="size-4" strokeWidth={2} />
          </button>
        )}
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
  return <BaseView store={ctx.store} text={ctx.text} path={ctx.path} host={ctx.host} place="fence" />
}
