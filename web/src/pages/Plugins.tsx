// Plugins: Your plugins (by category, never the `alwaysOn` parts; Filter narrows them) or Get plugins (PluginBrowse.tsx),
// the search above the list it looks in. A row not built in says where it's from; tap for its sheet.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { ChevronRight, ListFilter, Package, Search, Settings2, X } from "lucide-react"
import { allowPlugin, byCategory, hostOf, isEnabled, names, pluginById, setSwitch, standInOf, switchedOn, tintOfPlugin, usePlugins, type Plugin } from "@/core/plugins"
import { confirmDialog } from "@/components/ConfirmDialog"
import { disclosed } from "../../../core/pluginmeta.ts"
import { official } from "../../../core/updates.ts"
import { capitalize, cn } from "@/lib/utils"
import { usePrefs } from "@/core/prefs"
import type { Store } from "@/core/data"
import { hasSettings, openPluginSettings, settingsTitle } from "@/core/pluginSettings"
import { showInTree } from "@/components/FileTree"
import { openDetail } from "@/core/nav"
import { FilterField, PageHeader, Panel, Segmented, SheetHead, Switch } from "@/components/kit"
import { Button } from "@/components/Button"
import { openBundles } from "@/core/bundles"
import { DirectoryMatches, PluginBrowse } from "@/components/PluginBrowse"
import { Certified } from "@/components/Certified"
import { GroupRow, groupIcon, groupMembers, groupWords } from "@/components/PluginGroup"
import { categoryOf, groupOf } from "../../../core/categories.ts"
import { hasWords } from "@/core/fuzzy"
import { openMenu, type MenuItem } from "@/components/ContextMenu"

/** Names in the user's order, case aside (one collator, not one per comparison). */
const byName = new Intl.Collator(undefined, { sensitivity: "base" })

/** What a plugin does, in one line: its description up to the first full stop or colon. */
const blurb = (d: string | undefined) => (d ?? "").split(/(?<=[\w)])[.:;] /)[0].replace(/\.$/, "")

/** Vaultite made it: built in, or installed from Vaultite's GitHub organisation (never what a manifest says). */
const certified = (p: Plugin) => p.tier === "core" || (p.tier === "vault" && !!p.meta?.source && official(p.meta.source.source))

type Source = "built-in" | "installed" | "vault"
const SOURCES: Record<Source, string> = { "built-in": "Built in", installed: "Installed", vault: "In this vault" }
/** Where it's from: the app's, installed (from a repository, or another app's plugin), or made in this vault. */
const sourceOf = (p: Plugin): Source => (p.tier === "core" ? "built-in" : p.tier === "hosted" || p.meta?.source ? "installed" : "vault")

/** Where it's from, and who made it when it isn't Vaultite: an installed plugin's author, or the app whose plugin it is.
 *  Nothing for a built-in one (most rows: the label would say nothing). */
function bylineOf(p: Plugin): { text: string; tip?: string } | null {
  const source = sourceOf(p)
  if (source === "built-in") return null
  const from = SOURCES[source]
  if (p.tier === "hosted") { const h = hostOf(p); return h ? { text: `${from} · ${h.title}`, tip: h.intro } : { text: from } }
  if (p.tier === "vault" && !certified(p) && p.meta?.author && source === "installed") return { text: `${from} · by ${p.meta.author}` }
  return { text: from }
}

/** Scroll a plugin's row into view (if needed), then pulse it once. The page clears its search and filters first, so
 *  the row is there (Plugins sets `beforeReveal`). */
let beforeReveal = () => {}
function reveal(id: string) {
  beforeReveal()
  // (an original with a stand-in here shares its row)
  const found = pluginById(id), p = found && (standInOf(found) ?? found)
  requestAnimationFrame(() => requestAnimationFrame(() => pulse(p?.id ?? id)))
}
function pulse(id: string) {
  // (one in a group: its group's row)
  const row = document.querySelector<HTMLElement>(`[data-plugin-row="${id}"]`) ?? document.querySelector<HTMLElement>(`[data-plugin-members~="${id}"]`)
  if (!row) return
  const flash = () => { row.classList.remove("reveal-flash"); void row.offsetWidth; row.classList.add("reveal-flash") }
  const r = row.getBoundingClientRect()
  if (r.top >= 0 && r.bottom <= innerHeight) return flash()
  row.scrollIntoView({ behavior: "smooth", block: "center" })
  setTimeout(flash, 350)
}


/** `original`: the other app's plugin it stands in for, installed too (Obsidian's Excalidraw): one row for both, its
 *  switch and sheet the one that runs, and a line to swap them. `openSettings`: where its gear goes (else a sheet). */
export function PluginRow({ p: own, on: ownOn, blocked: ownBlocked, files, original, openSettings }: { p: Plugin; on: boolean; blocked: string[]; files: string[]; original?: Plugin; openSettings?: (id: string) => void }) {
  const theirs = !!original && !ownOn && switchedOn(original)
  const p = theirs ? original : own, on = ownOn || theirs, blocked = theirs ? [] : ownBlocked
  // Its own switch is kept: turn People back on and People map comes back as you left it.
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
      <button type="button" onClick={() => openDetail(`plugin/${p.id}`)} aria-label={`${p.name}: details and preview`} data-plugin-row={own.id}
        className="absolute inset-y-0 -inset-x-2 -z-10 cursor-pointer rounded-[8px] transition-colors group-hover/prow:bg-foreground/[0.04] active:bg-foreground/[0.07]" />
      {/* Off (by its switch, or because something it needs is off): greyed out. */}
      <span className={cn("pointer-events-none grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted transition-opacity md:size-8 md:rounded-[8px]", !live && "opacity-45")}
        style={{ color: tintOfPlugin(p.id) }}>
        <p.icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
      </span>
      <div className={cn("pointer-events-none min-w-0 flex-1 transition-opacity", !live && "opacity-55")}>
        <div className="text-[15px] leading-[20px] font-medium max-md:line-clamp-2 md:truncate md:text-[14px]">
          {p.name}
          {/* (the mark only where it tells something: installed, and from Vaultite) */}
          {sourceOf(p) === "installed" && certified(p) && <Certified className="pointer-events-auto ml-1" />}
          {by && <span className="pointer-events-auto ml-1.5 text-[13px] font-normal text-muted-foreground md:text-[12px]" data-plugin-by={own.id} data-plugin-source={sourceOf(p)} data-tip={by.tip}>{by.text}</span>}
          {/* Something it needs is off: that's underlined, dashed (no extra line, so nothing shifts). */}
          {p.requires && (
            <span className="font-normal text-muted-foreground">
              {" · "}
              {/* Tap to find what it needs in the list. */}
              <button type="button" onClick={(e) => { e.stopPropagation(); reveal(blocked[0] ?? p.requires![0]) }}
                className={cn("pointer-events-auto cursor-pointer hover:text-foreground", !!blocked.length && "dashed-under")}
                data-tip={blocked.length ? `Turn on ${names(blocked)} to use this` : `Show ${names(p.requires)}`}>needs {names(p.requires)}</button>
            </span>
          )}
        </div>
        {/* A vault plugin that can't run says why (the sheet has the rest). */}
        {problem ? <div className={cn(line, "text-[var(--red)]")}>{problem.split("\n")[0].replace(`${p.folder}/`, "")}</div>
          // On in the vault, but this machine hasn't allowed it (as it is now): the sheet shows what changed and Allow.
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
        <button type="button" onClick={() => openDetail(`plugin/${p.id}`)} data-plugin-review={p.id}
          className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-foreground/[0.06] px-3 text-[13px] font-medium hover:bg-foreground/[0.1] max-md:h-9 max-md:text-[15px]">Review</button>
      )}
      {live && hasSettings(p, files) && (
        <button type="button" onClick={() => (openSettings ?? openPluginSettings)(p.id)} aria-label={settingsTitle(p.name)} data-tip="Settings" data-plugin-gear={p.id}
          className="-mr-1 grid size-9 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground active:opacity-60 md:size-7 md:rounded-[6px]">
          <Settings2 className="size-[18px] md:size-4" strokeWidth={2} />
        </button>
      )}
      <Switch on={on && !blocked.length} onChange={toggle} label={`${p.name} plugin`} disabled={!!blocked.length} />
      <ChevronRight className="pointer-events-none -ml-1 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </div>
  )
}

const FOLDER = ".vaultite/plugins"

/** Vault plugins on in the vault that this machine hasn't allowed yet (another machine's, a synced vault's): all at once,
 *  after a dialog saying what each does beyond the vault. */
function Waiting({ list }: { list: Plugin[] }) {
  const [busy, setBusy] = useState(false)
  if (list.length < 2) return null
  const allowAll = async () => {
    const says = list.map((p) => { const d = disclosed(p.meta?.disclosures ?? {}); return `${p.name}: ${d.length ? d.join("; ") : "nothing beyond the vault"}` })
    if (!await confirmDialog({ title: `Allow ${list.length} plugins on this machine?`, body: `They run code here. What each says it does:\n${says.join("\n")}`, confirm: "Allow all" })) return
    setBusy(true)
    for (const p of list) if (!await allowPlugin(p)) break
    setBusy(false)
  }
  return (
    <div className="mb-4 flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-2.5" data-plugins-waiting>
      <span className="min-w-0 flex-1 text-[15px] leading-[20px] md:text-[13px] md:leading-[18px]">
        {list.length} plugins wait for you to allow them on this machine: {list.map((p) => p.name).join(", ")}
      </span>
      <button type="button" disabled={busy} onClick={() => void allowAll()} data-plugins-allow-all
        className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 max-md:h-9 max-md:text-[15px]">
        {busy ? "Allowing…" : "Allow all"}
      </button>
    </div>
  )
}

/** A card of rows, hairlines between them; a group's plugins one row, where the first of them is (`grouped`). */
export function Rows({ list, files, originals, openSettings, grouped = true }: { list: Plugin[]; files: string[]; originals: Map<string, Plugin>; openSettings?: (id: string) => void; grouped?: boolean }) {
  const prefs = usePrefs(), { disabled } = prefs
  return (
    <Panel className="py-1">
      <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
        {list.map((p, i) => grouped && p.group ? list.findIndex((q) => q.group === p.group) === i && <GroupRow key={`group:${p.group}`} id={p.group} /> : (
          <PluginRow key={p.id} p={p} on={switchedOn(p, prefs)} blocked={(p.requires ?? []).filter((r) => !isEnabled(r, disabled))} files={files} original={originals.get(p.id)} openSettings={openSettings} />
        ))}
      </div>
    </Panel>
  )
}

/** What Filter narrows the list to: a status, a source, a category (`""`: any). */
type Status = "all" | "on" | "off"
type Filters = { status: Status; source: Source | "any"; cat: string }
const NONE: Filters = { status: "all", source: "any", cat: "" }
const STATUSES: Record<Status, string> = { all: "All", on: "On", off: "Off" }

/** The filters on, under the search: each a chip that removes it, then how many rows show and Clear all. */
function ActiveFilters({ chips, count, remove, clear }: { chips: { id: keyof Filters; label: string }[]; count: number; remove: (id: keyof Filters) => void; clear: () => void }) {
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
        <span className="tabular-nums" data-plugins-count>{count} {count === 1 ? "plugin" : "plugins"}</span>
        <button type="button" onClick={clear} data-plugins-clear className="cursor-pointer font-medium text-primary hover:opacity-80">Clear all</button>
      </span>
    </div>
  )
}

type Tab = "installed" | "get"

/** `section`: drawn as Settings' section, else a page of its own (each scrolled by what holds it). `bundles`: what the
 *  Bundles button opens (in Settings, its section). */
export function Plugins({ store, section, bundles = openBundles }: { store: Store; section?: boolean; bundles?: () => void }) {
  const files = store.pluginSettings ?? []
  const all = usePlugins()
  const prefs = usePrefs()
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("installed")
  // (also in a ref: the open Filter menu draws itself again right after a pick, before React has the new state)
  const [filters, setFiltersState] = useState(NONE)
  const latest = useRef(filters)
  const setFilters = (f: Filters) => { latest.current = f; setFiltersState(f) }
  const [source, setSource] = useState("") // Get plugins' source: "" the plugin directory, else a host's
  useEffect(() => {
    beforeReveal = () => { setQuery(""); setTab("installed"); latest.current = NONE; setFiltersState(NONE) }
    return () => { beforeReveal = () => {} }
  }, [])
  const q = query.trim().toLowerCase()
  // Hosted originals installed beside their stand-in here, by the stand-in's id: drawn in its row, not on their own.
  const originals = new Map<string, Plugin>()
  for (const p of all) { const s = standInOf(p); if (s && !originals.has(s.id)) originals.set(s.id, p) }
  const paired = new Set([...originals.values()].map((p) => p.id))
  const text = (p: Plugin) => `${p.name}\n${p.description ?? ""}\n${groupWords(p)}`.toLowerCase()
  // (one whose switch is in a Settings section isn't here: Vim keys, in Editor)
  const every = all.filter((p) => !paired.has(p.id) && !p.alwaysOn && !p.switchIn).sort((a, b) => byName.compare(a.name, b.name))
  const sections = byCategory(every).filter((s) => s.plugins.length)
  // On as its switch shows it: switched on (it, or the original it stands in for) and nothing it needs off. A group's
  // row is on when any of its plugins is.
  const liveOn = (p: Plugin): boolean => {
    if (p.group) return all.some((m) => m.group === p.group && switchedOn(m, prefs) && (m.requires ?? []).every((r) => isEnabled(r, prefs.disabled)))
    const o = originals.get(p.id)
    if (o && !switchedOn(p, prefs) && switchedOn(o, prefs)) return true
    return switchedOn(p, prefs) && (p.requires ?? []).every((r) => isEnabled(r, prefs.disabled))
  }
  // What the order and Status go by, taken when the filters or the search change, not when a switch flips: a row
  // switched on or off stays under the finger (and in an On or Off list) till then.
  const key = `${tab}|${q}|${filters.status}|${filters.source}|${filters.cat}|${every.map((p) => p.id).join()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onSet = useMemo(() => new Set(every.filter(liveOn).map((p) => p.id)), [key])
  // A category emptied (its last plugin removed) isn't left picked with nothing in it.
  const cat = sections.find((s) => s.id === filters.cat) ?? null
  const searched = every.filter((p) => !q || hasWords(q, text(p)) || (originals.has(p.id) && hasWords(q, text(originals.get(p.id)!))))
  const passes = (p: Plugin, f: Filters, on: Set<string>) =>
    (f.status === "all" || on.has(p.id) === (f.status === "on")) && (f.source === "any" || sourceOf(p) === f.source) &&
    (!f.cat || categoryOf(p.category).id === f.cat)
  const eff = { ...filters, cat: cat?.id ?? "" }
  // On ones first, then by name (a group by its own name, its plugins together).
  const nameOf = (p: Plugin) => (p.group ? groupOf(p.group)?.label ?? p.group : p.name)
  const shown = searched.filter((p) => passes(p, eff, onSet))
    .sort((a, b) => Number(onSet.has(b.id)) - Number(onSet.has(a.id)) || byName.compare(nameOf(a), nameOf(b)))
  const waiting = all.filter((p) => p.tier !== "core" && switchedOn(p, prefs) && !p.problems?.length && !!p.meta?.approval && p.meta.approval.state !== "updating")
  // (a group counts as its one row)
  const rows = (list: Plugin[]) => list.filter((p, i) => !p.group || list.findIndex((q) => q.group === p.group) === i).length

  // Filter's menu: each choice with how many rows it would show, the other filters (and the search) as they are. It
  // stays open, so several can be picked; Category is a submenu (ten of them).
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
  const openFilter = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    openMenu({ x: r.left, y: r.bottom + 4 }, menu(), false, menu)
  }
  const chips: { id: keyof Filters; label: string }[] = [
    ...(filters.status !== "all" ? [{ id: "status" as const, label: STATUSES[filters.status] }] : []),
    ...(filters.source !== "any" ? [{ id: "source" as const, label: SOURCES[filters.source] }] : []),
    ...(cat ? [{ id: "cat" as const, label: cat.label }] : []),
  ]

  let list: ReactNode
  if (tab === "get") list = <PluginBrowse query={query} source={source} setSource={setSource} showInstalled={reveal} />
  else {
    list = <>
      <ActiveFilters chips={chips} count={rows(shown)} remove={(id) => setFilters({ ...filters, [id]: NONE[id] })} clear={() => setFilters(NONE)} />
      <Waiting list={waiting} />
      {!shown.length ? (
        <p className="py-4 text-[15px] text-muted-foreground md:text-[13px]" data-plugins-empty>
          {q ? `No installed plugin matches "${query.trim()}"${chips.length ? " with these filters" : ""}.` : chips.length ? "No plugins match these filters." : "No plugins here."}
        </p>
      ) : !cat && !q ? (
        // No category picked: a section per category, headings only (nothing folds; Filter picks one).
        byCategory(shown).filter((s) => s.plugins.length).map((s) => (
          <section key={s.id} className="mb-5" data-plugin-category={s.id}>
            <h2 className="mb-1.5 px-1 text-[13px] font-semibold text-muted-foreground md:text-[12px]">{s.label}</h2>
            <Rows list={s.plugins} files={files} originals={originals} />
          </section>
        ))
      ) : (
        <section data-plugin-category={cat?.id ?? "all"}><Rows list={shown} files={files} originals={originals} /></section>
      )}
      {/* A search also looks where more plugins are: the directory's that aren't here, then Get plugins' other sources. */}
      {q && <DirectoryMatches query={query} showInstalled={reveal} />}
      {q && (
        <button type="button" onClick={() => setTab("get")} data-plugins-search-more
          className="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-foreground/[0.04]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted text-muted-foreground md:size-8 md:rounded-[8px]"><Search className="size-[18px]" strokeWidth={2} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium md:text-[14px]">Search everywhere for "{query.trim()}"</span>
            <span className="block text-[13px] text-muted-foreground md:text-[12px]">Get plugins, with every source</span>
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
      <PageHeader title="Plugins" section={section}>
        <Button onClick={bundles} data-plugins-bundles><Package className="size-4" strokeWidth={2.25} />Bundles</Button>
      </PageHeader>
      {/* The search is above the list it looks in: what's installed, or (Get plugins) every source. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<Tab> label="Plugins" value={tab} onChange={setTab} className="shrink-0"
          options={[{ value: "installed", label: "Your plugins", attrs: { "data-plugins-installed": "" } }, { value: "get", label: "Get plugins", attrs: { "data-plugins-get": "" } }]} />
        <div className="flex min-w-[200px] flex-1 items-center gap-2">
          <form role="search" className="flex min-w-0 flex-1" onSubmit={(e) => e.preventDefault()} data-plugins-search>
            <FilterField value={query} onChange={setQuery} placeholder={tab === "get" ? "Search all plugins" : "Search your plugins"} />
          </form>
          {tab === "installed" && (
            <Button onClick={openFilter} aria-haspopup="menu" data-plugins-filter={chips.length}
              className={cn("px-3 md:h-7.5 md:px-2.5", chips.length && "bg-primary/10 text-primary hover:bg-primary/15")}>
              <ListFilter className="size-4" strokeWidth={2.25} />Filter
            </Button>
          )}
        </div>
      </div>
      {list}
    </div>
  )
}

/** A group's sheet (`plugin-group/<id>`, from its row): each of its plugins with its own switch and gear. */
export function PluginGroupSheet({ store, id }: { store: Store; id: string }) {
  const members = groupMembers(id, usePlugins())
  return (
    <>
      <SheetHead icon={groupIcon(id)} tint="var(--primary)" title={groupOf(id)?.label ?? id} sub="Each one on or off on its own" />
      <Rows list={members} files={store.pluginSettings ?? []} originals={new Map()} grouped={false} />
    </>
  )
}
