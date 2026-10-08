// The Web pages panel: pages open in this workspace's logins and the sites you opened that keep cookies (Sign out
// each), then one line for trackers' cookies (Clear).
import { useEffect, useState } from "react"
import { EyeOff, Globe, KeyRound, LogOut, Plus } from "lucide-react"
import {
  confirmDialog, menuFor, notifyError, panelMenu, SidebarHeading, SidebarRow, useWorkspaceVersion, webPages,
  type MenuItem, type SidebarCtx, type WebPageInfo, type WebSite,
} from "@vaultite"
import { siteIcon } from "./icons"
import { hostOf } from "./address"
import { profile, useSettings } from "./state"

/** Open an address in a web tab (a new one, or the tab already showing it). */
type Open = (url: string) => void

function useWebPages() {
  const [pages, setPages] = useState<WebPageInfo[] | null>(null)
  const [sites, setSites] = useState<WebSite[] | null>(null)
  const ws = useWorkspaceVersion()
  const { logins } = useSettings()
  const prof = profile()
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
  return { pages: pages?.filter((p) => p.profile === prof && /^https?:/i.test(p.url)) ?? null, sites, prof, refresh: () => void webPages?.sites?.(prof).then(setSites, () => {}) }
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
    title: `Clear ${names.length} ${names.length === 1 ? "tracker" : "trackers"}?`,
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

export function WebPagesPanel({ open, panel, openPage, ask }: Pick<SidebarCtx, "open" | "panel"> & { openPage: Open
  /** Ask for an address and open it (the heading's +). */
  ask: () => void }) {
  const { pages, sites: all, prof, refresh } = useWebPages()
  const sites = all?.filter((s) => !s.other) ?? null, others = all?.filter((s) => s.other) ?? []
  const own = (items: MenuItem[]) => [...items, ...(panel ? panelMenu(panel).map((it, i) => (i ? it : { ...it, sep: true })) : [])]
  const pageRows = (pages ?? []).map((p) => (
    <SidebarRow key={p.id} icon={siteIcon(p.url)} label={p.title || hostOf(p.url)} open={open} tint={p.shown ? "var(--web-viewer)" : undefined}
      tip={`${p.title || hostOf(p.url)}: ${p.url}`} data-web-page-row={String(p.id)} onClick={() => openPage(p.url)}
      onContextMenu={menuFor(() => own([{ label: "Open", icon: Globe, run: () => openPage(p.url) }]))}>
      {!p.shown && <span className="mr-1 text-[11px] text-tertiary">kept</span>}
    </SidebarRow>
  ))
  if (!open) return pageRows.length ? <div className="flex flex-col gap-px">{pageRows}</div> : null
  return (
    <div className="flex shrink-0 flex-col" data-web-pages-panel>
      <SidebarHeading title="Web pages" open={open}>
        {webPages?.list && (
          <button type="button" aria-label="Open web page" data-tip="Open web page" onClick={ask}
            className="grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
            <Plus className="size-3.5" strokeWidth={2.25} />
          </button>
        )}
      </SidebarHeading>
      {!webPages?.list ? <Unavailable /> : (
        <>
          <div className="flex flex-col gap-px">
            {pageRows}
            {pages && !pages.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No pages open</p>}
          </div>
          <div className="mt-2 mb-0.5 h-6 truncate pl-1.5 text-[11px] leading-6 font-semibold text-tertiary">{prof ? `Sites, in workspace ${prof}` : "Sites"}</div>
          <div className="flex flex-col gap-px" data-web-sites>
            {(sites ?? []).map((s) => (
              <SidebarRow key={s.site} icon={KeyRound} label={<SiteLabel s={s} />} open={open} tip={s.account ? `${s.site}: ${s.account}` : s.site}
                tint={s.account ? "var(--web-viewer)" : undefined} data-web-site={s.site} onClick={() => openPage(`https://${s.site}/`)}
                swipe={() => [{ label: "Sign out", icon: LogOut, danger: true, run: () => void signOut(prof, s, refresh) }]}
                onContextMenu={menuFor(() => own(siteMenu(prof, s, openPage, refresh)))}>
                <button type="button" aria-label={`Sign out of ${s.site}`} data-tip="Sign out"
                  className="hidden size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground group-hover/row:grid hover:bg-foreground/[0.08] hover:text-foreground"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void signOut(prof, s, refresh) }}>
                  <LogOut className="size-3.5" strokeWidth={2.25} />
                </button>
              </SidebarRow>
            ))}
            {sites && !sites.length && <p className="h-7 truncate pl-1.5 text-[13px] leading-7 text-tertiary">No sites yet</p>}
            {others.length > 0 && (
              <SidebarRow icon={EyeOff} label={`${others.length} ${others.length === 1 ? "tracker" : "trackers"}`} open={open} data-web-trackers={String(others.length)}
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
