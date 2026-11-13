import { lazy, memo, Suspense, useEffect } from "react"
import { Bookmark, Bot, Box, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Code, CopyPlus, Download, Eraser, FileCode2, ExternalLink, Globe, Hand, History, KeyRound, Lock, MonitorPlay, MousePointer2, MousePointerSquareDashed, Paintbrush, PanelTopClose, PencilLine, Play, Printer, Puzzle, RectangleEllipsis, RotateCw, Scissors, Search, Volume2, VolumeX } from "lucide-react"
import { choose, closePane, closeView, definePlugin, detailPath, setFocusedPane, getStore, getTabLayout, isMac, isViewOpen, isWindows, modKey, modifiedSteps, newTabId, notify, notifyError, openDetail, openInSplit, openTab, openView, openWebLink, Panel, allPanes, focusedPane, shownTab, post, runCommandById, runShortcut, typingIn, saveAttachments, selectPane, systemNotify, selectedText, trace, useCommandList, useEnabled, webPageActions, webPages, type Choice, type WebEvent } from "@vaultite"
import { hostOf, searchUrl, siteName } from "./address"
import { addContainer, argOf, chosenFor, colorOf, destination, keepOutside, openBehind, useContainers, containerById, containerOfProfile, containers, profileIn, splitArg, viewSource } from "./containers"
import { iconCame, siteIcon, spinnerIcon } from "./icons"
import { framedSite } from "./framed"
import { painted } from "./layers"
import { manageContainers, SitesPanel, sitesPanelMenu, SitesSettings, SitesView } from "./Sites"
import { extensionPageName, extensionsChanged, hasExtensions, popupChanged, setExtensionsOpener } from "./extstate"
import { liveTitle } from "./livetitles"
import { askClear, HistoryView } from "./HistoryView"
import { EDIT_DETAIL, ENTRY_DETAIL, entryTitle, NEW_DETAIL, PasswordsSetting } from "./passwordstore"
import { askImport, browsersHere, findBrowsers } from "./importer"
import "./types"
import { openBookmark, starOf } from "./Star"
import { focusedPage, focusedPageId, keptTitles, linksInViewer, loadingIn, onScreen, pageOfTab, pageTookKeyboard, passkeyAsks, profile, setPageFlags, stateCame, setPlayer, setSounds, settings, settingsRead, shown, soundOf, titleOf, typedIn } from "./state"
import { agentPage, agentPageOfTab, agentPages, openAsTab, pauseAgents, setAgentPages, working, type AgentPage } from "./agentpages"
import { AgentsCard, agentsCardShown, showAgentsCard } from "./AgentsCard"
import { pickElement, useHiddenParts, watchShields } from "./shields"
import { editStyle, useDarkPages, useLookBackground, useSiteStyles } from "./stylestate"
import { Playing } from "./Playing"
import { downloadCame, DownloadsChip, readDownloads, showDownloads } from "./downloads"
import { muteItem, pauseItems, pauseSound, watchSoundMarks } from "./soundmarks"
import { SoundCard, watchSoundCard } from "./SoundCard"
import { barHidden, barItems, marksBarShown, setBarHidden, setMarksBarShown } from "./pagebar"
import { switcherSearch } from "./switcher"
import { focusedReplay } from "./replaykeys"
import { openFromApp } from "./linklogins"
import { fillLoginIn, hasLoginForm, watchLogins } from "./LoginFill"
import { useSecretKeeper } from "./secretkeeper"
import { engine } from "./engine"

const WebPage = lazy(() => import("./WebPage"))
const ReplaysView = lazy(() => import("./Replays").then((m) => ({ default: m.ReplaysView })))
const AgentPasskeys = lazy(() => import("./AgentPasskeys").then((m) => ({ default: m.AgentPasskeys })))
const PasswordsView = lazy(() => import("./Passwords").then((m) => ({ default: m.PasswordsView })))
const EntrySheet = lazy(() => import("./PasswordSheets").then((m) => ({ default: m.EntrySheet })))
const EditSheet = lazy(() => import("./PasswordSheets").then((m) => ({ default: m.EditSheet })))
const LiveView = lazy(() => import("./LiveView").then((m) => ({ default: m.LiveView })))
const ExtensionsView = lazy(() => import("./Extensions").then((m) => ({ default: m.ExtensionsView })))

const openPage = (url: string, container: string | null = null) => openView(`web/${argOf(url, container)}`, { newTab: true })

function opened(m: Extract<WebEvent, { type: "open" }>) {
  const c = m.container !== undefined ? m.container : destination(m.url, { from: containerOfProfile(m.profile), fresh: false, opened: true }).container
  if (c === null) keepOutside(m.url)
  const to = `view:web/${argOf(m.url, c)}`
  if (m.how === "glance") return openDetail(detailPath("glance", to))
  if (m.how === "background" && !m.page) return openBehind(m.url, c, m.tab || undefined)
  const id = newTabId()
  if (m.page) void webPages?.engine?.("web:adopt", m.page, id).catch(() => {})
  if (m.how === "side") openInSplit(to, "right", true, id)
  else openTab(to, { background: m.how === "background", from: m.tab || undefined, id })
}

const openExtensions = () => openView("web-extensions", { newTab: !isViewOpen("view:web-extensions") })
setExtensionsOpener(openExtensions)

function askAddress(container: string | null = null) {
  openView(`web/${argOf("", container)}`, { another: true })
}

async function duplicate(arg: string, tab: string) {
  const id = (await webPages?.list?.().catch(() => null))?.find((p) => p.tab === tab)?.id, made = newTabId()
  if (id) await webPages?.go(id, "duplicate", made).catch(() => {})
  openTab(`view:web/${arg}`, { from: tab, id: made })
}

function bookmarkPage() {
  const url = focusedPage()?.url()
  const r = starOf(focusedPageId())?.getBoundingClientRect()
  if (url) openBookmark(url, titleOf(url) ?? "", r?.width ? r : new DOMRect(innerWidth - 24, 48, 0, 0))
}

function onWebTab() {
  const w = getTabLayout(), s = shownTab(w), t = s && focusedPane(s)
  return !!t && (t.to === "view:web" || t.to.startsWith("view:web/"))
}
const onPage = (action: Parameters<NonNullable<typeof webPages>["go"]>[1]) => { const id = focusedPageId(); if (id) void webPages?.go(id, action) }
const pageInFront = () => !!focusedPage() && !document.querySelector("dialog[open]")

function askContainer() {
  choose({
    title: "New tab in container", placeholder: "Container", heading: "Open a new tab in",
    items: containers().map((c): Choice => ({ id: c.id, label: c.name, icon: <span className="size-2.5 rounded-full" style={{ background: colorOf(c) }} /> })),
    other: (typed): Choice | null => (typed.trim() ? { id: `\0${typed.trim()}`, label: `New container “${typed.trim()}”` } : null),
    onPick: (it) => askAddress(it.id.startsWith("\0") ? addContainer(it.id.slice(1)).id : it.id),
  })
}

async function saveImage(m: Extract<WebEvent, { type: "image" }>) {
  const s = getStore()
  try {
    if (!m.data || !s) throw new Error(m.error ? `Couldn't get the image: ${m.error}` : "Couldn't get the image")
    const ext = m.mime === "image/jpeg" ? "jpg" : m.mime === "image/svg+xml" ? "svg" : m.mime.split("/")[1] ?? "png"
    // Chromium names a data: image "download.png".
    const when = new Date().toISOString().slice(0, 19).replace(/\D/g, "")
    let name = m.name && !/^download(\.\w+)?$/.test(m.name) ? m.name : `Web image ${when}`
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += `.${ext}`
    const [path] = await saveAttachments(s, "", [new File([m.data as BlobPart], name, { type: m.mime })])
    notify(`Saved ${path.split("/").pop()}`, { action: { label: "Open", run: () => openInSplit(`file:${path}`) } })
  } catch (e) { notifyError(e, "Couldn't save the image") }
}

function pageNotified(m: Extract<WebEvent, { type: "notify" | "session" }>) {
  if (settings.get().notifications === false) return
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
    ? { source: m.site, kind: m.kind, title, body, link, session: m.url }
    : { source: m.site || "web", kind: "web", title, body, link }
  post("inbox/events", event).catch(() => {
    notify(body ? `${title}: ${body}` : title, { action: link ? { label: "Open", run: open } : undefined })
    if (!document.hasFocus()) systemNotify(title, body)?.then((clicked) => { if (clicked) open() })
  })
}

const Card = memo(AgentsCard), Sounds = memo(SoundCard)

function Background() {
  useEffect(() => void settings.ready(), [])
  useEffect(() => { if (hasExtensions()) extensionsChanged() }, [])
  useEffect(watchShields, [])
  useEffect(watchLogins, [])
  useHiddenParts()
  useSiteStyles()
  useDarkPages()
  useLookBackground()
  useSecretKeeper()
  useEffect(() => { if (webPages?.engine) void findBrowsers() }, [])
  useEffect(() => { void webPages?.titles?.().then(keptTitles, () => {}) }, [])
  const commands = useCommandList()
  useEffect(() => { void webPages?.keys(modifiedSteps()) }, [commands])
  const agents = JSON.stringify(Object.fromEntries(useContainers().flatMap((c) => (c.agents ? [[profileIn(c.id), c.agents]] : []))))
  useEffect(() => { void webPages?.engine?.("agents:access", JSON.parse(agents), profileIn("agents")).catch(() => {}) }, [agents])
  const glance = useEnabled()("glance"), names = JSON.stringify(useContainers().map(({ id, name }) => ({ id, name })))
  useEffect(() => { void webPages?.engine?.("web:menus", { containers: JSON.parse(names), glance }).catch(() => {}) }, [names, glance])
  const locks = useContainers().filter((c) => c.lock).map((c) => profileIn(c.id)).join(" ")
  useEffect(() => { void webPages?.engine?.("lock:set", locks ? locks.split(" ") : []).catch(() => {}) }, [locks])
  useEffect(() => watchSoundMarks(), [])
  useEffect(() => watchSoundCard(), [])
  useEffect(() => {
    const web = webPages
    if (!web?.list) return
    let timer = 0
    const read = () => void web.list!().then((list) => {
      setSounds(list.flatMap((p) => p.muted || p.playing || p.paused
        ? [{ playing: !!p.playing, muted: !!p.muted, paused: !!p.paused, id: p.id, tab: p.tab ?? "", arg: argOf(p.url, containerOfProfile(p.profile)), title: p.title, player: !!p.player }] : []))
      const of = (on: (p: (typeof list)[number]) => boolean | undefined) => new Set(list.flatMap((p) => (p.tab && on(p) ? [p.tab] : [])))
      setPageFlags(of((p) => p.loading && !p.error), of((p) => p.typed))
    }, () => {})
    const off = web.on((m) => { if (m.type === "state" || m.type === "pages") { clearTimeout(timer); timer = window.setTimeout(read, 250) } })
    return () => { off(); clearTimeout(timer) }
  }, [])
  useEffect(readDownloads, [])
  useEffect(() => { void engine("agents:pages").then((l) => { if (Array.isArray(l)) setAgentPages(l) }, () => {}) }, [])
  useEffect(() => webPages?.on((m) => {
    if (m.type === "state") stateCame(m.id, m.state)
    else if (m.type === "open") opened(m)
    else if (m.type === "close") closePane(m.tab, true)
    else if (m.type === "blocked") notify(`Blocked a pop-up from ${hostOf(m.url) || "a page"}`, { action: { label: "Open", run: () => opened({ ...m, type: "open", how: "foreground" }) } })
    else if (m.type === "engine:agent:pages" && Array.isArray(m.pages)) setAgentPages(m.pages as AgentPage[])
    else if (m.type === "engine:agent:close" && typeof m.tab === "string" && m.tab) closePane(m.tab, true)
    else if (m.type === "engine:navlog:load") { const { type: _, ...load } = m; trace("browser", { ev: "load", ...load }) }
    else if (m.type === "engine:agent:help" && typeof m.id === "number" && m.on) {
      if (typeof m.tab === "string" && m.tab) selectPane(m.tab)
      else if (typeof m.url === "string" && typeof m.profile === "string") {
        void openAsTab({ id: m.id, tab: "", url: m.url, profile: m.profile, group: String(m.group ?? "") }, false)
      }
    }
    else if (m.type === "engine:passkey" && typeof m.id === "number" && typeof m.ask === "number") {
      const id = m.id, ask = m.ask, state = String(m.state ?? "")
      passkeyAsks.update((a) => {
        const next = new Map(a)
        if (state === "done") { if (next.get(id)?.ask === ask) next.delete(id) }
        else next.set(id, { ask, state, qr: String(m.qr ?? ""), site: String(m.site ?? ""), create: !!m.create })
        return next
      })
      if (state === "scan" && typeof m.tab === "string" && m.tab) selectPane(m.tab)
    }
    else if (m.type === "focus") { pageTookKeyboard(m.id); const s = shown.get(m.id); if (s) setFocusedPane(s.group) }
    else if (m.type === "address") shown.get(m.id)?.focusAddress()
    else if (m.type === "source") { const s = shown.get(m.id); viewSource(m.url.replace(/^view-source:/, ""), s?.container ?? null, s?.tab) }
    else if (m.type === "clip") shown.get(m.id)?.clip()
    else if (m.type === "block") void pickElement(m.id, undefined, { x: m.x, y: m.y })
    else if (m.type === "image") void saveImage(m)
    else if (m.type === "icon") iconCame(m.host, m.icon)
    else if (m.type === "notify" || m.type === "session") pageNotified(m)
    else if (m.type === "found") shown.get(m.id)?.found(m.active, m.matches)
    else if (m.type === "nav") { const s = shown.get(m.id); if (s) setFocusedPane(s.group); runCommandById(m.dir < 0 ? "nav:back" : "nav:forward") }
    else if (m.type === "key") runShortcut(new KeyboardEvent("keydown", { key: m.key, code: m.code, metaKey: m.meta, ctrlKey: m.ctrl, altKey: m.alt, shiftKey: m.shift, cancelable: true }))
    else if (m.type === "engine:ext:changed") extensionsChanged()
    else if (m.type === "engine:ext:open" && typeof m.url === "string") openPage(m.url, containerOfProfile(String(m.profile ?? "")))
    else if (m.type === "engine:ext:show" && typeof m.url === "string") openView(`web/${argOf(m.url, containerOfProfile(String(m.profile ?? "")))}`)
    else if (m.type === "engine:ext:close" && typeof m.url === "string") closeView(`web/${argOf(m.url, containerOfProfile(String(m.profile ?? "")))}`)
    else if (m.type === "engine:ext:popup" && typeof m.ext === "string") popupChanged(m.ext, !!m.open)
    else if (m.type === "engine:ext:popup-ask" && typeof m.ext === "string") document.querySelector<HTMLElement>(`[data-ext-button="${CSS.escape(m.ext)}"]`)?.click()
    else if (m.type === "download") downloadCame(m)
  }), [])
  return <><Card /><Sounds /></>
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
      title: (arg) => { const { url } = splitArg(arg); return url ? titleOf(url) || framedSite(url)?.title || extensionPageName(url) || (url.startsWith("view-source:") ? url : hostOf(url)) || "Web page" : "New tab" },
      iconFor: (arg, tab) => {
        const { container, url } = splitArg(arg), c = containerById(container), color = c ? colorOf(c) : undefined
        return tab && loadingIn(tab) ? spinnerIcon(color) : url.startsWith("view-source:") ? FileCode2 : siteIcon(url, color)
      },
      tabColor: (arg) => { const c = containerById(splitArg(arg).container); return c ? colorOf(c) : undefined },
      groupName: (arg) => siteName(splitArg(arg).url),
      full: true,
      history: (_arg, tab, dir) => {
        const p = pageOfTab(tab), web = webPages
        if (!p || !web) return null
        const can = !!(dir < 0 ? p.state().back : p.state().forward)
        return { can, go: async () => { const went = await web.go(p.id, dir < 0 ? "back" : "forward").catch(() => can); return typeof went === "boolean" ? went : can } }
      },
      asNewTab: { label: "Web page", here: () => !!webPages },
      argState: true,
      pinAs: (arg) => (/^https?:\/\//i.test(splitArg(arg).url) ? arg : null),
      pinLabel: (arg) => { const { url } = splitArg(arg); return titleOf(url) ?? framedSite(url)?.title },
      render: ({ arg, focused, setArg }) => (
        <Suspense fallback={null}><WebPage key={splitArg(arg).container ?? ""} arg={arg} focused={focused} setArg={setArg} /></Suspense>
      ),
      tabMark: (arg, tab) => {
        const a = agentPageOfTab(tab), s = soundOf(arg, tab)
        if (a?.asking) return { icon: Hand, label: `${a.by} needs you`, tint: "var(--purple)", run: () => {} }
        if (a && (a.own || (working(a) && !s))) {
          return { icon: MousePointer2, label: a.paused ? `${a.by}: paused here, click to resume` : `${a.by} is using this tab: click to pause`, tint: a.paused ? undefined : "var(--purple)",
            run: () => void pauseAgents(a.id, !a.paused) }
        }
        if (s && !s.playing && !s.muted && s.paused) return { icon: Play, label: "Play", run: () => pauseSound(s, false) }
        return s ? { icon: s.muted ? VolumeX : Volume2, label: s.muted ? "Unmute tab" : "Mute tab", run: () => void webPages?.go(s.id, s.muted ? "unmute" : "mute") } : null
      },
      archives: (arg, tab) => !soundOf(arg, tab)?.playing && !typedIn(tab),
      onTabClose: (_arg, tab, moved) => {
        if (moved) { void webPages?.close(tab, true); return }
        void painted().then(() => { if (!allPanes(getTabLayout()).some((p) => p.id === tab)) void webPages?.close(tab, false) })
      },
      paneMenu: () => (webPages ? barItems() : []),
      tabMenu: (arg, tab) => {
        const { url } = splitArg(arg), sound = soundOf(arg, tab)
        return [
          ...(/^https?:\/\//i.test(url) ? [{ label: "Duplicate tab", icon: CopyPlus, run: () => void duplicate(arg, tab) }] : []),
          ...(sound ? [...pauseItems(sound), muteItem(sound)] : []),
          ...(/^https?:\/\//i.test(url) ? webPageActions({ url, title: titleOf(url) ?? "" }) : []),
        ]
      },
    },
    "agent-runs": { icon: Bot, title: () => "Agents in the browser", full: true, render: () => <Suspense fallback={null}><ReplaysView /></Suspense> },
    passwords: { icon: RectangleEllipsis, title: () => "Passwords", full: true, render: () => <Suspense fallback={null}><PasswordsView /></Suspense> },
    "agent-passkeys": { icon: KeyRound, title: () => "Passkeys for agents' logins", render: () => <Suspense fallback={null}><AgentPasskeys /></Suspense> },
    "web-live": { icon: MonitorPlay, title: (arg) => (arg ? liveTitle(arg) || "Browser tab" : "Browser tabs"), argState: true, full: true,
      onScreen: (arg) => { const p = agentPage(Number(arg.split("@")[0])); return !!p && onScreen.get().has(p.id) },
      render: ({ arg, setArg }) => <Suspense fallback={null}><LiveView arg={arg} setArg={setArg} /></Suspense> },
    "web-pages": { icon: Globe, title: () => "Sites", render: () => <SitesView openPage={openPage} /> },
    "web-extensions": { icon: Puzzle, title: () => "Extensions", render: () => <Suspense fallback={null}><ExtensionsView openPage={openPage} /></Suspense> },
    "web-history": { icon: History, title: () => "History", render: () => <HistoryView openPage={(url) => openPage(url)} onImport={() => void askImport()} /> },
  },
  details: {
    [ENTRY_DETAIL]: { title: (_s, [id]) => entryTitle(id), render: (_s, [id]) => <Suspense fallback={null}><EntrySheet id={id} /></Suspense> },
    [EDIT_DETAIL]: { title: (_s, [id]) => `Edit ${entryTitle(id)}`, render: (_s, [id]) => <Suspense fallback={null}><EditSheet id={id} /></Suspense> },
    [NEW_DETAIL]: { title: () => "New password", render: (_s, [group]) => <Suspense fallback={null}><EditSheet group={group} /></Suspense> },
  },
  files: { types: ["bookmarks"], icon: Bookmark },
  ...switcherSearch(openPage),
  sidebar: {
    "web-pages": { title: "Sites", names: ["logins", "cookies", "signed in"], heading: false, needsHeading: true, sort: 34, hidden: true, view: "web-pages",
      menu: sitesPanelMenu, render: (ctx) => <SitesPanel open={ctx.open} openPage={openPage} newTab={askAddress} /> },
  },
  webLink: (url, { newTab, front, out, container, fromApp }) => {
    const chosen = chosenFor(container)
    if (!webPages && framedSite(url) && !out) { if (newTab) openTab(`view:web/${url}`, { background: !front }); else openPage(url); return true }
    if (!webPages || out || (!linksInViewer() && chosen === undefined)) return false
    if (fromApp && chosen === undefined) { void settingsRead().then(() => openFromApp(url, openPage)); return true }
    const c = destination(url, { from: null, fresh: true, chosen }).container
    if (c === null && chosen === null) keepOutside(url)
    if (newTab && front) openTab(`view:web/${argOf(url, c)}`)
    else if (newTab) openBehind(url, c)
    else openPage(url, chosen === undefined ? null : c)
    return true
  },
  webLinkOpensIn: (url, container) => {
    const chosen = chosenFor(container)
    return !webPages || (!linksInViewer() && chosen === undefined) ? undefined : destination(url, { from: null, fresh: true, chosen }).container
  },
  commands: [
    { id: "web:open", name: "Open web page…", desktop: true, when: () => !!webPages, run: () => askAddress() },
    { id: "web:live", name: "Show browser tabs", icon: MonitorPlay, run: () => openView("web-live", { newTab: !isViewOpen("view:web-live") }) },
    { id: "web:agent-runs", name: "Show agents in the browser", desktop: true, when: () => !!webPages?.engine, icon: Bot,
      run: () => openView("agent-runs", { newTab: !isViewOpen("view:agent-runs") }) },
    { id: "web:replay-previous", name: "Previous step of the replay", keys: ["ArrowLeft"], when: () => !!focusedReplay(), run: () => focusedReplay()?.step(-1), icon: ChevronLeft },
    { id: "web:replay-next", name: "Next step of the replay", keys: ["ArrowRight"], when: () => !!focusedReplay(), run: () => focusedReplay()?.step(1), icon: ChevronRight },
    { id: "web:replay-first", name: "First step of the replay", keys: ["Home"], when: () => !!focusedReplay(), run: () => focusedReplay()?.edge(false), icon: ChevronFirst },
    { id: "web:replay-last", name: "Last step of the replay", keys: ["End"], when: () => !!focusedReplay(), run: () => focusedReplay()?.edge(true), icon: ChevronLast },
    { id: "web:replay-play", name: "Play the replay", nameWhenOn: "Pause the replay", keys: ["Space"], when: () => !!focusedReplay(), on: () => !!focusedReplay()?.playing(),
      run: () => focusedReplay()?.play(), icon: Play },
    { id: "web:agent-pages", name: "Show agents' pages", nameWhenOn: "Hide agents' pages", desktop: true, icon: MousePointer2,
      when: () => agentPages.get().length > 0, on: agentsCardShown, run: () => showAgentsCard(!agentsCardShown()) },
    // Windows sets the default browser only in its own Settings.
    { id: "web:default-browser", name: "Make Vaultite the default browser", desktop: true, when: () => !!webPages?.engine && !isWindows, icon: Globe,
      run: () => void Promise.resolve(webPages?.engine?.("browser:make-default")).then((yes) => notify(yes ? "Vaultite is the default browser: links from other apps open here" : "Confirm it in the box macOS shows"), (e) => notifyError(e, "Couldn't make it the default browser")) },
    { id: "web:lock", name: "Lock containers", desktop: true, when: () => !!webPages?.engine && containers().some((c) => c.lock), run: () => void webPages?.engine?.("lock:lock"), icon: Lock },
    { id: "web:page-bar", name: "Hide page bar", nameWhenOn: "Always show page bar", desktop: true, when: () => !!webPages, on: barHidden,
      run: () => void setBarHidden(!barHidden()), icon: PanelTopClose },
    { id: "web:bookmarks-bar", name: "Always show bookmarks bar", keys: ["Mod+Shift+B"], desktop: true, when: () => !!webPages, on: marksBarShown,
      run: () => void setMarksBarShown(!marksBarShown()), icon: Bookmark },
    { id: "web:open-container", name: "New tab in container…", desktop: true, when: () => !!webPages, run: askContainer, icon: Box },
    { id: "web:fill-login", name: "Fill login", desktop: true, when: () => !!webPages?.engine && hasLoginForm(focusedPageId()), run: () => void fillLoginIn(focusedPageId()), icon: KeyRound },
    { id: "web:clip", name: "Clip current web page", when: () => !!focusedPage(), run: () => focusedPage()?.clip(), icon: Scissors },
    { id: "web:browser", name: "Open current web page in another browser", when: () => !!focusedPage(), run: () => { const p = focusedPage(); if (p) void webPages?.external(p.url()) }, icon: ExternalLink },
    { id: "web:address", name: "Edit current web page's address", keys: ["Mod+L"], when: () => !!focusedPage(),
      keysWhen: () => !typingIn(document.activeElement) || !!document.activeElement?.closest("[data-web-bar]"), run: () => focusedPage()?.focusAddress(), icon: PencilLine },
    { id: "web:search-selection", name: "Search the web for selected text", desktop: true, when: () => !!webPages && !!selectedText().trim(), run: () => openWebLink(searchUrl(selectedText().replace(/\s+/g, " "), settings.get().search)), icon: Search },
    { id: "web:extensions", name: "Extensions", desktop: true, when: hasExtensions, run: openExtensions, icon: Puzzle },
    { id: "web:sites-tab", name: "Show sites and logins", desktop: true, when: () => !!webPages?.sites, icon: Globe, run: manageContainers },
    { id: "web:passwords", name: "Show passwords", desktop: true, when: () => !!webPages?.engine, icon: RectangleEllipsis,
      run: () => openView("passwords", { newTab: !isViewOpen("view:passwords") }) },
    { id: "web:downloads", name: "Show downloads", desktop: true, when: () => !!webPages?.download, run: () => showDownloads(), icon: Download },
    { id: "web:history", name: "Show history", keys: isMac ? ["Mod+Y"] : ["Mod+H"], desktop: true, when: () => !!webPages?.engine, run: () => openView("web-history", { newTab: !isViewOpen("view:web-history") }), icon: History },
    { id: "web:clear-history", name: "Clear browsing history…", desktop: true, when: () => !!webPages?.engine, run: askClear, icon: Eraser },
    { id: "web:block-element", name: "Block an element on this page", when: () => !!webPages?.engine && /^https?:\/\//i.test(focusedPage()?.url() ?? ""),
      run: () => void pickElement(focusedPageId()), icon: MousePointerSquareDashed },
    { id: "web:edit-style", name: "Edit this site's style", when: () => !!webPages?.engine && !!hostOf(focusedPage()?.url() ?? ""),
      run: () => void editStyle(focusedPage()?.url() ?? ""), icon: Paintbrush },
    { id: "web:player", name: "Open current web page as player", nameWhenOn: "Bring current web page back from player", keys: ["Mod+Alt+P"], icon: MonitorPlay,
      when: () => !!webPages?.player && /^https?:\/\//i.test(focusedPage()?.url() ?? ""), on: () => !!focusedPage()?.inPlayer(),
      run: () => setPlayer(focusedPageId(), !focusedPage()?.inPlayer()) },
    { id: "web:bookmark", name: "Bookmark current web page", on: () => { const u = focusedPage()?.url(); return !!u && !!getStore()?.bookmarks?.some((b) => b.url === u) }, nameWhenOn: "Edit bookmark of current web page", keys: ["Mod+D"], when: () => !!focusedPage(), run: bookmarkPage, icon: Bookmark },
    { id: "web:reload", name: "Reload current web page", keys: ["Mod+R"], when: onWebTab, run: () => onPage("reload"), icon: RotateCw },
    { id: "web:hard-reload", name: "Reload current web page without its cache", keys: ["Mod+Shift+R"], when: onWebTab, run: () => onPage("hard-reload"), icon: RotateCw },
    { id: "web:devtools", name: "Show developer tools for current web page", keys: [isMac ? "Mod+Alt+I" : "Mod+Shift+I"], when: onWebTab, run: () => onPage("devtools"), icon: Code },
    { id: "web:find", name: "Find in current web page", keys: ["Mod+F"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("open"), icon: Search },
    { id: "web:find-next", name: "Find next in current web page", keys: ["Mod+G"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("next"), icon: Search },
    { id: "web:find-previous", name: "Find previous in current web page", keys: ["Mod+Shift+G"], when: () => pageInFront() && !!webPages?.find, run: () => focusedPage()?.find("previous"), icon: Search },
    { id: "web:source", name: "View current web page's source", keys: [isMac ? "Mod+Alt+U" : "Mod+U"], icon: FileCode2,
      when: () => /^https?:\/\//i.test(focusedPage()?.url() ?? ""), run: () => { const p = focusedPage(); if (p) viewSource(p.url(), p.container, p.tab) } },
    { id: "web:print", name: "Print current web page", when: () => /^https?:\/\//i.test(focusedPage()?.url() ?? ""), run: () => onPage("print"), icon: Printer },
    { id: "web:import-brave", name: "Import from Brave…", desktop: true, when: () => browsersHere().some((s) => s.browser === "brave"), run: () => void askImport("brave"), icon: Download },
    { id: "web:import-chrome", name: "Import from Chrome…", desktop: true, when: () => browsersHere().some((s) => s.browser === "chrome"), run: () => void askImport("chrome"), icon: Download },
  ],
  ambient: { playing: { title: "Web pages playing", sort: 55, render: () => <Playing /> }, downloads: { title: "Downloads", sort: 56, render: () => <DownloadsChip /> } },
  settingsPanel: () => <><SitesSettings /><PasswordsSetting /></>,
  settingsSearch: [{ key: "sites", label: "Sites and logins", description: "the sites signed in to in each container's and workspace's logins: sign out, clear trackers" },
    { key: "passwords", label: "Passwords", description: "your KeePass file (KeePassXC's, Strongbox's), its passwords listed, edited and filled in pages" }],
  background: Background,
  preview: () => <Preview />,
})
