// Browser: web pages in the desktop app's tabs (native views, electron/web.ts, its engine electron/browser/), beside notes.
// Links open here (⌘-click: the browser); pages' notifications and Claude Code on the web's sessions reach the Inbox.
import { lazy, Suspense, useEffect } from "react"
import { Bookmark, Bot, Box, Download, Eraser, ExternalLink, Globe, History, Lock, MonitorPlay, MousePointerSquareDashed, Paintbrush, PencilLine, Puzzle, Scissors, Search, Volume2, VolumeX } from "lucide-react"
import { choose, closeTab, closeView, definePlugin, focusGroup, getStore, isMac, isViewOpen, modKey, modifiedSteps, notify, notifyError, openInSet, openInSplit, openView, openWebLink, Panel, post, runShortcut, saveAttachments, selectTab, showLabel, systemNotify, selectedText, useCommandList, webPageActions, webPages, type Choice, type WebEvent } from "@vaultite"
import { hostOf, searchUrl } from "./address"
import { addContainer, argOf, colorOf, useContainers, containerById, containerOfProfile, containers, profileIn, splitArg } from "./containers"
import { iconCame, siteIcon } from "./icons"
import { painted } from "./layers"
import { manageContainers, SitesPanel, sitesPanelMenu, SitesSettings, SitesView } from "./Sites"
import { ExtensionsView } from "./Extensions"
import { extensionPageName, extensionsChanged, hasExtensions, popupChanged, setExtensionsOpener } from "./extstate"
import { ReplaysView } from "./Replays"
import { liveTitle, LiveView } from "./LiveView"
import { askClear, HistoryView } from "./HistoryView"
import { askImport, browsersHere, findBrowsers } from "./importer"
import "./types"
import { agentNews, bookmark, focusedPage, focusedPageId, helpAsks, linksInViewer, passkeyAsks, pausedPages, profile, setPlayer, setSounds, settings, shown, soundOf, titleOf } from "./state"
import { pickElement, useHiddenParts, watchShields } from "./shields"
import { editStyle, useLookBackground, useSiteStyles } from "./stylestate"
import { Playing } from "./Playing"

const WebPage = lazy(() => import("./WebPage"))

/** Open an address in a web tab (a new one, or the tab already showing it): in `container`, else where its site always
 *  opens (WebPage moves it there). */
const openPage = (url: string, container: string | null = null) => openView(`web/${argOf(url, container)}`, { newTab: true })

const openExtensions = () => openView("web-extensions", { newTab: !isViewOpen("view:web-extensions") })
setExtensionsOpener(openExtensions)

/** A new web tab (in `container`), its address ready to type, with suggestions. */
function askAddress(container: string | null = null) {
  openView(`web/${argOf("", container)}`, { newTab: true })
}

/** Bookmark the page in the focused pane. */
function bookmarkPage() {
  const url = focusedPage()?.url()
  if (url) void bookmark(url, titleOf(url) ?? "")
}

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

/** The plugin's work in the app: its settings, the app's shortcuts told to the desktop app, and its events. */
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
  // Which containers need Touch ID, told to the desktop app as they change.
  const locks = useContainers().filter((c) => c.lock).map((c) => profileIn(c.id)).join(" ")
  useEffect(() => { void webPages?.engine?.("lock:set", locks ? locks.split(" ") : []).catch(() => {}) }, [locks])
  // Which pages play sound, shown or in the background: read again as pages change.
  useEffect(() => {
    const web = webPages
    if (!web?.list) return
    let timer = 0
    const read = () => void web.list!().then((list) => setSounds(list.flatMap((p) => p.muted || p.playing
      ? [{ playing: !!p.playing, muted: !!p.muted, id: p.id, tab: p.tab ?? "", arg: argOf(p.url, containerOfProfile(p.profile)), title: p.title }] : [])), () => {})
    const off = web.on((m) => { if (m.type === "state" || m.type === "pages") { clearTimeout(timer); timer = window.setTimeout(read, 250) } })
    return () => { off(); clearTimeout(timer) }
  }, [])
  useEffect(() => webPages?.on((m) => {
    if (m.type === "state") shown.get(m.id)?.onState(m.state)
    else if (m.type === "open") openPage(m.url, shown.get(m.id)?.container ?? null)
    // An agent's tab: beside the user's work, without taking the keyboard, in its task's tab group.
    else if (m.type === "engine:agent:open" && typeof m.url === "string" && typeof m.profile === "string") {
      const to = `view:web/${argOf(m.url, containerOfProfile(m.profile))}`
      openInSet(to, typeof m.group === "string" ? m.group : "")
    } else if (m.type === "engine:agent:close" && typeof m.tab === "string" && m.tab) closeTab(m.tab, true)
    else if (m.type === "engine:agent:help" && typeof m.id === "number") {
      const id = m.id, on = !!m.on
      helpAsks.update((a) => { const next = new Map(a); if (on) next.set(id, { by: String(m.by ?? "An agent"), reason: String(m.reason ?? "") }); else next.delete(id); return next })
      // (shown, so the user sees what's asked where it's asked)
      if (on && typeof m.tab === "string" && m.tab) selectTab(m.tab)
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
    else if (m.type === "engine:agent:acting" && typeof m.id === "number") {
      const id = m.id
      agentNews.update((n) => new Map(n).set(id, { by: String(m.by ?? "An agent"), what: String(m.what ?? ""), at: Date.now() }))
    } else if (m.type === "engine:agent:paused" && typeof m.id === "number") {
      const id = m.id, on = !!m.on
      pausedPages.update((s) => { const next = new Set(s); if (on) next.add(id); else next.delete(id); return next })
    }
    else if (m.type === "focus") { const s = shown.get(m.id); if (s) focusGroup(s.group) }
    else if (m.type === "address") shown.get(m.id)?.focusAddress()
    else if (m.type === "clip") shown.get(m.id)?.clip()
    else if (m.type === "block") void pickElement(m.id, undefined, { x: m.x, y: m.y })
    else if (m.type === "image") void saveImage(m)
    else if (m.type === "icon") iconCame(m.host, m.icon)
    else if (m.type === "notify" || m.type === "session") pageNotified(m)
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
  return null
}

function Preview() {
  return (
    <Panel title="Browser" icon={Globe} tint="var(--web-viewer)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        A web browser in the desktop app's tabs, next to your notes: containers for several accounts, Shields against ads and
        trackers, Chrome extensions, history and bookmarks, and agents that work beside you. Save to vault clips a page as you
        see it into Clippings. Links in notes and terminals open here; {modKey}-click opens them in another browser. On the web
        and on phones links open in your browser as before.
      </p>
    </Panel>
  )
}

export default definePlugin({
  views: {
    web: {
      icon: Globe,
      title: (arg) => { const { url } = splitArg(arg); return url ? titleOf(url) || extensionPageName(url) || hostOf(url) || "Web page" : "New tab" },
      iconFor: (arg) => { const { container, url } = splitArg(arg), c = containerById(container); return siteIcon(url, c ? colorOf(c) : undefined) },
      // (with appearance `tabTint`: the active tab in its container's colour, lightly)
      tabTint: (arg) => { const c = containerById(splitArg(arg).container); return c ? colorOf(c) : undefined },
      full: true,
      // The address is the page's own state: following a link changes the tab's arg, not the page.
      argState: true,
      // Pinned by its address, named by its title (kept up to date while it's open).
      pinAs: (arg) => (/^https?:\/\//i.test(splitArg(arg).url) ? arg : null),
      pinLabel: (arg) => titleOf(splitArg(arg).url),
      // (another container is another page, in other logins: drawn afresh)
      render: ({ arg, focused, setArg }) => (
        <Suspense fallback={null}><WebPage key={splitArg(arg).container ?? ""} arg={arg} focused={focused} setArg={setArg} /></Suspense>
      ),
      // (playing sound or muted: a speaker beside the site's icon, a click on it mutes the tab, as a browser's does)
      tabMark: (arg, tab) => {
        const s = soundOf(arg, tab)
        return s ? { icon: s.muted ? VolumeX : Volume2, label: s.muted ? "Unmute tab" : "Mute tab", run: () => void webPages?.go(s.id, s.muted ? "unmute" : "mute") } : null
      },
      // (a tab's page is its own, whatever else shows the address)
      // (once the window paints behind it again, as WebPage lets go of one)
      onTabClose: (_arg, tab) => void painted().then(() => webPages?.close(tab)),
      tabMenu: (arg) => {
        const { url } = splitArg(arg), sound = soundOf(arg)
        return [
          ...(sound ? [{ label: sound.muted ? "Unmute tab" : "Mute tab", icon: sound.muted ? Volume2 : VolumeX,
            run: () => void webPages?.go(sound.id, sound.muted ? "unmute" : "mute") }] : []),
          ...(/^https?:\/\//i.test(url) ? webPageActions({ url, title: titleOf(url) ?? "" }) : []),
        ]
      },
    },
    "agent-runs": { icon: Bot, title: () => "Agents in the browser", render: () => <ReplaysView /> },
    // (from the web app: the desktop app's tabs, one watched live by its number)
    "web-live": { icon: MonitorPlay, title: (arg) => (arg ? liveTitle(Number(arg)) || "Browser tab" : "Browser tabs"), argState: true, full: true,
      render: ({ arg, setArg }) => <LiveView arg={arg} setArg={setArg} /> },
    // (named web-pages from when it listed open pages too: kept, as sidebars and tabs name it)
    "web-pages": { icon: Globe, title: () => "Sites", render: () => <SitesView openPage={openPage} /> },
    "web-extensions": { icon: Puzzle, title: () => "Extensions", render: () => <ExtensionsView openPage={openPage} /> },
    "web-history": { icon: History, title: () => "History", render: () => <HistoryView openPage={(url) => openPage(url)} onImport={() => void askImport()} /> },
  },
  files: { types: ["bookmarks"], icon: Bookmark },
  sidebar: {
    "web-pages": { title: "Sites", names: ["logins", "cookies", "signed in"], heading: false, sort: 34, hidden: true, view: "web-pages",
      menu: sitesPanelMenu, render: (ctx) => <SitesPanel open={ctx.open} openPage={openPage} /> },
  },
  webLink: (url, { mod }) => {
    if (!webPages || mod || !linksInViewer()) return false
    openPage(url)
    return true
  },
  commands: [
    { id: "web:open", name: "Open web page…", desktop: true, when: () => !!webPages, run: () => askAddress() },
    { id: "web:live", name: "Show browser tabs", when: () => !webPages, icon: MonitorPlay, run: () => openView("web-live", { newTab: !isViewOpen("view:web-live") }) },
    { id: "web:agent-runs", name: "Show agents in the browser", desktop: true, when: () => !!webPages?.engine, icon: Bot,
      run: () => openView("agent-runs", { newTab: !isViewOpen("view:agent-runs") }) },
    { id: "web:default-browser", name: "Make Vaultite the default browser", desktop: true, when: () => !!webPages?.engine, icon: Globe,
      run: () => void Promise.resolve(webPages?.engine?.("browser:make-default")).then((yes) => notify(yes ? "Vaultite is the default browser: links from other apps open here" : "Confirm it in the box macOS shows"), (e) => notifyError(e, "Couldn't make it the default browser")) },
    { id: "web:lock", name: "Lock containers", desktop: true, when: () => !!webPages?.engine && containers().some((c) => c.lock), run: () => void webPages?.engine?.("lock:lock"), icon: Lock },
    { id: "web:open-container", name: "New tab in container…", desktop: true, when: () => !!webPages, run: askContainer, icon: Box },
    { id: "web:clip", name: "Clip current web page", when: () => !!focusedPage(), run: () => focusedPage()?.clip(), icon: Scissors },
    { id: "web:browser", name: "Open current web page in another browser", when: () => !!focusedPage(), run: () => { const p = focusedPage(); if (p) void webPages?.external(p.url()) }, icon: ExternalLink },
    { id: "web:address", name: "Edit current web page's address", when: () => !!focusedPage(), run: () => focusedPage()?.focusAddress(), icon: PencilLine },
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
    { id: "web:import-brave", name: "Import from Brave…", desktop: true, when: () => browsersHere().some((s) => s.browser === "brave"), run: () => void askImport("brave"), icon: Download },
    { id: "web:import-chrome", name: "Import from Chrome…", desktop: true, when: () => browsersHere().some((s) => s.browser === "chrome"), run: () => void askImport("chrome"), icon: Download },
  ],
  ambient: { playing: { title: "Web pages playing", sort: 55, render: () => <Playing /> } },
  settingsPanel: () => <SitesSettings />,
  settingsSearch: [{ key: "sites", label: "Sites and logins", description: "the sites signed in to in each container's and workspace's logins: sign out, clear trackers" }],
  background: Background,
  preview: () => <Preview />,
})
