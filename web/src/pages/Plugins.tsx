// Plugins, in tiers (built-in, the vault's own: off until allowed on this machine since they run code), a folding
// section per category. Tap one for its sheet with a live preview; Browse is the directory (PluginBrowse.tsx).
import { useEffect, useState } from "react"
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Package, Settings2 } from "lucide-react"
import { allowPlugin, byCategory, hostOf, hostsNow, isEnabled, names, pluginById, setSwitch, standInOf, switchedOn, tintOfPlugin, usePlugins, type Plugin } from "@/core/plugins"
import { confirmDialog } from "@/components/ConfirmDialog"
import { disclosed } from "../../../core/pluginmeta.ts"
import { categoryOf } from "../../../core/categories.ts"
import { cn } from "@/lib/utils"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import type { Store } from "@/core/data"
import type { PluginHost } from "@/core/define"
import { hasSettings, openPluginSettings, settingsTitle } from "@/core/pluginSettings"
import { showInTree } from "@/components/FileTree"
import { openDetail } from "@/core/nav"
import { openBundles } from "@/core/bundles"
import { FilterField, PageHeader, Panel, Segmented, Switch } from "@/components/kit"
import { PluginBrowse } from "@/components/PluginBrowse"
import { PanelFold, SidebarHeading } from "@/components/SidebarHeading"

/** Names in the user's order, case aside (one collator, not one per comparison). */
const byName = new Intl.Collator(undefined, { sensitivity: "base" })

/** A section's key in `collapsedCategories`: "<tier>:<category>". */
const sectionKey = (tier: string, category: string) => `${tier}:${category}`

function toggleSection(key: string, fold?: boolean) {
  const c = getPrefs().collapsedCategories ?? []
  const folded = c.includes(key)
  if (fold === folded) return
  setPrefs({ collapsedCategories: folded ? c.filter((k) => k !== key) : [...c, key] })
}

/** Fold or open every section of a tier at once (`keys`: its sections' keys), in one write. */
function foldTier(keys: string[], fold: boolean) {
  const c = getPrefs().collapsedCategories ?? []
  setPrefs({ collapsedCategories: fold ? [...new Set([...c, ...keys])] : c.filter((k) => !keys.includes(k)) })
}

/** Scroll a plugin's row into view (if needed), then pulse it once. The page clears its search and shows the plugins
 *  that are off first, and its section is unfolded, so the row is there (Plugins sets `beforeReveal`). */
let beforeReveal = () => {}
function reveal(id: string) {
  beforeReveal()
  // (an original with a stand-in here shares its row)
  const found = pluginById(id), p = found && (standInOf(found) ?? found)
  if (p) toggleSection(sectionKey(p.tier, categoryOf(p.category).id), false)
  requestAnimationFrame(() => requestAnimationFrame(() => pulse(p?.id ?? id)))
}
function pulse(id: string) {
  const row = document.querySelector<HTMLElement>(`[data-plugin-row="${id}"]`)
  if (!row) return
  const flash = () => { row.classList.remove("reveal-flash"); void row.offsetWidth; row.classList.add("reveal-flash") }
  const r = row.getBoundingClientRect()
  if (r.top >= 0 && r.bottom <= innerHeight) return flash()
  row.scrollIntoView({ behavior: "smooth", block: "center" })
  setTimeout(flash, 350)
}

/** `original`: the other app's plugin it stands in for, installed too (Obsidian's Excalidraw): one row for both, its
 *  switch and sheet the one that runs, and a line to swap them. */
function PluginRow({ p: own, on: ownOn, blocked: ownBlocked, files, original }: { p: Plugin; on: boolean; blocked: string[]; files: string[]; original?: Plugin }) {
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
  return (
    <div className="group/prow relative isolate flex min-h-13 items-center gap-3 py-1.5 md:h-11 md:py-0">
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
        {problem && <div className="text-[13px] leading-[18px] text-[var(--red)] max-md:line-clamp-2 md:truncate md:text-[12px] md:leading-[16px]">{problem.split("\n")[0].replace(`${p.folder}/`, "")}</div>}
        {/* On in the vault, but this machine hasn't allowed it (as it is now): the sheet shows what changed and Allow. */}
        {waiting && <div className="text-[13px] leading-[18px] text-[var(--orange)] max-md:line-clamp-2 md:truncate md:text-[12px] md:leading-[16px]" data-plugin-waiting={p.id}>
          {p.meta!.approval!.state === "new" ? "Waiting for you to allow it on this machine" : "Changed: waiting for you to allow it again"}</div>}
        {original && !problem && !waiting && (
          <div className="text-[13px] leading-[18px] text-muted-foreground max-md:line-clamp-2 md:truncate md:text-[12px] md:leading-[16px]" data-plugin-pair={own.id}>
            {theirs ? kind[0].toUpperCase() + kind.slice(1) : mine}{" · "}
            <button type="button" onClick={(e) => { e.stopPropagation(); setSwitch(theirs ? own : original, true, true) }} data-plugin-swap={own.id}
              className="pointer-events-auto cursor-pointer underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current">
              use {theirs ? mine : kind} instead</button>
          </div>
        )}
      </div>
      {waiting && (
        <button type="button" onClick={() => openDetail(`plugin/${p.id}`)} data-plugin-review={p.id}
          className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-foreground/[0.06] px-3 text-[13px] font-medium hover:bg-foreground/[0.1] max-md:h-9 max-md:text-[15px]">Review</button>
      )}
      {live && hasSettings(p, files) && (
        <button type="button" onClick={() => openPluginSettings(p.id)} aria-label={settingsTitle(p.name)} data-tip="Settings" data-plugin-gear={p.id}
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

const link = "cursor-pointer text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current"

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
    <div className="mb-5 flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-2.5" data-plugins-waiting>
      <span className="min-w-0 flex-1 text-[15px] leading-[20px] text-[var(--orange)] md:text-[13px] md:leading-[18px]">
        {list.length} plugins wait for you to allow them on this machine: {list.map((p) => p.name).join(", ")}
      </span>
      <button type="button" disabled={busy} onClick={() => void allowAll()} data-plugins-allow-all
        className="h-8 shrink-0 cursor-pointer rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 max-md:h-9 max-md:text-[15px]">
        {busy ? "Allowing…" : "Allow all"}
      </button>
    </div>
  )
}

/** One tier's plugins: its heading on the page's left edge, then a section per category. */
function Group({ tier, title, list, intro, searching, files, originals }: { tier: string; title: string; list: Plugin[]; intro?: React.ReactNode; searching: boolean; files: string[]; originals: Map<string, Plugin> }) {
  const collapsed = usePrefs().collapsedCategories ?? []
  const sections = byCategory(list)
  const keys = sections.map((s) => sectionKey(tier, s.id))
  const anyOpen = keys.some((k) => !collapsed.includes(k))
  const all = anyOpen ? { label: "Collapse all", icon: ChevronsDownUp } : { label: "Expand all", icon: ChevronsUpDown }
  return (
    <section className="mb-7" data-plugin-group={tier}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {/* The file tree's button, for this tier's sections (a search shows every match, folded or not: none then). */}
        {!searching && keys.length > 1 && (
          <button type="button" onClick={() => foldTier(keys, anyOpen)} data-tip={all.label} aria-label={`${all.label} ${title.toLowerCase()}`} data-plugin-fold-all={tier}
            className="ml-auto grid size-6 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-8">
            <all.icon className="size-[15px]" strokeWidth={2} />
          </button>
        )}
      </div>
      {intro && <p className="mb-2 text-[13px] leading-[18px] text-muted-foreground">{intro}</p>}
      {sections.map((s) => (
        <Category key={s.id} id={sectionKey(tier, s.id)} label={s.label} list={s.plugins} searching={searching} files={files} originals={originals}
          foldAll={(fold) => foldTier(keys, fold)} />
      ))}
    </section>
  )
}

/** A category's plugins: a heading that folds it (the sidebar panels' heading: a chevron after the name while folded),
 *  then a card of rows, one column. A search shows its matches even while it's folded. */
function Category({ id, label, list, searching, files, originals, foldAll }: {
  id: string; label: string; list: Plugin[]; searching: boolean; files: string[]; originals: Map<string, Plugin>; foldAll: (fold: boolean) => void
}) {
  const prefs = usePrefs(), { disabled } = prefs
  const folded = !searching && (prefs.collapsedCategories ?? []).includes(id)
  return (
    <div className={folded ? undefined : "mb-3"} data-plugin-category={id} data-collapsed={folded || undefined}>
      <PanelFold.Provider value={searching ? null : { collapsed: folded, toggle: (e) => (e?.altKey ? foldAll(!folded) : toggleSection(id)) }}>
        <SidebarHeading title={label} open sticky={false} className={cn("mt-0 max-md:h-11", !searching && "cursor-pointer")} />
      </PanelFold.Provider>
      {!folded && (
        <Panel className="py-1">
          {/* Hairlines between rows. */}
          <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
            {list.map((p) => (
              <PluginRow key={p.id} p={p} on={switchedOn(p, prefs)} blocked={(p.requires ?? []).filter((r) => !isEnabled(r, disabled))} files={files} original={originals.get(p.id)} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

/** A host's plugins (an Obsidian plugin under obsidian-compat): its title, then one card of rows. */
function HostGroup({ host, info, list, paired, files, browse }: { host: string; info: PluginHost; list: Plugin[]; paired: Plugin[]; files: string[]; browse: () => void }) {
  const prefs = usePrefs()
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
  const on = list.filter((p) => switchedOn(p, prefs)).length
  return (
    <section className="mb-7" data-plugin-group={`hosted:${host}`}>
      <h2 className="mb-1 flex items-baseline gap-2 text-[17px] font-semibold">
        {info.title}
        {list.length > 0 && <span className="text-[13px] font-normal text-muted-foreground tabular-nums">{on} of {list.length} on</span>}
      </h2>
      {info.intro && <p className="mb-2 text-[13px] leading-[18px] text-muted-foreground">{info.intro}</p>}
      <Panel className="py-1">
        {sorted.length ? (
          <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
            {sorted.map((p) => <PluginRow key={p.id} p={p} on={switchedOn(p, prefs)} blocked={[]} files={files} />)}
          </div>
        ) : (
          <p className="py-2 text-[14px] text-muted-foreground md:text-[13px]" data-plugin-group-empty>
            {paired.length ? `${names(paired.map((p) => p.id))} ${paired.length === 1 ? "shares its row" : "share their rows"} with Vaultite's own, above.` : "None yet."}{info.browse && <> <button type="button" onClick={browse} className="cursor-pointer text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground">Find one in Browse</button></>}
          </p>
        )}
      </Panel>
    </section>
  )
}

const TIERS = [
  { tier: "core", title: "Built-in plugins" },
  { tier: "vault", title: "Vault plugins" },
] as const

export function Plugins({ store }: { store: Store }) {
  const files = store.pluginSettings ?? []
  const all = usePlugins()
  const prefs = usePrefs()
  const [query, setQuery] = useState("")
  const [showOff, setShowOff] = useState(true)
  const [tab, setTab] = useState<"installed" | "browse">("installed")
  const [source, setSource] = useState("") // Browse's source: "" the plugin directory, else a host's
  useEffect(() => {
    beforeReveal = () => { setQuery(""); setShowOff(true); setTab("installed") }
    return () => { beforeReveal = () => {} }
  }, [])
  const q = query.trim().toLowerCase()
  // Hosted originals installed beside their stand-in here, by the stand-in's id: drawn in its row, not their host's.
  const originals = new Map<string, Plugin>()
  for (const p of all) { const s = standInOf(p); if (s && !originals.has(s.id)) originals.set(s.id, p) }
  const paired = new Set([...originals.values()].map((p) => p.id))
  // On: its own switch, and everything it needs on (a blocked one counts as off); a stand-in's row, either of the two.
  const isOn = (p: Plugin): boolean => switchedOn(p, prefs) && (p.requires ?? []).every((r) => isEnabled(r, prefs.disabled)) || (originals.has(p.id) && isOn(originals.get(p.id)!))
  const text = (p: Plugin) => `${p.name}\n${p.description ?? ""}`.toLowerCase()
  const shown = all
    .filter((p) => !paired.has(p.id) && (showOff || isOn(p)) && (!q || text(p).includes(q) || (originals.has(p.id) && text(originals.get(p.id)!).includes(q))))
    .sort((a, b) => byName.compare(a.name, b.name))
  const filtering = !!q || !showOff
  // Only drawn with plugins in it, or when there are none at all (and nothing's filtered).
  const vaultIntro = (
    <>Your own plugins, in <button type="button" onClick={() => showInTree(FOLDER)} data-tip="Show the folder in the file tree" className={link}>{FOLDER}</button></>
  )
  return (
    <>
      <PageHeader title="Plugins" className="items-center">
        <button type="button" onClick={openBundles} data-plugins-bundles
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] bg-foreground/[0.06] px-3.5 text-[15px] font-medium transition-colors hover:bg-foreground/[0.1] md:h-8 md:text-[13px]">
          <Package className="size-4" strokeWidth={2} />Bundles
        </button>
      </PageHeader>
      <Segmented value={tab} onChange={setTab} label="Plugins" className="mb-4 w-full max-w-[300px]"
        options={[{ value: "installed", label: "Installed" }, { value: "browse", label: "Browse" }]} />
      <div className="mb-5 flex items-center gap-4">
        <FilterField value={query} onChange={setQuery} placeholder={tab === "browse" ? "Search the directory" : "Search plugins"} />
        {tab === "installed" && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
            Show disabled
            <Switch on={showOff} onChange={setShowOff} label="Show disabled plugins" />
          </label>
        )}
      </div>
      {tab === "installed" && <Waiting list={all.filter((p) => p.tier !== "core" && switchedOn(p, prefs) && !p.problems?.length && !!p.meta?.approval)} />}
      {tab === "browse" ? <PluginBrowse query={query} source={source} setSource={setSource} showInstalled={(id) => { setTab("installed"); reveal(id) }} /> : TIERS.map(({ tier, title }) => {
        const list = shown.filter((p) => p.tier === tier)
        const total = all.filter((p) => p.tier === tier).length
        // Filtering: a tier with nothing left leaves (the vault one too, unless it has none at all and nothing's filtered).
        if (!list.length && (tier !== "vault" || filtering || total)) return null
        return <Group key={tier} tier={tier} title={title} list={list} searching={!!q} intro={tier === "vault" ? vaultIntro : undefined} files={files} originals={originals} />
      })}
      {/* Plugins other plugins run (Obsidian's), a group per host, without categories. */}
      {tab === "installed" && hostsNow().map(([h, info]) => {
        const list = shown.filter((p) => p.tier === "hosted" && p.host === h)
        return (list.length || !filtering) && <HostGroup key={h} host={h} info={info} list={list} paired={all.filter((p) => paired.has(p.id) && p.host === h)} files={files}
          browse={() => { setSource(h); setTab("browse") }} />
      })}
      {tab === "installed" && !shown.length && filtering && (
        <p className="text-[15px] text-muted-foreground">
          {q ? `No plugins match "${query.trim()}".` : "Every plugin is off."}
        </p>
      )}
    </>
  )
}
