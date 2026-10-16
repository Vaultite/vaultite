// A base's toolbar menus, as Obsidian's: Sort, Filter and Properties, each a popover that changes the view in the
// base's YAML (baseedit.ts) as it's used, the results following.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { ArrowUpDown, Code, Ellipsis, GripVertical, List, ListFilter, Plus, Trash2, X } from "lucide-react"
import { choose, cn, FilterField, menuBelow, SortableList, useDismiss, type MenuItem } from "@vaultite"
import { keyOf, label, sortOf, type Result } from "./query"
import { setFilters, setOrder, setSort } from "./baseedit"
import { viewsOf, type BaseConfig } from "./bases"
import { condOf, countOf, exprOf, FILE_OPS, NO_VALUE, treeOf, valueOf, type Cond, type Group, type Item, type Op } from "./filters"

/** What a menu changes: the base as it is now (`cfg`), its view `at`, the answer shown, and `edit` (a change to its text). */
export type BaseEdit = { cfg: BaseConfig; at: number; res: Result | null; columns: string[]; edit: (fn: (t: string) => string) => void }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** The file's own properties, as Obsidian lists them (engine keys: query.ts keyOf). */
const FILE_PROPS: [string, string][] = [
  ["file", "File name"], ["path", "File path"], ["folder", "Folder"], ["file.ext", "File extension"], ["file.size", "File size"],
  ["file.ctime", "Created time"], ["file.mtime", "Modified time"], ["file.tags", "File tags"], ["file.links", "Links"],
  ["file.backlinks", "Backlinks"], ["file.embeds", "Embeds"],
]

/** A property's name in the menus: the base's display name, else its own. */
export function propLabel(cfg: BaseConfig, key: string): string {
  if (key === "file.self") return "File"
  for (const [k, v] of Object.entries(obj(cfg.properties) ?? {})) {
    const d = obj(v)?.displayName
    if (keyOf(k) === key && typeof d === "string" && d.trim()) return d.trim()
  }
  return FILE_PROPS.find(([k]) => k === key)?.[1] ?? label(key)
}

/** Every property a view could show: the matches' frontmatter keys, the file's, the base's formulas (engine keys). */
function allProps(cfg: BaseConfig, res: Result | null, shown: string[]): string[] {
  const formulas = Object.keys(obj(cfg.formulas) ?? {}).map((f) => `formula.${f}`)
  return [...new Set([...shown, ...(res?.keys ?? []), ...formulas, ...FILE_PROPS.map(([k]) => k)])]
}

/** Pick a property (the palette: a long list, found by typing); `other`: a name nobody has yet. */
function pickProp(title: string, keys: string[], cfg: BaseConfig, pick: (key: string) => void, current?: string) {
  choose({
    title, placeholder: "Find a property…", current,
    items: keys.map((k) => ({ id: k, label: propLabel(cfg, k), detail: k === propLabel(cfg, k) ? undefined : k })),
    other: (t) => (t.trim() && /^[^\s"'][^"']*$/.test(t.trim()) ? { id: keyOf(t.trim()), label: `Use "${t.trim()}"` } : null),
    onPick: (c) => pick(c.id),
  })
}

// ---------- the popover

/** A box under its button (as wide as a phone allows), closed by Escape or a press outside it. */
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
  // (the palette a property is picked in, and menus opened from inside, are part of it; Escape in a field closes it too,
  // but a search with text in it is cleared first)
  useDismiss(true, close, { inside: "[data-base-pop], [role=menu], [data-overlay]", anchor,
    escape: (e) => !document.querySelector("[data-overlay] [role=dialog]") && !(e.target instanceof HTMLInputElement && e.target.type === "search" && e.target.value) })
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

/** A toolbar button: its icon, and how many it holds when any (2 sorts). */
export function BarButton({ refTo, icon: Icon, name, count, open, onClick }: {
  refTo: RefObject<HTMLButtonElement | null>; icon: typeof List; name: string; count?: number; open: boolean; onClick: () => void
}) {
  return (
    <button ref={refTo} type="button" aria-label={name} data-tip={open ? undefined : name} aria-haspopup="dialog" aria-expanded={open} data-base-button={name}
      onClick={onClick}
      className={cn("flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[13px] hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:h-9 pointer-coarse:px-2",
        count ? "text-primary" : "text-muted-foreground", open && "bg-foreground/[0.08] text-foreground")}>
      <Icon className="size-4" strokeWidth={2} />
      {count ? <span className="tabular-nums">{count}</span> : null}
    </button>
  )
}
export const BUTTONS = { sort: ArrowUpDown, filter: ListFilter, properties: List }

// ---------- Sort

const TYPE_DIRS: Record<string, [string, string]> = { number: ["0 → 1", "1 → 0"], date: ["Old → new", "New → old"], datetime: ["Old → new", "New → old"] }
/** A sort's two directions in words, by the property's type (Obsidian's: A → Z, 0 → 1, old → new). */
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

// ---------- Properties

export function PropertiesMenu({ e }: { e: BaseEdit }) {
  const [q, setQ] = useState("")
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
    </div>
  )
}

// ---------- Filter

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
/** A filter's property as the engine names it (for its label): `status`, `file`, `file.ext`, `formula.x`. */
const keyOfProp = (p: string) => (p === "file" ? "file.self" : keyOf(p))
/** An engine key as a filter writes it: `file.name`, `status`, `formula.x`. */
const propOfKey = (k: string) => (k === "file" ? "file.name" : k === "path" || k === "folder" ? `file.${k}` : k)

export function FilterMenu({ e }: { e: BaseEdit }) {
  const v = viewsOf(e.cfg)[e.at] ?? {}
  // (the groups as edited here: a condition still missing its value stays while it isn't written)
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

/** A condition: its property, operator and value (what's typed is written when it's left, or on Enter). */
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

/** An expression the builder can't show: its text, written when it's left (nothing: the filter goes). */
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
