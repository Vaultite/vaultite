import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { ChevronRight, ListFilter, Search, X } from "lucide-react"
import { allowPlugin, byCategory, hostOf, isEnabled, names, offWithAi, pluginById, setSwitch, standInOf, switchedOn, tileTint, usePlugins, type Plugin } from "@/core/plugins"
import { confirmDialog } from "@/components/ConfirmDialog"
import { disclosed } from "../../../core/pluginmeta.ts"
import { official } from "../../../core/updates.ts"
import { capitalize, cn, plural } from "@/lib/utils"
import { usePrefs } from "@/core/prefs"
import type { Store } from "@/core/data"
import { showInTree } from "@/components/FileTree"
import { openDetail } from "@/core/nav"
import { FilterField, IconTile, Panel, Section, Segmented, SheetHead, Switch } from "@/components/kit"
import { Button } from "@/components/Button"
import { categoriesIn, DirectoryMatches, GET_NONE, getCategory, getSources, passesGet, PluginBrowse, SHOWS, sortOf, sortsOf, type GetFilters, type GetShow, type Listed } from "@/components/PluginBrowse"
import { Certified } from "@/components/Certified"
import { GroupRow, groupIcon, groupMembers, groupWords } from "@/components/PluginGroup"
import { categoryOf, groupOf } from "../../../core/categories.ts"
import { hasWords } from "@/core/fuzzy"
import { openMenu, type MenuItem } from "@/components/ContextMenu"
import { glide } from "@/core/animation"

const byName = new Intl.Collator(undefined, { sensitivity: "base" })

const blurb = (d: string | undefined) => (d ?? "").split(/(?<=[\w)])[.:;] /)[0].replace(/\.$/, "")

const certified = (p: Plugin) => p.tier === "core" || (p.tier === "vault" && !!p.meta?.source && official(p.meta.source.source))

type Source = "built-in" | "installed" | "vault"
const SOURCES: Record<Source, string> = { "built-in": "Built in", installed: "Installed", vault: "In this vault" }
const sourceOf = (p: Plugin): Source => (p.tier === "core" ? "built-in" : p.tier === "hosted" || p.meta?.source ? "installed" : "vault")

function bylineOf(p: Plugin): { text: string; tip?: string } | null {
  const source = sourceOf(p)
  if (source === "built-in") return null
  const from = SOURCES[source]
  if (p.tier === "hosted") { const h = hostOf(p); return h ? { text: `${from} · ${h.title}`, tip: h.intro } : { text: from } }
  if (p.tier === "vault" && !certified(p) && p.meta?.author && source === "installed") return { text: `${from} · by ${p.meta.author}` }
  return { text: from }
}

let beforeReveal = () => {}
function reveal(id: string) {
  beforeReveal()
  const found = pluginById(id), p = found && (standInOf(found) ?? found)
  requestAnimationFrame(() => requestAnimationFrame(() => pulse(p?.id ?? id)))
}
function pulse(id: string) {
  const row = document.querySelector<HTMLElement>(`[data-plugin-row="${id}"]`) ?? document.querySelector<HTMLElement>(`[data-plugin-members~="${id}"]`)
  if (!row) return
  const flash = () => { row.classList.remove("reveal-flash"); void row.offsetWidth; row.classList.add("reveal-flash") }
  const r = row.getBoundingClientRect()
  if (r.top >= 0 && r.bottom <= innerHeight) return flash()
  row.scrollIntoView({ behavior: glide(), block: "center" })
  setTimeout(flash, 350)
}

export const OpenPlugin = createContext<(id: string) => void>((id) => openDetail(`plugin/${id}`))

export function PluginRow({ p: own, on: ownOn, blocked: ownBlocked, original }: { p: Plugin; on: boolean; blocked: string[]; original?: Plugin }) {
  const open = useContext(OpenPlugin)
  const theirs = !!original && !ownOn && switchedOn(original)
  const p = theirs ? original : own, on = ownOn || theirs, blocked = theirs ? [] : ownBlocked
  const problem = p.problems?.[0]
  const waiting = on && !problem && !!p.meta?.approval
  const live = on && !blocked.length && !problem && !waiting
  const toggle = (v: boolean) => {
    if (v || !original) return setSwitch(own, v)
    for (const q of [own, original]) if (switchedOn(q)) setSwitch(q, false)
  }
  const mine = own.tier === "core" || own.meta?.author === "Vaultite" ? "Vaultite's" : own.name
  const kind = original ? `the ${hostOf(original)?.kind ?? "original"}` : ""
  const by = bylineOf(p)
  const line = "text-[13px] leading-[18px] max-md:line-clamp-2 md:truncate md:text-[12px] md:leading-[16px]"
  return (
    <div className="group/prow relative isolate flex min-h-15 items-center gap-3 py-2 md:min-h-12 md:py-1.5">
      <button type="button" onClick={() => open(p.id)} aria-label={`${p.name}: details and settings`} data-plugin-row={own.id}
        className="absolute inset-y-0 -inset-x-2 -z-10 cursor-pointer rounded-[8px] transition-colors group-hover/prow:bg-foreground/[0.04] active:bg-foreground/[0.07]" />
      <IconTile icon={p.icon} tint={tileTint(p.id)} className={cn("pointer-events-none size-9 rounded-[9px] transition-opacity md:size-8 md:rounded-[8px]", !live && "opacity-50 grayscale")}
        iconClassName="size-[20px] md:size-[18px]" />
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="text-[15px] leading-[20px] font-medium max-md:line-clamp-2 md:truncate md:text-[14px]">
          {p.name}
          {sourceOf(p) === "installed" && certified(p) && <Certified className="pointer-events-auto ml-1" />}
          {by && <span className="pointer-events-auto ml-1.5 text-[13px] font-normal text-muted-foreground md:text-[12px]" data-plugin-by={own.id} data-plugin-source={sourceOf(p)} data-tip={by.tip}>{by.text}</span>}
          {!!blocked.length && (
            <button type="button" onClick={(e) => { e.stopPropagation(); reveal(blocked[0]) }} data-plugin-needs={own.id}
              className="pointer-events-auto ml-1.5 cursor-pointer text-[13px] font-normal text-muted-foreground dashed-under hover:text-foreground md:text-[12px]"
              data-tip={`Turn on ${names(blocked)} to use this`}>needs {names(blocked)}</button>
          )}
        </div>
        {problem ? <div className={cn(line, "text-ink-(--red)")}>Couldn't start</div>
          : waiting ? <div className={cn(line, "text-muted-foreground")} data-plugin-waiting={p.id}>
            {p.meta!.approval!.state === "changed" ? "Changed: waiting for you to allow it again" : "Waiting for you to allow it on this machine"}</div>
          : original ? (
            <div className={cn(line, "text-muted-foreground")} data-plugin-pair={own.id}>
              {theirs ? capitalize(kind) : mine}{" · "}
              <button type="button" onClick={(e) => { e.stopPropagation(); setSwitch(theirs ? own : original, true, true) }} data-plugin-swap={own.id}
                className="pointer-events-auto cursor-pointer underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current">
                use {theirs ? mine : kind} instead</button>
            </div>
          ) : p.description && <div className={cn(line, "text-muted-foreground")} data-plugin-blurb>{blurb(p.description)}</div>}
      </div>
      {waiting && (
        <button type="button" onClick={() => open(p.id)} data-plugin-review={p.id}
          className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-foreground/[0.06] px-3 text-[13px] font-medium hover:bg-foreground/[0.1] max-md:h-9 max-md:text-[15px]">Review</button>
      )}
      <Switch on={on && !blocked.length} onChange={toggle} label={`${p.name} plugin`} disabled={!!blocked.length} />
      <ChevronRight className="pointer-events-none -ml-1 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </div>
  )
}

const FOLDER = ".vaultite/plugins"

function Waiting({ list }: { list: Plugin[] }) {
  const [busy, setBusy] = useState(false)
  if (!list.length) return null
  const button = "h-8 shrink-0 cursor-pointer rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 max-md:h-9 max-md:text-[15px]"
  const text = "min-w-0 flex-1 text-[15px] leading-[20px] md:text-[13px] md:leading-[18px]"
  if (list.length === 1) {
    const p = list[0]
    return (
      <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-2.5" data-plugins-waiting>
        <span className={text}>
          {p.name} {p.meta?.approval?.state === "changed" ? "changed and waits for you to allow it again" : "waits for you to allow it on this machine"}
        </span>
        <button type="button" onClick={() => openDetail(`plugin/${p.id}`)} data-plugins-review={p.id} className={button}>Review</button>
      </div>
    )
  }
  const allowAll = async () => {
    const says = list.map((p) => { const d = disclosed(p.meta?.disclosures ?? {}); return `${p.name}: ${d.length ? d.join("; ") : "nothing beyond the vault"}` })
    if (!await confirmDialog({ title: `Allow ${list.length} plugins on this machine?`, body: `They run code here. What each says it does:\n${says.join("\n")}`, confirm: "Allow all" })) return
    setBusy(true)
    for (const p of list) if (!await allowPlugin(p)) break
    setBusy(false)
  }
  return (
    <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-2.5" data-plugins-waiting>
      <span className={text}>
        {list.length} plugins wait for you to allow them on this machine: {list.map((p) => p.name).join(", ")}
      </span>
      <button type="button" disabled={busy} onClick={() => void allowAll()} data-plugins-allow-all className={button}>
        {busy ? "Allowing…" : "Allow all"}
      </button>
    </div>
  )
}

export function Rows({ list, originals, grouped = true }: { list: Plugin[]; originals: Map<string, Plugin>; grouped?: boolean }) {
  const prefs = usePrefs(), { disabled } = prefs
  return (
    <Panel className="py-1">
      <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
        {list.map((p, i) => grouped && p.group ? list.findIndex((q) => q.group === p.group) === i && <GroupRow key={`group:${p.group}`} id={p.group} /> : (
          <PluginRow key={p.id} p={p} on={switchedOn(p, prefs)} blocked={(p.requires ?? []).filter((r) => !isEnabled(r, disabled))} original={originals.get(p.id)} />
        ))}
      </div>
    </Panel>
  )
}

type Status = "all" | "on" | "off"
type Filters = { status: Status; source: Source | "any"; cat: string }
const NONE: Filters = { status: "all", source: "any", cat: "" }
const STATUSES: Record<Status, string> = { all: "All", on: "On", off: "Off" }

function ActiveFilters<K extends string>({ chips, count, remove, clear }: { chips: { id: K; label: string }[]; count: number | null; remove: (id: K) => void; clear: () => void }) {
  if (!chips.length) return null
  return (
    <div className="-mt-1.5 mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters" data-plugins-active>
      {chips.map((c) => (
        <button key={c.id} type="button" onClick={() => remove(c.id)} aria-label={`Remove filter: ${c.label}`} data-plugins-chip={c.id === "cat" ? "category" : c.id}
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-muted pr-2 pl-3 text-[15px] whitespace-nowrap hover:bg-foreground/[0.1] md:h-6.5 md:pr-1.5 md:pl-2.5 md:text-[13px]">
          {c.label}<X className="size-3.5 text-muted-foreground" strokeWidth={2.5} />
        </button>
      ))}
      <span className="ml-auto flex shrink-0 items-center gap-3 pl-2 text-[15px] text-muted-foreground md:text-[13px]">
        {count !== null && <span className="tabular-nums" data-plugins-count>{plural(count, "plugin")}</span>}
        <button type="button" onClick={clear} data-plugins-clear className="cursor-pointer font-medium text-primary hover:opacity-80">Clear all</button>
      </span>
    </div>
  )
}

type Tab = "installed" | "get"
export type PluginsView = Tab

export function Plugins({ view, onView, above }: { store: Store; view?: Tab; onView?: (v: Tab) => void; above?: (query: string, filters: GetFilters) => ReactNode }) {
  const all = usePlugins()
  const prefs = usePrefs()
  const [query, setQuery] = useState("")
  const [own, setOwn] = useState<Tab>("installed")
  const tab = view ?? own, setTab = onView ?? setOwn
  // Mirrored in a ref: the open Filter menu redraws right after a pick, before React has applied the new state.
  const [filters, setFiltersState] = useState(NONE)
  const latest = useRef(filters)
  const setFilters = (f: Filters) => { latest.current = f; setFiltersState(f) }
  const [gotOwn, setGotState] = useState(GET_NONE)
  const getCat = getCategory.use()
  const got = gotOwn.cat === getCat ? gotOwn : { ...gotOwn, cat: getCat }
  const gotRef = useRef(got)
  if (gotRef.current.cat !== getCat) gotRef.current = { ...gotRef.current, cat: getCat }
  const setGot = (f: GetFilters) => { gotRef.current = f; setGotState(f); getCategory.set(f.cat) }
  const [listed, setListedState] = useState<Listed | null>(null)
  const listedRef = useRef(listed)
  const setListed = useCallback((l: Listed | null) => { listedRef.current = l; setListedState(l) }, [])
  useEffect(() => {
    beforeReveal = () => { setQuery(""); setTab("installed"); latest.current = NONE; setFiltersState(NONE) }
    return () => { beforeReveal = () => {} }
  }, [setTab])
  const q = query.trim().toLowerCase()
  const originals = new Map<string, Plugin>()
  for (const p of all) { const s = standInOf(p); if (s && !originals.has(s.id)) originals.set(s.id, p) }
  const paired = new Set([...originals.values()].map((p) => p.id))
  const text = (p: Plugin) => `${p.name}\n${p.description ?? ""}\n${groupWords(p)}`.toLowerCase()
  const every = all.filter((p) => !paired.has(p.id) && !p.alwaysOn && !p.switchIn && !offWithAi(p, prefs)).sort((a, b) => byName.compare(a.name, b.name))
  const sections = byCategory(every).filter((s) => s.plugins.length)
  const liveOn = (p: Plugin): boolean => {
    if (p.group) return all.some((m) => m.group === p.group && switchedOn(m, prefs) && (m.requires ?? []).every((r) => isEnabled(r, prefs.disabled)))
    const o = originals.get(p.id)
    if (o && !switchedOn(p, prefs) && switchedOn(o, prefs)) return true
    return switchedOn(p, prefs) && (p.requires ?? []).every((r) => isEnabled(r, prefs.disabled))
  }
  const key = `${tab}|${q}|${filters.status}|${filters.source}|${filters.cat}|${every.map((p) => p.id).join()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps -- taken when filters or search change, not when a switch flips
  const onSet = useMemo(() => new Set(every.filter(liveOn).map((p) => p.id)), [key])
  const cat = sections.find((s) => s.id === filters.cat) ?? null
  const searched = every.filter((p) => !q || hasWords(q, text(p)) || (originals.has(p.id) && hasWords(q, text(originals.get(p.id)!))))
  const passes = (p: Plugin, f: Filters, on: Set<string>) =>
    (f.status === "all" || on.has(p.id) === (f.status === "on")) && (f.source === "any" || sourceOf(p) === f.source) &&
    (!f.cat || categoryOf(p.category).id === f.cat)
  const eff = { ...filters, cat: cat?.id ?? "" }
  const nameOf = (p: Plugin) => (p.group ? groupOf(p.group)?.label ?? p.group : p.name)
  const shown = searched.filter((p) => passes(p, eff, onSet))
    .sort((a, b) => Number(onSet.has(b.id)) - Number(onSet.has(a.id)) || byName.compare(nameOf(a), nameOf(b)))
  const waiting = all.filter((p) => p.tier !== "core" && switchedOn(p, prefs) && !p.problems?.length && !!p.meta?.approval && p.meta.approval.state !== "updating")
  const rows = (list: Plugin[]) => list.filter((p, i) => !p.group || list.findIndex((q) => q.group === p.group) === i).length

  const menu = (): MenuItem[] => {
    const f = latest.current, on = new Set(searched.filter(liveOn).map((p) => p.id))
    const count = (g: Partial<Filters>) => String(rows(searched.filter((p) => passes(p, { ...f, ...g }, on))))
    const pick = (g: Partial<Filters>) => () => setFilters({ ...latest.current, ...g })
    const picked = sections.find((s) => s.id === f.cat)
    return [
      { label: "Status", caption: true, run: () => {} },
      ...(Object.keys(STATUSES) as Status[]).map((s) => ({ label: STATUSES[s], checked: f.status === s, keep: true, hint: count({ status: s }), run: pick({ status: s }) })),
      { label: "Source", caption: true, sep: true, run: () => {} },
      { label: "Any", checked: f.source === "any", keep: true, hint: count({ source: "any" }), run: pick({ source: "any" }) },
      ...(Object.keys(SOURCES) as Source[]).map((s) => ({ label: SOURCES[s], checked: f.source === s, keep: true, hint: count({ source: s }), run: pick({ source: s }) })),
      { label: "Category", sep: true, hint: picked?.label ?? "All", run: () => {}, items: [
        { label: "All", checked: !picked, keep: true, hint: count({ cat: "" }), run: pick({ cat: "" }) },
        ...sections.map((s) => ({ label: s.label, checked: picked === s, keep: true, hint: count({ cat: s.id }), run: pick({ cat: s.id }) })),
      ] },
    ]
  }
  const getMenu = (): MenuItem[] => {
    const f = gotRef.current, l = listedRef.current
    const pick = (g: Partial<GetFilters>) => () => setGot({ ...gotRef.current, ...g })
    const count = (g: Partial<GetFilters>) => (l ? String(l.filter((e) => passesGet(e, { ...f, ...g })).length) : undefined)
    const sort = sortOf(f), sources = getSources(), cats = categoriesIn(l)
    const picked = cats.find((c) => c.id === f.cat)
    return [
      { label: "Sort by", caption: true, run: () => {} },
      ...sortsOf(f.source).map((s) => ({ label: s.label, checked: sort === s.value, keep: true, run: pick({ sort: s.value }) })),
      ...(sources.length > 1 ? [
        { label: "Source", caption: true, sep: true, run: () => {} },
        ...sources.map((s) => ({ label: s.label, checked: f.source === s.value, keep: true, run: () => { if (gotRef.current.source !== s.value) { setListed(null); pick({ source: s.value, sort: "", cat: "" })() } } })),
      ] : []),
      { label: "Show", caption: true, sep: true, run: () => {} },
      ...(Object.keys(SHOWS) as GetShow[]).map((s) => ({ label: SHOWS[s], checked: f.show === s, keep: true, hint: count({ show: s }), run: pick({ show: s }) })),
      ...(!f.source && cats.length ? [{ label: "Category", sep: true, hint: picked?.label ?? "All", run: () => {}, items: [
        { label: "All", checked: !picked, keep: true, hint: count({ cat: "" }), run: pick({ cat: "" }) },
        ...cats.map((c) => ({ label: c.label, checked: picked === c, keep: true, hint: count({ cat: c.id }), run: pick({ cat: c.id }) })),
      ] }] : []),
    ]
  }
  const openFilter = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), items = tab === "get" ? getMenu : menu
    openMenu({ x: r.left, y: r.bottom + 4, flip: r.top - 4 }, items(), false, items)
  }
  const chips: { id: keyof Filters; label: string }[] = [
    ...(filters.status !== "all" ? [{ id: "status" as const, label: STATUSES[filters.status] }] : []),
    ...(filters.source !== "any" ? [{ id: "source" as const, label: SOURCES[filters.source] }] : []),
    ...(cat ? [{ id: "cat" as const, label: cat.label }] : []),
  ]

  const sortLabel = sortsOf(got.source).find((s) => s.value === sortOf(got))
  const getChips: { id: keyof GetFilters; label: string }[] = [
    ...(got.source ? [{ id: "source" as const, label: getSources().find((s) => s.value === got.source)?.label ?? got.source }] : []),
    ...(sortLabel && sortLabel !== sortsOf(got.source)[0] ? [{ id: "sort" as const, label: `Sort: ${sortLabel.label}` }] : []),
    ...(got.show !== "all" ? [{ id: "show" as const, label: SHOWS[got.show] }] : []),
    ...(got.cat ? [{ id: "cat" as const, label: categoryOf(got.cat).label }] : []),
  ]
  const filtered = tab === "get" ? getChips.length : chips.length

  let list: ReactNode
  if (tab === "get") list = <>
    <ActiveFilters chips={getChips} count={listed ? listed.filter((e) => passesGet(e, got)).length : null}
      remove={(id) => { if (id === "source") setListed(null); setGot(id === "source" ? { ...got, source: "", sort: "", cat: "" } : { ...got, [id]: GET_NONE[id] }) }}
      clear={() => { if (got.source) setListed(null); setGot(GET_NONE) }} />
    {above?.(query, got)}
    <PluginBrowse query={query} filters={got} showInstalled={reveal} onListed={setListed} />
  </>
  else {
    list = <>
      <ActiveFilters chips={chips} count={rows(shown)} remove={(id) => setFilters({ ...filters, [id]: NONE[id] })} clear={() => setFilters(NONE)} />
      <Waiting list={waiting} />
      {!shown.length ? (
        <p className="py-4 text-[15px] text-muted-foreground md:text-[13px]" data-plugins-empty>
          {q ? `No installed plugin matches "${query.trim()}"${chips.length ? " with these filters" : ""}.` : chips.length ? "No plugins match these filters." : "No plugins here."}
        </p>
      ) : !cat && !q ? (
        byCategory(shown).filter((s) => s.plugins.length).map((s) => (
          <section key={s.id} className="mb-5" data-plugin-category={s.id}>
            <Section title={s.label}><Rows list={s.plugins} originals={originals} /></Section>
          </section>
        ))
      ) : (
        <section data-plugin-category={cat?.id ?? "all"}><Rows list={shown} originals={originals} /></section>
      )}
      {q && <DirectoryMatches query={query} showInstalled={reveal} />}
      {q && (
        <button type="button" onClick={() => setTab("get")} data-plugins-search-more
          className="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-foreground/[0.04]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground md:size-8 md:rounded-[8px]"><Search className="size-[18px]" strokeWidth={2} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium md:text-[14px]">Search everywhere for "{query.trim()}"</span>
            <span className="block text-[13px] text-muted-foreground md:text-[12px]">Get, with every source</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
        </button>
      )}
      <p className="mt-4 px-1 text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">
        Your own plugins live in <button type="button" onClick={() => showInTree(FOLDER)} data-tip="Show the folder in the file tree"
          className="cursor-pointer text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current">{FOLDER}</button>.
      </p>
    </>
  }

  return (
    <div data-plugins>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!view && <Segmented<Tab> label="Plugins" value={tab} onChange={setTab} className="shrink-0"
          options={[{ value: "installed", label: "Your plugins", attrs: { "data-plugins-installed": "" } }, { value: "get", label: "Get plugins", attrs: { "data-plugins-get": "" } }]} />}
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <form role="search" aria-label="Search plugins" className="flex min-w-0 flex-1" onSubmit={(e) => e.preventDefault()} data-plugins-search>
            <FilterField value={query} onChange={setQuery} placeholder={tab === "get" ? (above ? "Search plugins and layouts" : "Search all plugins") : "Search your plugins"} />
          </form>
          <Button onClick={openFilter} aria-haspopup="menu" data-plugins-filter={filtered}
            className={cn("px-3 md:h-7.5 md:px-2.5", filtered && "bg-primary/10 text-primary hover:bg-primary/15")}>
            <ListFilter className="size-4" strokeWidth={2.25} />Filter
          </Button>
        </div>
      </div>
      {list}
    </div>
  )
}

export function PluginGroupSheet({ id }: { store: Store; id: string }) {
  const members = groupMembers(id, usePlugins())
  return (
    <>
      <SheetHead icon={groupIcon(id)} tint="var(--primary)" title={groupOf(id)?.label ?? id} sub="Each one on or off on its own" />
      <Rows list={members} originals={new Map()} grouped={false} />
    </>
  )
}
