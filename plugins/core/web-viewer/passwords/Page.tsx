import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react"
import { ArrowDownWideNarrow, ChevronDown, Ellipsis, Folder, KeyRound, Lock, Plus, ShieldCheck, Trash2, Bot, type LucideIcon } from "lucide-react"
import { Button, detailPath, Empty, FilterField, menuBelow, openDetail, plural, useScopedState, useSelectable, type MenuItem } from "@vaultite"
import { AgentLogins, useUses } from "./Agents"
import { Beside } from "./Entry"
import { Groups } from "./Groups"
import { HealthReport } from "./Health"
import { EntryRow } from "./List"
import { LockScreen, Setup } from "./Lock"
import { LIST, listMenu, onSearchKey } from "./menus"
import { AGENTS, ALL, HEALTH } from "./places"
import { ISSUES, reportOf } from "./report"
import { isSort, sorted, SORTS, type Sort } from "./sort"
import { chooseFile, deleting, fileName, forgetFile, hasPasswords, lockNow, NEW_DETAIL, selected, showsBeside, state, usePasswordsLive } from "./store"
import { binsOf, groupPath, matches, treeOf, within } from "./tree"
import type { Group, Row, Status } from "./types"

const BESIDE_PX = 940

export function PasswordsView() {
  if (!hasPasswords()) return <div className="px-4 pt-6"><Empty>Your passwords open in Vaultite's desktop app.</Empty></div>
  return <Passwords />
}

function Passwords() {
  const { status, groups, entries } = usePasswordsLive()
  if (status === undefined) return null
  if (!status) return <Setup />
  if (status.locked || status.error || !entries) return <div className="h-full overflow-y-auto"><LockScreen status={status} /></div>
  return <Unlocked status={status} groups={groups} entries={entries} />
}

function useBeside(page: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = page.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => { if (e.contentRect.width) showsBeside.set(e.contentRect.width >= BESIDE_PX) })
    ro.observe(el)
    return () => { ro.disconnect(); showsBeside.set(false) }
  }, [page])
  return showsBeside.use()
}

function useShown(entries: Row[], groups: Group[], where: string, q: string) {
  const health = state.use((s) => s.health), kept = deleting.use(entries, (e) => e.id)
  const [by, setBy] = useScopedState<string>("web-viewer:password-sort", "title", "device"), sort: Sort = isSort(by) ? by : "title"
  const there = useMemo(() => {
    const bins = binsOf(groups), inside = where ? within(groups, where) : null
    return (kept.list ?? []).filter((e) => (inside ? inside.has(e.group) : !bins.has(e.group)))
  }, [kept.list, groups, where])
  const shown = useMemo(() => sorted(there.filter((e) => matches(e, q)), sort, health), [there, q, sort, health])
  return { shown, leaving: kept.leaving, sort, setSort: (s: Sort) => setBy(s) }
}

function useReport(entries: Row[], bins: ReadonlySet<string>, q: string) {
  const { health, leaks } = state.use(), [now] = useState(Date.now)
  const whole = useMemo(() => reportOf(entries.filter((e) => !bins.has(e.group)), health, leaks, now), [entries, bins, health, leaks, now])
  return useMemo(() => {
    if (!q.trim()) return { whole, found: whole }
    const issues = { ...whole.issues }
    for (const k of ISSUES) issues[k] = whole.issues[k].filter((f) => matches(f.row, q))
    return { whole, found: { ...whole, issues, left: whole.left.filter((e) => matches(e, q)) } }
  }, [whole, q])
}

function Unlocked({ status, groups, entries }: { status: NonNullable<Status>; groups: Group[]; entries: Row[] }) {
  const page = useRef<HTMLDivElement>(null), wide = useBeside(page)
  const [q, setQ] = useState(""), [picked, go] = useState(ALL)
  const uses = useUses()
  const { root, tree, bin, bins } = useMemo(() => treeOf(groups, entries), [groups, entries])
  const special = picked === HEALTH || (picked === AGENTS && !!uses)
  const where = special || groups.some((g) => g.id === picked) ? picked : ALL
  const { shown, leaving, sort, setSort } = useShown(entries, groups, special ? ALL : where, q)
  const { whole, found } = useReport(entries, bins, q)
  useSelectable(LIST, { noun: ["password", "passwords"], menu: listMenu })
  const binned = entries.filter((e) => bins.has(e.group)).length, counts = { all: entries.length - binned, bin: binned, issues: whole.total }
  const places: Place[] = [
    { id: ALL, label: "All passwords", icon: KeyRound }, { id: HEALTH, label: "Health", icon: ShieldCheck }, ...(uses ? [{ id: AGENTS, label: "Agents' logins", icon: Bot }] : []),
    ...tree.map((b, i) => ({ id: b.group.id, label: groupPath(new Map(groups.map((g) => [g.id, g])), b.group.id) || "Group", icon: Folder, sep: !i })),
    ...(bin ? [{ id: bin.id, label: "Recycle bin", icon: Trash2, sep: true }] : []),
  ]
  const newIn = special || bins.has(where) || !where ? root?.id ?? "" : where
  return (
    <div ref={page} className="@container flex h-full min-h-0" data-passwords={fileName(status.file)}>
      <Groups where={where} go={go} tree={tree} root={root} bin={bin} counts={counts} agents={!!uses} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2" onKeyDown={(e) => onSearchKey(e, where === AGENTS || where === HEALTH ? undefined : shown[0])}>
          <PlaceChip places={places} where={where} go={go} />
          <FilterField value={q} onChange={setQ} placeholder={where === AGENTS ? "Search agents' logins" : "Search passwords"} />
          <Button look="primary" size="small" onClick={() => openDetail(detailPath(NEW_DETAIL, newIn))} data-passwords-new><Plus className="size-4" strokeWidth={2.25} />New</Button>
          <IconButton icon={Lock} label="Lock" onClick={lockNow} data="lock" />
          <IconButton icon={Ellipsis} label="More" onClick={(e) => menuBelow(e, more())} data="more" />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className={`@container min-w-0 overflow-y-auto overscroll-contain px-2 pb-10 [scrollbar-gutter:stable] ${wide ? "w-[360px] shrink-0 border-r-[0.5px] border-border" : "flex-1"}`} data-passwords-list>
            {where === AGENTS ? <div className="px-2"><AgentLogins uses={uses ?? []} entries={entries} q={q} /></div>
              : where === HEALTH ? <HealthReport report={found} />
              : <Entries rows={shown} groups={groups} where={where} q={q} leaving={leaving} sort={sort} setSort={setSort} />}
          </div>
          {wide && <Side entries={entries} />}
        </div>
      </div>
    </div>
  )
}

const more = (): MenuItem[] => [
  { label: "Use another file…", icon: Folder, run: () => chooseFile() },
  { label: "Stop using it", icon: Trash2, danger: true, sep: true, run: () => forgetFile() },
]

type Place = { id: string; label: string; icon: LucideIcon; sep?: boolean }
function PlaceChip({ places, where, go }: { places: Place[]; where: string; go: (id: string) => void }) {
  return (
    <Button look="secondary" size="small" className="max-w-[40%] @2xl:hidden" data-passwords-group-chip
      onClick={(e) => menuBelow(e, places.map((p) => ({ ...p, checked: where === p.id, run: () => go(p.id) })))}>
      <span className="truncate">{places.find((p) => p.id === where)?.label ?? "All passwords"}</span><ChevronDown className="size-3.5 shrink-0" strokeWidth={2.25} />
    </Button>
  )
}

function Entries({ rows, groups, where, q, leaving, sort, setSort }: { rows: Row[]; groups: Group[]; where: string; q: string; leaving: (id: string) => "" | undefined; sort: Sort; setSort: (s: Sort) => void }) {
  const health = state.use((s) => s.health), byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])
  const pick = (e: MouseEvent) => menuBelow(e, Object.entries(SORTS).map(([k, label]) => ({ label, checked: k === sort, run: () => { if (isSort(k)) setSort(k) } })))
  if (!rows.length) return <div className="px-2 pt-6"><Empty>{q.trim() ? `No password matches "${q.trim()}".` : where === ALL ? "No passwords yet." : byId.get(where)?.bin ? "The recycle bin is empty." : "No passwords in this group."}</Empty></div>
  return (
    <>
      <div className="flex h-8 items-center justify-between pr-1 pl-2 text-[13px] text-tertiary md:text-[12px]">
        <span className="tabular-nums">{plural(rows.length, "password")}</span>
        <button type="button" onClick={pick} aria-label={`Sorted by: ${SORTS[sort]}`} data-passwords-sort={sort}
          className="flex h-7 cursor-pointer items-center gap-1 rounded-control px-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
          <ArrowDownWideNarrow className="size-3.5" strokeWidth={2} />{SORTS[sort]}
        </button>
      </div>
      <div className="flex flex-col" data-keylist data-select-list={LIST}>
        {rows.map((e) => <EntryRow key={e.id} e={e} meta={[e.username, e.group !== where && groupPath(byId, e.group)].filter(Boolean).join(" · ")} bits={health.get(e.id)?.bits} leaving={leaving(e.id)} />)}
      </div>
    </>
  )
}

function Side({ entries }: { entries: Row[] }) {
  const id = selected.use(), row = entries.find((e) => e.id === id), gone = deleting.use(row ? [row] : [], (e) => e.id)
  return (
    <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain" data-passwords-side>
      {row && gone.list?.length ? <Beside row={row} /> : (
        <div className="grid h-full place-items-center pb-16 text-tertiary"><KeyRound className="size-10" strokeWidth={1.25} aria-label="No password picked" /></div>
      )}
    </div>
  )
}

function IconButton({ icon: Icon, label, onClick, data }: { icon: LucideIcon; label: string; onClick: (e: MouseEvent) => void; data: string }) {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={onClick} data-passwords-action={data}
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-7">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}
