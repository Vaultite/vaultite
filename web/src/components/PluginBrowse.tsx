// The Plugins page's Get plugins: bundles first, then the plugin directory (repos with the topic vaultite-plugin:
// core/pluginindex.ts), each with what it says it does and Install, or a host's source (Obsidian's: PluginHost.browse).
import { useEffect, useState } from "react"
import { ChevronRight, Download, MoreHorizontal, Package, Puzzle, RefreshCw, Star } from "lucide-react"
import { dateText, fmtAgo } from "@/core/data"
import { op } from "@/core/http"
import { openWebLink } from "@/core/links"
import { notify, notifyError } from "@/core/notify"
import { namedIcon, pluginIcon, tintOf } from "@/core/pages"
import { openBundles, useBundles } from "@/core/bundles"
import { openDetail } from "@/core/nav"
import { useKeptCount } from "@/core/heights"
import { setPrefs, usePrefs } from "@/core/prefs"
import { policyOf, type UpdatePolicy } from "../../../core/updates.ts"
import { Bar, Loading, Panel, Segmented } from "@/components/kit"
import { menuBelow } from "@/components/ContextMenu"
import { capitalize, cn } from "@/lib/utils"
import { disclosed, type Disclosures } from "../../../core/pluginmeta.ts"
import type { BrowseEntry, BrowseSource } from "@/core/define"
import { hostsNow, pluginById, updatePlugin, usePluginsVersion } from "@/core/plugins"
import { Button } from "@/components/Button"

type Sort = "stars" | "new" | "updated"
type Entry = {
  id: string; name: string; description: string; author: string; repo: string; dir: string | null; source: string; version: string; stars: number; released: string | null
  pushed: string | null; created: string | null; disclosures: Disclosures; installed: string | null; ours: boolean; update: boolean; blocked: string | null
  /** Its manifest's icon (a name, or its SVG mark as a data address) and colour: as it looks once installed. */
  icon?: string; tint?: string
}
type Found = { url: string; available: boolean; error?: string; plugins: Entry[] }

const SORTS: { value: Sort; label: string }[] = [{ value: "stars", label: "Stars" }, { value: "new", label: "New" }, { value: "updated", label: "Updated" }]

function EntryRow({ e, busy, act }: { e: Entry; busy: boolean; act: (e: Entry) => void }) {
  const updated = e.released ?? e.pushed
  const says = disclosed(e.disclosures)
  const button = e.blocked ? null : e.update ? "Update" : e.installed !== null ? null : "Install"
  const Icon = pluginIcon(e.icon) ?? Puzzle
  return (
    <div className="flex items-start gap-3 py-2.5" data-browse-row={e.id}>
      {/* (the tile of its row once installed: Plugins.tsx) */}
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted md:size-8 md:rounded-[8px]" style={{ color: e.tint && `var(--${e.tint})` }} data-browse-icon>
        <Icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button type="button" onClick={() => openWebLink(`https://github.com/${e.repo}${e.dir ? `/tree/HEAD/${e.dir}` : ""}`)} data-tip={`github.com/${e.source}`}
            className="min-w-0 cursor-pointer truncate text-left text-[15px] leading-[20px] font-medium hover:underline md:text-[14px]">{e.name}</button>
          <span className="shrink-0 truncate text-[13px] text-muted-foreground md:text-[12px]">{e.author}</span>
        </div>
        {e.description && <p className="text-[14px] leading-[19px] text-muted-foreground max-md:line-clamp-3 md:line-clamp-2 md:text-[13px] md:leading-[18px]">{e.description}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground tabular-nums md:text-[12px]">
          <span className="inline-flex items-center gap-1" data-tip={`${e.stars} stars on GitHub`}><Star className="size-3" strokeWidth={2.25} />{e.stars}</span>
          <span>{e.version}</span>
          {updated && <span data-tip={dateText(new Date(updated), { day: "numeric", month: "long", year: "numeric" })}>updated {fmtAgo(updated)}</span>}
          {e.installed !== null && <span className="text-foreground/80" data-browse-installed>{e.update ? `${e.installed} installed` : "Installed"}</span>}
        </div>
        {says.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" data-browse-discloses>
            {says.map((s) => <span key={s} className="rounded-[5px] bg-muted px-1.5 py-px text-[12px] leading-[17px] text-muted-foreground md:text-[11px] md:leading-[16px]">{capitalize(s)}</span>)}
          </div>
        )}
        {e.blocked && <div className="mt-0.5 text-[13px] text-[var(--red)] md:text-[12px]">Blocked by the directory: a known problem with this version.</div>}
      </div>
      {button && (
        <button type="button" disabled={busy} onClick={() => act(e)} data-browse-action={button.toLowerCase()}
          className={cn("mt-0.5 h-8 min-w-20 shrink-0 cursor-pointer rounded-[8px] px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 max-md:h-9 max-md:text-[15px]",
            button === "Install" ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}>
          {busy ? (button === "Install" ? "Installing…" : "Updating…") : button}
        </button>
      )}
    </div>
  )
}

/** The list on its way: EntryRow's and HostRow's shape (`tile`: EntryRow's icon), a line of each as a bar. */
function RowSkeletons({ count, tile }: { count: number; tile?: boolean }) {
  return (
    <Panel className="loading-in py-0.5">
      <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border" aria-busy>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-2.5">
            {tile && <span className="mt-0.5 size-9 shrink-0 rounded-[9px] bg-muted md:size-8 md:rounded-[8px]" />}
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-[20px] md:text-[14px]"><Bar w={i % 2 ? "30%" : "38%"} /></div>
              <p className="text-[14px] leading-[19px] md:text-[13px] md:leading-[18px]"><Bar w="92%" /><br /><Bar w={i % 2 ? "48%" : "60%"} /></p>
              <div className="mt-0.5 text-[13px] md:text-[12px]"><Bar w="28%" /></div>
            </div>
            <span className="mt-0.5 h-9 w-20 shrink-0 rounded-[8px] bg-muted md:h-8" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** The app's bundles: a set of plugins (and a look) in one step, the quickest way to get several. */
function Bundles() {
  const list = useBundles()?.bundles.filter((b) => b.source === "app" && !b.more).sort((a, b) => a.sort - b.sort).slice(0, 3)
  if (!list?.length) return null
  return (
    <div className="mb-6" data-browse-bundles>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold text-muted-foreground md:text-[12px]">Start with a bundle</h2>
        <button type="button" onClick={openBundles} data-browse-all-bundles className="cursor-pointer text-[15px] text-primary hover:underline md:text-[13px]">All bundles</button>
      </div>
      <div className="grid gap-2 @xl:grid-cols-3">
        {list.map((b) => {
          const Icon = namedIcon(b.icon) ?? Package
          return (
            <button key={b.id} type="button" onClick={() => openDetail(`bundle/${b.id}`)} data-browse-bundle={b.id}
              className="flex cursor-pointer items-start gap-3 rounded-[10px] bg-muted px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.08]">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] bg-card" style={{ color: tintOf(b.tint) ?? "var(--primary)" }}>
                <Icon className="size-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium md:text-[14px]">{b.name}</span>
                <span className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">{b.description}</span>
              </span>
              <ChevronRight className="mt-2 size-4 shrink-0 text-tertiary @xl:hidden" strokeWidth={2.5} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

const POLICY_HINT: Record<UpdatePolicy, string> = {
  vaultite: "Vaultite's own update by themselves; others wait for you to update them.",
  all: "Every installed plugin updates by itself, on each machine that allowed it.",
  off: "None: update each from its page, or from here.",
}

/** Which installed plugins update on their own (plugins.json `updates`): Vaultite's, all of them, or none. */
function AutoUpdates() {
  const policy = policyOf(usePrefs())
  return (
    <div className="mt-6 flex items-center gap-3 rounded-[10px] bg-muted px-3.5 py-2.5 max-md:flex-col max-md:items-stretch" data-plugins-updates>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] md:text-[13px] md:font-medium">Update on their own</span>
        <span className="block text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">{POLICY_HINT[policy]}</span>
      </span>
      <Segmented value={policy} onChange={(v) => void setPrefs({ updates: v })} label="Which plugins update on their own" className="w-full shrink-0 md:w-[230px]"
        options={[{ value: "vaultite", label: "Vaultite's" }, { value: "all", label: "All" }, { value: "off", label: "None" }]} />
    </div>
  )
}

const TONES = { green: "text-[var(--green)]", orange: "text-[var(--orange)]", red: "text-[var(--red)]" }


/** A host's entry. One a plugin here does the job of offers that first (installing the original too would only draw the
 *  same twice), the original under its … menu. */
function HostRow({ e, busy, install, use, show, more }: { e: BrowseEntry; busy: boolean; install: (e: BrowseEntry) => void; use: (e: BrowseEntry) => void; show: (id: string) => void; more: boolean }) {
  const alt = !e.installed ? e.standIn : undefined
  return (
    <div className="flex items-start gap-3 py-2.5" data-browse-row={e.id}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {e.url ? <button type="button" onClick={() => openWebLink(e.url!)} className="min-w-0 cursor-pointer truncate text-left text-[15px] leading-[20px] font-medium hover:underline md:text-[14px]">{e.name}</button>
            : <span className="min-w-0 truncate text-[15px] leading-[20px] font-medium md:text-[14px]">{e.name}</span>}
          {e.author && <span className="shrink-0 truncate text-[13px] text-muted-foreground md:text-[12px]">{e.author}</span>}
        </div>
        {e.description && <p className="text-[14px] leading-[19px] text-muted-foreground max-md:line-clamp-3 md:line-clamp-2 md:text-[13px] md:leading-[18px]">{e.description}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground tabular-nums md:text-[12px]">
          {e.stat && <span>{e.stat}</span>}
          {e.badges?.map((b) => <span key={b.text} className={cn(b.tone && TONES[b.tone])} data-tip={b.tip} data-browse-badge>{b.text}</span>)}
          {e.standIn && (e.standIn.on ? <span className="text-foreground/80" data-browse-stand-in>Vaultite's {e.standIn.name} is on</span>
            : <span data-tip="A plugin of Vaultite's does its job, and agents can read what it draws" data-browse-stand-in>Vaultite has {e.standIn.name}</span>)}
          {e.installed && <span className="text-foreground/80" data-browse-installed>Installed</span>}
        </div>
      </div>
      {e.installed ? e.plugin && <Button className="mt-0.5 min-w-20 px-3" onClick={() => show(e.plugin!)}>Show</Button>
        : alt?.on ? <Button className="mt-0.5 min-w-20 px-3" onClick={() => show(alt.id)} data-browse-action="show-stand-in">Show</Button>
        : alt ? (
          <Button look="primary" className="mt-0.5 min-w-20 px-3" disabled={busy} onClick={() => use(e)} data-browse-action="use-stand-in">{busy ? "Turning on…" : "Use Vaultite's"}</Button>
        ) : (
          <Button look="primary" className="mt-0.5 min-w-20 px-3" disabled={busy} onClick={() => install(e)} data-browse-action="install">{busy ? "Installing…" : "Install"}</Button>
        )}
      {alt ? (
        <button type="button" disabled={busy} aria-label={`${e.name}: more`} data-tip="More" data-browse-more onClick={(ev) => menuBelow(ev, [
          { label: "Install the original anyway", icon: Download, run: () => install(e) },
        ])} className="mt-0.5 -ml-1.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 max-md:size-9">
          <MoreHorizontal className="size-4" strokeWidth={2.25} />
        </button>
      ) : more && <span aria-hidden className="-ml-1.5 size-8 shrink-0 max-md:size-9" />}
    </div>
  )
}

/** A host's source (Obsidian's community plugins): its list as it answers, and Install. */
function HostBrowse({ src, query, showInstalled }: { src: BrowseSource; query: string; showInstalled: (id: string) => void }) {
  const [sort, setSort] = useState(src.sorts?.[0]?.value ?? "")
  const [found, setFound] = useState<Awaited<ReturnType<BrowseSource["search"]>> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => { src.search(query.trim(), sort).then((f) => { if (live) setFound(f) }, () => { if (live) setFound({ available: false, entries: [] }) }) }, query ? 200 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [src, query, sort, n])
  const act = async (e: BrowseEntry) => {
    setBusy(e.id)
    try { await src.install(e.id); notify(`${e.name} is installed and on`, e.plugin ? { action: { label: "Show", run: () => showInstalled(e.plugin!) } } : {}); setN((x) => x + 1) }
    catch (err) { notifyError(err, `Couldn't install ${e.name}`) } finally { setBusy(null) }
  }
  const use = async (e: BrowseEntry) => {
    const s = e.standIn!
    setBusy(e.id)
    try { await s.use(); notify(`Vaultite's ${s.name} is on`, { action: { label: "Show", run: () => showInstalled(s.id) } }); setN((x) => x + 1) }
    catch (err) { notifyError(err, `Couldn't turn on ${s.name}`) } finally { setBusy(null) }
  }
  // (any row with a … menu keeps its slot in every row, so the buttons line up)
  const more = !!found?.entries.some((e) => !e.installed && e.standIn)
  const rows = useKeptCount(`plugins:browse:${src.title}`, found ? found.entries.length : undefined)
  return (
    <>
      {src.sorts && src.sorts.length > 1 && <Segmented value={sort} options={src.sorts} onChange={setSort} label="Sort plugins" className="mb-3 w-full max-w-[300px]" />}
      {!found ? (rows ? <RowSkeletons count={rows} /> : <Loading />) : !found.available ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{src.title}'s plugin list can't be reached right now.</p>
      ) : !found.entries.length ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{query.trim() ? `No plugins match "${query.trim()}".` : "Nothing here yet."}</p>
      ) : (
        <>
          <Panel className="py-0.5">
            <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
              {found.entries.map((e) => <HostRow key={e.id} e={e} busy={busy === e.id} install={act} use={use} show={showInstalled} more={more} />)}
            </div>
          </Panel>
          {(src.note || (found.total ?? 0) > found.entries.length) && (
            <p className="mt-2 px-1 text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">
              {[(found.total ?? 0) > found.entries.length ? `The first ${found.entries.length} of ${found.total}: search to find others.` : "", src.note ?? ""].filter(Boolean).join(" ")}
            </p>
          )}
        </>
      )}
    </>
  )
}

/** `query`: the page's search field. `source`: "" the plugin directory, else the host whose source shows.
 *  `showInstalled`: back to the installed plugins, at this one. */
export function PluginBrowse({ query, source, setSource, showInstalled }: { query: string; source: string; setSource: (s: string) => void; showInstalled: (id: string) => void }) {
  usePluginsVersion()
  const sources = hostsNow().filter(([, h]) => h.browse)
  const src = sources.find(([h]) => h === source)?.[1].browse
  return (
    <section className="@container" data-plugin-browse>
      <Bundles />
      {sources.length > 0 && (
        <Segmented value={src ? source : ""} onChange={setSource} label="Where from" className="mb-3 w-full max-w-[300px]"
          options={[{ value: "", label: "Vaultite directory" }, ...sources.map(([h, info]) => ({ value: h, label: info.browse!.title }))]} />
      )}
      {src ? <HostBrowse key={source} src={src} query={query} showInstalled={showInstalled} /> : <Directory query={query} showInstalled={showInstalled} />}
      <AutoUpdates />
    </section>
  )
}

function Directory({ query, showInstalled }: { query: string; showInstalled: (id: string) => void }) {
  const [sort, setSort] = useState<Sort>("stars")
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0) // asked again after an install, or fetched again (`fresh`)
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      op<Found>("plugin.search", { q: query.trim(), sort, ...(fresh ? { refresh: true } : {}) }).then((f) => { if (live) { setFound(f); setFresh(false) } },
        () => { if (live) setFound({ url: "", available: false, plugins: [] }) })
    }, query ? 200 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [query, sort, n, fresh])
  const rows = useKeptCount("plugins:directory", found ? found.plugins.length : undefined)

  const act = async (e: Entry) => {
    setBusy(e.id)
    try {
      if (e.update) {
        const p = pluginById(e.id)
        if (p) await updatePlugin(p)
      } else {
        await op("plugin.install", { source: e.source })
        notify(`${e.name} is installed, off until you turn it on`, { action: { label: "Show", run: () => showInstalled(e.id) } })
      }
      setN((x) => x + 1)
    } catch (err) {
      notifyError(err, `Couldn't ${e.update ? "update" : "install"} ${e.name}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-plugin-directory>
      <div className="mb-3 flex items-center gap-3">
        <Segmented value={sort} options={SORTS} onChange={setSort} label="Sort plugins" className="w-full max-w-[300px]" />
        <button type="button" onClick={() => setFresh(true)} disabled={fresh} aria-label="Fetch the directory again" data-tip="Fetch again" data-browse-refresh
          className="ml-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 max-md:size-11">
          <RefreshCw className={cn("size-4", fresh && "animate-spin")} strokeWidth={2} />
        </button>
      </div>
      {!found ? (rows ? <RowSkeletons count={rows} tile /> : <Loading />) : !found.available ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>The plugin directory can't be reached right now.</p>
      ) : !found.plugins.length ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{query.trim() ? `No plugins match "${query.trim()}".` : "No plugins in the directory yet."}</p>
      ) : (
        <>
          <Panel className="py-0.5">
            <div className="flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
              {found.plugins.map((e) => <EntryRow key={e.id} e={e} busy={busy === e.id} act={act} />)}
            </div>
          </Panel>
          <p className="mt-2 px-1 text-[13px] leading-[18px] text-muted-foreground md:text-[12px] md:leading-[16px]">
            Plugins from GitHub run code on this machine once you turn them on: what each says it does is above, unchecked.
          </p>
        </>
      )}
    </div>
  )
}
