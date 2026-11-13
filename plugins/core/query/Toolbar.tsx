import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { ArrowUpDown, Code, Copy, Eye, EyeOff, PencilLine, Sigma, Ellipsis, FileSpreadsheet, GripVertical, Layers, List, ListFilter, Plus, Trash2, X } from "lucide-react"
import { choose, cn, copyText, FilterField, folderOf, menuBelow, notify, notifyError, openFile, post, SortableList, useDismiss, type MenuItem } from "@vaultite"
import { csvText, groupName, keyOf, label, markdownRows, rowsOf, sortOf, type Result } from "./query"
import { parse as parseExpr, same } from "./expr"
import { countText } from "./QueryView"
import { removeProperty, setDisplayName, setFilters, setFormula, setGroupBy, setGroupOrder, setLimit, setOrder, setSort } from "./baseedit"
import { obj, viewsOf, type BaseConfig } from "./bases"
import { condOf, countOf, exprOf, FILE_OPS, NO_VALUE, treeOf, valueOf, type Cond, type Group, type Item, type Op } from "./filters"

export type BaseEdit = { cfg: BaseConfig; at: number; res: Result | null; columns: string[]; edit: (fn: (t: string) => string) => void }

const FILE_PROPS: [string, string][] = [
  ["file", "File name"], ["path", "File path"], ["folder", "Folder"], ["file.ext", "File extension"], ["file.size", "File size"],
  ["file.ctime", "Created time"], ["file.mtime", "Modified time"], ["file.tags", "File tags"], ["file.links", "Links"],
  ["file.backlinks", "Backlinks"], ["file.embeds", "Embeds"],
]

export function named(cfg: BaseConfig, key: string): string | null {
  for (const [k, v] of Object.entries(obj(cfg.properties) ?? {})) {
    const d = obj(v)?.displayName
    if (keyOf(k) === key && typeof d === "string" && d.trim()) return d.trim()
  }
  return null
}

export function propLabel(cfg: BaseConfig, key: string): string {
  if (key === "file.self") return "File"
  return named(cfg, key) ?? FILE_PROPS.find(([k]) => k === key)?.[1] ?? label(key)
}

function allProps(cfg: BaseConfig, res: Result | null, shown: string[]): string[] {
  const formulas = Object.keys(obj(cfg.formulas) ?? {}).map((f) => `formula.${f}`)
  return [...new Set([...shown, ...(res?.keys ?? []), ...formulas, ...FILE_PROPS.map(([k]) => k)])]
}

function pickProp(title: string, keys: string[], cfg: BaseConfig, pick: (key: string) => void, current?: string) {
  choose({
    title, placeholder: "Find a property…", current,
    items: keys.map((k) => ({ id: k, label: propLabel(cfg, k), detail: k === propLabel(cfg, k) ? undefined : k })),
    other: (t) => (t.trim() && /^[^\s"'][^"']*$/.test(t.trim()) ? { id: keyOf(t.trim()), label: `Use "${t.trim()}"` } : null),
    onPick: (c) => pick(c.id),
  })
}

export function Popover({ anchor, label: name, close, children, wide }: {
  anchor: RefObject<HTMLElement | null>; label: string; close: () => void; children: ReactNode; wide?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(wide ? 520 : 360, innerWidth - 16)
    setAt({ left: Math.max(8, Math.min(r.right - width, innerWidth - 8 - width)), top: r.bottom + 6, width })
  }, [anchor, wide])
  useDismiss(true, close, { inside: "[data-base-pop], [role=menu], [data-overlay]", anchor,
    escape: (e) => !(e.target instanceof HTMLInputElement && e.target.type === "search" && e.target.value) })
  return createPortal(
    <div ref={box} role="dialog" aria-label={name} data-base-pop={name}
      className="glass-strong fixed z-40 flex flex-col overflow-y-auto overscroll-contain rounded-[10px] p-2 shadow-xl"
      style={at ? { left: at.left, top: at.top, width: at.width, maxHeight: `calc(var(--vvh, 100dvh) - ${at.top + 12}px)` } : { visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  )
}

const row = "flex min-h-8 items-center gap-1 pointer-coarse:min-h-11"
const pill = "inline-flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-[6px] bg-foreground/[0.05] px-2 text-[13px] hover:bg-foreground/[0.08] pointer-coarse:h-9 pointer-coarse:text-[15px]"
const iconBtn = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-9"
const addBtn = "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-10 pointer-coarse:text-[15px]"
const field = "h-7 min-w-0 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none focus:border-primary pointer-coarse:h-9 pointer-coarse:text-[16px]"

export function BarButton({ refTo, icon: Icon, name, count, on, open, onClick }: {
  refTo: RefObject<HTMLButtonElement | null>; icon: typeof List; name: string; count?: number; on?: boolean; open: boolean; onClick: () => void
}) {
  return (
    <button ref={refTo} type="button" aria-label={name} data-tip={open ? undefined : name} aria-haspopup="dialog" aria-expanded={open} data-base-button={name}
      onClick={onClick}
      className={cn("flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[13px] hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-9 pointer-coarse:px-2",
        count || on ? "text-primary" : "text-muted-foreground", open && "bg-foreground/[0.08] text-foreground")}>
      <Icon className="size-4" strokeWidth={2} />
      {count ? <span className="tabular-nums">{count}</span> : null}
    </button>
  )
}
export const BUTTONS = { group: Layers, sort: ArrowUpDown, filter: ListFilter, properties: List }

const TYPE_DIRS: Record<string, [string, string]> = { number: ["0 → 1", "1 → 0"], date: ["Old → new", "New → old"], datetime: ["Old → new", "New → old"] }
const dirs = (res: Result | null, key: string): [string, string] =>
  TYPE_DIRS[res?.types?.[key] ?? ""] ?? (["file.ctime", "file.mtime"].includes(key) ? TYPE_DIRS.date : ["A → Z", "Z → A"])

export function SortMenu({ e }: { e: BaseEdit }) {
  const v = viewsOf(e.cfg)[e.at] ?? {}
  const sort = sortOf(v.sort)
  const set = (next: typeof sort) => e.edit((t) => setSort(t, e.at, next))
  const props = allProps(e.cfg, e.res, e.columns)
  return (
    <div className="flex flex-col gap-0.5" data-base-sort>
      {sort.length ? (
        <SortableList ids={sort.map((s) => s.key)} onMove={(a, b) => {
          const from = sort.findIndex((s) => s.key === a), to = sort.findIndex((s) => s.key === b), next = [...sort]
          next.splice(to, 0, ...next.splice(from, 1))
          set(next)
        }}>
          {(key) => {
            const s = sort.find((x) => x.key === key)!, i = sort.indexOf(s), [up, down] = dirs(e.res, key)
            return (
              <div className={row} data-base-sort-key={key}>
                <GripVertical className="size-4 shrink-0 cursor-grab text-tertiary" strokeWidth={2} aria-hidden />
                <button type="button" className={cn(pill, "flex-1")} onClick={() => pickProp("Sort by", props.filter((k) => k === key || !sort.some((x) => x.key === k)), e.cfg,
                  (k) => set(sort.map((x, j) => (j === i ? { ...x, key: k } : x))), key)}>
                  <span className="truncate">{propLabel(e.cfg, key)}</span>
                </button>
                <button type="button" className={pill} data-base-sort-dir={s.desc ? "desc" : "asc"} onClick={(ev) => menuBelow(ev, [
                  { label: up, checked: !s.desc, run: () => set(sort.map((x, j) => (j === i ? { ...x, desc: false } : x))) },
                  { label: down, checked: s.desc, run: () => set(sort.map((x, j) => (j === i ? { ...x, desc: true } : x))) },
                ])}>{s.desc ? down : up}</button>
                <button type="button" aria-label={`Remove sort by ${propLabel(e.cfg, key)}`} data-tip="Remove" className={iconBtn}
                  onClick={() => set(sort.filter((_, j) => j !== i))}><Trash2 className="size-4" strokeWidth={2} /></button>
              </div>
            )
          }}
        </SortableList>
      ) : <p className="px-1 py-1 text-[13px] text-muted-foreground">Sorted by name. Add a sort to order it otherwise.</p>}
      <div><button type="button" className={addBtn} data-base-add-sort
        onClick={() => pickProp("Sort by", props.filter((k) => !sort.some((x) => x.key === k)), e.cfg, (k) => set([...sort, { key: k, desc: false }]))}>
        <Plus className="size-4" strokeWidth={2} />Add sort
      </button></div>
    </div>
  )
}

export const groupOf = (v: Record<string, unknown>): { key: string; desc: boolean } | null => {
  const g = obj(v.groupBy)
  return g && typeof g.property === "string" && g.property.trim()
    ? { key: keyOf(g.property), desc: String(g.direction ?? "").toUpperCase() === "DESC" } : null
}

type GroupRow = { id: string; value: unknown; name: string | null; n: number }
const NONE_ID = "\0none"
const stored = (r: { value: unknown; name: string | null }) =>
  r.name === null ? null : r.value !== null && typeof r.value !== "object" ? r.value : r.name

export function GroupMenu({ e }: { e: BaseEdit }) {
  const v = viewsOf(e.cfg)[e.at] ?? {}
  const g = groupOf(v)
  const order = g && Array.isArray(v.groupOrder) ? v.groupOrder as unknown[] : null
  const [removed, setRemoved] = useState<unknown[] | null>(null)
  const [adding, setAdding] = useState(false)
  const set = (next: typeof g) => e.edit((t) => setGroupBy(t, e.at, next))
  const props = allProps(e.cfg, e.res, e.columns)
  const board = e.res?.view === "board"
  if (!g) {
    return (
      <div className="flex flex-col gap-0.5" data-base-group-menu>
        <p className="px-1 py-1 text-[13px] text-muted-foreground">Not grouped. Group to see the results under each value of a property.</p>
        <div><button type="button" className={addBtn} data-base-add-group-by
          onClick={() => pickProp("Group by", props, e.cfg, (k) => set({ key: k, desc: false }))}>
          <Plus className="size-4" strokeWidth={2} />Group by
        </button></div>
      </div>
    )
  }
  const [up, down] = dirs(e.res, g.key)
  const known = e.res?.group === g.key ? e.res.allGroups ?? [] : []
  const nameOf = (x: unknown) => (x === null || x === undefined || x === "" ? null : groupName(x))
  const match = (a: string | null, b: string | null) => (a === null || b === null ? a === b : same(a, b))
  const shown: GroupRow[] = []
  for (const x of order ?? []) {
    const name = nameOf(x)
    if (shown.some((r) => match(r.name, name))) continue
    const k = known.find((r) => match(r.name, name))
    shown.push({ id: name ?? NONE_ID, value: x ?? null, name: k ? k.name : name, n: k?.n ?? 0 })
  }
  const hidden: GroupRow[] = known.filter((k) => !shown.some((r) => match(r.name, k.name)))
    .map((k) => ({ id: k.name ?? NONE_ID, value: stored(k), name: k.name, n: k.n }))
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, undefined, { numeric: true })))
  const write = (next: unknown[] | null) => e.edit((t) => setGroupOrder(t, e.at, next))
  const manual = (on: boolean) => {
    if (on === !!order) return
    if (on) {
      write(removed ?? known.map(stored))
      setRemoved(null)
    } else { setRemoved(order); write(null) }
  }
  const toggle = (r: GroupRow, on: boolean) => write(on ? [...shown.map((x) => x.value), r.value] : shown.filter((x) => x.id !== r.id).map((x) => x.value))
  const add = (text: string) => {
    setAdding(false)
    const t = text.trim()
    if (!t) return
    const was = [...shown, ...hidden].find((r) => match(r.name, t))
    if (was && shown.includes(was)) return
    write([...shown.map((x) => x.value), was ? was.value : t])
  }
  const anyShown = shown.length > 0
  const groupRow = (r: GroupRow, on: boolean) => (
    <label className={cn(row, "min-w-0 flex-1 cursor-pointer gap-2 rounded-[6px] px-1 text-[13px] hover:bg-foreground/[0.04] pointer-coarse:text-[15px]", !on && "text-muted-foreground")}
      data-base-group={r.name ?? ""} data-shown={on || undefined}>
      <input type="checkbox" checked={on} className="size-3.5 shrink-0 accent-[var(--primary)] pointer-coarse:size-5" onChange={() => toggle(r, !on)} />
      <span className="min-w-0 flex-1 truncate">{r.name ?? "No value"}</span>
      <span className="shrink-0 text-[12px] text-tertiary tabular-nums">{r.n}</span>
    </label>
  )
  return (
    <div className="flex flex-col gap-0.5" data-base-group-menu>
      <div className={row} data-base-group-by={g.key}>
        <span className="shrink-0 px-1 text-[13px] text-muted-foreground pointer-coarse:text-[15px]">Group by</span>
        <button type="button" className={cn(pill, "flex-1")} onClick={() => pickProp("Group by", props, e.cfg, (k) => {
          if (k !== g.key) e.edit((t) => setGroupOrder(setGroupBy(t, e.at, { ...g, key: k }), e.at, null))
        }, g.key)}>
          <span className="truncate">{propLabel(e.cfg, g.key)}</span>
        </button>
        <button type="button" className={pill} data-base-group-dir={order ? "manual" : g.desc ? "desc" : "asc"} onClick={(ev) => menuBelow(ev, [
          { label: up, checked: !order && !g.desc, run: () => { manual(false); if (g.desc) set({ ...g, desc: false }) } },
          { label: down, checked: !order && g.desc, run: () => { manual(false); if (!g.desc) set({ ...g, desc: true }) } },
          { label: "Manual", checked: !!order, run: () => manual(true) },
        ])}>{order ? "Manual" : g.desc ? down : up}</button>
        {!board && <button type="button" aria-label="Remove grouping" data-tip="Remove" className={iconBtn}
          onClick={() => set(null)}><Trash2 className="size-4" strokeWidth={2} /></button>}
      </div>
      {order && (
        <div className="mt-1 flex flex-col border-t-[0.5px] border-border pt-1" data-base-groups>
          {shown.length ? (
            <SortableList ids={shown.map((r) => r.id)} onMove={(a, b) => {
              const next = [...shown], from = next.findIndex((r) => r.id === a), to = next.findIndex((r) => r.id === b)
              next.splice(to, 0, ...next.splice(from, 1))
              write(next.map((r) => r.value))
            }}>
              {(id) => (
                <div className="flex items-center">
                  <GripVertical className="size-4 shrink-0 cursor-grab text-tertiary" strokeWidth={2} aria-hidden />
                  {groupRow(shown.find((r) => r.id === id)!, true)}
                </div>
              )}
            </SortableList>
          ) : null}
          {adding && (
            <div className={cn(row, "pl-4")}>
              <input autoFocus placeholder="Value" aria-label="New group" data-base-new-group className={cn(field, "flex-1")}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(ev.currentTarget.value) } else if (ev.key === "Escape") { ev.stopPropagation(); setAdding(false) } }}
                onBlur={(ev) => add(ev.target.value)} />
            </div>
          )}
          {hidden.map((r) => <div key={r.id} className="pl-4">{groupRow(r, false)}</div>)}
          <div className="mt-1 flex items-center justify-between border-t-[0.5px] border-border pt-1">
            <button type="button" className={addBtn} data-base-add-group onClick={() => setAdding(true)}><Plus className="size-4" strokeWidth={2} />Add group</button>
            <button type="button" className={addBtn} data-base-groups-all={anyShown ? "hide" : "show"}
              onClick={() => write(anyShown ? [] : [...shown, ...hidden].map((r) => r.value))}>
              {anyShown ? <EyeOff className="size-4" strokeWidth={2} /> : <Eye className="size-4" strokeWidth={2} />}{anyShown ? "Hide all" : "Show all"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ResultsButton({ refTo, res, open, onClick }: { refTo: RefObject<HTMLButtonElement | null>; res: Result; open: boolean; onClick: () => void }) {
  return (
    <button ref={refTo} type="button" aria-label="Results" aria-haspopup="dialog" aria-expanded={open} data-base-button="Results" data-base-count onClick={onClick}
      className={cn("flex h-7 shrink-0 cursor-pointer items-center rounded-[6px] px-1.5 text-[13px] text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-9 pointer-coarse:px-2",
        open && "bg-foreground/[0.08] text-foreground")}>
      <span className="@sm:hidden">{res.shown < res.total ? `${res.shown}/${res.total}` : res.total}</span>
      <span className="hidden @sm:inline">{countText(res)}</span>
    </button>
  )
}

export function ResultsMenu({ e, path, title }: { e: BaseEdit; path: string; title: string }) {
  const v = viewsOf(e.cfg)[e.at] ?? {}
  const limit = typeof v.limit === "number" && v.limit > 0 ? v.limit : null
  const setTo = (t: string) => {
    const n = Math.trunc(Number(t.trim()))
    const next = t.trim() && Number.isFinite(n) && n > 0 ? n : null
    if (next !== limit) e.edit((x) => setLimit(x, e.at, next))
  }
  const rows = () => (e.res ? rowsOf(e.res) : [])
  const copy = async (md: boolean) => {
    if (!e.res) return
    await copyText(md ? markdownRows(rowsOf(e.res, true)) : csvText(rows()))
    notify(md ? "Copied as a Markdown table" : "Copied as CSV")
  }
  const save = async () => {
    try {
      const name = title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").trim() || "Results"
      const f = await post<{ path: string }>("file", { path: `${folderOf(path) ? `${folderOf(path)}/` : ""}${name}.csv`, text: csvText(rows()), unique: true })
      notify(`Saved ${f.path.split("/").pop()}`, { action: { label: "Open", run: () => openFile(f.path) } })
    } catch (err) { notifyError(err, "Couldn't save the results") }
  }
  const act = "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-1 text-left text-[13px] hover:bg-foreground/[0.06] pointer-coarse:min-h-11 pointer-coarse:text-[15px]"
  const empty = !e.res?.shown
  return (
    <div className="flex flex-col gap-0.5" data-base-results>
      <label className={cn(row, "gap-2 px-1 text-[13px] pointer-coarse:text-[15px]")}>
        <span className="flex-1">Limit</span>
        <input key={limit ?? ""} type="number" inputMode="numeric" min={1} defaultValue={limit ?? ""} placeholder="None" aria-label="Limit" data-base-limit
          className={cn(field, "w-24 text-right tabular-nums")}
          onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur() }}
          onBlur={(ev) => setTo(ev.target.value)} />
      </label>
      <div className="mt-1 border-t-[0.5px] border-border pt-1">
        <button type="button" className={act} disabled={empty} data-base-copy="markdown" onClick={() => void copy(true)}><Copy className="size-4 text-muted-foreground" strokeWidth={2} />Copy as Markdown table</button>
        <button type="button" className={act} disabled={empty} data-base-copy="csv" onClick={() => void copy(false)}><Copy className="size-4 text-muted-foreground" strokeWidth={2} />Copy as CSV</button>
        <button type="button" className={act} disabled={empty} data-base-save-csv onClick={() => void save()}><FileSpreadsheet className="size-4 text-muted-foreground" strokeWidth={2} />Save as CSV</button>
      </div>
    </div>
  )
}

export function PropertiesMenu({ e }: { e: BaseEdit }) {
  const [q, setQ] = useState("")
  const [formula, setFormulaOpen] = useState<string | null>(null)
  if (formula !== null) return <FormulaForm e={e} name={formula} done={() => setFormulaOpen(null)} />
  const shown = e.columns
  const set = (keys: string[]) => e.edit((t) => setOrder(t, e.at, keys))
  const rest = allProps(e.cfg, e.res, shown).filter((k) => !shown.includes(k))
  const hit = (k: string) => !q.trim() || `${propLabel(e.cfg, k)} ${k}`.toLowerCase().includes(q.trim().toLowerCase())
  const check = (k: string, on: boolean, last = false) => (
    <label className={cn(row, "min-w-0 flex-1 cursor-pointer gap-2 rounded-[6px] px-1 text-[13px] hover:bg-foreground/[0.04] pointer-coarse:text-[15px]")} data-base-prop={k}>
      <input type="checkbox" checked={on} disabled={last} className="size-3.5 shrink-0 accent-[var(--primary)] pointer-coarse:size-5"
        onChange={() => set(on ? shown.filter((x) => x !== k) : [...shown, k])} />
      <span className="min-w-0 flex-1 truncate">{propLabel(e.cfg, k)}</span>
      {propLabel(e.cfg, k) !== k && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-tertiary">{k}</span>}
      {k.startsWith("formula.") && k.slice(8) in (obj(e.cfg.formulas) ?? {}) && (
        <button type="button" aria-label={`Edit formula ${propLabel(e.cfg, k)}`} data-tip="Edit formula" data-base-edit-formula={k.slice(8)} className={iconBtn}
          onClick={(ev) => { ev.preventDefault(); setFormulaOpen(k.slice(8)) }}><PencilLine className="size-4" strokeWidth={2} /></button>
      )}
    </label>
  )
  return (
    <div className="flex flex-col gap-1" data-base-props>
      <FilterField value={q} onChange={setQ} placeholder="Find a property" />
      {q.trim() ? shown.filter(hit).map((k) => <div key={k}>{check(k, true, shown.length === 1)}</div>) : (
        <SortableList ids={shown} onMove={(a, b) => {
          const next = [...shown], from = next.indexOf(a), to = next.indexOf(b)
          next.splice(to, 0, ...next.splice(from, 1))
          set(next)
        }}>
          {(k) => (
            <div className="flex items-center">
              <GripVertical className="size-4 shrink-0 cursor-grab text-tertiary" strokeWidth={2} aria-hidden />
              {check(k, true, shown.length === 1)}
            </div>
          )}
        </SortableList>
      )}
      {rest.some(hit) && <div className="mt-1 border-t-[0.5px] border-border pt-1">{rest.filter(hit).map((k) => <div key={k} className="pl-4">{check(k, false)}</div>)}</div>}
      <div className="mt-1 border-t-[0.5px] border-border pt-1"><button type="button" className={addBtn} data-base-add-formula onClick={() => setFormulaOpen("")}>
        <Sigma className="size-4" strokeWidth={2} />Add formula
      </button></div>
    </div>
  )
}

const keyName = (n: string) => n.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "").replace(/^(\p{N})/u, "_$1")

function FormulaForm({ e, name, done }: { e: BaseEdit; name: string; done: () => void }) {
  const formulas = obj(e.cfg.formulas) ?? {}
  const editing = name !== ""
  const [first] = useState(() => (editing ? named(e.cfg, `formula.${name}`) ?? name : ""))
  const [title, setTitle] = useState(first)
  const [src, setSrc] = useState(editing ? String(formulas[name] ?? "") : "")
  const key = editing ? name : keyName(title)
  const [tried, setTried] = useState(editing)
  let error = ""
  try { if (src.trim()) parseExpr(src) } catch (err) { error = (err as Error).message }
  const taken = !editing && key in formulas
  const ready = !!key && !!src.trim() && !error && !taken
  const save = () => {
    setTried(true)
    if (!ready) return
    const shown = title.trim() && title.trim() !== key ? title.trim() : ""
    e.edit((t) => {
      let next = setFormula(t, key, src.trim())
      if (!editing || title !== first) next = setDisplayName(next, `formula.${key}`, shown)
      if (!e.columns.includes(`formula.${key}`)) next = setOrder(next, e.at, [...e.columns, `formula.${key}`])
      return next
    })
    done()
  }
  return (
    <form className="flex flex-col gap-2 p-1" data-base-formula={key} onSubmit={(ev) => { ev.preventDefault(); save() }}>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">Name
        <input autoFocus={!editing} value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Pages left" data-base-formula-name
          className={cn(field, "font-normal text-foreground")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-muted-foreground">Formula
        <textarea autoFocus={editing} value={src} onChange={(ev) => setSrc(ev.target.value)} onBlur={() => setTried(true)} rows={3} placeholder="pages - read" spellCheck={false}
          autoCapitalize="off" autoCorrect="off" data-base-formula-src
          onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); save() } }}
          className={cn(field, "h-auto resize-none py-1.5 font-mono text-[12px] font-normal text-foreground pointer-coarse:text-[16px]")} />
      </label>
      {((tried && error) || taken) && <p className="text-[12px] text-destructive" data-base-formula-error>{taken ? `There's a formula named ${key} already` : `This formula has a mistake: ${error}.`}</p>}
      <div className="flex items-center gap-1">
        {editing && <button type="button" className={cn(addBtn, "text-destructive hover:text-destructive")} data-base-delete-formula
          onClick={() => { e.edit((t) => removeProperty(setFormula(t, key, null), `formula.${key}`)); done() }}>
          <Trash2 className="size-4" strokeWidth={2} />Delete</button>}
        <span className="flex-1" />
        <button type="button" className={addBtn} onClick={done}>Cancel</button>
        <button type="submit" disabled={!ready} data-base-formula-save
          className="inline-flex h-7 cursor-pointer items-center rounded-[6px] bg-primary px-3 text-[13px] font-medium text-primary-foreground disabled:cursor-default disabled:opacity-50 pointer-coarse:h-10 pointer-coarse:text-[15px]">
          {editing ? "Save" : "Add"}</button>
      </div>
    </form>
  )
}

const OP_LABELS: Record<Op, string> = {
  "==": "is", "!=": "is not", ">": "is greater than", "<": "is less than", ">=": "is at least", "<=": "is at most",
  contains: "contains", "!contains": "does not contain", startsWith: "starts with", endsWith: "ends with", isEmpty: "is empty", "!isEmpty": "is not empty",
  hasTag: "has tag", "!hasTag": "does not have tag", inFolder: "is in folder", "!inFolder": "is not in folder",
  hasLink: "links to", "!hasLink": "does not link to", hasProperty: "has property", "!hasProperty": "does not have property",
}
const PROP_OPS: Op[] = ["==", "!=", "contains", "!contains", "startsWith", "endsWith", "isEmpty", "!isEmpty", ">", "<", ">=", "<="]
const KINDS: { kind: Group["kind"]; label: string }[] = [
  { kind: "and", label: "All the following are true" }, { kind: "or", label: "Any of the following are true" }, { kind: "not", label: "None of the following are true" },
]
const keyOfProp = (p: string) => (p === "file" ? "file.self" : keyOf(p))
const propOfKey = (k: string) => (k === "file" ? "file.name" : k === "path" || k === "folder" ? `file.${k}` : k)

export function FilterMenu({ e }: { e: BaseEdit }) {
  const v = viewsOf(e.cfg)[e.at] ?? {}
  const [base, setBase] = useState(() => treeOf(e.cfg.filters))
  const [own, setOwn] = useState(() => treeOf(v.filters))
  const props = useMemo(() => ["file", ...allProps(e.cfg, e.res, e.columns).map(propOfKey)], [e.cfg, e.res, e.columns])
  const name = (p: string) => (p === "file" ? "File" : propLabel(e.cfg, keyOfProp(p)))
  const ctx = { props, name, cfg: e.cfg }
  return (
    <div className="flex flex-col gap-3" data-base-filters>
      <section data-base-filters-of="all">
        <h3 className="px-1 pb-1 text-[11px] font-semibold text-muted-foreground">All views</h3>
        <GroupEditor g={base} ctx={ctx} top set={(g) => { setBase(g); e.edit((t) => setFilters(t, null, valueOf(g))) }} />
      </section>
      <section data-base-filters-of="view">
        <h3 className="px-1 pb-1 text-[11px] font-semibold text-muted-foreground">This view</h3>
        <GroupEditor g={own} ctx={ctx} top set={(g) => { setOwn(g); e.edit((t) => setFilters(t, e.at, valueOf(g))) }} />
      </section>
    </div>
  )
}
export const filterCount = (cfg: BaseConfig, at: number) => countOf(treeOf(cfg.filters)) + countOf(treeOf((viewsOf(cfg)[at] ?? {}).filters))

type Ctx = { props: string[]; name: (p: string) => string; cfg: BaseConfig }

function GroupEditor({ g, set, ctx, top, remove }: { g: Group; set: (g: Group) => void; ctx: Ctx; top?: boolean; remove?: () => void }) {
  const put = (i: number, it: Item | null) => set({ ...g, items: it ? g.items.map((x, j) => (j === i ? it : x)) : g.items.filter((_, j) => j !== i) })
  const fresh = (): Cond => ({ t: "cond", prop: ctx.props.find((p) => p !== "file" && !p.startsWith("file.")) ?? "file", op: "==", value: "" })
  return (
    <div className={cn("flex flex-col gap-1", !top && "rounded-[8px] border-[0.5px] border-border p-1.5")} data-base-group={g.kind}>
      {(g.items.length > 1 || !top || g.kind !== "and") && (
        <div className={row}>
          <button type="button" className={pill} data-base-kind={g.kind} onClick={(ev) => menuBelow(ev, KINDS.map((k) => ({ label: k.label, checked: k.kind === g.kind, run: () => set({ ...g, kind: k.kind }) })))}>
            {KINDS.find((k) => k.kind === g.kind)!.label}
          </button>
          <span className="flex-1" />
          {remove && <button type="button" aria-label="Delete filter group" data-tip="Delete group" className={iconBtn} onClick={remove}><Trash2 className="size-4" strokeWidth={2} /></button>}
        </div>
      )}
      {g.items.map((it, i) => (
        <div key={i}>
          {it.t === "group" ? <GroupEditor g={it} ctx={ctx} set={(n) => put(i, n)} remove={() => put(i, null)} />
            : it.t === "cond" ? <CondRow c={it} ctx={ctx} set={(n) => put(i, n)} />
            : it.t === "raw" ? <RawRow src={it.src} set={(src) => put(i, src === null ? null : condOf(src) ?? { t: "raw", src })} />
            : (
              <div className={cn(row, "text-[13px] text-muted-foreground")} data-base-filter-other>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{JSON.stringify(it.value)}</span>
                <button type="button" aria-label="Delete filter" className={iconBtn} onClick={() => put(i, null)}><X className="size-4" strokeWidth={2} /></button>
              </div>
            )}
        </div>
      ))}
      {!g.items.length && top && <p className="px-1 text-[13px] text-muted-foreground">No filters.</p>}
      <div className="flex flex-wrap gap-0.5">
        <button type="button" className={addBtn} data-base-add-filter onClick={() => set({ ...g, items: [...g.items, fresh()] })}><Plus className="size-4" strokeWidth={2} />Add filter</button>
        <button type="button" className={addBtn} data-base-add-group onClick={() => set({ ...g, items: [...g.items, { t: "group", kind: "and", items: [fresh()] }] })}><Plus className="size-4" strokeWidth={2} />Add filter group</button>
      </div>
    </div>
  )
}

function CondRow({ c, set, ctx }: { c: Cond; set: (c: Cond | Item | null) => void; ctx: Ctx }) {
  const file = c.prop === "file"
  const ops = file ? FILE_OPS : PROP_OPS
  const change = (to: Partial<Cond>) => set({ ...c, ...to, src: undefined })
  const more = (ev: React.MouseEvent) => menuBelow(ev, [
    { label: "Edit as expression", icon: Code, run: () => set({ t: "raw", src: c.src ?? exprOf(c) }) },
    { label: "Delete", icon: Trash2, danger: true, run: () => set(null) },
  ] as MenuItem[])
  return (
    <div className="flex flex-wrap items-center gap-1" data-base-cond={c.src ?? exprOf(c)}>
      <button type="button" className={cn(pill, "max-w-[40%]")} data-base-cond-prop={c.prop}
        onClick={() => pickProp("Filter by", ctx.props.map(keyOfProp), ctx.cfg, (k) => {
          const p = k === "file.self" ? "file" : propOfKey(k)
          change({ prop: p, ...(p === "file") !== file ? { op: p === "file" ? "hasTag" : "==" } : {} })
        }, keyOfProp(c.prop))}>
        <span className="truncate">{ctx.name(c.prop)}</span>
      </button>
      <button type="button" className={pill} data-base-cond-op={c.op}
        onClick={(ev) => menuBelow(ev, ops.map((o) => ({ label: OP_LABELS[o], checked: o === c.op, run: () => change({ op: o }) })))}>
        {OP_LABELS[c.op]}
      </button>
      {!NO_VALUE.includes(c.op) && (
        <input key={c.value} defaultValue={c.value} placeholder="Value" aria-label="Value" data-base-cond-value autoFocus={!c.value && !c.src}
          className={cn(field, "min-w-[96px] flex-1")}
          onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur() }}
          onBlur={(ev) => { if (ev.target.value !== c.value) change({ value: ev.target.value }) }} />
      )}
      {NO_VALUE.includes(c.op) && <span className="flex-1" />}
      <button type="button" aria-label="Filter options" className={iconBtn} onClick={more}><Ellipsis className="size-4" strokeWidth={2} /></button>
    </div>
  )
}

function RawRow({ src, set }: { src: string; set: (src: string | null) => void }) {
  return (
    <div className={cn(row, "gap-1")} data-base-raw>
      <Code className="size-4 shrink-0 text-tertiary" strokeWidth={2} aria-hidden />
      <input key={src} defaultValue={src} aria-label="Filter expression" spellCheck={false} autoCapitalize="off" autoCorrect="off"
        className={cn(field, "flex-1 font-mono text-[12px]")}
        onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur() }}
        onBlur={(ev) => { const t = ev.target.value.trim(); if (t !== src.trim()) set(t || null) }} />
      <button type="button" aria-label="Delete filter" data-tip="Delete" className={iconBtn} onClick={() => set(null)}><Trash2 className="size-4" strokeWidth={2} /></button>
    </div>
  )
}
