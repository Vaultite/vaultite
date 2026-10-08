// Web viewer: pages in desktop app tabs (native views, electron/web.ts), a viewer next to your notes rather than a
// browser. Links open here (⌘-click: the browser); pages' notifications and Claude Code sessions become Inbox events.
import { lazy, Suspense, useEffect } from "react"
import { ExternalLink, Globe, PencilLine, Scissors, Search } from "lucide-react"
import {
  choose, currentWorkspace, definePlugin, focusGroup, get, getStore, getTabLayout, isViewOpen, modKey, onTabLayoutChange, workspaceList, modifiedSteps, notify, notifyError, openInSplit, openView, openWebLink, Panel, post, runShortcut,
  saveAttachments, showLabel, systemNotify, selectedText, useCommandList, useVaultChange, webPages, type TabLayout, type WebEvent,
} from "@vaultite"
import { addressOf, hostOf, searchUrl } from "./address"
import { iconCame, siteIcon } from "./icons"
import { WebPagesPanel, WebPagesView } from "./Pages"
import { focusedPage, getSettings, linksInViewer, profile, profileFor, setSettings, SETTINGS_DIR, shown, titleOf, type Settings } from "./state"

const WebPage = lazy(() => import("./WebPage"))

/** Open an address in a web tab (a new one, or the tab already showing it). */
const openPage = (url: string) => openView(`web/${url}`, { newTab: true })

/** Ask for an address (or words to search for) and open it. */
function askAddress() {
  choose({
    title: "Open web page", placeholder: "An address, or words to search for", items: [],
    empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Type an address (example.com) or what to search for.</p>,
    other: (typed) => { const to = addressOf(typed, getSettings().search); return to ? { id: to, label: `Open ${to}` } : null },
    onPick: (it) => openPage(it.id),
  })
}

/** An image from a page's menu (Save image to vault) saved where attachments go, named as the page named it. */
async function saveImage(m: Extract<WebEvent, { type: "image" }>) {
  const s = getStore()
  try {
    if (!m.data || !s) throw new Error("Couldn't get the image")
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
  if (getSettings().notifications === false) return
  // Looking at it: the page (a session's: showing that session) is the focused pane's, in a window that's in front.
  const page = focusedPage()
  const looking = document.visibilityState === "visible" && document.hasFocus() && !!page
    && (m.type === "session" ? page.url() === m.url : page === shown.get(m.id))
  if (looking) return
  const here = m.profile === profile()
  const title = m.title || m.site
  const body = [m.title ? m.body : "", here ? "" : `In workspace ${m.profile || "1"}`].filter(Boolean).join(" · ")
  const link = here ? `view:web/${m.url}` : undefined
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

/** Tell the desktop app every workspace's web tabs, with their logins (see the head of this file). */
function wake() {
  if (!webPages?.wake) return
  const web = (to: string) => (to.startsWith("view:web/") ? [to.slice(9)] : [])
  const here: string[] = []
  const walk = (n: TabLayout["root"]) => { if ("tabs" in n) here.push(...n.tabs.flatMap((t) => web(t.to))); else n.kids.forEach(walk) }
  walk(getTabLayout().root)
  const now = currentWorkspace()?.n
  const by = new Map<string, string[]>([[profile(), here]])
  for (const w of workspaceList()) {
    if (w.n === now) continue
    const p = profileFor(w.n)
    by.set(p, [...(by.get(p) ?? []), ...w.places.flatMap(web)])
  }
  for (const [p, urls] of by) if (urls.length) void webPages.wake([...new Set(urls)], p).catch(() => {})
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
        ? [...document.querySelectorAll<HTMLElement>("[data-sonner-toast], [data-floats]")].map((t) => ({ r: t.getBoundingClientRect(), through: t.hasAttribute("data-floats") }))
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
  const read = () => { get<Settings>("config/plugin/web-viewer").then((s) => setSettings(s && typeof s === "object" ? s : {}), () => {}) }
  useEffect(read, [])
  useVaultChange(read, (p) => p.startsWith(`${SETTINGS_DIR}/`))
  // (a moment after the tabs change: a tab being shown makes its own page first)
  useEffect(() => {
    let t = window.setTimeout(wake, 3000)
    const off = onTabLayoutChange(() => { clearTimeout(t); t = window.setTimeout(wake, 2000) })
    return () => { clearTimeout(t); off() }
  }, [])
  const commands = useCommandList()
  useEffect(() => { void webPages?.keys(modifiedSteps()) }, [commands])
  useEffect(() => webPages?.on((m) => {
    if (m.type === "state") shown.get(m.id)?.onState(m.state)
    else if (m.type === "open") openPage(m.url)
    else if (m.type === "focus") { const s = shown.get(m.id); if (s) focusGroup(s.group) }
    else if (m.type === "address") shown.get(m.id)?.focusAddress()
    else if (m.type === "clip") shown.get(m.id)?.clip()
    else if (m.type === "image") void saveImage(m)
    else if (m.type === "icon") iconCame(m.host, m.icon)
    else if (m.type === "notify" || m.type === "session") pageNotified(m)
    else if (m.type === "key") runShortcut(new KeyboardEvent("keydown", { key: m.key, code: m.code, metaKey: m.meta, ctrlKey: m.ctrl, altKey: m.alt, shiftKey: m.shift, cancelable: true }))
    else if (m.type === "download") {
      if (m.ok) notify(`Downloaded ${m.name}`, { action: { label: showLabel, run: () => void webPages?.reveal(m.path) } })
      else notify(`Couldn't download ${m.name}`, { kind: "error" })
    }
  }), [])
  return <FloatLayer />
}

function Preview() {
  return (
    <Panel title="Web viewer" icon={Globe} tint="var(--web-viewer)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Web pages in a tab of the desktop app, next to your notes: back, forward, reload, and Save to vault, which clips the
        page as you see it (one you're logged in to too) into a note in Clippings. Links in notes open here; {modKey}-click opens
        them in your browser. On the web and on phones links open in your browser as before.
      </p>
    </Panel>
  )
}

export default definePlugin({
  icon: Globe,
  views: {
    web: {
      icon: Globe,
      title: (arg) => titleOf(arg) || hostOf(arg) || "Web page",
      iconFor: siteIcon,
      full: true,
      // The address is the page's own state: following a link changes the tab's arg, not the page.
      argState: true,
      render: ({ arg, focused, setArg }) => (
        <Suspense fallback={null}><WebPage arg={arg} focused={focused} setArg={setArg} /></Suspense>
      ),
      onClose: (arg) => { void webPages?.close(arg, profile()) },
    },
    "web-pages": { icon: Globe, title: () => "Web pages", render: () => <WebPagesView openPage={openPage} ask={() => void askAddress()} /> },
  },
  sidebar: {
    "web-pages": { title: "Web pages", heading: false, sort: 34, hidden: true, view: "web-pages",
      render: (ctx) => <WebPagesPanel open={ctx.open} panel={ctx.panel} openPage={openPage} ask={() => void askAddress()} /> },
  },
  webLink: (url, { mod }) => {
    if (!webPages || mod || !linksInViewer()) return false
    openPage(url)
    return true
  },
  commands: [
    { id: "web:open", name: "Open web page…", desktop: true, when: () => !!webPages, run: askAddress },
    { id: "web:clip", name: "Clip current web page", when: () => !!focusedPage(), run: () => focusedPage()?.clip(), icon: Scissors },
    { id: "web:browser", name: "Open current web page in the browser", when: () => !!focusedPage(), run: () => { const p = focusedPage(); if (p) void webPages?.external(p.url()) }, icon: ExternalLink },
    { id: "web:address", name: "Edit current web page's address", when: () => !!focusedPage(), run: () => focusedPage()?.focusAddress(), icon: PencilLine },
    { id: "web:search-selection", name: "Search the web for selected text", desktop: true, when: () => !!webPages && !!selectedText().trim(), run: () => openWebLink(searchUrl(selectedText().replace(/\s+/g, " "), getSettings().search)), icon: Search },
    { id: "web:pages-tab", name: "Open web pages in a tab", desktop: true, when: () => !!webPages, run: () => openView("web-pages", { newTab: !isViewOpen("view:web-pages") }) },
  ],
  background: Background,
  preview: () => <Preview />,
})
