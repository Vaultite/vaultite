import { useEffect, useState, type ReactNode } from "react"
import { Check, ChevronRight, Download, ExternalLink, MoreHorizontal, Puzzle, RefreshCw, type LucideIcon } from "lucide-react"
import { dateText, fmtAgo, numberText, reload } from "@/core/data"
import { op } from "@/core/http"
import { openWebLink } from "@/core/links"
import { snippet } from "@/core/plaintext"
import { openDetail, replaceDetail } from "@/core/nav"
import { GitHubIcon } from "@/core/icons"
import { notify, notifyError } from "@/core/notify"
import { pluginIcon } from "@/core/pages"
import { useKeptCount } from "@/core/heights"
import { official } from "../../../core/updates.ts"
import { CATEGORIES, categoryOf, OTHER } from "../../../core/categories.ts"
import { cell } from "@/core/signal"
import { Bar, List, Loading, Panel, Row, Section, SheetHead } from "@/components/kit"
import { menuBelow } from "@/components/ContextMenu"
import { confirmDialog } from "@/components/ConfirmDialog"
import { capitalize, cn } from "@/lib/utils"
import { disclosed, type Disclosures } from "../../../core/pluginmeta.ts"
import type { BrowseEntry, BrowseSource } from "@/core/define"
import { hostsNow, pluginById, setSwitch, updatePlugin, usePluginsVersion } from "@/core/plugins"
import { Button } from "@/components/Button"
import { Certified } from "@/components/Certified"
import { overConnect } from "@/core/here"

type Sort = "stars" | "new" | "updated"
type Entry = {
  id: string; name: string; description: string; author: string; repo: string; dir: string | null; source: string; version: string; stars: number; released: string | null
  pushed: string | null; created: string | null; disclosures: Disclosures; installed: string | null; ours: boolean; update: boolean; blocked: string | null
  readme: string; fundingUrl?: string
  icon?: string; tint?: string; category?: string
  desktopApp?: boolean
}
type Found = { url: string; available: boolean; error?: string; plugins: Entry[] }

const SORTS: { value: Sort; label: string }[] = [{ value: "stars", label: "Top" }, { value: "new", label: "New" }, { value: "updated", label: "Updated" }]

export type GetShow = "all" | "not" | "installed"
export type GetFilters = { source: string; sort: string; show: GetShow; cat: string }
export const GET_NONE: GetFilters = { source: "", sort: "", show: "all", cat: "" }
export const SHOWS: Record<GetShow, string> = { all: "All", not: "Not installed", installed: "Installed" }
export type Listed = { installed: boolean; category?: string }[]

export const getSources = () => [{ value: "", label: "Vaultite directory" }, ...hostsNow().filter(([, h]) => h.browse).map(([h, info]) => ({ value: h, label: info.browse!.title }))]
const hostSource = (source: string) => hostsNow().find(([h, info]) => h === source && info.browse)?.[1].browse
export const sortsOf = (source: string) => (source ? hostSource(source)?.sorts ?? [] : SORTS)
export const sortOf = (f: GetFilters) => { const all = sortsOf(f.source); return all.find((s) => s.value === f.sort)?.value ?? all[0]?.value ?? "" }
export const passesGet = (e: { installed: boolean; category?: string }, f: GetFilters) =>
  (f.show === "all" || e.installed === (f.show === "installed")) && (!f.cat || categoryOf(e.category).id === f.cat)

export function categoriesIn(l: Listed | null) {
  if (!l?.some((e) => e.category)) return []
  const ids = new Set(l.map((e) => categoryOf(e.category).id))
  return [...CATEGORIES, OTHER].filter((c) => ids.has(c.id))
}

export const getCategory = cell("")
export type GetCategory = { id: string; label: string; count: number }
export const getCategories = cell<GetCategory[]>([])
function noteCategories(l: Listed) {
  const next = categoriesIn(l).map((c) => ({ ...c, count: l.filter((e) => categoryOf(e.category).id === c.id).length }))
  if (JSON.stringify(next) !== JSON.stringify(getCategories.get())) getCategories.set(next)
}
let primed = false
export function primeCategories() {
  if (primed || getCategories.get().length || overConnect()) return
  primed = true
  op<Found>("plugin.search", { q: "", sort: SORTS[0].value }).then((f) => { if (f.available) noteCategories(f.plugins.map((e) => ({ installed: e.installed !== null, category: e.category }))) }, () => {})
}

const githubOf = (e: Entry) => `https://github.com/${e.repo}${e.dir ? `/tree/HEAD/${e.dir}` : ""}`

const seen = new Map<string, Entry>()
const seenHosted = new Map<string, BrowseEntry>()

function openEntry(e: Entry) {
  seen.set(e.id, e)
  openDetail(e.installed !== null && pluginById(e.id) ? `plugin/${e.id}` : `plugin-get/${e.id}`)
}

function Tappable({ id, name, open, have, children }: { id: string; name: string; open: () => void; have?: boolean; children: ReactNode }) {
  return (
    <div className={cn("group/prow relative isolate flex items-start gap-3 py-2.5", have && "[&>:not(button):not([data-browse-have])]:opacity-55")} data-browse-row={id} data-browse-have-row={have || undefined}>
      <button type="button" onClick={open} aria-label={`${name}: details`} data-browse-open={id}
        className="absolute inset-y-0 -inset-x-2 -z-10 cursor-pointer rounded-[8px] transition-colors group-hover/prow:bg-foreground/[0.04] active:bg-foreground/[0.07]" />
      {children}
      <ChevronRight className="pointer-events-none mt-2.5 -ml-1 size-4 shrink-0 text-tertiary max-md:mt-3" strokeWidth={2.5} />
    </div>
  )
}

function TitleLine({ name, mark, children }: { name: string; mark?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="flex min-w-0 items-baseline gap-x-1.5">
        <span className="min-w-0 truncate text-[15px] leading-[20px] font-medium md:text-[14px]" data-browse-name>{name}</span>{mark}
      </span>
      <span className="flex min-w-0 items-baseline gap-x-2.5 overflow-hidden text-[13px] whitespace-nowrap text-muted-foreground tabular-nums max-md:basis-full md:text-[12px]">{children}</span>
    </div>
  )
}

const Have = () => (
  <span className="pointer-events-none mt-0.5 flex h-8 min-w-20 shrink-0 items-center justify-center gap-1 text-[13px] text-muted-foreground max-md:h-9 max-md:text-[15px]" data-browse-installed data-browse-have>
    <Check className="size-3.5" strokeWidth={2.5} />Installed
  </span>
)
const haveLast = <T,>(list: T[], have: (e: T) => boolean) => [...list].sort((a, b) => Number(have(a)) - Number(have(b)))

const Description = ({ text }: { text?: string }) =>
  text ? <p className="text-[14px] leading-[19px] text-muted-foreground max-md:line-clamp-2 md:truncate md:text-[13px] md:leading-[18px]">{text}</p> : null

function EntryRow({ e, busy, act }: { e: Entry; busy: boolean; act: (e: Entry) => void }) {
  const updated = e.released ?? e.pushed
  const ours = official(e.source)
  const says = ours ? [] : disclosed(e.disclosures)
  const button = e.blocked ? null : e.update ? "Update" : e.installed !== null ? null : "Install"
  const Icon = pluginIcon(e.icon) ?? Puzzle
  const have = e.installed !== null && !e.update
  return (
    <Tappable id={e.id} name={e.name} open={() => openEntry(e)} have={have}>
      <span className="pointer-events-none mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted md:size-8 md:rounded-[8px]" style={{ color: e.tint && `var(--${e.tint})` }} data-browse-icon>
        <Icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <TitleLine name={e.name} mark={ours && <Certified className="pointer-events-auto shrink-0 self-center" />}>
          {!ours && e.author && <span>{e.author}</span>}
          <span>{e.version}</span>
          {updated && <span className="pointer-events-auto" data-tip={dateText(new Date(updated), { day: "numeric", month: "long", year: "numeric" })}>updated {fmtAgo(updated)}</span>}
          {e.update && <span className="text-foreground/80">{e.installed} installed</span>}
        </TitleLine>
        <Description text={e.description} />
        {says.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" data-browse-discloses>
            {says.map((s) => <span key={s} className="rounded-[5px] bg-muted px-1.5 py-px text-[12px] leading-[17px] text-muted-foreground md:text-[11px] md:leading-[16px]">{capitalize(s)}</span>)}
          </div>
        )}
        {e.blocked && <div className="mt-0.5 text-[13px] text-ink-(--red) md:text-[12px]">Blocked by the directory: a known problem with this version.</div>}
      </div>
      {button && (
        <button type="button" disabled={busy} onClick={() => act(e)} data-browse-action={button.toLowerCase()}
          className={cn("mt-0.5 h-8 min-w-20 shrink-0 cursor-pointer rounded-[8px] px-3 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-50 max-md:h-9 max-md:text-[15px]",
            button === "Install" ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-foreground/[0.06] hover:bg-foreground/[0.1]")}>
          {busy ? (button === "Install" ? "Installing…" : "Updating…") : button}
        </button>
      )}
      {have && <Have />}
    </Tappable>
  )
}

function RowSkeletons({ count, tile }: { count: number; tile?: boolean }) {
  return (
    <Panel className="loading-in py-0.5">
      <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border" aria-busy>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-start gap-3 py-2.5">
            {tile && <span className="mt-0.5 size-9 shrink-0 rounded-[9px] bg-muted md:size-8 md:rounded-[8px]" />}
            <div className="min-w-0 flex-1">
              <div className="text-[15px] leading-[20px] md:text-[14px]"><Bar w={i % 2 ? "30%" : "38%"} /></div>
              <p className="text-[14px] leading-[19px] md:text-[13px] md:leading-[18px]"><Bar w={i % 2 ? "78%" : "88%"} /></p>
            </div>
            <span className="mt-0.5 h-9 w-20 shrink-0 rounded-[8px] bg-muted md:h-8" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

const TONES = { green: "text-ink-(--green)", orange: "text-ink-(--orange)", red: "text-ink-(--red)" }


function HostRow({ host, e, busy, install, use, show, more }: { host: string; e: BrowseEntry; busy: boolean; install: (e: BrowseEntry) => void; use: (e: BrowseEntry) => void; show: (id: string) => void; more: boolean }) {
  const alt = !e.installed ? e.standIn : undefined
  const open = () => {
    const key = `${host}:${e.id}`
    seenHosted.set(key, e)
    openDetail(e.installed && e.plugin && pluginById(e.plugin) ? `plugin/${e.plugin}` : `plugin-get/${encodeURIComponent(key)}`)
  }
  return (
    <Tappable id={e.id} name={e.name} open={open} have={!!e.installed}>
      <div className="pointer-events-none min-w-0 flex-1">
        <TitleLine name={e.name}>
          {e.author && <span>{e.author}</span>}
          {e.stat && <span>{e.stat}</span>}
          {e.badges?.map((b) => <span key={b.text} className={cn("pointer-events-auto", b.tone && TONES[b.tone])} data-tip={b.tip} data-browse-badge>{b.text}</span>)}
          {e.standIn && (e.standIn.on ? <span className="text-foreground/80" data-browse-stand-in>Vaultite's {e.standIn.name} is on</span>
            : <span className="pointer-events-auto" data-tip="A plugin of Vaultite's does its job, and agents can read what it draws" data-browse-stand-in>Vaultite has {e.standIn.name}</span>)}
        </TitleLine>
        <Description text={e.description} />
      </div>
      {e.installed ? <Have />
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
    </Tappable>
  )
}

async function installHosted(src: BrowseSource, e: BrowseEntry, show?: (id: string) => void) {
  try {
    await src.install(e.id)
    notify(`${e.name} is installed and on`, e.plugin && show ? { action: { label: "Show", run: () => show(e.plugin!) } } : {})
    return true
  } catch (err) { notifyError(err, `Couldn't install ${e.name}`); return false }
}
async function turnOnStandIn(e: BrowseEntry, show?: (id: string) => void) {
  const s = e.standIn!
  try {
    await s.use()
    notify(`Vaultite's ${s.name} is on`, show ? { action: { label: "Show", run: () => show(s.id) } } : {})
    return true
  } catch (err) { notifyError(err, `Couldn't turn on ${s.name}`); return false }
}

function HostBrowse({ host, src, query, filters, showInstalled, onListed }: { host: string; src: BrowseSource; query: string; filters: GetFilters; showInstalled: (id: string) => void; onListed: (l: Listed | null) => void }) {
  const sort = sortOf(filters)
  const [found, setFound] = useState<Awaited<ReturnType<BrowseSource["search"]>> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  const v = usePluginsVersion()
  useEffect(() => {
    let live = true
    const t = setTimeout(() => { src.search(query.trim(), sort).then((f) => { if (live) setFound(f) }, () => { if (live) setFound({ available: false, entries: [] }) }) }, query ? 200 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [src, query, sort, n, v])
  const act = async (e: BrowseEntry) => {
    setBusy(e.id)
    if (await installHosted(src, e, showInstalled)) setN((x) => x + 1)
    setBusy(null)
  }
  const use = async (e: BrowseEntry) => {
    setBusy(e.id)
    if (await turnOnStandIn(e, showInstalled)) setN((x) => x + 1)
    setBusy(null)
  }
  useEffect(() => { onListed(found?.available ? found.entries.map((e) => ({ installed: !!e.installed })) : null) }, [found, onListed])
  const entries = haveLast(found?.entries.filter((e) => passesGet({ installed: !!e.installed }, filters)) ?? [], (e) => !!e.installed)
  const more = entries.some((e) => !e.installed && e.standIn)
  const rows = useKeptCount(`plugins:browse:${src.title}`, found ? entries.length : undefined)
  return (
    <>
      <ListHead title={`${src.title} plugins`} />
      {!found ? (rows ? <RowSkeletons count={rows} /> : <Loading />) : !found.available ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{src.title}'s plugin list can't be reached right now.</p>
      ) : !entries.length ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{emptyText(query, found.entries.length > 0, "Nothing here yet.")}</p>
      ) : (
        <>
          <Panel className="py-0.5">
            <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
              {entries.map((e) => <HostRow key={e.id} host={host} e={e} busy={busy === e.id} install={act} use={use} show={showInstalled} more={more} />)}
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

function ListHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-1.5 flex min-h-7 items-center gap-2 px-1" data-browse-head>
      <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-muted-foreground md:text-[12px]">{title}</h2>
      {children}
    </div>
  )
}

const emptyText = (query: string, some: boolean, none: string) =>
  some ? "No plugins match these filters." : query.trim() ? `No plugins match "${query.trim()}".` : none

export function PluginBrowse({ query, filters, showInstalled, onListed }: { query: string; filters: GetFilters; showInstalled: (id: string) => void; onListed: (l: Listed | null) => void }) {
  usePluginsVersion()
  const src = filters.source ? hostSource(filters.source) : undefined
  return (
    <section className="@container" data-plugin-browse>
      {src ? <HostBrowse key={filters.source} host={filters.source} src={src} query={query} filters={filters} showInstalled={showInstalled} onListed={onListed} />
        : <Directory query={query} filters={filters} showInstalled={showInstalled} onListed={onListed} />}
    </section>
  )
}

export function DirectoryMatches({ query, showInstalled }: { query: string; showInstalled: (id: string) => void }) {
  return <Directory query={query} showInstalled={showInstalled} compact />
}

async function installEntry(e: Entry, show?: (id: string) => void) {
  try {
    if (e.update) {
      const p = pluginById(e.id)
      if (p) await updatePlugin(p)
      return true
    }
    const says = official(e.source) ? [] : disclosed(e.disclosures)
    if (!official(e.source) && !(await confirmDialog({
      title: `Install and turn on ${e.name}?`,
      body: `It runs code on the machine that serves this app, with your files${says.length ? `. It says it ${says.join(", ")}` : ""}. Install only plugins you trust.`,
      confirm: "Install",
    }))) return false
    await op("plugin.install", { source: e.source })
    await reload()
    const p = pluginById(e.id)
    if (p) setSwitch(p, true); else await op("plugin.enable", { id: e.id })
    notify(`${e.name} is installed and on`, show ? { action: { label: "Show", run: () => show(e.id) } } : {})
    return true
  } catch (err) {
    notifyError(err, `Couldn't ${e.update ? "update" : "install"} ${e.name}`)
    return false
  }
}

function Directory({ query, filters = GET_NONE, showInstalled, onListed, compact }: { query: string; filters?: GetFilters; showInstalled: (id: string) => void; onListed?: (l: Listed | null) => void; compact?: boolean }) {
  const sort = sortOf(filters)
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [n, setN] = useState(0)
  const [fresh, setFresh] = useState(false)
  const v = usePluginsVersion()
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      op<Found>("plugin.search", { q: query.trim(), sort, ...(fresh ? { refresh: true } : {}) }).then((f) => { if (live) { setFound(f); setFresh(false) } },
        () => { if (live) setFound({ url: "", available: false, plugins: [] }) })
    }, query ? 200 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [query, sort, n, fresh, v])
  useEffect(() => {
    const l = found?.available ? found.plugins.map((e) => ({ installed: e.installed !== null, category: e.category })) : null
    onListed?.(l)
    if (l && !compact && !query.trim()) noteCategories(l)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- noted only when a new list comes
  }, [found, onListed])
  const shown = haveLast(found?.plugins.filter((e) => passesGet({ installed: e.installed !== null, category: e.category }, filters)) ?? [], (e) => e.installed !== null && !e.update)
  const rows = useKeptCount(compact ? "plugins:matches" : "plugins:directory", found ? shown.length : undefined)

  const act = async (e: Entry) => {
    setBusy(e.id)
    if (await installEntry(e, showInstalled)) setN((x) => x + 1)
    setBusy(null)
  }

  if (compact) {
    const notHere = found?.plugins.filter((e) => e.installed === null) ?? []
    if (!notHere.length) return null
    return (
      <section className="mt-5" data-plugins-not-installed>
        <h2 className="mb-1.5 px-1 text-[13px] font-semibold text-muted-foreground md:text-[12px]">Not installed</h2>
        <Panel className="py-0.5">
          <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
            {notHere.map((e) => <EntryRow key={e.id} e={e} busy={busy === e.id} act={act} />)}
          </div>
        </Panel>
      </section>
    )
  }

  return (
    <div data-plugin-directory>
      <ListHead title="Plugins">
        <button type="button" onClick={() => setFresh(true)} disabled={fresh} aria-label="Fetch the directory again" data-tip="Fetch again" data-browse-refresh
          className="-my-1 -mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50 max-md:size-11">
          <RefreshCw className={cn("size-3.5", fresh && "animate-spin")} strokeWidth={2} />
        </button>
      </ListHead>
      {!found ? (rows ? <RowSkeletons count={rows} tile /> : <Loading />) : !found.available ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>The plugin directory can't be reached right now.</p>
      ) : !shown.length ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground md:text-[13px]" data-browse-empty>{emptyText(query, found.plugins.length > 0, "No plugins in the directory yet.")}</p>
      ) : (
        <Panel className="py-0.5">
          <div className="flex flex-col [&>:where(:not(:first-child))]:border-t-[0.5px] [&>:where(:not(:first-child))]:border-border">
            {shown.map((e) => <EntryRow key={e.id} e={e} busy={busy === e.id} act={act} />)}
          </div>
        </Panel>
      )}
    </div>
  )
}

function WebLink({ url }: { url: string }) {
  const github = /^https:\/\/github\.com\//.test(url)
  const Icon: LucideIcon = github ? GitHubIcon : ExternalLink
  return (
    <button type="button" onClick={() => openWebLink(url)} aria-label={github ? "Open on GitHub" : "Open its page"} data-tip={github ? "GitHub" : "Its page"} data-browse-web
      className="ml-auto grid size-11 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-9 md:rounded-[8px]">
      <Icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
    </button>
  )
}

const BIG = "h-11 min-w-32 px-5 text-[17px] md:h-9 md:min-w-28 md:text-[14px]"
const NOTE = "text-[15px] leading-[20px] text-muted-foreground md:text-[13px] md:leading-[18px]"

export function GetPluginSheet({ id }: { id: string }) {
  const at = id.indexOf(":")
  return at < 0 ? <DirectorySheet key={id} id={id} /> : <HostedSheet key={id} host={id.slice(0, at)} id={id.slice(at + 1)} />
}

const notFound = (what: string) => <SheetHead icon={Puzzle} tint="var(--muted-foreground)" kicker="Not found" title={what} />

function DirectorySheet({ id }: { id: string }) {
  const v = usePluginsVersion()
  const [e, setE] = useState<Entry | null | undefined>(() => seen.get(id))
  const [busy, setBusy] = useState(false)
  const [goOn, setGoOn] = useState(() => { const s = seen.get(id); return !!s && s.installed !== null && !s.update && !pluginById(id) })
  useEffect(() => { if (goOn && pluginById(id)) replaceDetail(`plugin/${id}`) }, [goOn, id, v])
  useEffect(() => {
    let live = true
    op<Found>("plugin.search", { q: id }).then((f) => {
      if (!live) return
      const got = f.plugins.find((x) => x.id === id)
      if (got) seen.set(id, got)
      setE(got ?? seen.get(id) ?? null)
    }, () => { if (live) setE((x) => x ?? null) })
    return () => { live = false }
  }, [id, v])
  if (e === undefined) return <Loading />
  if (!e) return notFound("This plugin isn't in the directory")
  const ours = official(e.source)
  const says = disclosed(e.disclosures)
  const Icon = pluginIcon(e.icon) ?? Puzzle
  const updated = e.released ?? e.pushed
  const here = e.installed !== null && !!pluginById(e.id)
  const install = async () => {
    setBusy(true)
    const ok = await installEntry(e)
    setBusy(false)
    if (ok) setGoOn(true)
  }
  return (
    <div data-browse-sheet={e.id}>
      <SheetHead icon={Icon} tint={e.tint ? `var(--${e.tint})` : "var(--primary)"} kicker={ours ? "Vaultite" : e.author || "Plugin directory"}
        title={<>{e.name}{ours && <Certified className="ml-1.5 align-[1px]" />}</>} sub={e.description} />
      <div className="mb-5 flex items-center gap-3">
        {e.blocked ? <p className="min-w-0 flex-1 text-[15px] text-ink-(--red) md:text-[13px]">Blocked by the directory: a known problem with this version.</p>
          : here && !e.update ? <>
            <span className={cn(NOTE, "text-foreground/80")} data-browse-installed>Installed</span>
            <Button className={BIG} onClick={() => replaceDetail(`plugin/${e.id}`)} data-browse-sheet-show>Show</Button>
          </> : (
            <Button look="primary" className={BIG} disabled={busy} onClick={() => void install()} data-browse-sheet-action={e.update ? "update" : "install"}>
              {busy ? (e.update ? "Updating…" : "Installing…") : e.update ? `Update to ${e.version}` : "Install"}
            </Button>
          )}
        <WebLink url={githubOf(e)} />
      </div>
      {!ours && !here && !e.blocked && <p className={cn(NOTE, "-mt-2 mb-5 px-1")}>Installing turns it on: it runs code on the machine that serves this app, with your files. Install only plugins you trust.</p>}
      {says.length > 0 && (
        <Section title="What it says it does" className="mb-5">
          <List>{says.map((x) => <Row key={x} title={capitalize(x)} />)}</List>
        </Section>
      )}
      <Section title="About" className="mb-5">
        <List>
          {e.desktopApp && <Row title="Works in" right="The desktop app on a Mac" />}
          <Row title="Version" right={e.installed && e.update ? `${e.version} (${e.installed} installed)` : e.version} />
          {e.author && <Row title="Author" right={e.author} />}
          <Row title="Source" right={e.source} />
          {updated && <Row title="Updated" right={dateText(new Date(updated), { day: "numeric", month: "short", year: "numeric" })} />}
          {e.stars > 0 && <Row title="Stars" right={numberText(e.stars)} />}
          {e.fundingUrl && <Row title="Support it" right={<button type="button" onClick={() => openWebLink(e.fundingUrl!)}
            className="cursor-pointer text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground">{new URL(e.fundingUrl).host}</button>} />}
        </List>
      </Section>
      {e.readme && (
        <Section title="From its readme" className="mb-5">
          <p className="px-1 text-[15px] leading-[21px] md:text-[14px] md:leading-[20px]" data-browse-readme>{snippet(e.readme)}</p>
        </Section>
      )}
      {!here && <p className={cn(NOTE, "px-1")}>Its preview shows once it's installed and on: nothing of a plugin from GitHub runs before then.</p>}
    </div>
  )
}

function HostedSheet({ host, id }: { host: string; id: string }) {
  const v = usePluginsVersion()
  const key = `${host}:${id}`
  const src = hostsNow().find(([h]) => h === host)?.[1].browse
  const [e, setE] = useState<BrowseEntry | null | undefined>(() => seenHosted.get(key))
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!src) return
    let live = true
    src.search(id, src.sorts?.[0]?.value ?? "").then((f) => {
      if (!live) return
      const got = f.entries.find((x) => x.id === id)
      if (got) seenHosted.set(key, got)
      setE(got ?? seenHosted.get(key) ?? null)
    }, () => { if (live) setE((x) => x ?? null) })
    return () => { live = false }
  }, [src, id, key, v])
  if (!src) return notFound("This source isn't here now")
  if (e === undefined) return <Loading />
  if (!e) return notFound(`This plugin isn't in ${src.title}`)
  const alt = !e.installed ? e.standIn : undefined
  const show = (pid: string) => replaceDetail(`plugin/${pid}`)
  const run = async (f: () => Promise<boolean>, then?: string) => {
    setBusy(true)
    const ok = await f()
    setBusy(false)
    if (ok && then && pluginById(then)) show(then)
  }
  return (
    <div data-browse-sheet={e.id}>
      <SheetHead icon={Puzzle} tint="var(--primary)" kicker={src.title} title={e.name} sub={e.description} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {e.installed ? <>
          <span className={cn(NOTE, "text-foreground/80")} data-browse-installed>Installed</span>
          {e.plugin && <Button className={BIG} onClick={() => show(e.plugin!)} data-browse-sheet-show>Show</Button>}
        </> : alt?.on ? <Button className={BIG} onClick={() => show(alt.id)} data-browse-sheet-show>Show Vaultite's {alt.name}</Button>
          : alt ? <>
            <Button look="primary" className={BIG} disabled={busy} onClick={() => void run(() => turnOnStandIn(e), alt.id)} data-browse-sheet-action="use-stand-in">
              {busy ? "Turning on…" : `Use Vaultite's ${alt.name}`}</Button>
            <Button disabled={busy} onClick={() => void run(() => installHosted(src, e), e.plugin)} data-browse-sheet-action="install">Install the original</Button>
          </> : (
            <Button look="primary" className={BIG} disabled={busy} onClick={() => void run(() => installHosted(src, e), e.plugin)} data-browse-sheet-action="install">
              {busy ? "Installing…" : "Install"}</Button>
          )}
        {e.url && <WebLink url={e.url} />}
      </div>
      {alt && !alt.on && <p className={cn(NOTE, "-mt-2 mb-5 px-1")}>Vaultite's {alt.name} does its job, and agents can read what it draws.</p>}
      {(e.author || e.stat || !!e.badges?.length) && (
        <Section title="About" className="mb-5">
          <List>
            {e.author && <Row title="Author" right={e.author} />}
            {e.stat && <Row title="Used by" right={e.stat} />}
            {e.badges?.map((b) => <Row key={b.text} title={<span className={cn(b.tone && TONES[b.tone])}>{b.text}</span>} meta={b.tip} wrap />)}
          </List>
        </Section>
      )}
    </div>
  )
}
