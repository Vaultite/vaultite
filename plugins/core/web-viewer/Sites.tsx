// Sites: a set of logins' accounts and the sites always opened there, then the rest folded with its trackers (Clear).
// Drawn as the sidebar's Sites panel (one set of logins), the Sites tab (every set, containers managed) and in settings.
import { forwardRef, useEffect, useId, useRef, useState } from "react"
import { ArrowRightLeft, Bot, ChevronDown, ChevronRight, ChevronsUpDown, Copy, Ellipsis, EyeOff, Fingerprint, Globe, LogOut, Pin, Plus, Settings2 } from "lucide-react"
import {
  edgeScroller, Button, confirmDialog, dotIcon, FilterField, fmtAgo, Group, HeadingButton, isViewOpen, menuBelow, menuFor, openView, PageHeader, plural, rehit, reorder, scopedState, Section,
  SettingRow, SidebarHeading, SidebarRow, slotAt, startDrag, useDrag, useDropHit, useDropTarget, useScopedState, useSlide, useWorkspaceVersion, webPages,
  type MenuItem, type SidebarCtx, type WebSite,
} from "@vaultite"
import type { LucideIcon, LucideProps } from "lucide-react"
import { askSites, elsewhere, keep, listed, type MachineSets } from "./accounts"
import { SiteIcon, siteIcon } from "./icons"
import { colorOf, containersOf, moveContainer, setSiteRule, useContainers, type Container } from "./containers"
import { agentsSay, canLockNow, containerItems, newContainer, useCanLock } from "./ContainerButton"
import { allLogins, allLoginsOn, andList, isIn, loginsOf, loginsOn, moveLogin, nameOf, NEUTRAL, ownLogins, refreshElsewhere, setOrder, signingOut, sitesIn, sitesOf, type Logins } from "./loginsets"
import { settings } from "./state"

/** Show every set of logins and their containers' options: the Sites tab. */
export const manageContainers = () => openView("web-pages", { newTab: !isViewOpen("view:web-pages") })

/** The Sites panel's logins, per workspace: a container's id, or null for the workspace's own. */
const PICKED = "web-viewer:sites-in"
const pickedNow = () => scopedState<string | null>(PICKED, null)

/** Open an address in a web tab (a new one, or the tab already showing it), in a container or none. */
type Open = (url: string, container?: string | null) => void

function useOwnLogins(): Logins {
  useWorkspaceVersion()
  settings.use()
  return ownLogins()
}
function useAllLogins(): Logins[] {
  useWorkspaceVersion()
  settings.use()
  useContainers()
  return allLogins()
}

/** The sites of `prof` as last listed (a move lists both sides again), asked again when a page done loading may have
 *  signed in or out; the ones leaving from here gone at once (`leaving`: a row's while it folds away). */
function useSites(prof: string) {
  const sites = listed.use((m) => m.get(prof) ?? null)
  useEffect(() => {
    const web = webPages
    if (!web?.sites) return
    let timer = 0
    askSites([prof])
    const off = web.on((m) => {
      if (m.type === "state" && !m.state.loading) { clearTimeout(timer); timer = window.setTimeout(() => askSites([prof]), 1500) }
    })
    return () => { off(); clearTimeout(timer) }
  }, [prof])
  const { list, leaving } = signingOut(prof).use(sites, (s) => s.site)
  return { sites: list?.filter((s) => !s.other) ?? null, others: list?.filter((s) => s.other) ?? [], leaving,
    refresh: () => void webPages?.sites?.(prof).then((s) => keep(prof, s), () => {}) }
}

/** Forget sites in a set of logins: their rows go at once; the list is asked again once it's done. */
function forget(l: Logins, names: string[], failed: string, done: () => void) {
  const web = webPages
  if (!web?.forget) return
  void signingOut(l.prof).remove(names, () => Promise.all(names.map((n) => web.forget!(l.prof, n))), failed).then(done)
}

/** Everyone signed in, in a line. */
const whoText = (s: WebSite) => [s.account, ...(s.more ?? [])].filter(Boolean).join(", ")

async function signOut(l: Logins, s: WebSite, done: () => void) {
  const names = sitesOf(s), who = whoText(s)
  const ok = await confirmDialog({
    title: `Sign out of ${andList(names)}?`,
    body: `${who ? `${who} will be signed out` : "Its logins go"} in ${l.name}: ${names.length > 1 ? "their" : "the site's"} cookies and what ${names.length > 1 ? "they keep" : "it keeps"} in the browser are deleted. Open pages of ${names.length > 1 ? "them" : "it"} reload.`,
    confirm: "Sign out", danger: true,
  })
  if (ok) forget(l, names, "Couldn't sign out", done)
}

/** Clear the trackers' cookies (and storage), after showing which. */
async function clearTrackers(l: Logins, others: WebSite[], done: () => void) {
  const names = others.map((s) => s.site)
  const ok = await confirmDialog({
    title: `Clear ${plural(names.length, "tracker")}?`,
    body: `Cookies these sites left while you were on other sites' pages (ad and analytics networks, not logins of yours): ${names.join(", ")}. Their cookies and storage are deleted.`,
    confirm: "Clear", danger: true,
  })
  if (ok) forget(l, names, "Couldn't clear them", done)
}

const Dot = ({ color }: { color: string }) => <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />

const trackersTip = (others: WebSite[]) => `Cookies from sites you didn't open, left by other sites' pages: ${others.map((s) => s.site).join(", ")}`

/** A set of logins' sites, as sidebar rows (the panel) or setting rows (the settings). */
function SiteList({ logins: l, look, openPage }: { logins: Logins; look: "sidebar" | "settings"; openPage?: Open }) {
  const { sites, others, leaving, refresh } = useSites(l.prof)
  const trackersLeaving = others.length && others.every((s) => leaving(s.site) === "") ? "" : undefined
  const containers = useContainers()
  const can = useCanLock()
  const c = l.container ? containers.find((x) => x.id === l.container) : undefined
  const [unfolded, unfold] = useState(false)
  if (look === "settings") {
    // A row per set of logins, unfolding to its sites: the section stays short above the options.
    const Chevron = unfolded ? ChevronDown : ChevronRight
    const row = "flex min-h-10 items-center gap-2.5 py-1 pl-4.5 text-[14px]"
    return (
      <>
        <SettingRow label={<span className="flex items-center gap-2"><Dot color={l.color} />{l.name}</span>} onClick={() => unfold(!unfolded)} chevron={Chevron}
          aria-expanded={unfolded} data-web-logins-group={l.container ?? l.prof} onContextMenu={c ? menuFor(() => containerItems(c, can)) : undefined}
          value={sites === null ? "" : [sites.length ? plural(sites.length, "site") : "No sites", others.length ? plural(others.length, "tracker") : ""].filter(Boolean).join(", ")} />
        {unfolded && (
          <div className="pb-1.5" data-web-sites>
            {(sites ?? []).map((s) => (
              <div key={s.site} className={row} data-web-site={s.site} data-leaving={leaving(s.site)}>
                <SiteIcon host={s.site} className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2"><span className="truncate">{s.site}</span>
                  {isIn(s) && <span className="min-w-0 truncate text-[13px] text-muted-foreground">{s.account || "Signed in"}</span>}</span>
                <Button size="small" look="quiet" onClick={() => void signOut(l, s, refresh)}>Sign out</Button>
              </div>
            ))}
            {others.length > 0 && (
              <div className={row} data-web-trackers={String(others.length)} data-leaving={trackersLeaving}>
                <EyeOff className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate" data-tip={trackersTip(others)} data-tip-trunc="">{plural(others.length, "tracker")}
                  <span className="ml-2 text-[13px] text-muted-foreground">cookies other sites' pages left</span></span>
                <Button size="small" look="quiet" onClick={() => void clearTrackers(l, others, refresh)}>Clear</Button>
              </div>
            )}
            {sites && !sites.length && !others.length && <p className={`${row} text-muted-foreground`}>No sites yet</p>}
            {c && <div className={row}><Button size="small" look="quiet" onClick={(e) => menuBelow(e, containerItems(c, can))}>{c.name} options</Button></div>}
          </div>
        )}
      </>
    )
  }
  return <SiteRows logins={l} data={{ sites, others, leaving, refresh }} openPage={openPage} />
}

type Listed = ReturnType<typeof useSites>
/** Shown without folding when this few are left over. */
const FEW = 3
const matches = (s: WebSite, q: string) => sitesOf(s).some((x) => x.includes(q)) || whoText(s).toLowerCase().includes(q)

/** A set of logins' sites as rows: accounts and always-open sites in the order dragged into (else pinned, then A to Z),
 *  then the rest and trackers, folded past a few; dragged onto another card to move there (another machine's: only shown). */
function SiteRows({ logins: l, data, openPage, filter = "" }: { logins: Logins; data: Listed; openPage?: Open; filter?: string }) {
  const { sites, leaving, refresh } = data, there = !!l.machine
  const others = there ? [] : data.others
  const containers = useContainers()
  const c = l.container ? containers.find((x) => x.id === l.container) : undefined
  const [unfolded, unfold] = useState(false)
  const open = (url: string) => openPage?.(url, l.container)
  // A container's sites always opened there, signed in to or not.
  const always = c?.sites ?? []
  const q = filter.trim().toLowerCase()
  const all = [...(sites ?? []), ...(sites ? always.filter((a) => !sites.some((s) => sitesOf(s).includes(a))).map((site): WebSite => ({ site })) : [])]
    .filter((s) => !q || matches(s, q))
  const pinned = (s: WebSite) => sitesOf(s).some((x) => always.includes(x))
  const order = settings.use().siteOrder?.[l.prof] ?? []
  const rank = (s: WebSite) => Math.min(...sitesOf(s).map((x) => order.indexOf(x)).filter((i) => i >= 0))
  const top = all.filter((s) => isIn(s) || pinned(s))
    .sort((a, b) => rank(a) - rank(b) || Number(pinned(b)) - Number(pinned(a)) || a.site.localeCompare(b.site))
  const rest = all.filter((s) => !isIn(s) && !pinned(s))
  const trackers = q ? others.filter((s) => matches(s, q)) : others
  const trackersLeaving = trackers.length && trackers.every((s) => leaving(s.site) === "") ? "" : undefined
  const folds = !q && rest.length + (trackers.length ? 1 : 0) > FEW
  const shown = !folds || unfolded
  const signedIn = (s: WebSite) => !!sites?.some((x) => x.site === s.site)
  const box = useRef<HTMLDivElement>(null)
  useSlide(box, useSiteOrder(box, l.prof, q || there ? [] : top.map((s) => s.site)), "y")
  const lifted = useDrag((d) => (d?.item.site?.logins === l.prof ? d.item.site.site : null))
  const machines = elsewhere.use()
  const to = (o: Logins, copy: boolean) => (s: WebSite): MenuItem => ({ label: o.name, icon: dotIcon(o.color), run: () => void moveLogin(l, o, s, copy) })
  const targets = (copy: boolean) => (s: WebSite): MenuItem[] => [
    ...allLogins().filter((o) => o.prof !== l.prof).map((o) => to(o, copy)(s)),
    // (another machine's take a copy: sealed for its app, never signed out there from here)
    ...(copy && webPages?.seal ? (machines ?? []).flatMap((m) => [
      { label: m.label, caption: true, sep: true, run: () => {} },
      ...allLogins().map((o) => to(loginsOn({ id: m.machine, label: m.label }, o), true)(s)),
    ]) : []),
  ]
  const menu = (s: WebSite): MenuItem[] => there ? [{ label: `Open ${s.site}`, icon: Globe, run: () => open(`https://${s.site}/`) }] : [
    { label: `Open ${s.site}`, icon: Globe, run: () => open(`https://${s.site}/`) },
    ...(c ? [{ label: `Always open in ${c.name}`, icon: Pin, checked: always.includes(s.site), run: () => void setSiteRule(s.site, always.includes(s.site) ? null : c.id) }] : []),
    ...(signedIn(s) && webPages?.move ? [
      { label: "Move to", icon: ArrowRightLeft, sep: true, run: () => {}, items: targets(false)(s) },
      { label: "Copy to", icon: Copy, run: () => {}, items: targets(true)(s) },
    ] : []),
    ...(signedIn(s) ? [{ label: "Sign out", icon: LogOut, danger: true, sep: true, run: () => void signOut(l, s, refresh) }] : []),
  ]
  const row = (s: WebSite) => (
    <SidebarRow key={s.site} icon={isIn(s) ? accountIcon(s.site, s.avatar) : siteIcon(`https://${s.site}/`)} label={<SiteLabel s={s} />} open
      tip={[andList(sitesOf(s)), whoText(s), pinned(s) && c ? `always opens in ${c.name}` : ""].filter(Boolean).join(": ")}
      data-web-site={s.site} data-web-account={isIn(s) ? "" : undefined} data-leaving={pinned(s) ? undefined : leaving(s.site)} onClick={() => open(`https://${s.site}/`)} more
      swipe={() => signedIn(s) && !there ? [{ label: "Sign out", icon: LogOut, danger: true, run: () => void signOut(l, s, refresh) }] : []}
      onContextMenu={menuFor(() => menu(s))}>
      {pinned(s) && <Pin aria-hidden data-web-always="" className="mr-1 size-3 shrink-0 text-tertiary group-hover/row:hidden" strokeWidth={2} />}
      {!isIn(s) && !pinned(s) && s.last ? <span className="mr-1 shrink-0 text-[11px] text-tertiary tabular-nums group-hover/row:hidden">{fmtAgo(s.last, { short: true })}</span> : null}
    </SidebarRow>
  )
  // (only what has cookies here goes elsewhere: a site only pinned has nothing to move, but takes its place in the order)
  const draggable = (s: WebSite) => there ? <div key={s.site}>{row(s)}</div> : (
    <div key={s.site} data-slide={s.site} className={lifted === s.site ? "opacity-40" : undefined}
      onPointerDown={(e) => startDrag(e, { from: "site", site: { logins: l.prof, site: s.site }, label: s.account ? `${s.site} · ${s.account}` : s.site })}>
      {row(s)}
    </div>
  )
  const Chevron = unfolded ? ChevronDown : ChevronRight
  return (
    <div className="flex flex-col gap-px" data-web-sites>
      <div ref={box} className="relative flex flex-col gap-px" data-web-sites-top="">{top.map(draggable)}</div>
      {folds && (
        <SidebarRow icon={Chevron} open aria-expanded={unfolded} data-web-more={String(rest.length)} onClick={() => unfold(!unfolded)} tip={null}
          label={<span className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
            <span className="truncate">{rest.length ? `${plural(rest.length, top.length ? "more site" : "site")}` : plural(trackers.length, "tracker")}</span>
            {rest.length > 0 && trackers.length > 0 && <span className="min-w-0 truncate text-[12px] text-tertiary">{plural(trackers.length, "tracker")}</span>}
          </span>} />
      )}
      {shown && rest.map(draggable)}
      {shown && trackers.length > 0 && (
        <SidebarRow icon={EyeOff} label={plural(trackers.length, "tracker")} open data-web-trackers={String(trackers.length)} data-leaving={trackersLeaving} tip={trackersTip(trackers)}
          onClick={() => void clearTrackers(l, trackers, refresh)}>
          <span className="mr-1 text-[11px] text-tertiary">Clear</span>
        </SidebarRow>
      )}
      {sites && !all.length && !trackers.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">{q ? "Nothing matches" : "No sites yet"}</p>}
    </div>
  )
}

/** A set of logins' top rows (`keys`, none while filtered) take one of theirs dragged among them: it goes where the
 *  others make way, and the order is kept. The order a drop would leave (null: none). */
function useSiteOrder(box: React.RefObject<HTMLDivElement | null>, prof: string, keys: string[]) {
  const id = `web-viewer:site-order:${useId()}`
  useDropTarget<{ order: string[] }>(id, (item, x, y) => {
    const el = box.current
    if (item.site?.logins !== prof || !keys.includes(item.site.site) || !el) return null
    const b = el.getBoundingClientRect()
    if (x < b.left - 8 || x > b.right + 8 || y < b.top - 14 || y > b.bottom + 14) return null
    const rows = [...el.querySelectorAll<HTMLElement>(":scope > [data-slide]")]
    const { order, same } = reorder(keys, [item.site.site], slotAt(el, rows, x, y, "y"))
    return same ? null : { order }
  }, (_item, h) => void setOrder(prof, h.order))
  return useDropHit<{ order: string[] }>(id)?.order ?? null
}

function SiteLabel({ s }: { s: WebSite }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink truncate">{sitesOf(s).join(", ")}</span>
      {isIn(s) && <span className="min-w-0 shrink-[0.5] truncate text-[12px] text-muted-foreground">{s.account || "Signed in"}</span>}
      {!!s.more?.length && <span className="shrink-0 text-[11px] text-tertiary" data-web-more-accounts={String(s.more.length)}>+{s.more.length}</span>}
    </span>
  )
}

const accountIcons = new Map<string, LucideIcon>()
/** A signed-in row's icon (a lucide icon's props): the account's picture with its site's icon on its corner, as a
 *  browser's profile button has it; the site's icon alone without one. */
function accountIcon(site: string, avatar?: string): LucideIcon {
  const key = `${site} ${avatar?.length ?? 0} ${avatar?.slice(-24) ?? ""}`
  let c = accountIcons.get(key)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => avatar
      ? <span className={`${className ?? ""} relative inline-grid`} data-web-avatar="">
          <img src={avatar} alt="" draggable={false} className="size-full rounded-full object-cover" />
          <SiteIcon host={site} className="absolute -right-[3px] -bottom-[3px] size-[9px] rounded-[2px] bg-background" />
        </span>
      : <SiteIcon host={site} className={className} />) as unknown as LucideIcon
    accountIcons.set(key, c)
  }
  return c
}

/** What's set on a container beyond its sites, in a line (only when something is): Touch ID, agents. A click: its options. */
function About({ c }: { c: Container }) {
  const can = useCanLock()
  const agents = agentsSay(c)
  if (!c.lock && !agents) return null
  return (
    <button type="button" onClick={(e) => menuBelow(e, containerItems(c, can))} data-web-container-about={c.id}
      className="mb-0.5 flex h-6 min-w-0 cursor-pointer items-center gap-3 rounded-[5px] pl-1.5 text-left text-[12px] text-tertiary hover:bg-foreground/[0.05] hover:text-muted-foreground">
      {c.lock && <span className="flex items-center gap-1.5"><Fingerprint aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />Touch ID</span>}
      {agents && <span className="flex min-w-0 items-center gap-1.5"><Bot aria-hidden className="size-3.5 shrink-0" strokeWidth={2} /><span className="truncate">{agents}</span></span>}
    </button>
  )
}

/** The Sites panel's own items atop its right-click menu: a new container, the picked one's options. */
export function sitesPanelMenu(): MenuItem[] {
  const c = containersNow().find((x) => x.id === pickedNow().get())
  return [
    { label: "New container…", icon: Plus, run: () => newContainer((n) => pickedNow().set(n.id)) },
    ...(c ? [{ label: c.name, icon: dotIcon(colorOf(c)), run: () => {}, items: containerItems(c, canLockNow()) }] : []),
  ]
}
const containersNow = () => containersOf(settings.get())

/** The sidebar's Sites panel: one set of logins' sites, picked on the heading's right (this workspace's, or a container's). */
export function SitesPanel({ open, openPage }: Pick<SidebarCtx, "open"> & { openPage: Open }) {
  const [pickedId, pick] = useScopedState<string | null>(PICKED, null)
  const own = useOwnLogins()
  const containers = useContainers()
  const can = useCanLock()
  const inside = containers.find((c) => c.id === pickedId)
  const logins: Logins = inside ? loginsOf(inside) : own
  if (!open) return null
  const add = () => newContainer((c) => pick(c.id))
  const menu = (e: React.MouseEvent) => menuBelow(e, [
    { label: "Sites in", caption: true, run: () => {} },
    { label: own.name, icon: dotIcon(NEUTRAL), checked: !inside, run: () => pick(undefined) },
    ...containers.map((c) => ({ label: c.name, icon: dotIcon(colorOf(c)), checked: c.id === inside?.id, run: () => pick(c.id) })),
    { label: "New container…", icon: Plus, sep: true, run: add },
    { label: "Manage containers…", icon: Settings2, run: manageContainers },
  ])
  const picker = webPages?.sites && (
    <button type="button" onClick={menu} onContextMenu={inside ? menuFor(() => containerItems(inside, can)) : undefined}
      aria-label={`Sites in ${logins.name}`} data-tip="Whose logins" data-web-logins={logins.container ?? ""}
      className="flex h-5 max-w-[60%] min-w-0 cursor-pointer items-center gap-1.5 rounded-[4px] px-1.5 text-[11px] font-medium text-tertiary hover:bg-foreground/[0.08] hover:text-muted-foreground">
      <Dot color={logins.color} />
      <span className="truncate">{logins.name}</span>
      <ChevronsUpDown aria-hidden className="-mx-0.5 size-3 shrink-0" strokeWidth={2.25} />
    </button>
  )
  return (
    <div className="flex shrink-0 flex-col" data-web-sites-panel>
      <SidebarHeading title="Sites" open={open} aside={picker}>
        {webPages?.sites && <HeadingButton icon={Plus} label="New container" onClick={add} data-web-new-container="" />}
      </SidebarHeading>
      {webPages?.sites
        ? <>{inside && <About c={inside} />}<SiteList key={logins.prof} logins={logins} look="sidebar" openPage={openPage} /></>
        : <p className="px-1.5 py-1 text-[13px] leading-[18px] text-tertiary">Sites and their logins are in Vaultite's desktop app.</p>}
    </div>
  )
}

/** A set of logins' heading in the Sites tab: its dot and name, what's set on a container (Touch ID, agents), how many
 *  accounts, and its options on hover and right-click. A container's is where it's dragged to another place. */
function LoginsHeading({ l, c, count }: { l: Logins; c?: Container; count: string }) {
  const can = useCanLock()
  // (another machine's container is changed here too, in its own card: the vault's)
  const own = l.machine ? undefined : c
  const items = () => (own ? containerItems(own, can) : [])
  const agents = c ? agentsSay(c) : ""
  return (
    <div onContextMenu={own ? menuFor(items) : undefined} data-web-logins-heading={l.container ?? l.prof}
      onPointerDown={own ? (e) => startDrag(e, { from: "container", container: own.id, label: own.name }) : undefined}
      className={`group/head mb-1 flex h-8 items-center gap-2 pr-0.5 pl-1.5 select-none ${own ? "cursor-grab" : ""}`}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
      <span className="min-w-0 truncate text-[14px] font-semibold" data-web-logins-name="">{l.name}</span>
      {c?.lock && <Fingerprint aria-label="Locked with Touch ID" data-tip="Locked with Touch ID" className="size-3.5 shrink-0 text-tertiary" strokeWidth={2} />}
      {agents && <Bot aria-label={agents} data-tip={agents} className="size-3.5 shrink-0 text-tertiary" strokeWidth={2} />}
      <span className="min-w-0 flex-1 truncate text-right text-[12px] text-tertiary">{count}</span>
      {own && <span data-no-drag="" className="md:opacity-0 md:group-hover/head:opacity-100 md:group-focus-within/head:opacity-100">
        <HeadingButton icon={Ellipsis} label={`Options for ${own.name}`} tip="Options" onClick={(e) => menuBelow(e, items())} />
      </span>}
    </div>
  )
}

/** A set of logins in the Sites tab, a card in its colour: its heading and its sites; nothing while a filter matches none. */
function LoginsSection(props: { l: Logins; c?: Container; openPage: Open; filter: string }) {
  return <LoginsCard {...props} data={useSites(props.l.prof)} />
}

/** Another machine's set of logins, as last listed there. */
function MachineSection(props: { l: Logins; c?: Container; openPage: Open; filter: string }) {
  const sites = elsewhere.use(() => sitesIn(props.l) ?? null)
  return <LoginsCard {...props} data={{ sites: sites?.filter((s) => !s.other) ?? null, others: [], leaving: () => undefined, refresh: () => void refreshElsewhere() }} />
}

function LoginsCard({ l, c, data, openPage, filter }: { l: Logins; c?: Container; data: Listed; openPage: Open; filter: string }) {
  const lifted = useDrag((d) => d?.item.container) === c?.id && !!c && !l.machine
  const card = useRef<HTMLElement>(null)
  const taking = useLoginDrop(card, l)
  const q = filter.trim().toLowerCase()
  if (q && data.sites && !data.sites.some((s) => matches(s, q)) && !data.others.some((s) => matches(s, q)) && !(c?.sites ?? []).some((x) => x.includes(q))) return null
  const accounts = data.sites?.filter(isIn).length ?? 0
  const count = accounts ? plural(accounts, "account") : ""
  return (
    // (a card in its colour, faint, so every row reads as inside it)
    <section ref={card} data-web-logins-section={l.container ?? l.prof} data-web-machine={l.machine?.id} data-slide={l.machine ? undefined : c?.id} data-web-logins-taking={taking ? (taking.copy ? "copy" : "move") : undefined}
      className={`rounded-[12px] border px-1.5 pt-1 pb-1.5 transition-[background-color,border-color] ${lifted ? "opacity-40" : ""}`}
      style={{ background: `color-mix(in srgb, ${l.color} ${taking ? 14 : 6}%, transparent)`, borderColor: `color-mix(in srgb, ${l.color} ${taking ? 60 : 20}%, transparent)` }}>
      <LoginsHeading l={l} c={c} count={count} />
      <SiteRows logins={l} data={data} openPage={openPage} filter={filter} />
    </section>
  )
}

/** ⌥ held while a site is dragged: dropping it on another set of logins copies it there. */
let copying = false
/** Whether ⌥ is held, heard while the Sites tab is open: the drag's hint changes as it's pressed, the pointer still. */
function useCopyKey() {
  useEffect(() => {
    const hear = (e: KeyboardEvent | PointerEvent) => { if (e.altKey !== copying) { copying = e.altKey; rehit() } }
    for (const t of ["keydown", "keyup", "pointermove"] as const) addEventListener(t, hear, true)
    return () => { for (const t of ["keydown", "keyup", "pointermove"] as const) removeEventListener(t, hear, true) }
  }, [])
}

/** A set of logins' card takes a site's login dragged from another set's (one it has cookies in): moved here, or copied
 *  with ⌥. What a drop would do (null: nothing). */
function useLoginDrop(card: React.RefObject<HTMLElement | null>, l: Logins) {
  const id = `web-viewer:logins:${l.prof}${l.machine ? `@${l.machine.id}` : ""}`
  const verb = (copy: boolean) => `${copy ? "Copy" : "Move"} to ${nameOf(l)}`
  useDropTarget<{ copy: boolean }>(id, (item, x, y) => {
    const from = item.site, el = card.current
    if (!from || (from.logins === l.prof && !l.machine) || !el || !(l.machine ? webPages?.seal : webPages?.move)) return null
    if (!listed.get().get(from.logins)?.some((s) => s.site === from.site && !s.other)) return null
    const b = el.getBoundingClientRect()
    // (another machine's set only takes a copy)
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom ? { copy: copying || !!l.machine } : null
  }, (item, h) => {
    const from = allLogins().find((o) => o.prof === item.site!.logins)
    const s = listed.get().get(item.site!.logins)?.find((x) => x.site === item.site!.site)
    if (from && s) void moveLogin(from, l, s, h.copy)
  }, { hint: (h) => verb(h.copy) })
  return useDropHit<{ copy: boolean }>(id)
}

type Reorder = { before: string | null; order: string[] }
const DROP = "web-viewer:containers"
/** The Sites tab's containers take one dragged by its heading: it goes where the others make way. The order a drag
 *  would leave (null: none). */
function useContainerDrop(box: React.RefObject<HTMLDivElement | null>) {
  const [edge] = useState(() => edgeScroller())
  useDropTarget<Reorder>(DROP, (item, x, y) => {
    const el = box.current
    if (!item.container || !el) return null
    edge.over(el, x, y)
    const b = el.getBoundingClientRect()
    if (x < b.left || x > b.right || y < b.top - 40 || y > b.bottom + 40) return null
    const cards = [...el.querySelectorAll<HTMLElement>(":scope > [data-slide]")]
    const { order, before, same } = reorder(cards.map((e) => e.dataset.slide!), [item.container], slotAt(el, cards, x, y, "y"))
    return same ? null : { before, order }
  }, (item, h) => void moveContainer(item.container!, h.before), { end: edge.stop })
  return useDropHit<Reorder>(DROP)?.order ?? null
}

/** The Sites tab: every set of logins with who's signed in where and its sites, where containers are added and changed. */
export function SitesView({ openPage }: { openPage: Open }) {
  const all = useAllLogins()
  const containers = useContainers()
  const [q, setQ] = useState("")
  const box = useRef<HTMLDivElement>(null)
  useSlide(box, useContainerDrop(box), "y")
  useCopyKey()
  const machines = useMachines()
  if (!webPages?.sites) return <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10"><SitesPanel open openPage={openPage} /></div>
  return (
    <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10" data-web-sites-view>
      <PageHeader title="Sites" subtitle="Who you're signed in as, container by container: drag a login to move it">
        <Button size="small" onClick={() => newContainer()} data-web-new-container="">New container</Button>
      </PageHeader>
      <FilterField value={q} onChange={setQ} placeholder="Filter sites and accounts" />
      <div ref={box} data-size-up="" data-web-logins-list="" className="relative mt-2 flex flex-col gap-3">
        {all.map((l) => <LoginsSection key={l.prof} l={l} c={containers.find((x) => x.id === l.container)} openPage={openPage} filter={q} />)}
      </div>
      {machines.map((m) => <MachineLogins key={m.machine} m={m} openPage={openPage} filter={q} />)}
    </div>
  )
}

/** How often the Sites tab lists the other machines' logins again while it's open. */
const ELSEWHERE_MS = 30_000

/** The other machines' browsers with sets of logins, listed again while the Sites tab shows. */
function useMachines() {
  useWorkspaceVersion()
  const machines = elsewhere.use()
  useEffect(() => {
    void refreshElsewhere()
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refreshElsewhere() }, ELSEWHERE_MS)
    return () => window.clearInterval(t)
  }, [])
  return (machines ?? []).filter((m) => Object.keys(m.sets).length)
}

/** Another machine's sets of logins with sites, under its name: what's signed in there, and where a login is copied. */
function MachineLogins({ m, openPage, filter }: { m: MachineSets; openPage: Open; filter: string }) {
  const containers = useContainers()
  const sets = allLoginsOn({ id: m.machine, label: m.label }).filter((l) => m.sets[l.prof])
  return (
    <Section title={`On ${m.label}`} className="mt-6">
      <div data-size-up="" data-web-machine-logins={m.machine} className="flex flex-col gap-3">
        {sets.map((l) => <MachineSection key={l.prof} l={l} c={containers.find((x) => x.id === l.container)} openPage={openPage} filter={filter} />)}
      </div>
    </Section>
  )
}

/** The settings' Sites and logins: every set of logins with its sites. */
export function SitesSettings() {
  const all = useAllLogins()
  const workspaces = all.filter((l) => !l.container).length > 1
  return (
    <div data-setting="sites">
    <Section title="Sites and logins">
      {!webPages?.sites ? <p className="text-[15px] text-muted-foreground">Sites and their logins are in Vaultite's desktop app.</p> : (
        <div data-web-sites-settings>
          <Group>{all.map((l) => <SiteList key={l.prof} logins={l} look="settings" />)}</Group>
          <div className="mt-2"><Button size="small" onClick={() => newContainer()}>New container…</Button></div>
          <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">
            Each container{workspaces ? " and each workspace" : ""} signs in to sites on its own. Sign out deletes a site's cookies and what it keeps in the browser there; right-click a container for its options.
          </p>
        </div>
      )}
    </Section>
    </div>
  )
}
