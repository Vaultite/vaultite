// Browser: web pages in the desktop app's tabs (native views, electron/web.ts, its engine electron/browser/), beside notes.
// Links open here (⌥⌘-click: the browser); pages' notifications and Claude Code on the web's sessions reach the Inbox.
import { lazy, memo, Suspense, useEffect } from "react"
import { Bookmark, Bot, Box, Code, CopyPlus, Download, Eraser, FileCode2, ExternalLink, Globe, Hand, History, KeyRound, Lock, MonitorPlay, MousePointer2, MousePointerSquareDashed, Paintbrush, PencilLine, Printer, Puzzle, RotateCw, Scan, Scissors, Search, Volume2, VolumeX, ZoomIn,
  ZoomOut } from "lucide-react"
import { choose, closeTab, closeView, definePlugin, detailPath, focusGroup, getStore, getTabLayout, isMac, isViewOpen, isWindows, modKey, modifiedSteps, newTabId, notify, notifyError, openDetail, openInSplit, openTab, openView, openWebLink, Panel, panesOf, post, runCommandById, runShortcut, typingIn, saveAttachments, selectTab, showLabel, systemNotify, selectedText, useCommandList, useEnabled, webPageActions, webPages, type Choice, type WebEvent } from "@vaultite"
import { hostOf, searchUrl, siteName } from "./address"
import { addContainer, argOf, colorOf, destination, keepOutside, openBehind, useContainers, containerById, containerOfProfile, containers, profileIn, splitArg, viewSource } from "./containers"
import { iconCame, siteIcon, spinnerIcon } from "./icons"
import { painted } from "./layers"
import { manageContainers, SitesPanel, sitesPanelMenu, SitesSettings, SitesView } from "./Sites"
import { ExtensionsView } from "./Extensions"
import { extensionPageName, extensionsChanged, hasExtensions, popupChanged, setExtensionsOpener } from "./extstate"
import { ReplaysView } from "./Replays"
import { AgentPasskeys } from "./AgentPasskeys"
import { liveTitle, LiveView } from "./LiveView"
import { askClear, HistoryView } from "./HistoryView"
import { askImport, browsersHere, findBrowsers } from "./importer"
import "./types"
import { bookmark, focusedPage, focusedPageId, linksInViewer, loadingIn, onScreen, pageOfTab, pageTookKeyboard, passkeyAsks, profile, setPageFlags, stateCame, setPlayer, setSounds, settings, shown, soundOf, titleOf, typedIn } from "./state"
import { agentPage, agentPageOfTab, agentPages, openAsTab, pauseAgents, setAgentPages, working, type AgentPage } from "./agentpages"
import { AgentsCard, agentsCardShown, showAgentsCard } from "./AgentsCard"
import { pickElement, useHiddenParts, watchShields } from "./shields"
import { editStyle, useLookBackground, useSiteStyles } from "./stylestate"
import { Playing } from "./Playing"
import { switcherSearch } from "./switcher"

const WebPage = lazy(() => import("./WebPage"))

/** Open an address in a web tab (a new one, or the tab already showing it): in `container`, else where its site always
 *  opens (WebPage moves it there). */
const openPage = (url: string, container: string | null = null) => openView(`web/${argOf(url, container)}`, { newTab: true })

/** What a page opened (a link to a new tab, window.open, its link menu): in a new tab after it, behind or in front, to
 *  the side or in a glance, in its container (or the one picked); the page made for it (`page`) handed to that tab. */
function opened(m: Extract<WebEvent, { type: "open" }>) {
  const c = m.container !== undefined ? m.container : destination(m.url, { from: containerOfProfile(m.profile), fresh: false }).container
  if (c === null) keepOutside(m.url)
  const to = `view:web/${argOf(m.url, c)}`
  if (m.how === "glance") return openDetail(detailPath("glance", to))
  if (m.how === "background" && !m.page) return openBehind(m.url, c, m.tab || undefined)
  // (handed over first: the tab's page claims it as it's drawn)
  const id = newTabId()
  if (m.page) void webPages?.engine?.("web:adopt", m.page, id).catch(() => {})
  if (m.how === "side") openInSplit(to, "right", true, id)
  else openTab(to, { background: m.how === "background", from: m.tab || undefined, id })
}

const openExtensions = () => openView("web-extensions", { newTab: !isViewOpen("view:web-extensions") })
setExtensionsOpener(openExtensions)

/** A new web tab (in `container`), its address ready to type, with suggestions: always its own, never another blank one. */
function askAddress(container: string | null = null) {
  openView(`web/${argOf("", container)}`, { another: true })
}

/** A copy of tab `tab` (its page's address and container) right after it, its page starting with that one's Back and
 *  Forward, as Chrome's Duplicate. */
async function duplicate(arg: string, tab: string) {
  const id = (await webPages?.list?.().catch(() => null))?.find((p) => p.tab === tab)?.id, made = newTabId()
  // (its history handed over before the tab asks for its page; the address keeps its container)
  if (id) await webPages?.go(id, "duplicate", made).catch(() => {})
  openTab(`view:web/${arg}`, { from: tab, id: made })
}

/** Bookmark the page in the focused pane. */
function bookmarkPage() {
  const url = focusedPage()?.url()
  if (url) void bookmark(url, titleOf(url) ?? "")
}

/** The focused pane shows a web tab (with a page or not): the browser's keys are the page's, never the app's menu's
 *  (⌘R reloading the app). */
function onWebTab() {
  const w = getTabLayout(), g = panesOf(w.root).find((x) => x.id === w.focus), t = g?.tabs.find((x) => x.id === g.active)
  return !!t && (t.to === "view:web" || t.to.startsWith("view:web/"))
}
/** What the focused page does now (none: nothing). */
const onPage = (action: Parameters<NonNullable<typeof webPages>["go"]>[1]) => { const id = focusedPageId(); if (id) void webPages?.go(id, action) }
/** A page in the focused pane, not under a sheet (whose own find ⌘F is). */
const pageInFront = () => !!focusedPage() && !document.querySelector("dialog[open]")

/** Pick a container, then an address to open in it. */
function askContainer() {
  choose({
    title: "New tab in container", placeholder: "Container", heading: "Open a new tab in",
    items: containers().map((c): Choice => ({ id: c.id, label: c.name, icon: <span className="size-2.5 rounded-full" style={{ background: colorOf(c) }} /> })),
    // (a name that isn't one: a new container of that name)
    other: (typed): Choice | null => (typed.trim() ? { id: `\0${typed.trim()}`, label: `New container “${typed.trim()}”` } : null),
    onPick: (it) => askAddress(it.id.startsWith("\0") ? addContainer(it.id.slice(1)).id : it.id),
  })
}

/** An image from a page's menu (Save image to vault) saved where attachments go, named as the page named it. */
async function saveImage(m: Extract<WebEvent, { type: "image" }>) {
  const s = getStore()
  try {
    if (!m.data || !s) throw new Error(m.error ? `Couldn't get the image: ${m.error}` : "Couldn't get the image")
    const ext = ({ "image/jpeg": "jpg", "image/svg+xml": "svg" } as Record<string, string>)[m.mime] ?? m.mime.split("/")[1] ?? "png"
    // (a data: image is "download.png": named for when it was saved instead)
    const when = new Date().toISOString().slice(0, 19).replace(/\D/g, "")
    let name = m.name && !/^download(\.\w+)?$/.test(m.name) ? m.name : `Web image ${when}`
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${ext}`
    const [path] = await saveAttachments(s, "", [new File([m.data as BlobPart], name, { type: m.mime })])
    notify(`Saved ${path.split("/").pop()}`, { action: { label: "Open", run: () => openInSplit(`file:${path}`) } })
  } catch (e) { notifyError(e, "Couldn't save the image") }
}

/** A page's notification, or news of a session in it, told the user (see the head of this file). */
function pageNotified(m: Extract<WebEvent, { type: "notify" | "session" }>) {
  if (settings.get().notifications === false) return
  // Looking at it: the page (a session's: showing that session) is the focused pane's, in a window that's in front.
  const page = focusedPage()
  const looking = document.visibilityState === "visible" && document.hasFocus() && !!page
    && (m.type === "session" ? page.url() === m.url : page === shown.get(m.id))
  if (looking) return
  const container = containerOfProfile(m.profile)
  const here = m.profile === profile() || !!containerById(container)
  const title = m.title || m.site
  const body = [m.title ? m.body : "", here ? "" : `In workspace ${m.profile || "1"}`].filter(Boolean).join(" · ")
  const link = here ? `view:web/${argOf(m.url, container)}` : undefined
  const open = () => { if (link) openView(link, { newTab: !isViewOpen(link) }) }
  const event = m.type === "session"
    // (one event a session: its news replaces the last within a minute, others' stay their own)
    ? { source: m.site, kind: m.kind, title, body, link, session: m.url }
    : { source: m.site || "web", kind: "web", title, body, link }
  post("inbox/events", event).catch(() => {
    // No Inbox: tell it here.
    notify(body ? `${title}: ${body}` : title, { action: link ? { label: "Open", run: open } : undefined })
    if (!document.hasFocus()) systemNotify(title, body)?.then((clicked) => { if (clicked) open() })
  })
}

/** The agents' card, not drawn again with Background (each store change): it listens to what it shows itself. */
const Card = memo(AgentsCard)

/** The plugin's work in the app: its settings, the app's shortcuts told to the desktop app, and its events; the agents'
 *  card. */
function Background() {
  useEffect(() => void settings.ready(), [])
  useEffect(() => { if (hasExtensions()) extensionsChanged() }, [])
  useEffect(watchShields, [])
  useHiddenParts()
  useSiteStyles()
  useLookBackground()
  // (the browsers there are to import from: their commands show)
  useEffect(() => { if (webPages?.engine) void findBrowsers() }, [])
  const commands = useCommandList()
  useEffect(() => { void webPages?.keys(modifiedSteps()) }, [commands])
  // What agents may do in each container, and where their tabs open, told to the desktop app as they change.
  const agents = JSON.stringify(Object.fromEntries(useContainers().flatMap((c) => (c.agents ? [[profileIn(c.id), c.agents]] : []))))
  useEffect(() => { void webPages?.engine?.("agents:access", JSON.parse(agents), profileIn("agents")).catch(() => {}) }, [agents])
  // What a page's right-click offers: its containers and Glance, told to the desktop app as they change.
  const glance = useEnabled()("glance"), names = JSON.stringify(useContainers().map(({ id, name }) => ({ id, name })))
  useEffect(() => { void webPages?.engine?.("web:menus", { containers: JSON.parse(names), glance }).catch(() => {}) }, [names, glance])
  // Which containers need Touch ID, told to the desktop app as they change.
  const locks = useContainers().filter((c) => c.lock).map((c) => profileIn(c.id)).join(" ")
  useEffect(() => { void webPages?.engine?.("lock:set", locks ? locks.split(" ") : []).catch(() => {}) }, [locks])
  // Which pages play sound, shown or in the background: read again as pages change.
  useEffect(() => {
    const web = webPages
    if (!web?.list) return
    let timer = 0
    const read = () => void web.list!().then((list) => {
      setSounds(list.flatMap((p) => p.muted || p.playing
        ? [{ playing: !!p.playing, muted: !!p.muted, id: p.id, tab: p.tab ?? "", arg: argOf(p.url, containerOfProfile(p.profile)), title: p.title }] : []))
      const of = (on: (p: (typeof list)[number]) => boolean | undefined) => new Set(list.flatMap((p) => (p.tab && on(p) ? [p.tab] : [])))
      setPageFlags(of((p) => p.loading && !p.error), of((p) => p.typed))
    }, () => {})
    const off = web.on((m) => { if (m.type === "state" || m.type === "pages") { clearTimeout(timer); timer = window.setTimeout(read, 250) } })
    return () => { off(); clearTimeout(timer) }
  }, [])
  // The pages agents are at work in: as the desktop app tells them, and as they are when this window loads.
  useEffect(() => { void Promise.resolve(webPages?.engine?.("agents:pages")).then((l) => { if (Array.isArray(l)) setAgentPages(l as AgentPage[]) }, () => {}) }, [])
  useEffect(() => webPages?.on((m) => {
    if (m.type === "state") stateCame(m.id, m.state)
    else if (m.type === "open") opened(m)
    else if (m.type === "close") closeTab(m.tab, true)
    else if (m.type === "blocked") notify(`Blocked a pop-up from ${hostOf(m.url) || "a page"}`, { action: { label: "Open", run: () => opened({ ...m, type: "open", how: "foreground" }) } })
    else if (m.type === "engine:agent:pages" && Array.isArray(m.pages)) setAgentPages(m.pages as AgentPage[])
    else if (m.type === "engine:agent:close" && typeof m.tab === "string" && m.tab) closeTab(m.tab, true)
    // An agent asks: its page shown as a tab (opened as one from the background, in its agent's tab group), so the user
    // does it where it's asked.
    else if (m.type === "engine:agent:help" && typeof m.id === "number" && m.on) {
      if (typeof m.tab === "string" && m.tab) selectTab(m.tab)
      else if (typeof m.url === "string" && typeof m.profile === "string") {
        void openAsTab({ id: m.id, tab: "", url: m.url, profile: m.profile, group: String(m.group ?? "") }, false)
      }
    }
    // A page asked for a passkey: its QR code over it, the tab shown (a request in a hidden tab is refused, but the tab may
    // have gone behind since).
    else if (m.type === "engine:passkey" && typeof m.id === "number" && typeof m.ask === "number") {
      const id = m.id, ask = m.ask, state = String(m.state ?? "")
      passkeyAsks.update((a) => {
        const next = new Map(a)
        if (state === "done") { if (next.get(id)?.ask === ask) next.delete(id) }
        else next.set(id, { ask, state, qr: String(m.qr ?? ""), site: String(m.site ?? ""), create: !!m.create })
        return next
      })
      if (state === "scan" && typeof m.tab === "string" && m.tab) selectTab(m.tab)
    }
    else if (m.type === "focus") { pageTookKeyboard(m.id); const s = shown.get(m.id); if (s) focusGroup(s.group) }
    else if (m.type === "address") shown.get(m.id)?.focusAddress()
    else if (m.type === "source") { const s = shown.get(m.id); viewSource(m.url.replace(/^view-source:/, ""), s?.container ?? null, s?.tab) }
    else if (m.type === "clip") shown.get(m.id)?.clip()
    else if (m.type === "block") void pickElement(m.id, undefined, { x: m.x, y: m.y })
    else if (m.type === "image") void saveImage(m)
    else if (m.type === "icon") iconCame(m.host, m.icon)
    else if (m.type === "notify" || m.type === "session") pageNotified(m)
    else if (m.type === "found") shown.get(m.id)?.found(m.active, m.matches)
    // (the mouse's back and forward buttons over a page: its pane's Back and Forward)
    else if (m.type === "nav") { const s = shown.get(m.id); if (s) focusGroup(s.group); runCommandById(m.dir < 0 ? "nav:back" : "nav:forward") }
    else if (m.type === "key") runShortcut(new KeyboardEvent("keydown", { key: m.key, code: m.code, metaKey: m.meta, ctrlKey: m.ctrl, altKey: m.alt, shiftKey: m.shift, cancelable: true }))
    else if (m.type === "engine:ext:changed") extensionsChanged()
    // (an extension's tab, in its session's container)
    else if (m.type === "engine:ext:open" && typeof m.url === "string") openPage(m.url, containerOfProfile(String(m.profile ?? "")))
    else if (m.type === "engine:ext:show" && typeof m.url === "string") openView(`web/${argOf(m.url, containerOfProfile(String(m.profile ?? "")))}`)
    else if (m.type === "engine:ext:close" && typeof m.url === "string") closeView(`web/${argOf(m.url, containerOfProfile(String(m.profile ?? "")))}`)
    else if (m.type === "engine:ext:popup" && typeof m.ext === "string") popupChanged(m.ext, !!m.open)
    else if (m.type === "engine:ext:popup-ask" && typeof m.ext === "string") document.querySelector<HTMLElement>(`[data-ext-button="${CSS.escape(m.ext)}"]`)?.click()
    else if (m.type === "download") {
      if (m.ok) notify(`Downloaded ${m.name}`, { action: { label: showLabel, run: () => void webPages?.reveal(m.path) } })
      else notify(`Couldn't download ${m.name}`, { kind: "error" })
    }
  }), [])
  return <Card />
}

function Preview() {
  return (
    <Panel title="Browser" icon={Globe} tint="var(--web-viewer)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        A web browser in the desktop app's tabs, next to your notes: containers for several accounts, Shields against ads and
        trackers, Chrome extensions, history and bookmarks, and agents that work beside you. Save to vault clips a page as you
        see it into Clippings. Links in notes and terminals open here, {modKey}-click behind your tab; ⌥{modKey}-click opens them
        in another browser. On the web and on phones links open in your browser as before.
      </p>
    </Panel>
  )
}

export default definePlugin({
  containers: () => containers().map(({ id, name, color }) => ({ id, name, color })),
  views: {
    web: {
      icon: Globe,
      title: (arg) => { const { url } = splitArg(arg); return url ? titleOf(url) || extensionPageName(url) || (url.startsWith("view-source:") ? url : hostOf(url)) || "Web page" : "New tab" },
      // (loading: a spinner, as a browser's tab shows; a page's source: its own icon)
      iconFor: (arg, tab) => {
        const { container, url } = splitArg(arg), c = containerById(container), color = c ? colorOf(c) : undefined
        return tab && loadingIn(tab) ? spinnerIcon(color) : url.startsWith("view-source:") ? FileCode2 : siteIcon(url, color)
      },
      // (with appearance `tabTint`: the active tab in its container's colour, lightly)
      tabTint: (arg) => { const c = containerById(splitArg(arg).container); return c ? colorOf(c) : undefined },
      // (a new tab group of one site's pages is named after it)
      groupName: (arg) => siteName(splitArg(arg).url),
      full: true,
      // (Back and Forward walk the page's history before the tab's)
      history: (_arg, tab, dir) => {
        const p = pageOfTab(tab), st = p?.state()
        return p && (dir < 0 ? st?.back : st?.forward) ? () => void webPages?.go(p.id, dir < 0 ? "back" : "forward") : null
      },
      // (what a new tab can be, its address to type: in the desktop app, where pages show)
      asNewTab: { label: "Web page", here: () => !!webPages },
      // The address is the page's own state: following a link changes the tab's arg, not the page.
      argState: true,
      // Pinned by its address, named by its title (kept up to date while it's open).
      pinAs: (arg) => (/^https?:\/\//i.test(splitArg(arg).url) ? arg : null),
      pinLabel: (arg) => titleOf(splitArg(arg).url),
      // (another container is another page, in other logins: drawn afresh)
      render: ({ arg, focused, setArg }) => (
        <Suspense fallback={null}><WebPage key={splitArg(arg).container ?? ""} arg={arg} focused={focused} setArg={setArg} /></Suspense>
      ),
      // (an agent asking or at work in it: its pointer beside the site's icon, a click pausing it; else playing sound or
      // muted: a speaker, a click on it mutes the tab, as a browser's does)
      tabMark: (arg, tab) => {
        const a = agentPageOfTab(tab), s = soundOf(arg, tab)
        if (a?.asking) return { icon: Hand, label: `${a.by} needs you`, tint: "var(--purple)", run: () => {} }
        if (a && (a.own || (working(a) && !s))) {
          return { icon: MousePointer2, label: a.paused ? `${a.by}: paused here, click to resume` : `${a.by} is using this tab: click to pause`, tint: a.paused ? undefined : "var(--purple)",
            run: () => void pauseAgents(a.id, !a.paused) }
        }
        return s ? { icon: s.muted ? VolumeX : Volume2, label: s.muted ? "Unmute tab" : "Mute tab", run: () => void webPages?.go(s.id, s.muted ? "unmute" : "mute") } : null
      },
      // (a page playing sound or holding what was typed and not sent is in use, seen or not)
      archives: (arg, tab) => !soundOf(arg, tab)?.playing && !typedIn(tab),
      // (a tab's page is its own, whatever else shows the address; moved to another window, it goes along)
      // (once the window paints behind it again, as WebPage lets go of one; not if it's back by then: ⌘⇧T)
      onTabClose: (_arg, tab, moved) => void painted().then(() => { if (!panesOf(getTabLayout().root).some((g) => g.tabs.some((t) => t.id === tab))) void webPages?.close(tab, moved) }),
      tabMenu: (arg, tab) => {
        const { url } = splitArg(arg), sound = soundOf(arg)
        return [
          ...(/^https?:\/\//i.test(url) ? [{ label: "Duplicate tab", icon: CopyPlus, run: () => void duplicate(arg, tab) }] : []),
          ...(sound ? [{ label: sound.muted ? "Unmute tab" : "Mute tab", icon: sound.muted ? Volume2 : VolumeX,
            run: () => void webPages?.go(sound.id, sound.muted ? "unmute" : "mute") }] : []),
          ...(/^https?:\/\//i.test(url) ? webPageActions({ url, title: titleOf(url) ?? "" }) : []),
        ]
      },
    },
    "agent-runs": { icon: Bot, title: () => "Agents in the browser", render: () => <ReplaysView /> },
    "agent-passkeys": { icon: KeyRound, title: () => "Passkeys for agents' logins", render: () => <AgentPasskeys /> },
    // (every machine's browser tabs, one watched live: `3`, or `3@m1` in another machine's browser)
    "web-live": { icon: MonitorPlay, title: (arg) => (arg ? liveTitle(arg) || "Browser tab" : "Browser tabs"), argState: true, full: true,
      // (a page of this window's agents shown in its tab: an ask there needs no toast)
      onScreen: (arg) => { const p = agentPage(Number(arg.split("@")[0])); return !!p && onScreen.get().has(p.id) },
      render: ({ arg, setArg }) => <LiveView arg={arg} setArg={setArg} /> },
    // (named web-pages from when it listed open pages too: kept, as sidebars and tabs name it)
    "web-pages": { icon: Globe, title: () => "Sites", render: () => <SitesView openPage={openPage} /> },
    "web-extensions": { icon: Puzzle, title: () => "Extensions", render: () => <ExtensionsView openPage={openPage} /> },
    "web-history": { icon: History, title: () => "History", render: () => <HistoryView openPage={(url) => openPage(url)} onImport={() => void askImport()} /> },
  },
  files: { types: ["bookmarks"], icon: Bookmark },
  // Its tabs, bookmarks, history and the web in the quick switcher, the browser's command bar (⌘T's, with newtab.json `opens`).
  ...switcherSearch(openPage),
  sidebar: {
    "web-pages": { title: "Sites", names: ["logins", "cookies", "signed in"], heading: false, sort: 34, hidden: true, view: "web-pages",
      menu: sitesPanelMenu, render: (ctx) => <SitesPanel open={ctx.open} openPage={openPage} newTab={askAddress} /> },
  },
  webLink: (url, { newTab, front, out }) => {
    if (!webPages || out || !linksInViewer()) return false
    const c = destination(url, { from: null, fresh: true }).container
    if (newTab && front) openTab(`view:web/${argOf(url, c)}`)
    else if (newTab) openBehind(url, c)
    else openPage(url)
    return true
  },
  commands: [
    { id: "web:open", name: "Open web page…", desktop: true, when: () => !!webPages, run: () => askAddress() },
    { id: "web:live", name: "Show browser tabs", icon: MonitorPlay, run: () => openView("web-live", { newTab: !isViewOpen("view:web-live") }) },
    { id: "web:agent-runs", name: "Show agents in the browser", desktop: true, when: () => !!webPages?.engine, icon: Bot,
      run: () => openView("agent-runs", { newTab: !isViewOpen("view:agent-runs") }) },
    { id: "web:agent-pages", name: "Show agents' pages", nameWhenOn: "Hide agents' pages", desktop: true, icon: MousePointer2,
      when: () => agentPages.get().length > 0, on: agentsCardShown, run: () => showAgentsCard(!agentsCardShown()) },
    // (Windows sets the default browser only in its Settings, among browsers it knows)
    { id: "web:default-browser", name: "Make Vaultite the default browser", desktop: true, when: () => !!webPages?.engine && !isWindows, icon: Globe,
      run: () => void Promise.resolve(webPages?.engine?.("browser:make-default")).then((yes) => notify(yes ? "Vaultite is the default browser: links from other apps open here" : "Confirm it in the box macOS shows"), (e) => notifyError(e, "Couldn't make it the default browser")) },
    { id: "web:lock", name: "Lock containers", desktop: true, when: () => !!webPages?.engine && containers().some((c) => c.lock), run: () => void webPages?.engine?.("lock:lock"), icon: Lock },
    { id: "web:open-container", name: "New tab in container…", desktop: true, when: () => !!webPages, run: askContainer, icon: Box },
    { id: "web:clip", name: "Clip current web page", when: () => !!focusedPage(), run: () => focusedPage()?.clip(), icon: Scissors },
    { id: "web:browser", name: "Open current web page in another browser", when: () => !!focusedPage(), run: () => { const p = focusedPage(); if (p) void webPages?.external(p.url()) }, icon: ExternalLink },
    // (⌘L with a web tab in front, wherever the keyboard is but another field: the editor's ⌘L is a note's)
    { id: "web:address", name: "Edit current web page's address", keys: ["Mod+L"], when: () => !!focusedPage(),
      keysWhen: () => !typingIn(document.activeElement) || !!document.activeElement?.closest("[data-web-bar]"), run: () => focusedPage()?.focusAddress(), icon: PencilLine },
    { id: "web:search-selection", name: "Search the web for selected text", desktop: true, when: () => !!webPages && !!selectedText().trim(), run: () => openWebLink(searchUrl(selectedText().replace(/\s+/g, " "), settings.get().search)), icon: Search },
    { id: "web:extensions", name: "Extensions", desktop: true, when: hasExtensions, run: openExtensions, icon: Puzzle },
    { id: "web:sites-tab", name: "Show sites and logins", desktop: true, when: () => !!webPages?.sites, icon: Globe, run: manageContainers },
    { id: "web:history", name: "Show history", keys: isMac ? ["Mod+Y"] : ["Mod+H"], desktop: true, when: () => !!webPages?.engine, run: () => openView("web-history", { newTab: !isViewOpen("view:web-history") }), icon: History },
    { id: "web:clear-history", name: "Clear browsing history…", desktop: true, when: () => !!webPages?.engine, run: askClear, icon: Eraser },
    { id: "web:block-element", name: "Block an element on this page", when: () => !!webPages?.engine && /^https?:\/\//i.test(focusedPage()?.url() ?? ""),
      run: () => void pickElement(focusedPageId()), icon: MousePointerSquareDashed },
    { id: "web:edit-style", name: "Edit this site's style", when: () => !!webPages?.engine && !!hostOf(focusedPage()?.url() ?? ""),
      run: () => void editStyle(hostOf(focusedPage()?.url() ?? ""), focusedPageId()), icon: Paintbrush },
    { id: "web:player", name: "Open current web page as player", nameWhenOn: "Bring current web page back from player", keys: ["Mod+Alt+P"], icon: MonitorPlay,
      when: () => !!webPages?.player && /^https?:\/\//i.test(focusedPage()?.url() ?? ""), on: () => !!focusedPage()?.inPlayer(),
      run: () => setPlayer(focusedPageId(), !focusedPage()?.inPlayer()) },
    { id: "web:bookmark", name: "Bookmark current web page", keys: ["Mod+D"], when: () => !!focusedPage(), run: bookmarkPage, icon: Bookmark },
    // The browser's keys, as Chrome's, wherever the keyboard is while a web tab is in front (a page takes ⌘F, ⌘G and zoom
    // first: electron/web.ts BROWSER_KEYS); elsewhere they're the app's.
    { id: "web:reload", name: "Reload current web page", keys: ["Mod+R"], when: onWebTab, run: () => onPage("reload"), icon: RotateCw },
    { id: "web:hard-reload", name: "Reload current web page without its cache", keys: ["Mod+Shift+R"], when: onWebTab, run: () => onPage("hard-reload"), icon: RotateCw },
    { id: "web:devtools", name: "Show developer tools for current web page", keys: [isMac ? "Mod+Alt+I" : "Mod+Shift+I"], when: onWebTab, run: () => onPage("devtools"), icon: Code },
    { id: "web:find", name: "Find in current web page", keys: ["Mod+F"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("open"), icon: Search },
    { id: "web:find-next", name: "Find next in current web page", keys: ["Mod+G"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("next"), icon: Search },
    { id: "web:find-previous", name: "Find previous in current web page", keys: ["Mod+Shift+G"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("previous"), icon: Search },
    { id: "web:zoom-in", name: "Zoom in on current web page", keys: ["Mod+=", "Mod+Shift+="], when: () => !!focusedPage(), run: () => onPage("zoom-in"), icon: ZoomIn },
    { id: "web:zoom-out", name: "Zoom out on current web page", keys: ["Mod+-"], when: () => !!focusedPage(), run: () => onPage("zoom-out"), icon: ZoomOut },
    { id: "web:zoom-reset", name: "Reset current web page's zoom", keys: ["Mod+0"], when: () => !!focusedPage(), run: () => onPage("zoom-reset"), icon: Scan },
    { id: "web:source", name: "View current web page's source", keys: [isMac ? "Mod+Alt+U" : "Mod+U"], icon: FileCode2,
      when: () => /^https?:\/\//i.test(focusedPage()?.url() ?? ""), run: () => { const p = focusedPage(); if (p) viewSource(p.url(), p.container, p.tab) } },
    { id: "web:print", name: "Print current web page", when: () => /^https?:\/\//i.test(focusedPage()?.url() ?? ""), run: () => onPage("print"), icon: Printer },
    { id: "web:import-brave", name: "Import from Brave…", desktop: true, when: () => browsersHere().some((s) => s.browser === "brave"), run: () => void askImport("brave"), icon: Download },
    { id: "web:import-chrome", name: "Import from Chrome…", desktop: true, when: () => browsersHere().some((s) => s.browser === "chrome"), run: () => void askImport("chrome"), icon: Download },
  ],
  ambient: { playing: { title: "Web pages playing", sort: 55, render: () => <Playing /> } },
  settingsPanel: () => <SitesSettings />,
  settingsSearch: [{ key: "sites", label: "Sites and logins", description: "the sites signed in to in each container's and workspace's logins: sign out, clear trackers" }],
  background: Background,
  preview: () => <Preview />,
})
