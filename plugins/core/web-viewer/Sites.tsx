// Sites: a set of logins' sites (Sign out each), a line for trackers' cookies (Clear) and containers' options. Drawn as
// the sidebar's Sites panel (one set of logins), the Sites tab (every set: containers managed) and in the settings.
import { useEffect, useState } from "react"
import { Bot, ChevronDown, ChevronRight, ChevronsUpDown, Ellipsis, EyeOff, Fingerprint, Globe, LogOut, Pin, Plus, Settings2 } from "lucide-react"
import {
  Button, confirmDialog, currentWorkspace, dotIcon, Group, HeadingButton, isViewOpen, menuBelow, menuFor, notifyError, openView, PageHeader, plural, scopedState, Section,
  SettingRow, SidebarHeading, SidebarRow, useScopedState, useWorkspaceVersion, webPages, workspaceList, type MenuItem, type SidebarCtx, type WebSite,
} from "@vaultite"
import { SiteIcon, siteIcon } from "./icons"
import { colorOf, containersOf, profileIn, setSiteRule, useContainers, type Container } from "./containers"
import { agentsSay, canLockNow, containerItems, newContainer, useCanLock } from "./ContainerButton"
import { profile, profileFor, settings } from "./state"

/** Show every set of logins and their containers' options: the Sites tab. */
export const manageContainers = () => openView("web-pages", { newTab: !isViewOpen("view:web-pages") })

/** The Sites panel's logins, per workspace: a container's id, or null for the workspace's own. */
const PICKED = "web-viewer:sites-in"
const pickedNow = () => scopedState<string | null>(PICKED, null)

/** Open an address in a web tab (a new one, or the tab already showing it), in a container or none. */
type Open = (url: string, container?: string | null) => void

/** A set of logins pages have: a workspace's (the default one without workspaces), or a container's. */
type Logins = { prof: string; name: string; color: string; container: string | null }

/** The default logins' dot: neutral, so their rows line up with containers' coloured ones. */
const NEUTRAL = "color-mix(in srgb, var(--muted-foreground) 55%, transparent)"

/** This workspace's logins: "Workspace N" while each workspace has its own, else the default ones. */
function useOwnLogins(): Logins {
  useWorkspaceVersion()
  const { logins } = settings.use()
  const ws = currentWorkspace()
  return { prof: profile(), name: ws && logins !== "shared" ? `Workspace ${ws.n}` : "Default", color: NEUTRAL, container: null }
}

/** Every set of logins: each workspace's (or the default), then the containers'. */
function useAllLogins(): Logins[] {
  useWorkspaceVersion()
  const { logins } = settings.use()
  const own = useOwnLogins()
  const workspaces = logins === "shared" ? [] : workspaceList()
  const containers = useContainers().map((c): Logins => ({ prof: profileIn(c.id), name: c.name, color: colorOf(c), container: c.id }))
  return [
    ...(workspaces.length > 1 ? workspaces.map((w): Logins => ({ prof: profileFor(w.n), name: `Workspace ${w.n}`, color: NEUTRAL, container: null })) : [own]),
    ...containers,
  ]
}

/** The sites of `prof` (drawn afresh for another), asked again when a page done loading may have signed in or out. */
function useSites(prof: string) {
  const [sites, setSites] = useState<WebSite[] | null>(null)
  useEffect(() => {
    const web = webPages
    if (!web?.sites) return
    let gone = false, timer = 0
    const list = () => { void web.sites!(prof).then((s) => { if (!gone) setSites(s) }, () => {}) }
    list()
    const off = web.on((m) => {
      if (m.type === "state" && !m.state.loading) { clearTimeout(timer); timer = window.setTimeout(list, 1500) }
    })
    return () => { gone = true; off(); clearTimeout(timer) }
  }, [prof])
  return { sites: sites?.filter((s) => !s.other) ?? null, others: sites?.filter((s) => s.other) ?? [],
    refresh: () => void webPages?.sites?.(prof).then(setSites, () => {}) }
}

async function signOut(l: Logins, s: WebSite, done: () => void) {
  const ok = await confirmDialog({
    title: `Sign out of ${s.site}?`,
    body: `${s.account ? `${s.account} will be signed out` : "Its logins go"} in ${l.name}: the site's cookies and what it keeps in the browser are deleted. Open pages of it reload.`,
    confirm: "Sign out", danger: true,
  })
  if (!ok) return
  try { await webPages?.forget?.(l.prof, s.site) } catch (e) { notifyError(e, "Couldn't sign out") }
  done()
}

/** Clear the trackers' cookies (and storage), after showing which. */
async function clearTrackers(l: Logins, others: WebSite[], done: () => void) {
  const names = others.map((s) => s.site)
  const ok = await confirmDialog({
    title: `Clear ${plural(names.length, "tracker")}?`,
    body: `Cookies these sites left while you were on other sites' pages (ad and analytics networks, not logins of yours): ${names.join(", ")}. Their cookies and storage are deleted.`,
    confirm: "Clear", danger: true,
  })
  if (!ok) return
  try { for (const n of names) await webPages?.forget?.(l.prof, n) } catch (e) { notifyError(e, "Couldn't clear them") }
  done()
}

const Dot = ({ color }: { color: string }) => <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />

const trackersTip = (others: WebSite[]) => `Cookies from sites you didn't open, left by other sites' pages: ${others.map((s) => s.site).join(", ")}`

/** A set of logins' sites, as sidebar rows (the panel) or setting rows (the settings). */
function SiteList({ logins: l, look, openPage }: { logins: Logins; look: "sidebar" | "settings"; openPage?: Open }) {
  const { sites, others, refresh } = useSites(l.prof)
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
              <div key={s.site} className={row} data-web-site={s.site}>
                <SiteIcon host={s.site} className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2"><span className="truncate">{s.site}</span>
                  {s.account && <span className="min-w-0 truncate text-[13px] text-muted-foreground">{s.account}</span>}</span>
                <Button size="small" look="quiet" onClick={() => void signOut(l, s, refresh)}>Sign out</Button>
              </div>
            ))}
            {others.length > 0 && (
              <div className={row} data-web-trackers={String(others.length)}>
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
  const open = (url: string) => openPage?.(url, l.container)
  // A container's sites always opened there, signed in to or not.
  const always = c?.sites ?? []
  const rows = [...(sites ?? []), ...(sites ? always.filter((a) => !sites.some((s) => s.site === a)).map((site): WebSite => ({ site })) : [])]
  const menu = (s: WebSite): MenuItem[] => [
    { label: `Open ${s.site}`, icon: Globe, run: () => open(`https://${s.site}/`) },
    ...(c ? [{ label: `Always open in ${c.name}`, icon: Pin, checked: always.includes(s.site), run: () => void setSiteRule(s.site, always.includes(s.site) ? null : c.id) }] : []),
    ...(sites?.some((x) => x.site === s.site) ? [{ label: "Sign out", icon: LogOut, danger: true, sep: true, run: () => void signOut(l, s, refresh) }] : []),
  ]
  return (
    <div className="flex flex-col gap-px" data-web-sites>
      {rows.map((s) => (
        <SidebarRow key={s.site} icon={siteIcon(`https://${s.site}/`)} label={<SiteLabel s={s} />} open
          tip={[s.site, s.account, always.includes(s.site) && c ? `always opens in ${c.name}` : ""].filter(Boolean).join(": ")}
          data-web-site={s.site} onClick={() => open(`https://${s.site}/`)} more
          swipe={() => sites?.some((x) => x.site === s.site) ? [{ label: "Sign out", icon: LogOut, danger: true, run: () => void signOut(l, s, refresh) }] : []}
          onContextMenu={menuFor(() => menu(s))}>
          {always.includes(s.site) && <Pin aria-hidden data-web-always="" className="mr-1 size-3 shrink-0 text-tertiary group-hover/row:hidden" strokeWidth={2} />}
        </SidebarRow>
      ))}
      {sites && !rows.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No sites yet</p>}
      {others.length > 0 && (
        <SidebarRow icon={EyeOff} label={plural(others.length, "tracker")} open data-web-trackers={String(others.length)} tip={trackersTip(others)}
          onClick={() => void clearTrackers(l, others, refresh)}>
          <span className="mr-1 text-[11px] text-tertiary">Clear</span>
        </SidebarRow>
      )}
    </div>
  )
}

function SiteLabel({ s }: { s: WebSite }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{s.site}</span>
      {s.account && <span className="min-w-0 truncate text-[12px] text-muted-foreground">{s.account}</span>}
    </span>
  )
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
  const logins: Logins = inside ? { prof: profileIn(inside.id), name: inside.name, color: colorOf(inside), container: inside.id } : own
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

/** A set of logins' heading in the Sites tab: its dot and name, and a container's options on hover and right-click. */
function LoginsHeading({ l, c }: { l: Logins; c?: Container }) {
  const can = useCanLock()
  const items = () => (c ? containerItems(c, can) : [])
  return (
    <div onContextMenu={c ? menuFor(items) : undefined} data-web-logins-heading={l.container ?? l.prof}
      className="group/head mt-4 flex h-7 items-center gap-2 pr-0.5 pl-1.5 first:mt-1">
      <Dot color={l.color} />
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-muted-foreground">{l.name}</span>
      {c && <span className="opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
        <HeadingButton icon={Ellipsis} label={`Options for ${c.name}`} tip="Options" onClick={(e) => menuBelow(e, items())} />
      </span>}
    </div>
  )
}

/** The Sites tab: every set of logins with its sites, where containers are added and changed. */
export function SitesView({ openPage }: { openPage: Open }) {
  const all = useAllLogins()
  const containers = useContainers()
  if (!webPages?.sites) return <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10"><SitesPanel open openPage={openPage} /></div>
  return (
    <div className="mx-auto max-w-[640px] px-4 pt-2 pb-10" data-web-sites-view>
      <PageHeader title="Sites" subtitle="What each container signs in to, apart from the others">
        <Button size="small" onClick={() => newContainer()} data-web-new-container="">New container</Button>
      </PageHeader>
      <div data-size-up="">
        {all.map((l) => {
          const c = containers.find((x) => x.id === l.container)
          return (
            <section key={l.prof} data-web-logins-section={l.container ?? l.prof}>
              <LoginsHeading l={l} c={c} />
              {c && <About c={c} />}
              <SiteList logins={l} look="sidebar" openPage={openPage} />
            </section>
          )
        })}
      </div>
    </div>
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
