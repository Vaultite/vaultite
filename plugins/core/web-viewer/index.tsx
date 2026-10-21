// Browser: web pages in the desktop app's tabs (native views, electron/web.ts, its engine electron/browser/), beside notes.
// Links open here (⌘-click: the browser); pages' notifications and Claude Code on the web's sessions reach the Inbox.
import { lazy, Suspense, useEffect } from "react"
import { Bookmark, Bot, Boxes, Download, Eraser, ExternalLink, Globe, History, Lock, MousePointerSquareDashed, PencilLine, Puzzle, Scissors, Search, Volume2, VolumeX } from "lucide-react"
import { choose, closeView, definePlugin, focusGroup, getStore, isMac, isViewOpen, modKey, modifiedSteps, notify, notifyError, op, openFile, openInSplit, openView, openWebLink, Panel, post, runShortcut, saveAttachments, showLabel, systemNotify, selectedText, useCommandList, webPageActions, webPages, type Choice, type WebEvent } from "@vaultite"
import { hostOf, searchUrl } from "./address"
import { addContainer, argOf, colorOf, useContainers, containerById, containerOfProfile, containers, profileIn, splitArg } from "./containers"
import { iconCame, siteIcon } from "./icons"
import { WebPagesPanel, WebPagesView } from "./Pages"
import { ExtensionsView } from "./Extensions"
import { extensionPageName, extensionsChanged, hasExtensions, popupChanged, setExtensionsOpener } from "./extstate"
import { ReplaysView } from "./Replays"
import { askClear, HistoryView } from "./HistoryView"
import { askImport, browsersHere, findBrowsers } from "./importer"
import "./types"
import { agentNews, focusedPage, focusedPageId, linksInViewer, pausedPages, profile, setSounds, settings, shown, soundOf, titleOf } from "./state"
import { pickElement, useHiddenParts, watchShields } from "./shields"

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

/** Bookmark the page in the focused pane: a line in the bookmarks note. */
async function bookmarkPage() {
  const p = focusedPage(), url = p?.url()
  if (!url || !/^https?:\/\//i.test(url)) return
  try {
    const r = await op<{ path: string | null; added: number }>("bookmarks.add", { url, title: titleOf(url) ?? "" })
    const path = r.path
    notify(r.added ? "Bookmarked" : "Already bookmarked", { action: path ? { label: "Open bookmarks", run: () => openFile(path) } : undefined })
  } catch (e) { notifyError(e, "Couldn't bookmark the page") }
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

/** Toasts and tooltips over a shown page, told to the desktop app, which copies them above the native page so they show
 *  without stopping it; resent as they or the tabs change, and every 100 ms while they animate. */
function FloatLayer() {
  useEffect(() => {
    const web = webPages
    if (!web?.float) return
    let timer = 0, until = 0, had = false
    const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const send = () => {
      timer = 0
      const pages = [...document.querySelectorAll<HTMLElement>("[data-web-box][data-live]")]
        .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1)
      const rects = pages.length
        // (tooltips first, then the toasts sonner shows (past three it draws them see-through; copies are capped) and
        // the status bar, over a page beside the focused pane: copied like a toast, so it's clicked there)
        ? [...document.querySelectorAll<HTMLElement>("[data-floats]"), ...document.querySelectorAll<HTMLElement>("[data-sonner-toast][data-visible=true]:not([data-removed=true]), [data-status-bar]")]
          .map((t) => ({ r: t.getBoundingClientRect(), through: t.hasAttribute("data-floats") }))
          .filter(({ r }) => r.width > 1 && r.height > 1 && pages.some((b) => meets(r, b)))
          .map(({ r, through }) => ({ x: r.left, y: r.top, width: r.width, height: r.height, through }))
        : []
      if (rects.length || had) void web.float!(rects).catch(() => {})
      had = rects.length > 0
      if (Date.now() < until) timer = window.setTimeout(send, 100)
    }
    const soon = () => { until = Date.now() + 700; if (!timer) timer = window.setTimeout(send, 16) }
    const mo = new MutationObserver(soon)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class", "hidden", "data-live", "data-expanded", "data-removed", "data-mounted", "data-visible", "data-front"] })
    addEventListener("resize", soon)
    return () => { mo.disconnect(); removeEventListener("resize", soon); clearTimeout(timer); if (had) void web.float!([]).catch(() => {}) }
  }, [])
  return null
}

/** The plugin's work in the app: its settings, the app's shortcuts told to the desktop app, and its events. */
function Background() {
  useEffect(() => void settings.ready(), [])
  useEffect(() => { if (hasExtensions()) extensionsChanged() }, [])
  useEffect(watchShields, [])
  useHiddenParts()
  // (Claude Code on the web's sessions: their news comes as `session` events from now on)
  useEffect(() => { void webPages?.cloud?.().catch(() => {}) }, [])
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
  // Which pages play sound, shown or kept: read again as pages change.
  useEffect(() => {
    const web = webPages
    if (!web?.list) return
    let timer = 0
    const read = () => void web.list!().then((list) => setSounds(new Map(list.flatMap((p) => p.muted || p.audible
      ? [[argOf(p.url, containerOfProfile(p.profile)), { sound: p.muted ? "muted" as const : "playing" as const, id: p.id }] as const] : []))), () => {})
    const off = web.on((m) => { if (m.type === "state" || m.type === "pages") { clearTimeout(timer); timer = window.setTimeout(read, 250) } })
    return () => { off(); clearTimeout(timer) }
  }, [])
  useEffect(() => webPages?.on((m) => {
    if (m.type === "state") shown.get(m.id)?.onState(m.state)
    else if (m.type === "open") openPage(m.url, shown.get(m.id)?.container ?? null)
    // An agent's tab: beside the user's work, without taking the keyboard.
    else if (m.type === "engine:agent:open" && typeof m.url === "string" && typeof m.profile === "string")
      openInSplit(`view:web/${argOf(m.url, containerOfProfile(m.profile))}`, "right", false)
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
  return <FloatLayer />
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
      // (playing sound or muted: a speaker in place of the site's icon, as a browser's tab shows it)
      iconFor: (arg) => {
        const sound = soundOf(arg)?.sound
        if (sound) return sound === "muted" ? VolumeX : Volume2
        const { container, url } = splitArg(arg), c = containerById(container)
        return siteIcon(url, c ? colorOf(c) : undefined)
      },
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
      onClose: (arg) => { const { container, url } = splitArg(arg); void webPages?.close(url, profileIn(container)) },
      tabMenu: (arg) => {
        const { url } = splitArg(arg), sound = soundOf(arg)
        return [
          ...(sound ? [{ label: sound.sound === "muted" ? "Unmute tab" : "Mute tab", icon: sound.sound === "muted" ? Volume2 : VolumeX,
            run: () => void webPages?.go(sound.id, sound.sound === "muted" ? "unmute" : "mute") }] : []),
          ...(/^https?:\/\//i.test(url) ? webPageActions({ url, title: titleOf(url) ?? "" }) : []),
        ]
      },
    },
    "agent-runs": { icon: Bot, title: () => "Agents in the browser", render: () => <ReplaysView /> },
    "web-pages": { icon: Globe, title: () => "Web pages", render: () => <WebPagesView openPage={openPage} ask={() => void askAddress()} /> },
    "web-extensions": { icon: Puzzle, title: () => "Extensions", render: () => <ExtensionsView openPage={openPage} /> },
    "web-history": { icon: History, title: () => "History", render: () => <HistoryView openPage={(url) => openPage(url)} onImport={() => void askImport()} /> },
  },
  files: { types: ["bookmarks"], icon: Bookmark },
  sidebar: {
    "web-pages": { title: "Web pages", heading: false, sort: 34, hidden: true, view: "web-pages",
      render: (ctx) => <WebPagesPanel open={ctx.open} openPage={openPage} ask={() => void askAddress()} /> },
  },
  webLink: (url, { mod }) => {
    if (!webPages || mod || !linksInViewer()) return false
    openPage(url)
    return true
  },
  commands: [
    { id: "web:open", name: "Open web page…", desktop: true, when: () => !!webPages, run: () => askAddress() },
    { id: "web:agent-runs", name: "Show what agents did in the browser", desktop: true, when: () => !!webPages?.engine, icon: Bot,
      run: () => openView("agent-runs", { newTab: !isViewOpen("view:agent-runs") }) },
    { id: "web:default-browser", name: "Make Vaultite the default browser", desktop: true, when: () => !!webPages?.engine, icon: Globe,
      run: () => void Promise.resolve(webPages?.engine?.("browser:make-default")).then((yes) => notify(yes ? "Vaultite is the default browser: links from other apps open here" : "Confirm it in the box macOS shows"), (e) => notifyError(e, "Couldn't make it the default browser")) },
    { id: "web:lock", name: "Lock containers", desktop: true, when: () => !!webPages?.engine && containers().some((c) => c.lock), run: () => void webPages?.engine?.("lock:lock"), icon: Lock },
    { id: "web:open-container", name: "New tab in container…", desktop: true, when: () => !!webPages, run: askContainer, icon: Boxes },
    { id: "web:clip", name: "Clip current web page", when: () => !!focusedPage(), run: () => focusedPage()?.clip(), icon: Scissors },
    { id: "web:browser", name: "Open current web page in another browser", when: () => !!focusedPage(), run: () => { const p = focusedPage(); if (p) void webPages?.external(p.url()) }, icon: ExternalLink },
    { id: "web:address", name: "Edit current web page's address", when: () => !!focusedPage(), run: () => focusedPage()?.focusAddress(), icon: PencilLine },
    { id: "web:search-selection", name: "Search the web for selected text", desktop: true, when: () => !!webPages && !!selectedText().trim(), run: () => openWebLink(searchUrl(selectedText().replace(/\s+/g, " "), settings.get().search)), icon: Search },
    { id: "web:extensions", name: "Extensions", desktop: true, when: hasExtensions, run: openExtensions, icon: Puzzle },
    { id: "web:pages-tab", name: "Open web pages in a tab", desktop: true, when: () => !!webPages, run: () => openView("web-pages", { newTab: !isViewOpen("view:web-pages") }) },
    { id: "web:history", name: "Show history", keys: isMac ? ["Mod+Y"] : ["Mod+H"], desktop: true, when: () => !!webPages?.engine, run: () => openView("web-history", { newTab: !isViewOpen("view:web-history") }), icon: History },
    { id: "web:clear-history", name: "Clear browsing history…", desktop: true, when: () => !!webPages?.engine, run: askClear, icon: Eraser },
    { id: "web:block-element", name: "Block an element on this page", when: () => !!webPages?.engine && /^https?:\/\//i.test(focusedPage()?.url() ?? ""),
      run: () => void pickElement(focusedPageId()), icon: MousePointerSquareDashed },
    { id: "web:bookmark", name: "Bookmark current web page", keys: ["Mod+D"], when: () => !!focusedPage(), run: () => void bookmarkPage(), icon: Bookmark },
    { id: "web:import-brave", name: "Import from Brave…", desktop: true, when: () => browsersHere().some((s) => s.browser === "brave"), run: () => void askImport("brave"), icon: Download },
    { id: "web:import-chrome", name: "Import from Chrome…", desktop: true, when: () => browsersHere().some((s) => s.browser === "chrome"), run: () => void askImport("chrome"), icon: Download },
  ],
  background: Background,
  preview: () => <Preview />,
})
