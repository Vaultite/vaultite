import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FoldVertical, AppWindow, Group as GroupIcon, Ungroup, Braces, EyeOff, ArchiveRestore, ArrowLeft, ArrowRight, ArrowRightToLine, ChevronLeft, ChevronRight, ChevronsUpDown, CirclePlay, ClipboardCopy, Columns2, Columns3, LayoutPanelLeft, MoveDown, MoveHorizontal, MoveLeft, MoveRight, MoveUp, MoveVertical, Command as CommandIcon, Copy, CopyPlus, CopyX, FileInput, FilePlus, FileText, FlaskConical, Focus, FolderOpen, Hash, Import, Keyboard, Layers, LayoutDashboard, LayoutTemplate, Link, ListChecks, ListTree, Moon, Palette as PaletteIcon, PanelLeft, PanelRight, PencilLine, Pin, Plus, Redo2, RefreshCw, RotateCcw, Rows2, PanelTopDashed, Server, SlidersHorizontal, Smile, Store as StoreIcon, SquareArrowOutUpRight, SquareSplitHorizontal, SquareX, Sun, SunMoon, Sparkles, Tags, Trash2, Undo2, UnfoldVertical, X, Zap, Search, Type } from "lucide-react"
import { cell } from "@/core/signal"
import { getStore, onState, reload, useStore, vaultName as vaultNameOf, type Store } from "@/core/data"
import { share } from "@/core/share"
import { setOpenWidth, setRoom } from "@/core/room"
import { SharedWith } from "@/components/SharedWith"
import { commandKeys, runCommandLink, useCommands } from "@/core/commands"
import { isDesktop, isMac, isWindows, useDesktop } from "@/core/platform"
import { loadActions } from "@/core/actions"
import { currentEditor, keysInEditor } from "@/core/editors"
import { bareWindow, desktop as desktopApp, hasLights } from "@/core/desktop"
import { canKeepOnTop, keepOnTop, onTop } from "@/core/ontop"
import { otherVaults } from "@/core/desktopapp"
import { peekPanel, peekRider, usePeek, usePeekLights, useSideMotion } from "@/core/peek"
import { useBarFade } from "@/core/barfade"
import { keepTypingInSight } from "@/core/sight"
import { phoneApp, takeLinks } from "@/core/phoneapp"
import { GrantAsker } from "@/components/GrantAsker"
import { isProtected, inVault, isReadOnly, openFile, stem } from "@/core/files"
import { activeTab, askRename, canClosePane, closePane, closeTab, closeTabs, closeWholePane, currentFile, cycleTab, placesHere, fillFirstTab, onWorkspaceChange, followHash, go, hashOf, tabsHere, navigate, selectTabAt, togglePinTab, activePane, isPopout, popOut, targetOf, useWorkspace } from "@/core/workspace"
import { barsHidden, closedTabs, hideBars, reopenClosed, restTab, setClosedTogether, tabsInWorkspace, useBarsHidden } from "@/core/workspace"
import { canNudge, evenOutAll, focusByOrder, focusLastPane, hasLastPane, hasNeighbour, severalPanes, movePane, moveTabBy, nudgePane, paneToTab, splitPane, splitToFit, canFloat, canZoom, isFloating, isZoomed, toggleFloat, zoomPane } from "@/core/splits"
import { Maximize2, PictureInPicture2 } from "lucide-react"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { vaultPath, type Pane, type Tab } from "../../core/layout.ts"
import { backDetail, closeDetail, openDetail, replaceHash, route, setDetailRedirect, takeScroll } from "@/core/nav"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { currentWorkspace, noteOpened, subscribeScoped, useWorkspacesOn } from "@/core/scope"
import { sayWindowState, setWindowState } from "@/core/live"
import { activeKey, backgrounds, detailFor, homeTab, isEnabled, panelsIn, pluginById, pluginCommands, safeMode, showTabsIn, shownHeaderItems, tabListPanel, tabsInSidebar, turnPluginsBackOn, usePluginsVersion, useSidebars, viewFor } from "@/core/plugins"
import { leaveGroup } from "@/core/tabgroups"
import { canRenameTab, chooseTabGroup, renameTab, renameTabGroup } from "@/core/tabnames"
import { canReopen, reopenLatest } from "@/core/tabarchive"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { textSizeCommands } from "@/core/textsize"
import { zoomCommands } from "@/core/zoom"
import { allSwitches, placeOf, switchCommand } from "@/core/switches"
import { allChoices, choiceCommand } from "@/core/choices"
import { loadVaultPlugins } from "@/core/vaultPlugins"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { DetailSheet } from "@/components/DetailSheet"
import { setFileView } from "@/components/fileState"
import { newNote, revealInTree } from "@/components/FileTree"
import { headerMenu, panelMenu, RAIL, SidebarPanels, SidebarToggle } from "@/components/Sidebar"
import { FileView } from "@/components/FileView"
import { keptShown, PhoneFiles } from "@/components/PhoneFiles"
import { StatusBar } from "@/components/StatusBar"
import { Catch, Drawn, Guard } from "@/components/Guard"
import { DownloadingNotice, VaultLoading } from "@/components/VaultLoading"
import { KeyHints } from "@/components/KeyHints"
import { preloadEditor } from "@/editor/lazy"
import { Logo, SheetHead, Stone } from "@/components/kit"
import { dismissNotice, notify, notifyError } from "@/core/notify"
import { QUIET, stepOffer, type OfferEvent } from "@/core/closedoffer"
import { trace } from "@/core/trace"
import { editorSettings, showPropertiesAs } from "@/core/editorPrefs"
import { PluginPreview } from "@/components/PluginPreview"
import { PluginSettings } from "@/components/PluginSettings"
import { settingsCommands, settingsTitle } from "@/core/pluginSettings"
import { currentLayout, openImport, previousSetup, restoreSetup } from "@/core/bundles"
import { startWelcome } from "@/core/welcome"
import { saveAsNew } from "@/components/LayoutPicker"
import { APP_PAGES, appPageOf, hrefOf, isSetupTab, openAppPage, openSettings, openSetup, pageShownAt, useSettingsOwner, type AppPage } from "@/core/apppages"
import { CommandPalette } from "@/components/CommandPalette"
import { FolderPicker } from "@/components/FolderPicker"
import { Chooser } from "@/components/Chooser"
import { IconPicker, pickIcon } from "@/components/IconPicker"
import { SearchPalette } from "@/components/SearchPalette"
import { TabSearch } from "@/components/TabSearch"
import { openNewTab } from "@/core/launcher"
import { Workspace } from "@/components/Workspace"
import { Resizer } from "@/components/Resizer"
import { DragGhost, setPageInfo, useTabInfo, type TabInfo } from "@/components/Tabs"
import { useLingeringSheet } from "@/core/motion"
import { moves } from "@/core/animation"
import { closeSwitcher } from "@/core/phoneTabs"
import { PhoneTab, TabSwitcher } from "@/components/TabSwitcher"
import { PullActions } from "@/components/PullActions"
import { PhoneBar } from "@/components/PhoneBar"
import { PhoneHeader } from "@/components/PhoneHeader"
import { drawerOut, openDrawer, PhoneDrawers } from "@/components/PhoneDrawer"
import { Tooltips } from "@/components/Tooltip"
import { Toaster } from "@/components/Toast"
import { BundleTrial } from "@/components/BundleTrial"
import { SelectionBar } from "@/components/SelectionBar"
import { VaultManager, webVaults } from "@/components/VaultManager"
import { ContextMenus } from "@/components/ContextMenu"
import { ConfirmDialogs } from "@/components/ConfirmDialog"
import { WelcomeCards } from "@/components/Welcome"
import { canReveal, chooseAction, copyLink, copyPath, copyText, duplicate, remove, revealInFinder } from "@/components/FileActions"
import { cn, space, whenIdle } from "@/lib/utils"
import { byTab } from "@/core/focus"
import { canGoSide, focusArea, goSide } from "@/core/keylist"
import { useStateFor } from "@/core/statefor"
import { chooseScheme, schemeName } from "@/components/SchemeChooser"
import { chooseFont, fontSetting } from "@/components/FontChooser"
import { chooseNewTabPage, showNewTabSections } from "@/components/NewTab"

const Setup = lazy(() => import("@/pages/Setup").then((m) => ({ default: m.Setup })))
const PluginGroupSheet = lazy(() => import("@/pages/Plugins").then((m) => ({ default: m.PluginGroupSheet })))
const GetPluginSheet = lazy(() => import("@/components/PluginBrowse").then((m) => ({ default: m.GetPluginSheet })))
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })))
const SchemeGallery = lazy(() => import("@/components/Appearance").then((m) => ({ default: m.SchemeGallery })))
const HotkeysSheet = lazy(() => import("@/pages/Hotkeys").then((m) => ({ default: m.HotkeysSheet })))
const SidebarsSheet = lazy(() => import("@/pages/Sidebars").then((m) => ({ default: m.SidebarsSheet })))
const FontsSheet = lazy(() => import("@/components/Appearance").then((m) => ({ default: m.FontsSheet })))
const SettingsSection = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsSection })))
const BundlePreview = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.BundlePreview })))
const ShareBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.ShareBundle })))
const ImportBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.ImportBundle })))
const IncomingBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.IncomingBundle })))

const DRAW: Record<AppPage["id"], (store: Store, to: string, pane: Pane | null) => React.ReactNode> = {
  setup: (store, to, pane) => <Suspense><Setup store={store} tab={isSetupTab(to) ? to : "plugins"} at={pane?.id} /></Suspense>,
  settings: (store) => <Suspense><Settings store={store} /></Suspense>,
}
const pageTabOf = (to: string) => { const p = appPageOf(to); return p && { ...p, render: DRAW[p.id] } }
const mac = (k: string, other?: string) => (isMac ? [k] : other ? [other] : undefined)
const focusedTabClose = () => {
  const a = document.activeElement
  return a?.matches("[data-tab-strip] [role=tab]") ? a.closest("[data-tab-id]")?.querySelector<HTMLElement>(":scope > [data-tab-close]") ?? null : null
}
const SIDEBAR = { min: 200, max: 480, default: 240 }
const railPx = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing")) || 0.25) * 16 * RAIL
const INSET_L = "env(safe-area-inset-left)", INSET_R = "env(safe-area-inset-right)"
const sidebarPx = (w: number) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w || SIDEBAR.default)))
let dragFrom = SIDEBAR.default, dragOpen = true
function dragSidebar(right: boolean, x: number) {
  const w = right ? innerWidth - x : x
  const [on, width] = right ? ["rightSidebar", "rightSidebarWidth"] as const : ["sidebar", "sidebarWidth"] as const
  if (w <= (railPx() + SIDEBAR.min) / 2) { if (getPrefs()[on]) setPrefs({ [on]: false, [width]: dragFrom }); return }
  setPrefs({ [on]: true, [width]: sidebarPx(w) })
}
const manageVaults = () => (desktopApp ? desktopApp.manageVaults() : openDetail("vaults"))
const VAULT_MENU = (): MenuItem[] => [
  ...otherVaults().map((v) => ({ label: `Open ${v.name}`, run: () => { (desktopApp ? desktopApp.openVault(v.path) : webVaults.open(v.path)).catch((e) => notifyError(e, "Couldn't open it")) } })),
  { label: "Manage vaults", sep: !!otherVaults().length, run: () => { manageVaults() } },
  ...(desktopApp?.openSandbox ? [{ label: "Open the playground", run: () => { desktopApp!.openSandbox!() } }] : []),
  ...(phoneApp ? [{ label: "Switch server…", run: () => { phoneApp!.launcher() } }] : []),
]

function sheet_(...a: Parameters<typeof detail_>): ReturnType<typeof detail_> {
  try { return detail_(...a) } catch (e) { return { body: <Drawn draw={() => { throw e }} />, title: "" } }
}

const CORE_SHEETS: Record<string, [string, (store: Store, id: string) => React.ReactNode]> = {
  schemes: ["Colour schemes", () => <SchemeGallery />],
  fonts: ["Fonts", () => <FontsSheet />],
  "settings-section/": ["Settings", (store, id) => <SettingsSection store={store} id={id} />],
  hotkeys: ["Hotkeys", () => <HotkeysSheet />],
  sidebars: ["Sidebars", () => <SidebarsSheet />],
  "bundle/": ["Bundle", (_, id) => <BundlePreview id={id} />],
  "plugin-group/": ["Plugins", (store, id) => <PluginGroupSheet store={store} id={id} />],
  "plugin-get/": ["Get plugins", (_, id) => <GetPluginSheet id={id} />],
  "bundle-share/": ["Share", (_, id) => <ShareBundle id={id} />],
  "bundle-import": ["Import a bundle", () => <ImportBundle />],
  "bundle-incoming/": ["Import a bundle", (_, id) => <IncomingBundle id={id} />],
}

function detail_(store: Store, path: string, disabled: string[], tabInfo: (t: Tab | Pane) => TabInfo): { body: React.ReactNode; title: string; wide?: boolean } {
  const [kind, id] = path.split("/")
  if (kind === "file") {
    const p = decodeURIComponent(id ?? "")
    return { body: <FileView store={store} path={p} pane={false} />, title: stem(p) }
  }
  if (kind === "tabs") return { body: <TabSwitcher store={store} info={tabInfo} />, title: "Tabs" }
  if (kind === "vaults") {
    return { body: <><SheetHead icon={Logo} tint="var(--primary)" kicker="Vaultite" title="Vaults" /><VaultManager backend={webVaults} /></>, title: "Vaults" }
  }
  const own = CORE_SHEETS[id ? `${kind}/` : kind]
  if (own) return { body: <Suspense>{own[1](store, decodeURIComponent(id ?? ""))}</Suspense>, title: own[0] }
  if (kind === "plugin") {
    const p = pluginById(id)
    if (p) return { body: <PluginPreview store={store} plugin={p} />, title: p.name }
  }
  if (kind === "plugin-settings") {
    const p = pluginById(decodeURIComponent(id ?? ""))
    if (p) return { body: <PluginSettings store={store} plugin={p} />, title: settingsTitle(p.name) }
  }
  const d = detailFor(path, disabled)
  const file = d?.def.file?.(store, d.args)
  if (file) return { body: <FileView store={store} path={file} pane={false} />, title: stem(file) }
  const title = d ? d.def.title(store, d.args) : ""
  if (d && title) return { body: <Guard what="This sheet" size="tab" reset={path}><Drawn draw={() => d.def.render(store, d.args)} /></Guard>, title, wide: d.def.wide }
  return { body: <SheetHead icon={ListChecks} tint="var(--muted-foreground)" kicker="Not found" title="Nothing to show here"
    sub="What this link opens was moved or deleted, or the plugin that shows it is off." />, title: "" }
}

function useRoute() {
  const [r, setR] = useState(route)
  useEffect(() => {
    const on = () => setR(route())
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])
  const place = useRef("")
  const restoring = useRef(false)
  const loaded = !!useStore().store
  useLayoutEffect(() => {
    if (isDesktop() || !loaded) return
    place.current = targetOf(r.tab)
    restoring.current = true
    // By line when it has one: CodeMirror's guessed heights for lines not drawn yet drift a scrollTop.
    const back = takeScroll(), kept = keptShown(), left = back === null || Math.abs(back - scrollOf(place.current)) < 1
    return restoreScroll(null, back ?? scrollOf(place.current), () => { restoring.current = false }, left && !kept ? place.current : undefined,
      document.querySelector<HTMLElement>("#main-scroll article.file-view:not([data-kept] *)"))
  }, [r.tab, loaded])
  useEffect(() => {
    const on = () => { if (!isDesktop() && !restoring.current && place.current) keepScroll(place.current, scrollY) }
    addEventListener("scroll", on, { passive: true })
    return () => removeEventListener("scroll", on)
  }, [])
  return r
}

onState(loadVaultPlugins)

const fileGone = (to: string) => {
  const s = getStore(), p = vaultPath(to)
  return !!s && p !== null && !inVault(s, p)
}
const CLOSED_TOAST = "tabs-closed"
let offer = QUIET, unwatch = () => {}
const tellOffer = (e: OfferEvent) => {
  const { state, effects } = stepOffer(offer, e)
  if (effects.length) trace("tabs", { ev: "closed-toast", from: offer.kind, on: e.type, to: state.kind })
  offer = state
  for (const fx of effects) {
    if (fx.do === "unwatch") { unwatch(); unwatch = () => {} }
    else if (fx.do === "dismiss") dismissNotice(CLOSED_TOAST)
    else if (fx.do === "watch") unwatch = onWorkspaceChange(() => tellOffer({ type: "changed", closed: closedTabs().map((c) => c.id) }))
    else {
      const keys = commandKeys("tab:reopen"), { id } = fx
      notify(`Closed ${fx.n} tabs${keys ? ` · Reopen with ${keys}` : ""}`, { id: CLOSED_TOAST, action: { label: "Undo", run: () => reopenClosed(id, fileGone) } })
    }
  }
}
setClosedTogether((id, n) => tellOffer({ type: "closed", id, n }))

setFileView((store, path, docked) => <FileView store={store} path={path} pane={false} docked={docked} />)

setDetailRedirect((path) => {
  const s = getStore()
  const d = s ? detailFor(path, getPrefs().disabled) : null
  return d?.def.file && s ? d.def.file(s, d.args) : null
})

type PaletteKind = "search" | "launcher" | "commands" | "tabs"
const paletteOpen = cell<PaletteKind | null>(null)
const setPalette = (p: PaletteKind | null | ((was: PaletteKind | null) => PaletteKind | null)) => paletteOpen.set(typeof p === "function" ? p(paletteOpen.get()) : p)
const closePalette = () => paletteOpen.set(null)
const Palettes = memo(function Palettes({ store }: { store: Store | null }) {
  const palette = paletteOpen.use()
  return (
    <>
      {(palette === "search" || palette === "launcher") && store && <SearchPalette key={palette} store={store} launcher={palette === "launcher"} onClose={closePalette} />}
      {palette === "commands" && <CommandPalette onClose={closePalette} />}
      {palette === "tabs" && store && <TabSearch store={store} onClose={closePalette} />}
    </>
  )
})

export default function App() {
  const { tab, detail, depth, prev } = useRoute()
  const lingering = useLingeringSheet()
  const sheet = detail || lingering || ""
  const { store, error } = useStore()
  const { sidebar, sidebarWidth, rightSidebar, rightSidebarWidth, rails, peekShade, fileBarFade, disabled, enabled, sidebarHeader } = usePrefs()
  const home = store ? homeTab(store, disabled) : null
  const isFileTab = tab.startsWith("file/") || tab === "file"
  const isViewTab = tab.startsWith("view/")
  const isNewTab = tab === "new"
  const desktop = useDesktop()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once the store arrives, not on each store change
  useEffect(() => { if (store) whenIdle(preloadEditor) }, [!!store])
  useEffect(() => { if (safeMode) notify("Vault plugins are off for now", { id: "safe-mode", duration: Infinity, action: { label: "Turn back on", run: turnPluginsBackOn } }) }, [])
  useEffect(() => { if (store) whenIdle(loadActions) }, [!!store, disabled, enabled])
  const workspacesOn = useWorkspacesOn()
  useEffect(() => { if (store && !workspacesOn) tabsInWorkspace(false) }, [!!store, workspacesOn])
  useEffect(() => onWorkspaceChange(() => noteOpened(currentFile())), [])
  useEffect(() => {
    let was = currentWorkspace()?.n ?? null
    setWindowState(() => { const n = currentWorkspace()?.n; return n ? { workspace: n } : {} })
    sayWindowState()
    return subscribeScoped(() => { const n = currentWorkspace()?.n ?? null; if (n !== was) { was = n; sayWindowState() } })
  }, [])
  useEffect(() => {
    if (store?.vault.sandbox) sandboxNotice()
    if (store) void startWelcome()
    if (home) fillFirstTab(home)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per store
  }, [store])
  useEffect(() => {
    if (!store) return
    if (route().tab !== tab) return
    if (isFileTab || isViewTab || isNewTab || appPageOf(tab)) return
    const to = !tab || (!desktop && !detail) ? (home ? hashOf(home) : desktop ? null : "new") : null
    if (!to) return
    replaceHash(`${to}${detail ? `/${detail}` : ""}`, history.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a new store or address only
  }, [store, tab])
  useWorkspace()
  const known = isFileTab || isViewTab || isNewTab || !!appPageOf(tab)
  useEffect(() => {
    if (route().tab !== tab) return
    if (known) followHash(tab)
    else if (desktop && !detail && store) replaceHash(hashOf(activePane().to))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- detail is read as of the address change
  }, [tab, desktop, known, !!store])
  useEffect(() => takeLinks({ command: runCommandLink, open: (p) => { const s = getStore(); if (!s?.files.files.some((f) => f.path === p)) return false; openFile(p); return true },
    bundle: (repo) => { if (!getStore()) return false; void openImport(repo); return true } }), [])
  useEffect(() => {
    if (!location.hash) replaceHash(hashOf(activePane().to))
  }, [])
  const filePath = isFileTab ? targetOf(tab).slice(5) : ""
  useSettingsOwner()
  const active = pageShownAt(tab)
  useEffect(() => {
    if (!desktop || !store || !detail) return
    const [kind, arg] = detail.split("/")
    if (kind !== "file") return
    let f: string | null = null
    try { f = decodeURIComponent(arg ?? "") } catch { f = null }
    if (f) { history.replaceState(null, "", `#${hashOf(activePane().to)}`); go(`file:${f}`, false, false) }
  }, [desktop, store, detail])
  const pageInfo = (id: string) => { const p = pageShownAt(hashOf(id)); return p ? { label: p.label, icon: p.icon, tint: p.tint } : null }
  const tabInfo = useTabInfo(store, pageInfo)
  setPageInfo(pageInfo)
  const canBack = !!prev
  const prevTitle = canBack && store ? sheet_(store, prev, disabled, tabInfo).title : ""
  const sheetDetail = store && sheet ? sheet_(store, sheet, disabled, tabInfo) : null
  const setSearching = (on: boolean) => setPalette(on ? "search" : null)
  const vaultName = vaultNameOf(store)
  const vaultMenu = (e: React.MouseEvent) => menuBelow(e, VAULT_MENU())
  const actionTarget = () => currentEditor()?.path ?? currentFile()
  const tabFile = () => (isDesktop() ? currentFile() : "")
  const besideText = () => { const ed = currentEditor(); return !!ed?.undo && keysInEditor(ed) }
  useCommands(() => [
    { id: "switcher:open", name: "Open quick switcher", keys: ["Mod+O"], run: () => setPalette((p) => (p === "search" ? null : "search")), fromLink: true, label: "Open a file", icon: FileText },
    { id: "switcher:new-tab", name: "Open new tab from quick switcher", run: () => setPalette((p) => (p === "launcher" ? null : "launcher")), icon: Plus },
    { id: "palette:open", name: "Open command palette", keys: ["Mod+P"], run: () => setPalette((p) => (p === "commands" ? null : "commands")), icon: CommandIcon },
    { id: "icon:search", name: "Search icons", run: () => pickIcon({ title: "Search icons", onPick: (n) => copyText(n).then(() => notify(`Copied ${n}: use it as an icon:`, { id: "copied" }), notifyError) }), icon: Smile },
    // ⌘N, ⌘T, ⌘W are the browser's: only the desktop app can bind them.
    { id: "file:new", name: "Create new note", keys: desktopApp ? ["Mod+N"] : ["Mod+Alt+N"], run: () => void newNote(), fromLink: true, label: "New note", icon: FilePlus },
    { id: "sidebar:toggle", name: "Show left sidebar", keys: ["Mod+\\"],
      run: () => (isDesktop() ? setPrefs({ sidebar: !getPrefs().sidebar }) : openDrawer(drawerOut() === "left" ? null : "left")), icon: PanelLeft,
      nameWhenOn: "Hide left sidebar", on: () => (isDesktop() ? getPrefs().sidebar : drawerOut() === "left") },
    { id: "sidebar:toggle-right", name: "Show right sidebar", keys: ["Mod+Shift+\\"],
      run: () => { if (isDesktop()) document.querySelector<HTMLElement>("[data-sidebar-toggle=right]")?.click(); else openDrawer(drawerOut() === "right" ? null : "right") }, icon: PanelRight,
      nameWhenOn: "Hide right sidebar", on: () => (isDesktop() ? document.querySelector("[data-sidebar-toggle=right]")?.getAttribute("aria-expanded") === "true" : drawerOut() === "right") },
    { id: "tab:new", name: "Open new tab", keys: desktopApp ? ["Mod+T"] : undefined, when: isDesktop, run: () => openNewTab(), icon: Plus },
    { id: "split:right", name: "Split right", keys: ["Mod+D", "Mod+Alt+\\"], desktop: true, run: () => splitPane("right"), icon: Columns2 },
    { id: "split:down", name: "Split down", keys: ["Mod+Shift+D"], desktop: true, run: () => splitPane("bottom"), icon: Rows2 },
    { id: "split:left", name: "Split left", desktop: true, run: () => splitPane("left"), icon: Columns2 },
    { id: "split:up", name: "Split up", desktop: true, run: () => splitPane("top"), icon: Rows2 },
    { id: "split:fit", name: "Split along the longer side", desktop: true, words: "best fit", run: splitToFit, icon: LayoutPanelLeft },
    { id: "pane:to-tab", name: "Move pane to new tab", when: () => isDesktop() && severalPanes(), words: "separate split out", run: () => paneToTab(activePane().id), icon: SquareSplitHorizontal },
    { id: "pane:zoom", name: "Zoom pane", keys: ["Mod+Shift+Enter"], when: () => isDesktop() && canZoom(), run: () => zoomPane(), icon: Maximize2, nameWhenOn: "Unzoom pane", on: isZoomed },
    { id: "pane:float", name: "Float pane", keys: ["Mod+Alt+Enter"], when: () => isDesktop() && (canFloat() || isFloating()), run: toggleFloat, icon: PictureInPicture2,
      nameWhenOn: "Dock pane", on: () => isFloating() },
    // Off a Mac Alt+Shift: Alt← is Back, Ctrl+Alt arrows switch the desktop's workspaces, Ctrl+Alt is AltGr on Windows.
    { id: "split:focus-left", name: "Focus pane to the left", keys: mac("Mod+Ctrl+ArrowLeft", "Alt+Shift+ArrowLeft"), when: () => isDesktop() && canGoSide("left"), run: () => goSide("left"), icon: Focus },
    { id: "split:focus-right", name: "Focus pane to the right", keys: mac("Mod+Ctrl+ArrowRight", "Alt+Shift+ArrowRight"), when: () => isDesktop() && canGoSide("right"), run: () => goSide("right"), icon: Focus },
    { id: "split:focus-top", name: "Focus pane above", keys: mac("Mod+Ctrl+ArrowUp", "Alt+Shift+ArrowUp"), when: () => isDesktop() && canGoSide("top"), run: () => goSide("top"), icon: Focus },
    { id: "split:focus-bottom", name: "Focus pane below", keys: mac("Mod+Ctrl+ArrowDown", "Alt+Shift+ArrowDown"), when: () => isDesktop() && canGoSide("bottom"), run: () => goSide("bottom"), icon: Focus },
    { id: "pane:focus-next", name: "Focus next pane", keys: mac("Mod+Ctrl+]", "Alt+Shift+]"), when: () => isDesktop() && severalPanes(), run: () => focusByOrder(1), icon: Focus },
    { id: "pane:focus-previous", name: "Focus previous pane", keys: mac("Mod+Ctrl+[", "Alt+Shift+["), when: () => isDesktop() && severalPanes(), run: () => focusByOrder(-1), icon: Focus },
    { id: "pane:focus-last", name: "Focus last pane", words: "recent back", when: () => isDesktop() && hasLastPane(), run: focusLastPane, icon: Focus },
    { id: "pane:move-left", name: "Move pane left", keys: mac("Mod+Ctrl+Shift+ArrowLeft"), when: () => isDesktop() && hasNeighbour("left"), words: "swap", run: () => movePane("left"), icon: MoveLeft },
    { id: "pane:move-right", name: "Move pane right", keys: mac("Mod+Ctrl+Shift+ArrowRight"), when: () => isDesktop() && hasNeighbour("right"), words: "swap", run: () => movePane("right"), icon: MoveRight },
    { id: "pane:move-up", name: "Move pane up", keys: mac("Mod+Ctrl+Shift+ArrowUp"), when: () => isDesktop() && hasNeighbour("top"), words: "swap", run: () => movePane("top"), icon: MoveUp },
    { id: "pane:move-down", name: "Move pane down", keys: mac("Mod+Ctrl+Shift+ArrowDown"), when: () => isDesktop() && hasNeighbour("bottom"), words: "swap", run: () => movePane("bottom"), icon: MoveDown },
    { id: "pane:resize-left", name: "Resize pane left", keys: mac("Mod+Ctrl+Alt+ArrowLeft"), when: () => isDesktop() && canNudge("left"), words: "divider grow shrink", run: () => nudgePane("left"), icon: MoveHorizontal },
    { id: "pane:resize-right", name: "Resize pane right", keys: mac("Mod+Ctrl+Alt+ArrowRight"), when: () => isDesktop() && canNudge("right"), words: "divider grow shrink", run: () => nudgePane("right"), icon: MoveHorizontal },
    { id: "pane:resize-up", name: "Resize pane up", keys: mac("Mod+Ctrl+Alt+ArrowUp"), when: () => isDesktop() && canNudge("top"), words: "divider grow shrink", run: () => nudgePane("top"), icon: MoveVertical },
    { id: "pane:resize-down", name: "Resize pane down", keys: mac("Mod+Ctrl+Alt+ArrowDown"), when: () => isDesktop() && canNudge("bottom"), words: "divider grow shrink", run: () => nudgePane("bottom"), icon: MoveVertical },
    { id: "pane:even-out", name: "Even out panes", keys: mac("Mod+Ctrl+=", "Alt+Shift+="), when: () => isDesktop() && severalPanes(), words: "balance equal sizes splits", run: evenOutAll, icon: Columns3 },
    // Off a Mac, ⌃⌥← switches workspaces (GNOME, Xfce): ⌥← there, as browsers have it.
    { id: "nav:back", name: "Navigate back", keys: isMac ? ["Mod+Alt+ArrowLeft", "Mod+["] : ["Alt+ArrowLeft"], when: isDesktop, run: () => navigate(-1), icon: ArrowLeft },
    { id: "nav:forward", name: "Navigate forward", keys: isMac ? ["Mod+Alt+ArrowRight", "Mod+]"] : ["Alt+ArrowRight"], when: isDesktop, run: () => navigate(1), icon: ArrowRight },
    { id: "tab:close", name: "Close current tab", keys: desktopApp ? ["Mod+W"] : undefined, label: "Close tab", icon: X, run: () => {
      const t = activeTab()
      if (t.pinned) restTab(t.id); else if (canClosePane()) closePane(); else closeTab(t.id)
    } },
    { id: "tab:close-focused", name: "Close the tab that has the keyboard", keys: isMac ? ["Backspace", "Delete"] : ["Delete"], label: "Close tab", icon: X,
      when: () => !!focusedTabClose(), run: () => {
        const x = focusedTabClose()!, bar = x.closest<HTMLElement>("[data-tab-strip]")
        x.click()
        requestAnimationFrame(() => bar?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus())
      } },
    { id: "pane:close", name: "Close pane", keys: desktopApp ? undefined : ["Mod+Alt+Shift+W"], when: () => isDesktop() && canClosePane(), run: () => closeWholePane(activePane().id), icon: SquareX },
    { id: "split:close", name: "Close split", keys: desktopApp ? ["Mod+Alt+Shift+W"] : undefined, words: "whole tab all panes", when: () => isDesktop() && canClosePane(),
      run: () => { const t = activeTab(); if (t.pinned) restTab(t.id); else closeTab(t.id) }, icon: X },
    { id: "tab:toggle-pin", name: "Pin tab", when: isDesktop, run: () => togglePinTab(activeTab().id), icon: Pin, nameWhenOn: "Unpin tab", on: () => !!activeTab().pinned },
    { id: "tab:sidebar", name: "Show tabs in the sidebar", when: () => isDesktop() && !isPopout() && !!tabListPanel(), run: () => showTabsIn(tabsInSidebar() ? "top" : "sidebar"),
      icon: PanelLeft, nameWhenOn: "Show tabs on top", on: () => tabsInSidebar() },
    { id: "tab:rename", name: "Rename tab…", when: () => canRenameTab(activeTab()), run: () => renameTab(), icon: PencilLine },
    { id: "tab:group", name: "Add current tab to group…", when: isDesktop, run: chooseTabGroup, icon: GroupIcon },
    { id: "tab:rename-group", name: "Rename tab group…", when: () => isDesktop() && !!activeTab().group, run: renameTabGroup, icon: PencilLine },
    { id: "tab:ungroup", name: "Remove current tab from group", when: () => isDesktop() && !!activeTab().group, run: () => leaveGroup([activeTab().id]), icon: Ungroup },
    { id: "tab:move-to-window", name: "Move current tab to new window", when: () => isDesktop() && activePane().to !== "new", run: () => popOut(activeTab().id, true), icon: AppWindow },
    { id: "tab:move-to-main", name: "Move current tab to main window", when: hasMainWindow, run: () => moveToMain([activeTab().id]), icon: AppWindow },
    { id: "window:bars", name: "Show window bars", nameWhenOn: "Hide window bars", words: "chrome chromeless frameless title bar tab bar toolbar traffic lights compact",
      when: () => isDesktop() && isPopout(), on: () => !barsHidden(), run: () => hideBars(!barsHidden()), icon: PanelTopDashed },
    { id: "window:on-top", name: "Keep window on top", nameWhenOn: "Stop keeping window on top", words: "always on top float pin pip picture",
      when: () => isDesktop() && canKeepOnTop, on: onTop, run: () => keepOnTop(!onTop()), icon: Pin },
    { id: "tab:open-in-window", name: "Open current tab in new window", when: () => isDesktop() && activePane().to !== "new", run: () => popOut(activeTab().id), icon: SquareArrowOutUpRight },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `tab:goto-${n}`, name: `Go to tab #${n}`, keys: desktopApp ? [`Mod+${n}`] : undefined,
      when: () => isDesktop() && tabsHere() >= n, run: () => selectTabAt(n), icon: Hash })),
    { id: "tab:goto-last", name: "Go to last tab", keys: desktopApp ? ["Mod+9"] : undefined, when: isDesktop, run: () => selectTabAt(-1), icon: ArrowRightToLine },
    // (⌘⇧T is the browser's too.)
    { id: "tab:reopen", name: "Reopen closed tab", keys: desktopApp ? ["Mod+Shift+T"] : undefined, when: canReopen, run: () => reopenLatest(fileGone), icon: RotateCcw },
    { id: "tab:search", name: "Search tabs…", keys: ["Mod+Shift+A"], words: "find switch open recently closed archived", when: isDesktop,
      run: () => setPalette((p) => (p === "tabs" ? null : "tabs")), icon: Search },
    { id: "tab:close-others", name: "Close all other tabs", keys: ["Mod+Alt+W"], when: isDesktop, run: () => closeTabs("others", activeTab().id), icon: CopyX },
    // (⌃⇧PgUp and PgDn are the browser's: the desktop app has them.)
    { id: "tab:move-left", name: "Move tab left", keys: desktopApp ? ["Ctrl+Shift+PageUp"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => moveTabBy(-1), icon: ArrowLeft },
    { id: "tab:move-right", name: "Move tab right", keys: desktopApp ? ["Ctrl+Shift+PageDown"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => moveTabBy(1), icon: ArrowRight },
    // (⌃Tab is the browser's: the desktop app has it, the web none by default.)
    { id: "tab:next", name: "Go to next tab", keys: desktopApp ? ["Ctrl+Tab", ...(isMac ? ["Mod+Shift+]"] : [])] : undefined, when: () => isDesktop() && (tabsHere() > 1 || placesHere() > 1), run: () => cycleTab(1), icon: ChevronRight },
    { id: "tab:previous", name: "Go to previous tab", keys: desktopApp ? ["Ctrl+Shift+Tab", ...(isMac ? ["Mod+Shift+["] : [])] : undefined, when: () => isDesktop() && (tabsHere() > 1 || placesHere() > 1), run: () => cycleTab(-1), icon: ChevronLeft },
    // (Ctrl+. is IBus' emoji key on Linux: Alt+Enter there too, JetBrains' "show actions".)
    { id: "file:actions", name: "Show actions for current file", keys: isMac ? ["Mod+."] : ["Mod+.", "Alt+Enter"], when: () => !!actionTarget(), run: () => chooseAction(actionTarget()), icon: Zap },
    { id: "file:reveal", name: "Reveal current file in file tree", when: () => !!tabFile() && isEnabled("files", getPrefs().disabled),
      run: () => revealInTree(tabFile(), { scroll: true, flash: true, open: true }), icon: ListTree },
    { id: "file:rename", name: "Rename current file", when: () => !!tabFile() && !isProtected(tabFile()), run: () => askRename(tabFile()), icon: PencilLine },
    { id: "file:delete", name: "Delete current file", when: () => !!tabFile() && !isProtected(tabFile()), run: () => remove(tabFile()), icon: Trash2 },
    { id: "file:duplicate", name: "Duplicate current file", when: () => !!tabFile() && !isReadOnly(tabFile()), run: () => duplicate(tabFile()), icon: Copy },
    { id: "file:copy-path", name: "Copy file path", when: () => !!tabFile(), run: () => copyPath(tabFile()), icon: ClipboardCopy },
    { id: "file:copy-link", name: "Copy link to current file", when: () => !!tabFile(), run: () => copyLink(tabFile()), icon: Link },
    // `id` and `name` first, literal: core/appsource.ts lists commands from the source; off a Mac `name` changes here.
    { id: "file:reveal-finder", name: "Reveal current file in Finder", when: () => !!tabFile() && canReveal(), run: () => revealInFinder(tabFile()), icon: FolderOpen,
      ...(isMac ? {} : { name: isWindows ? "Show current file in Explorer" : "Show current file in folder" }) },
    ...APP_PAGES.map((p) => ({ id: `page:${p.id}`, name: `Open ${p.label}`, keys: p.keys, words: p.words, run: () => openAppPage(p), icon: p.icon })),
    { id: "page:get", name: "Get plugins and layouts", words: "setup store directory install bundles packs", run: () => openSetup("get"), icon: StoreIcon },
    { id: "layouts:choose", name: "Choose a layout…", words: "bundle setup zen browser standard", run: () => openSettings("appearance"), icon: LayoutTemplate },
    { id: "layouts:save", name: "Save layout as new…", words: "bundle setup", run: () => saveAsNew(currentLayout()), icon: CopyPlus },
    { id: "bundles:import", name: "Import a bundle…", words: "layout pack", run: () => openDetail("bundle-import"), icon: Import },
    { id: "bundles:restore", name: "Restore previous layout", words: "bundle setup undo", when: () => !!previousSetup(), run: () => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it")), icon: ArchiveRestore },
    { id: "theme:light", name: "Use light theme", unlisted: true, when: () => getPrefs().theme !== "light", run: () => setPrefs({ theme: "light" }), icon: Sun },
    { id: "theme:dark", name: "Use dark theme", unlisted: true, when: () => getPrefs().theme !== "dark", run: () => setPrefs({ theme: "dark" }), icon: Moon },
    { id: "theme:system", name: "Use the system's light or dark theme", unlisted: true, when: () => getPrefs().theme !== "system", run: () => setPrefs({ theme: "system" }), icon: SunMoon },
    { id: "scheme:gruvbox", name: "Use Gruvbox colours (the default)", unlisted: true, when: () => getPrefs().scheme !== "gruvbox", run: () => setPrefs({ scheme: "gruvbox" }), icon: PaletteIcon },
    { id: "scheme:default", name: "Use Classic colours", unlisted: true, when: () => getPrefs().scheme !== "default", run: () => setPrefs({ scheme: "default" }), icon: PaletteIcon },
    { id: "scheme:choose", name: "Colour scheme…", words: "change color colours obsidian themes", run: chooseScheme, icon: PaletteIcon, value: () => schemeName(), place: placeOf({ id: "setting:scheme", section: "appearance" }) },
    { id: "font:text", name: "Text font…", words: "change typeface notes", run: () => chooseFont("textFont"), icon: Type, ...fontSetting("textFont") },
    { id: "font:interface", name: "Interface font…", words: "change typeface ui", run: () => chooseFont("interfaceFont"), icon: Type, ...fontSetting("interfaceFont") },
    { id: "font:mono", name: "Monospace font…", words: "change typeface code terminal", run: () => chooseFont("monoFont"), icon: Type, ...fontSetting("monoFont") },
    { id: "newtab:page", name: "Choose a page for new tabs…", run: chooseNewTabPage, icon: LayoutDashboard },
    { id: "newtab:sections", name: "Show sections on new tabs", when: () => !!getPrefs().newTab.page, run: showNewTabSections, icon: Layers },
    { id: "sidebars:customize", name: "Customize sidebars", run: () => openDetail("sidebars"), icon: SlidersHorizontal },
    { id: "hotkeys:open", name: "Open hotkeys", keys: ["Shift+/"], run: () => openDetail("hotkeys"), icon: Keyboard },
    { id: "density:compact", name: "Use compact density", unlisted: true, when: () => getPrefs().density === "comfortable", run: () => setPrefs({ density: "compact" }), icon: FoldVertical },
    { id: "density:comfortable", name: "Use comfortable density", unlisted: true, when: () => getPrefs().density !== "comfortable", run: () => setPrefs({ density: "comfortable" }), icon: UnfoldVertical },
    ...(["natural", "snappy", "off"] as const).map((animation) => ({ id: `animation:${animation}`, name: animation === "off" ? "Turn animations off" : `Use ${animation} animations`, unlisted: true, when: () => getPrefs().animation !== animation, run: () => setPrefs({ animation }), icon: Sparkles })),
    { id: "properties:visible", name: "Show properties in notes", unlisted: true, when: () => editorSettings().propertiesInDocument !== "visible", run: () => showPropertiesAs("visible"), icon: Tags },
    { id: "properties:hidden", name: "Hide properties in notes", unlisted: true, when: () => editorSettings().propertiesInDocument !== "hidden", run: () => showPropertiesAs("hidden"), icon: EyeOff },
    { id: "properties:source", name: "Show properties as text while editing", unlisted: true, when: () => editorSettings().propertiesInDocument !== "source", run: () => showPropertiesAs("source"), icon: Braces },
    { id: "editor:undo", name: "Undo", keys: ["Mod+Z"], when: besideText, run: () => currentEditor()?.undo?.(), icon: Undo2 },
    { id: "editor:redo", name: "Redo", keys: ["Mod+Shift+Z"], when: besideText, run: () => currentEditor()?.redo?.(), icon: Redo2 },
    { id: "vault:reload", name: "Reload the vault", run: () => reload(), icon: RefreshCw },
    { id: "vault:manage", name: "Manage vaults", run: manageVaults, icon: Stone },
    { id: "vault:sandbox", name: "Open the playground", when: () => !!desktopApp?.openSandbox, run: () => desktopApp?.openSandbox?.(), icon: FlaskConical },
    { id: "app:setup", name: "Set up Vaultite", when: () => !!desktopApp?.setup, run: () => desktopApp?.setup?.(), icon: CirclePlay },
    { id: "app:switch-server", name: "Switch server…", when: () => !!phoneApp, run: () => phoneApp?.launcher(), icon: Server },
    { id: "file:open-outside", name: "Open file from outside the vault…", when: () => !!desktopApp, run: () => desktopApp?.pickOutside(), icon: FileInput },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- commands read state when run, built once per store
  ], [!!store])
  const pluginsVersion = usePluginsVersion()
  const onKey = activeKey(disabled)
  const running = useMemo(() => store && backgrounds(disabled).map(({ key, Run }) => <Catch key={key} fallback={() => null}><Run store={store} /></Catch>),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- disabled changes are covered by onKey
    [store, onKey, pluginsVersion])
  useCommands(() => pluginCommands(disabled), [onKey, pluginsVersion])
  useCommands(settingsCommands, [onKey, pluginsVersion])
  useCommands(() => textSizeCommands(disabled), [onKey])
  useCommands(zoomCommands, [])
  useCommands(() => [...allSwitches(disabled).map(switchCommand), ...allChoices(disabled).map(choiceCommand)], [onKey, pluginsVersion])
  const popout = isPopout()
  const bare = useBarsHidden()
  useLayoutEffect(() => {
    if (!popout) return
    document.documentElement.toggleAttribute("data-bars-hidden", bare)
    bareWindow(bare)
  }, [popout, bare])
  const hideLeft = desktop && !popout && !rails && !sidebar
  const side = popout ? "0px" : hideLeft ? INSET_L : `calc(${sidebar ? `${sidebarPx(sidebarWidth)}px` : space(RAIL)} + ${INSET_L})`
  const header = shownHeaderItems(disabled, sidebarHeader)
  const rightCount = panelsIn("right", useSidebars(), disabled).length
  const hasRight = rightCount > 0
  const [emptyRight, setEmptyRight] = useStateFor([hasRight], () => false)
  const rightOpen = hasRight ? rightSidebar : emptyRight
  const showRight = !popout && (hasRight || emptyRight)
  const hideRight = desktop && showRight && !rails && !rightOpen
  const rside = popout ? "0px" : showRight && !hideRight ? `calc(${rightOpen ? `${sidebarPx(rightSidebarWidth)}px` : space(RAIL)} + ${INSET_R})` : INSET_R
  const peek = usePeek(hideLeft, hideRight && hasRight)
  const leftOpen = sidebar || hideLeft
  const leftIn = usePeekLights(hideLeft, peek)
  const leftMotion = useSideMotion(hideLeft, leftIn), rightMotion = useSideMotion(hideRight, peek === "right")
  useBarFade(desktop && fileBarFade)
  useEffect(() => keepTypingInSight(), [])
  useLayoutEffect(() => setRoom(desktop ? side : "0px", desktop ? rside : "0px"), [side, rside, desktop])
  useLayoutEffect(() => { setOpenWidth("left", sidebarPx(sidebarWidth)); setOpenWidth("right", sidebarPx(rightSidebarWidth)) }, [sidebarWidth, rightSidebarWidth])
  // Data attributes, not body:has(aside...) in CSS: :has made every DOM change recalc styles 4x.
  useLayoutEffect(() => {
    const root = document.documentElement.dataset
    if (showRight) root.rightSidebar = ""; else delete root.rightSidebar
    if (!popout && !sidebar && rails) root.leftRail = ""; else delete root.leftRail
    if (showRight && !rightOpen && rails) root.rightRail = ""; else delete root.rightRail
    if (!rails) root.noRails = ""; else delete root.noRails
  }, [showRight, rightOpen, popout, sidebar, rails])
  useEffect(() => {
    if (!store) return
    const t = setTimeout(() => { delete document.body.dataset.arriving }, 500)
    return () => clearTimeout(t)
  }, [!!store])

  return (
    <>
      {/* Chromium on Linux focuses this with no Tab when a focused web page closes: then it hands focus on to the pane. */}
      {desktop && (
        <button type="button" data-skip-link data-overlay onClick={() => focusArea()} onFocus={(e) => { if (!byTab(e.nativeEvent)) focusArea() }}
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-1.5 focus-visible:left-1/2 focus-visible:z-[90] focus-visible:h-7 focus-visible:-translate-x-1/2 focus-visible:cursor-pointer focus-visible:rounded-[6px] focus-visible:bg-popover focus-visible:px-2.5 focus-visible:text-[13px] focus-visible:font-medium focus-visible:text-popover-foreground focus-visible:shadow-lg">
          Skip to content
        </button>
      )}
      {peekShade && (hideLeft || hideRight) && <div aria-hidden data-peek-shade="" data-shown={peek ? "" : undefined} className="pointer-events-none fixed inset-0 z-(--z-peek-shade)" />}
      {/* Over an iframe (an HTML file, a PDF) the window gets no pointer events: these catch them at the edges. */}
      {hideLeft && <div aria-hidden data-peek-edge="" className="fixed inset-y-0 left-0 z-(--z-peek-edge) w-[6px]" />}
      {hideRight && hasRight && <div aria-hidden data-peek-edge="" className="fixed inset-y-0 right-0 z-(--z-peek-edge) w-[3px]" />}
      {!popout && <>
      <aside data-side="left" data-collapsed={!leftOpen || undefined} data-peek={hideLeft ? peek === "left" : undefined} data-motion={leftMotion} inert={hideLeft && !leftIn} onContextMenu={menuFor(panelMenu)}
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col overflow-hidden border-r-[0.5px] border-border bg-sidebar pr-[calc(--spacing(2)-0.5px)] pl-[calc(--spacing(2)+env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[max(--spacing(2),env(safe-area-inset-bottom))] md:flex",
          hideLeft && "z-(--z-peek) rounded-[12px] border-0 shadow-[0_8px_32px_rgb(0_0_0/0.22)]",
        )} style={hideLeft ? { width: `${sidebarPx(sidebarWidth)}px`, ...peekPanel("left", leftIn) } : { width: side }}>
        <div data-titlebar onContextMenu={menuFor(headerMenu)} className={cn("@container flex h-10 shrink-0 items-center justify-end gap-1 pl-7.5 whitespace-nowrap transition-opacity duration-(--motion)", !leftOpen && "pointer-events-none opacity-0")}>
          {store && desktop && leftOpen && header.map(({ key, item }) => (
            <div key={key} data-header-item={key} className="flex min-w-0 shrink-0 items-center"><Guard what="This item"><Drawn draw={() => item.render({ store, open: true, file: filePath, tab: targetOf(tab) })} /></Guard></div>
          ))}
        </div>
        {hasLights && <span aria-hidden data-lights-ghost=""><i /><i /><i /></span>}
        <div className="flex min-h-0 flex-1 flex-col">
          {store && desktop && <SidebarPanels store={store} open={leftOpen} file={filePath} tab={targetOf(tab)}
            head={!leftOpen && header.length ? header.map(({ key, item }) => (
              <div key={key} data-header-item={key} className="flex"><Guard what="This item"><Drawn draw={() => item.render({ store, open: false, file: filePath, tab: targetOf(tab) })} /></Guard></div>
            )) : undefined} />}
        </div>
        <nav aria-label="App" data-sidebar-foot className={cn("-mx-2 -mb-2 flex shrink-0 gap-1 border-t-[0.5px] border-border p-2", !leftOpen && "flex-col items-start")}>
          {leftOpen && share && <SharedWith />}
          {leftOpen && !share && (
            <button type="button" onClick={vaultMenu} aria-haspopup="menu"
              className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] font-medium whitespace-nowrap hover:bg-foreground/[0.06]">
              <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
              <span className="min-w-0 truncate">{vaultName}</span>
            </button>
          )}
          {APP_PAGES.map((t) => (
            <a key={t.id} href={hrefOf(t)} aria-label={t.label} aria-current={t.id === active?.id ? "page" : undefined} data-tip={t.label} data-tip-side={leftOpen ? "top" : "right"} data-app-page={t.id}
              onClick={(e) => { if (!desktop) return; e.preventDefault(); openAppPage(t, e.metaKey || e.ctrlKey) }}
              className={cn("grid size-7 shrink-0 place-items-center rounded-[5px] transition-colors",
                t.id === active?.id ? "bg-foreground/[0.08] text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground")}>
              <t.icon className="size-4" strokeWidth={2} />
            </a>
          ))}
        </nav>
        {!hideLeft && <Resizer label="Resize the sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().sidebarWidth); dragOpen = getPrefs().sidebar }} onDrag={(x) => dragSidebar(false, x)}
          onCancel={() => setPrefs({ sidebar: dragOpen, sidebarWidth: dragFrom })} onReset={() => setPrefs({ sidebar: true, sidebarWidth: SIDEBAR.default })}
          className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ left: `calc(${side} + var(--pane-gap) / 2 - 3.5px)` }} />}
      </aside>
      </>}

      {showRight && (
        <aside data-side="right" data-collapsed={!(rightOpen || hideRight) || undefined} data-peek={hideRight ? peek === "right" : undefined} data-motion={rightMotion} inert={hideRight && peek !== "right"}
          onContextMenu={menuFor(() => panelMenu(undefined, "right"))}
          className={cn(
            "fixed inset-y-0 right-0 z-20 hidden flex-col overflow-hidden border-l-[0.5px] border-border bg-sidebar pr-[calc(--spacing(2)+env(safe-area-inset-right))] pl-[calc(--spacing(2)-0.5px)] pt-[env(safe-area-inset-top)] pb-2 md:flex",
            hideRight && "z-(--z-peek) rounded-[12px] border-0 shadow-[0_8px_32px_rgb(0_0_0/0.22)]",
          )} style={hideRight ? { width: `${sidebarPx(rightSidebarWidth)}px`, ...peekPanel("right", peek === "right") } : { width: rside }}>
          <div data-titlebar className="h-10 shrink-0" />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {store && desktop && <SidebarPanels side="right" store={store} open={rightOpen || hideRight} file={filePath} tab={targetOf(tab)} />}
          </div>
          {rightOpen && (
            <Resizer label="Resize the right sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().rightSidebarWidth); dragOpen = getPrefs().rightSidebar }} onDrag={(x) => dragSidebar(true, x)}
              onCancel={() => setPrefs({ rightSidebar: dragOpen, rightSidebarWidth: dragFrom })}
              onReset={() => setPrefs({ rightSidebar: true, rightSidebarWidth: 280 })}
              className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ right: `calc(${rside} + var(--pane-gap) / 2 - 3.5px)` }} />
          )}
        </aside>
      )}

      {desktop ? (
        <Workspace store={store} error={error} left={side} right={rside} pageInfo={pageInfo} page={pageTabOf} />
      ) : (
        <div id="main-scroll" className="overflow-x-clip">
          {store && <PhoneHeader title={tabInfo(activeTab()).label} tab={activeTab()} />}
          <main className="pb-safe relative mx-auto max-w-5xl px-4 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
            {error && !store && <p className="mt-10 text-muted-foreground">{error}</p>}
            {!error && !store && <VaultLoading />}
            {store && <Guard what="This tab" size="tab" reset={tab} close={() => closeTab(activeTab().id)}>
              <PhoneFiles store={store} pane={activePane().id} path={isFileTab ? filePath : null} />
              {(isNewTab || isViewTab) && <PhoneTab key={isViewTab && viewFor(targetOf(tab), disabled)?.def.argState ? targetOf(tab).split("/")[0] : tab} store={store} to={targetOf(tab)} />}
              {active && !isFileTab && <div key={active.id}><Drawn draw={() => DRAW[active.id](store, tab, activePane())} /></div>}
            </Guard>}
          </main>
          <DragGhost info={tabInfo} />
        </div>
      )}

      {/* After the panes: in Electron a drag region drawn later than these toggles would swallow their clicks. */}
      {!popout && (
        <SidebarToggle side="left" open={sidebar} onClick={() => setPrefs({ sidebar: !sidebar })}
          className={hideLeft ? cn("z-(--z-peek-rider) transition-[translate,color,background-color] duration-(--motion-spring) ease-(--spring)", peek !== "left" && "pointer-events-none") : !rails ? "transition-[translate,color,background-color] duration-(--motion-spring) ease-(--spring)" : undefined}
          style={hideLeft ? peekRider("left", leftIn, sidebarPx(sidebarWidth)) : undefined} />
      )}
      {desktop && !popout && (
        <SidebarToggle side="right" open={rightOpen} empty={!hasRight}
          onClick={() => (hasRight ? setPrefs({ rightSidebar: !rightSidebar }) : setEmptyRight(!emptyRight))}
          className={!rails && !rightOpen ? cn("z-(--z-peek-rider) transition-[translate,color,background-color] duration-(--motion-spring) ease-(--spring)", peek !== "right" && "pointer-events-none") : !rails ? "transition-[translate,color,background-color] duration-(--motion-spring) ease-(--spring)" : undefined}
          style={!rails && !rightOpen ? peekRider("right", peek === "right", sidebarPx(rightSidebarWidth)) : undefined} />
      )}

      <DetailSheet open={!!sheet && !!store} onClose={sheet === "tabs" ? closeSwitcher : closeDetail} path={sheet} depth={depth}
        still={!desktop && sheet === "tabs" && moves()} own={sheet === "tabs"}
        onBack={canBack ? backDetail : undefined} backLabel={prevTitle.length <= 12 ? prevTitle : "Back"}
        title={sheetDetail?.title ?? ""} wide={sheetDetail?.wide}>
        {sheetDetail && <Guard key={sheet} what="This sheet" size="tab" reset={sheet}>{sheetDetail.body}</Guard>}
      </DetailSheet>

      <Palettes store={store} />
      <FolderPicker />
      <Chooser />
      <DownloadingNotice store={store} />
      <IconPicker />
      {desktop && !bare && <StatusBar />}
      {desktop && <KeyHints />}
      {desktop && <Tooltips />}
      {!desktop && <SelectionBar />}
      <ContextMenus />
      <WelcomeCards />
      <ConfirmDialogs />
      <BundleTrial store={store} />
      <Toaster desktop={desktop} />

      {running}
      {store && <GrantAsker store={store} />}

      {!desktop && (
        <PhoneBar system={APP_PAGES} active={active} listOpen={detail === "tabs"}
          onSearch={() => setSearching(true)} onCommands={() => setPalette("commands")} onNewNote={() => void newNote()} />
      )}
      {!desktop && store && <PullActions />}
      {!desktop && store && <PhoneDrawers store={store} file={filePath} tab={targetOf(tab)} vaultName={vaultName} vaultMenu={vaultMenu} />}
    </>
  )
}

let sandboxTold = false
function sandboxNotice() {
  if (sandboxTold) return
  sandboxTold = true
  notify("This is the playground: changes here are lost when it's opened again. Make a vault of your own to keep notes.", { duration: 10000, id: "sandbox",
    ...(desktopApp?.setup ? { action: { label: "Set up my vault", run: () => desktopApp!.setup!() } } : {}) })
}
