// The Web pages panel: pages open in this workspace's logins and the sites you opened that keep cookies (Sign out
// each), then one line for trackers' cookies (Clear).
import { useEffect, useState } from "react"
import { ChevronDown, EyeOff, Globe, KeyRound, LogOut, Plus } from "lucide-react"
import {
  confirmDialog, dotIcon, HeadingButton, menuBelow, menuFor, notifyError, plural, SidebarHeading, SidebarRow, useWorkspaceVersion, webPages, type MenuItem,
  type SidebarCtx, type WebPageInfo, type WebSite,
} from "@vaultite"
import { siteIcon } from "./icons"
import { hostOf } from "./address"
import { colorOf, containerById, containerOfProfile, profileIn, useContainers } from "./containers"
import { profile, settings } from "./state"

/** Open an address in a web tab (a new one, or the tab already showing it), in a container or none. */
type Open = (url: string, container?: string | null) => void

function useWebPages(container: string | null) {
  const [pages, setPages] = useState<WebPageInfo[] | null>(null)
  const [sites, setSites] = useState<WebSite[] | null>(null)
  const ws = useWorkspaceVersion()
  const { logins } = settings.use()
  // (the sites listed are the chosen logins': the workspace's, or a container's)
  const prof = profileIn(container)
  useEffect(() => {
    const web = webPages
    if (!web?.list || !web.sites) return
    let gone = false, listing = 0, siting = 0
    const list = () => { void web.list!().then((l) => { if (!gone) setPages(l) }, () => {}) }
    const siteList = () => { void web.sites!(prof).then((s) => { if (!gone) setSites(s) }, () => {}) }
    list()
    siteList()
    const off = web.on((m) => {
      if (m.type !== "pages" && m.type !== "state") return
      clearTimeout(listing)
      listing = window.setTimeout(list, 200)
      // A page done loading may have signed in or out.
      if (m.type === "state" && !m.state.loading) { clearTimeout(siting); siting = window.setTimeout(siteList, 1500) }
    })
    return () => { gone = true; off(); clearTimeout(listing); clearTimeout(siting) }
  }, [prof, ws, logins])
  // This workspace's pages, and those in containers (any workspace's tabs may show them).
  const own = profile()
  return { pages: pages?.filter((p) => (p.profile === own || !!containerById(containerOfProfile(p.profile))) && /^https?:/i.test(p.url)) ?? null, sites, prof,
    refresh: () => void webPages?.sites?.(prof).then(setSites, () => {}) }
}

async function signOut(prof: string, s: WebSite, done: () => void) {
  const ok = await confirmDialog({
    title: `Sign out of ${s.site}?`,
    body: `${s.account ? `${s.account} will be signed out` : "Its logins go"} in these web pages: the site's cookies and what it keeps in the browser are deleted. Open pages of it reload.`,
    confirm: "Sign out", danger: true,
  })
  if (!ok) return
  try { await webPages?.forget?.(prof, s.site) } catch (e) { notifyError(e, "Couldn't sign out") }
  done()
}

/** Clear the trackers' cookies (and storage), after showing which. */
async function clearOthers(prof: string, others: WebSite[], done: () => void) {
  const names = others.map((s) => s.site)
  const ok = await confirmDialog({
    title: `Clear ${plural(names.length, "tracker")}?`,
    body: `Cookies these sites left while you were on other sites' pages (ad and analytics networks, not logins of yours): ${names.join(", ")}. Their cookies and storage are deleted.`,
    confirm: "Clear", danger: true,
  })
  if (!ok) return
  try { for (const n of names) await webPages?.forget?.(prof, n) } catch (e) { notifyError(e, "Couldn't clear them") }
  done()
}

const siteMenu = (prof: string, s: WebSite, open: Open, done: () => void): MenuItem[] => [
  { label: `Open ${s.site}`, icon: Globe, run: () => open(`https://${s.site}/`) },
  { label: "Sign out", icon: LogOut, danger: true, run: () => void signOut(prof, s, done) },
]

function Unavailable() {
  return <p className="px-1.5 py-1 text-[13px] leading-[18px] text-tertiary">Web pages open in Vaultite's desktop app.</p>
}

export function WebPagesPanel({ open, openPage, ask }: Pick<SidebarCtx, "open"> & { openPage: Open
  /** Ask for an address and open it (the heading's +). */
  ask: () => void }) {
  const [container, setContainer] = useState<string | null>(null)
  const list = useContainers()
  const inside = list.find((c) => c.id === container) ?? null
  const { pages, sites: all, prof, refresh } = useWebPages(inside?.id ?? null)
  const loginsMenu = (e: React.MouseEvent) => menuBelow(e, [
    { label: "Workspace logins", checked: !inside, run: () => setContainer(null) },
    ...list.map((c) => ({ label: c.name, icon: dotIcon(colorOf(c)), checked: c.id === inside?.id, run: () => setContainer(c.id) })),
  ])
  const sites = all?.filter((s) => !s.other) ?? null, others = all?.filter((s) => s.other) ?? []
  const pageRows = (pages ?? []).map((p) => {
    const c = containerById(containerOfProfile(p.profile))
    return (
    <SidebarRow key={p.id} icon={siteIcon(p.url, c ? colorOf(c) : undefined)} label={p.title || hostOf(p.url)} open={open} tint={p.shown ? "var(--web-viewer)" : undefined}
      tip={`${p.title || hostOf(p.url)}: ${p.url}${c ? ` (${c.name})` : ""}`} data-web-page-row={String(p.id)} onClick={() => openPage(p.url, c?.id)}
      onContextMenu={menuFor(() => [{ label: "Open", icon: Globe, run: () => openPage(p.url, c?.id) }])}>
      {!p.shown && <span className="mr-1 text-[11px] text-tertiary">kept</span>}
    </SidebarRow>
    )
  })
  if (!open) return pageRows.length ? <div className="flex flex-col gap-px">{pageRows}</div> : null
  return (
    <div className="flex shrink-0 flex-col" data-web-pages-panel>
      <SidebarHeading title="Web pages" open={open}>
        {webPages?.list && (
          <HeadingButton icon={Plus} label="Open web page" onClick={ask} />
        )}
      </SidebarHeading>
      {!webPages?.list ? <Unavailable /> : (
        <>
          <div className="flex flex-col gap-px">
            {pageRows}
            {pages && !pages.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No pages open</p>}
          </div>
          <button type="button" onClick={loginsMenu} data-web-logins={inside?.id ?? ""}
            className="mt-2 mb-0.5 flex h-6 max-w-full cursor-pointer items-center gap-1.5 truncate pl-1.5 text-left text-[11px] leading-6 font-semibold text-tertiary hover:text-muted-foreground">
            {inside && <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(inside) }} />}
            {inside ? `Sites, in ${inside.name}` : profile() ? `Sites, in workspace ${profile()}` : "Sites"}
            <ChevronDown className="size-3 shrink-0" strokeWidth={2.25} />
          </button>
          <div className="flex flex-col gap-px" data-web-sites>
            {(sites ?? []).map((s) => (
              <SidebarRow key={s.site} icon={KeyRound} label={<SiteLabel s={s} />} open={open} tip={s.account ? `${s.site}: ${s.account}` : s.site}
                tint={s.account ? "var(--web-viewer)" : undefined} data-web-site={s.site} onClick={() => openPage(`https://${s.site}/`, inside?.id)} more
                swipe={() => [{ label: "Sign out", icon: LogOut, danger: true, run: () => void signOut(prof, s, refresh) }]}
                onContextMenu={menuFor(() => siteMenu(prof, s, (u) => openPage(u, inside?.id), refresh))} />
            ))}
            {sites && !sites.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No sites yet</p>}
            {others.length > 0 && (
              <SidebarRow icon={EyeOff} label={plural(others.length, "tracker")} open={open} data-web-trackers={String(others.length)}
                tip={`Cookies from sites you didn't open, left by other sites' pages: ${others.map((s) => s.site).join(", ")}`}
                onClick={() => void clearOthers(prof, others, refresh)}>
                <span className="mr-1 text-[11px] text-tertiary">Clear</span>
              </SidebarRow>
            )}
          </div>
        </>
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

/** The panel in a tab. */
export function WebPagesView({ openPage, ask }: { openPage: Open; ask: () => void }) {
  return <div className="mx-auto max-w-[560px] px-4 pt-2 pb-10"><WebPagesPanel open openPage={openPage} ask={ask} /></div>
}
