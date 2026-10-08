// All properties' list: each key with its type's icon and count; click for its files, its menu renames or retypes it
// everywhere (with Undo) or pins it as a chip.
import { useMemo, useState, type MouseEvent } from "react"
import { ArrowDownAZ, ArrowDownWideNarrow, Binary, Braces, Calendar, CalendarClock, CircleDashed, Ellipsis, List, Pin, PinOff, Search, SquareCheck, Text, type LucideIcon } from "lucide-react"
import { choose, cn, confirmDialog, devicePref, Empty, isViewOpen, notify, notifyError, numberText, openMenu, openView, post, SidebarHeading, type MenuItem, type SidebarCtx, type Store } from "@vaultite"
import type { PropSummary, PropType } from "./types"
import { isPinned, pin, pinnable, unpin } from "./Chips"

export const ICONS: Record<PropType, LucideIcon> = {
  text: Text, number: Binary, checkbox: SquareCheck, date: Calendar, datetime: CalendarClock, list: List, object: Braces, empty: CircleDashed,
}
const NAMES: Record<PropType, string> = {
  text: "Text", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date & time", list: "List", object: "Object", empty: "Empty",
}
/** What a property can be changed to. */
const RETYPES: PropType[] = ["text", "number", "checkbox", "date", "list"]

const plural = (n: number, one: string) => `${numberText(n)} ${one}${n === 1 ? "" : "s"}`
const sortPref = devicePref<"count" | "name">("properties.sort", "count")

/** A search for the files that have the key (core search syntax: `[key]`). */
export function showFiles(key: string) {
  const q = /^[\w-]+$/.test(key) ? `[${key}]` : `["${key.replace(/"/g, '\\"')}"]`
  openView(`search/${q}`, { newTab: !isViewOpen("search") })
}

type Changed = { changed: string[]; skipped: { path: string; reason: string }[] }

async function rename(p: PropSummary) {
  choose({
    title: `Rename ${p.key}`,
    placeholder: `New name for ${p.key}`,
    items: [],
    empty: <span>Type the new name, then Enter.</span>,
    other: (typed) => {
      const to = typed.trim()
      return to && to !== p.key && !/[\n:#]/.test(to) ? { id: to, label: `Rename to ${to}` } : null
    },
    onPick: async ({ id: to }) => {
      const ok = await confirmDialog({
        title: `Rename ${p.key} to ${to}?`,
        body: `In ${plural(p.count, "file")}. Only the property's name changes; its values and everything else stay as they are.`,
        confirm: "Rename",
      })
      if (!ok) return
      try {
        const r = await post<Changed>("properties/rename", { from: p.key, to })
        const skipped = r.skipped.length ? `; ${plural(r.skipped.length, "file")} left as ${p.key} (${r.skipped[0].reason})` : ""
        notify(`Renamed ${p.key} to ${to} in ${plural(r.changed.length, "file")}${skipped}`, r.changed.length ? {
          action: { label: "Undo", run: async () => {
            try {
              const back = await post<Changed>("properties/rename", { from: to, to: p.key })
              notify(`Back to ${p.key} in ${plural(back.changed.length, "file")}`)
            } catch (e) { notifyError(e, "Couldn't undo") }
          } },
        } : {})
      } catch (e) { notifyError(e, "Couldn't rename") }
    },
  })
}

async function retype(p: PropSummary, type: PropType) {
  try {
    const r = await post<{ changed: { path: string; value: unknown }[]; skipped: { path: string; reason: string }[] }>("properties/retype", { key: p.key, type })
    const skipped = r.skipped.length ? `; ${plural(r.skipped.length, "value")} couldn't be (${r.skipped[0].reason})` : ""
    if (!r.changed.length) { notify(`Nothing to change: ${p.key} is a ${NAMES[type].toLowerCase()} already${skipped}`); return }
    notify(`Made ${p.key} a ${NAMES[type].toLowerCase()} in ${plural(r.changed.length, "file")}${skipped}`, {
      action: { label: "Undo", run: async () => {
        try { await post("properties/restore", { key: p.key, values: r.changed }) } catch (e) { notifyError(e, "Couldn't undo") }
      } },
    })
  } catch (e) { notifyError(e, "Couldn't change the type") }
}

const menuOf = (p: PropSummary): MenuItem[] => [
  { label: "Show files with it", icon: Search, run: () => showFiles(p.key) },
  { label: "Rename property…", run: () => rename(p), sep: true },
  { label: "Change type", run: () => {}, items: RETYPES.map((t) => ({ label: NAMES[t], icon: ICONS[t], checked: p.type === t && Object.keys(p.types).filter((k) => k !== "empty").length === 1, run: () => retype(p, t) })) },
  ...(isPinned(p.key)
    ? [{ label: "Remove from files' headers", icon: PinOff, sep: true, run: () => unpin(p.key) }]
    : pinnable(p) ? [{ label: "Show in files' headers", icon: Pin, sep: true, run: () => { pin(p).catch((e) => notifyError(e, "Couldn't pin it")) } }] : []),
]

function useSorted(store: Store) {
  const [by, setBy] = useState(sortPref.get)
  const list = store.properties ?? []
  const sorted = useMemo(() => {
    if (by === "count") return list
    const c = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
    return [...list].sort((a, b) => c.compare(a.key, b.key))
  }, [list, by])
  return { sorted, by, setBy: (b: "count" | "name") => { sortPref.set(b); setBy(b) } }
}

function Row({ p, big }: { p: PropSummary; big?: boolean }) {
  const Icon = ICONS[p.type]
  const mixed = Object.keys(p.types).filter((k) => k !== "empty").length > 1
  const menu = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, menuOf(p)) }
  const tip = `${NAMES[p.type]}${mixed ? ` (mixed: ${Object.entries(p.types).filter(([k]) => k !== "empty").map(([k, n]) => `${n} ${NAMES[k as PropType].toLowerCase()}`).join(", ")})` : ""}, in ${plural(p.count, "file")}`
  return (
    <div className={cn("group/row flex min-w-0 items-center gap-1.5 rounded-[5px] pr-1 pl-1.5 hover:bg-foreground/[0.04]", big ? "h-8 text-[15px] max-md:h-11 max-md:text-[17px]" : "h-7 text-[13px]")}
      data-property={p.key} onContextMenu={menu}>
      <button type="button" onClick={() => showFiles(p.key)} data-tip={tip} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left">
        <Icon className={cn("size-3.5 shrink-0", mixed ? "text-[var(--orange)]" : "text-muted-foreground")} strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">{p.key}</span>
        <span className="shrink-0 text-[12px] text-tertiary tabular-nums">{numberText(p.count)}</span>
      </button>
      <button type="button" aria-label={`${p.key}: more`} onClick={menu} data-property-menu
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-[4px] text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 max-md:opacity-100">
        <Ellipsis className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}

function SortButton({ by, setBy }: { by: "count" | "name"; setBy: (b: "count" | "name") => void }) {
  const Icon = by === "count" ? ArrowDownWideNarrow : ArrowDownAZ
  return (
    <button type="button" aria-label="Sort" data-tip={by === "count" ? "Sorted by how many files have it" : "Sorted by name"}
      onClick={() => setBy(by === "count" ? "name" : "count")}
      className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
      <Icon className="size-3.5" strokeWidth={2} />
    </button>
  )
}

/** The sidebar's panel (desktop). Nothing in the icon rail. */
export function PropertiesPanel({ store, open }: SidebarCtx) {
  const { sorted, by, setBy } = useSorted(store)
  if (!open) return null
  return (
    <div className="flex shrink-0 flex-col" data-properties-panel>
      <SidebarHeading title="All properties" open={open}><SortButton by={by} setBy={setBy} /></SidebarHeading>
      {sorted.length ? <div>{sorted.map((p) => <Row key={p.key} p={p} />)}</div>
        : <p className="h-7 pl-1.5 text-[13px] leading-7 text-tertiary">No properties yet.</p>}
    </div>
  )
}

/** The tab (view:properties): the same list, page-sized. */
export function PropertiesView({ store }: { store: Store }) {
  const { sorted, by, setBy } = useSorted(store)
  return (
    <div className="pb-10" data-properties-view>
      <div className="mb-1 flex items-center gap-2 max-md:hidden">
        <h1 className="flex-1 text-[22px] leading-[28px] font-bold">All properties</h1>
        <SortButton by={by} setBy={setBy} />
      </div>
      <p className="mb-4 text-[13px] text-muted-foreground">Every property in the vault's notes, how many files have it and its type. Click one for its files; right-click to rename it everywhere or change its type.</p>
      {sorted.length ? sorted.map((p) => <Row key={p.key} p={p} big />) : <Empty>No properties yet.</Empty>}
    </div>
  )
}
