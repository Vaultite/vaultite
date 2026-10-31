import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FoldVertical, AppWindow, Group as GroupIcon, Ungroup, Braces, EyeOff, ArchiveRestore, ArrowLeft, ArrowRight, ArrowRightToLine, ChevronLeft, ChevronRight, ChevronsUpDown, CirclePlay, ClipboardCopy, Columns2, Command as CommandIcon, Copy, CopyX, FileInput, FilePlus, FileText, FlaskConical, Focus, FolderOpen, Hash, Import, Keyboard, Layers, LayoutDashboard, Link, ListChecks, ListTree, Moon, Package, PackagePlus, Palette as PaletteIcon, PanelLeft, PanelRight, PencilLine, Pin, Plus, Puzzle, Redo2, RefreshCw, RotateCcw, Rows2, Server, SlidersHorizontal, Smile, SquareArrowOutUpRight, SquareSplitHorizontal, SquareSplitVertical, SquareX, Sun, SunMoon, Tags, Trash2, Undo2, UnfoldVertical, Vault, X, Zap } from "lucide-react"
import { getStore, onState, reload, useStore, type Store } from "@/core/data"
import { share } from "@/core/share"
import { SharedWith } from "@/components/SharedWith"
import { runCommandLink, useCommands } from "@/core/commands"
import { isDesktop, isMac, isWindows, useDesktop } from "@/core/platform"
import { loadActions } from "@/core/actions"
import { currentEditor, keysInEditor } from "@/core/editors"
import { desktop as desktopApp, hasLights, otherVaults } from "@/core/desktop"
import { peekPanel, peekRider, usePeek, usePeekLights } from "@/core/peek"
import { useTypingFade } from "@/core/typing"
import { keepTypingInSight } from "@/core/sight"
import { phoneApp, takeLinks } from "@/core/phoneapp"
import { GrantAsker } from "@/components/GrantAsker"
import { isProtected, inVault, isReadOnly, openFile, stem } from "@/core/files"
import { activeTab, askRename, canClosePane, closePane, closeTab, closeTabs, currentFile, cycleTab, fillFirstTab, onWorkspaceChange, followHash, go, hashOf, tabsHere, navigate, selectTabAt, togglePinTab, toggleStacked, isStacked, isPopout, popOut, targetOf, useWorkspace } from "@/core/workspace"
import { restTab } from "@/core/workspace"
import { hasSiblings, moveTabBy, moveToSplit, splitTab } from "@/core/splits"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { vaultPath, type Tab } from "../../core/layout.ts"
import { backDetail, closeDetail, openDetail, replaceHash, route, setDetailRedirect, takeScroll } from "@/core/nav"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { currentWorkspace, noteOpened, subscribeScoped } from "@/core/scope"
import { sayWindowState, setWindowState } from "@/core/live"
import { backgrounds, detailFor, homeTab, isEnabled, panelsIn, pluginById, pluginCommands, safeMode, showTabsIn, shownHeaderItems, tabListPanel, tabsInSidebar, turnPluginsBackOn, usePluginsVersion, useSidebars, viewFor } from "@/core/plugins"
import { leaveSet, makeSet } from "@/core/tabsets"
import { canReopen, reopenLatest } from "@/core/tabarchive"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { textSizeCommands } from "@/core/textsize"
import { allSwitches, switchCommand } from "@/core/switches"
import { choiceCommands } from "@/core/choices"
import { loadVaultPlugins } from "@/core/vaultPlugins"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { DetailSheet } from "@/components/DetailSheet"
import { setSheetFile } from "@/components/TargetView"
import { newNote, revealInTree } from "@/components/FileTree"
import { headerMenu, panelMenu, RAIL, SidebarPanels, SidebarToggle } from "@/components/Sidebar"
import { FileView } from "@/components/FileView"
import { StatusBar } from "@/components/StatusBar"
import { Catch, Drawn, Guard } from "@/components/Guard"
import { DownloadingNotice, VaultLoading } from "@/components/VaultLoading"
import { KeyHints } from "@/components/KeyHints"
import { preloadEditor } from "@/editor/lazy"
import { Logo, SheetHead } from "@/components/kit"
import { notify, notifyError } from "@/core/notify"
import { editorSettings, showPropertiesAs } from "@/core/editorPrefs"
import { PluginPreview } from "@/components/PluginPreview"
import { PluginSettings } from "@/components/PluginSettings"
import { settingsCommands, settingsTitle } from "@/core/pluginSettings"
import { offerBundles, openImport, previousSetup, restoreSetup, startSave } from "@/core/bundles"
import { APP_PAGES, appPageOf, hrefOf, isSetupTab, openAppPage, openSetup, type AppPage } from "@/core/apppages"
import { CommandPalette } from "@/components/CommandPalette"
import { FolderPicker } from "@/components/FolderPicker"
import { Chooser } from "@/components/Chooser"
import { IconPicker, pickIcon } from "@/components/IconPicker"
import { SearchPalette } from "@/components/SearchPalette"
import { openNewTab } from "@/core/launcher"
import { Workspace } from "@/components/Workspace"
import { Resizer } from "@/components/Resizer"
import { DragGhost, editSet, setPageInfo, useTabInfo, type TabInfo } from "@/components/Tabs"
import { useLingeringSheet, zooms } from "@/core/motion"
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
import { canReveal, chooseAction, copyLink, copyPath, copyText, duplicate, remove, revealInFinder } from "@/components/FileActions"
import { cn, space, whenIdle } from "@/lib/utils"
import { canGoSide, goSide } from "@/core/keylist"
import { chooseScheme } from "@/components/SchemeChooser"
import { chooseNewTabPage, showNewTabSections } from "@/components/NewTab"

// The app's own pages, which few visits open: loaded when they are.
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
const SaveBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.SaveBundle })))
const ShareBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.ShareBundle })))
const ImportBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.ImportBundle })))
const IncomingBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.IncomingBundle })))

// The app's own pages (core/apppages.ts), each drawn from its lazy chunk: Setup on the tab its address names.
const DRAW: Record<AppPage["id"], (store: Store, to: string, tab: Tab | null) => React.ReactNode> = {
  setup: (store, to, tab) => <Suspense><Setup store={store} tab={isSetupTab(to) ? to : "bundles"} at={tab?.id} /></Suspense>,
  settings: (store) => <Suspense><Settings store={store} /></Suspense>,
}
const pageTabOf = (to: string) => { const p = appPageOf(to); return p && { ...p, render: DRAW[p.id] } }
/** The sidebar: open (its edge drags between these px widths, double-click resets) or an icon rail (RAIL: in spacing
 *  units, so it follows density; `railPx` is what it measures now). */
const SIDEBAR = { min: 200, max: 480, default: 240 }
const railPx = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing")) || 0.25) * 16 * RAIL
const sidebarPx = (w: number) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w || SIDEBAR.default)))
let dragFrom = SIDEBAR.default, dragOpen = true
/** A sidebar's edge dragged to x (the right one's from the right): narrower than halfway between the rail and its
 *  narrowest, it's the rail, and it keeps the width it had when the drag began, so it reopens as it was. */
function dragSidebar(right: boolean, x: number) {
  const w = right ? innerWidth - x : x
  const [on, width] = right ? ["rightSidebar", "rightSidebarWidth"] as const : ["sidebar", "sidebarWidth"] as const
  if (w <= (railPx() + SIDEBAR.min) / 2) { if (getPrefs()[on]) setPrefs({ [on]: false, [width]: dragFrom }); return }
  setPrefs({ [on]: true, [width]: sidebarPx(w) })
}
/** The vault menu (the vault's name at the sidebar's bottom): the other vaults, Manage vaults. */
const manageVaults = () => (desktopApp ? desktopApp.manageVaults() : openDetail("vaults"))
const VAULT_MENU = (): MenuItem[] => [
  ...otherVaults().map((v) => ({ label: `Open ${v.name}`, run: () => { (desktopApp ? desktopApp.openVault(v.path) : webVaults.open(v.path)).catch((e) => notifyError(e, "Couldn't open it")) } })),
  { label: "Manage vaults", sep: !!otherVaults().length, run: () => { manageVaults() } },
  ...(desktopApp?.openSandbox ? [{ label: "Open the playground", run: () => { desktopApp!.openSandbox!() } }] : []), // a made-up vault to try things in
  ...(phoneApp ? [{ label: "Switch server…", run: () => { phoneApp!.launcher() } }] : []), // the iPhone app's servers
]

/** A sheet's body and title (detail_): a plugin's `title` or `file` that throws is a sheet saying so (the Guard around
 *  its body), not the app stopped, as it's called while App draws. */
function sheet_(...a: Parameters<typeof detail_>): ReturnType<typeof detail_> {
  try { return detail_(...a) } catch (e) { return { body: <Drawn draw={() => { throw e }} />, title: "" } }
}

/** The core's own sheets, from their lazy chunks: by the path's kind ("bundle/": one with an id), its title and body. */
const CORE_SHEETS: Record<string, [string, (store: Store, id: string) => React.ReactNode]> = {
  schemes: ["Colour schemes", () => <SchemeGallery />], // Settings' More…, the command "Change colour scheme"
  fonts: ["Fonts", () => <FontsSheet />], // Settings' Fonts row
  "settings-section/": ["Settings", (store, id) => <SettingsSection store={store} id={id} />], // a Settings section, where the pane is narrow
  hotkeys: ["Hotkeys", () => <HotkeysSheet />], // Settings' Hotkeys row, the command "Open hotkeys"
  sidebars: ["Sidebars", () => <SidebarsSheet />], // Panels ▸ Customize sidebars…, Settings' Sidebars row, the command
  "bundle/": ["Bundle", (_, id) => <BundlePreview id={id} />], // a bundle's preview (pages/Bundles.tsx)
  "plugin-group/": ["Plugins", (store, id) => <PluginGroupSheet store={store} id={id} />], // a group's row on Plugins (the coding agents)
  "plugin-get/": ["Get plugins", (_, id) => <GetPluginSheet id={id} />], // a row of Get plugins: one not installed yet
  "bundle-save": ["Save current setup", () => <SaveBundle />],
  "bundle-share/": ["Share", (_, id) => <ShareBundle id={id} />],
  "bundle-import": ["Import a bundle", () => <ImportBundle />],
  "bundle-incoming/": ["Import a bundle", (_, id) => <IncomingBundle id={id} />], // a bundle given to the app (core/bundles.ts openImport)
}

/** The detail sheet for a path: a plugin's (person/…, log/…), or the core's plugin sheet (plugin/<id>). */
function detail_(store: Store, path: string, disabled: string[], tabInfo: (t: Tab) => TabInfo): { body: React.ReactNode; title: string; wide?: boolean } {
  const [kind, id] = path.split("/")
  if (kind === "file") {
    const p = decodeURIComponent(id ?? "")
    return { body: <FileView store={store} path={p} pane={false} />, title: stem(p) }
  }
  if (kind === "tabs") return { body: <TabSwitcher store={store} info={tabInfo} />, title: "Tabs" } // the phone's tab list
  if (kind === "vaults") { // Manage vaults, on the web (the desktop app has its own window)
    return { body: <><SheetHead icon={Logo} tint="var(--primary)" kicker="Vaultite" title="Vaults" /><VaultManager backend={webVaults} /></>, title: "Vaults" }
  }
  const own = CORE_SHEETS[id ? `${kind}/` : kind]
  if (own) return { body: <Suspense>{own[1](store, decodeURIComponent(id ?? ""))}</Suspense>, title: own[0] }
  if (kind === "plugin") {
    const p = pluginById(id)
    if (p) return { body: <PluginPreview store={store} plugin={p} />, title: p.name }
  }
  if (kind === "plugin-settings") { // a plugin's settings (core/pluginSettings.ts)
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
  // A phone shows one tab at a time in the window, each going back to where it was left (core/viewstate.ts, per vault,
  // so once the vault is loaded). A computer's panes keep their own.
  const place = useRef("")
  const restoring = useRef(false)
  const loaded = !!useStore().store
  useLayoutEffect(() => {
    if (isDesktop() || !loaded) return
    place.current = targetOf(r.tab)
    restoring.current = true
    // (Back or Forward: where that entry was, by pixels; another tab: where it was left, by its line when it has one)
    const back = takeScroll()
    return restoreScroll(null, back ?? scrollOf(place.current), () => { restoring.current = false }, back === null ? place.current : undefined,
      document.querySelector<HTMLElement>("#main-scroll article.file-view"))
  }, [r.tab, loaded])
  useEffect(() => {
    const on = () => { if (!isDesktop() && !restoring.current && place.current) keepScroll(place.current, scrollY) }
    addEventListener("scroll", on, { passive: true })
    return () => removeEventListener("scroll", on)
  }, [])
  return r
}

// The vault's own plugins load with each state, before it's drawn.
onState(loadVaultPlugins)

setSheetFile((store, path) => <FileView store={store} path={path} pane={false} />)

// A detail that is a file (a person, a note) opens as the file.
setDetailRedirect((path) => {
  const s = getStore()
  const d = s ? detailFor(path, getPrefs().disabled) : null
  return d?.def.file && s ? d.def.file(s, d.args) : null
})

export default function App() {
  const { tab, detail, depth, prev } = useRoute()
  // The tab list stays on screen a moment after it's left, while the page grows out of it (core/motion.ts).
  const lingering = useLingeringSheet()
  const sheet = detail || lingering || ""
  const { store, error } = useStore()
  const { sidebar, sidebarWidth, rightSidebar, rightSidebarWidth, rails, peekShade, typingFade, disabled, enabled, sidebarHeader } = usePrefs()
  // Where a device starts (a plugin's `home`: Pinned's first page), else a new tab.
  const home = store ? homeTab(store, disabled) : null
  const isFileTab = tab.startsWith("file/") || tab === "file"
  const isViewTab = tab.startsWith("view/")
  const isNewTab = tab === "new"
  const desktop = useDesktop()
  // The editor's code, once the first page is drawn.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (store) whenIdle(preloadEditor) }, [!!store])
  // (until turned back on: the toast stays, so the visit can't be taken for the app as it is)
  useEffect(() => { if (safeMode) notify("Vault plugins are off for now", { id: "safe-mode", duration: Infinity, action: { label: "Turn back on", run: turnPluginsBackOn } }) }, [])
  // Files' actions (the ops' catalog) ready before a menu asks, and again when plugins come and go.
  useEffect(() => { if (store) whenIdle(loadActions) }, [!!store, disabled, enabled])
  // The files the focused tab shows go into the current workspace's "opened lately" (core/scope.ts).
  useEffect(() => onWorkspaceChange(() => noteOpened(currentFile())), [])
  // The window tells the server which workspace it's on (an agent's `vau panels` changes that one), again on a switch.
  useEffect(() => {
    let was = currentWorkspace()?.n ?? null
    setWindowState(() => { const n = currentWorkspace()?.n; return n ? { workspace: n } : {} })
    // Now, too: the live socket may have opened before this (main.tsx connects first) and said nothing of it.
    sayWindowState()
    return subscribeScoped(() => { const n = currentWorkspace()?.n ?? null; if (n !== was) { was = n; sayWindowState() } })
  }, [])
  // A device's first visit (nothing saved): its blank tab shows where plugins say it starts (the first pinned page). A
  // vault the app has never opened before shows the bundles first (core/bundles.ts: a setup to start from).
  useEffect(() => {
    if (store?.vault.sandbox) sandboxNotice()
    if (store && offerBundles()) { openSetup("bundles"); return }
    if (home) fillFirstTab(home)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  // No address, or on a phone one it can't show: where the app starts (home, else a new tab).
  useEffect(() => {
    if (!store) return
    // The address moved on since this was drawn (a workspace's tabs put in place meanwhile): the next draw sees to it.
    if (route().tab !== tab) return
    if (isFileTab || isViewTab || isNewTab || appPageOf(tab)) return
    const to = !tab || (!desktop && !detail) ? (home ? hashOf(home) : desktop ? null : "new") : null
    if (!to) return
    replaceHash(`${to}${detail ? `/${detail}` : ""}`, history.state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, tab])
  useWorkspace() // re-render when tabs change
  // The address shows the focused group's active tab; when it changes by itself (back, a link, a page picked in
  // the phone's drawer), the tab follows. Phones use the same tabs, shown one at a time (components/TabSwitcher.tsx).
  const known = isFileTab || isViewTab || isNewTab || !!appPageOf(tab)
  useEffect(() => {
    if (known) followHash(tab)
    else if (desktop && !detail && store) replaceHash(hashOf(activeTab().to))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desktop, known, !!store])
  useEffect(() => takeLinks({ command: runCommandLink, open: (p) => { const s = getStore(); if (!s?.files.files.some((f) => f.path === p)) return false; openFile(p); return true },
    bundle: (repo) => { if (!getStore()) return false; void openImport(repo); return true } }), [])
  // First load with no address: show the tab that was open last time.
  useEffect(() => {
    if (!location.hash) replaceHash(hashOf(activeTab().to))
  }, [])
  const filePath = isFileTab ? targetOf(tab).slice(5) : ""
  const active = appPageOf(tab)
  // A file's sheet in the address (#<tab>/file/…, a phone's): on desktop, the file's tab.
  useEffect(() => {
    if (!desktop || !store || !detail) return
    const [kind, arg] = detail.split("/")
    if (kind !== "file") return
    let f: string | null = null
    try { f = decodeURIComponent(arg ?? "") } catch { f = null }
    if (f) { history.replaceState(null, "", `#${hashOf(activeTab().to)}`); go(`file:${f}`, false, false) }
  }, [desktop, store, detail])
  const pageInfo = (id: string) => { const p = appPageOf(hashOf(id)); return p ? { label: p.label, icon: p.icon, tint: p.tint } : null }
  const tabInfo = useTabInfo(store, pageInfo)
  setPageInfo(pageInfo)
  // Back when this sheet was opened from another sheet.
  const canBack = !!prev
  const prevTitle = canBack && store ? sheet_(store, prev, disabled, tabInfo).title : ""
  const sheetDetail = store && sheet ? sheet_(store, sheet, disabled, tabInfo) : null
  // The quick switcher (⌘O) or the command palette (⌘P); their commands are below.
  const [palette, setPalette] = useState<"search" | "launcher" | "commands" | null>(null)
  const setSearching = (on: boolean) => setPalette(on ? "search" : null)
  // The vault's name at the bottom of the sidebar: a menu of vault-wide things (VAULT_MENU).
  const vaultName = store ? (store.vault.sandbox ? "Playground" : store.vault.path.split("/").filter(Boolean).pop() ?? "Vault") : "Vault"
  const vaultMenu = (e: React.MouseEvent) => menuBelow(e, VAULT_MENU())
  // The app's commands (⌘P lists them); file commands act on the active tab's file, in the vault only (not "file:/…").
  // The file the user means: the editor's (a sheet's over the page too), else the focused tab's.
  const actionTarget = () => currentEditor()?.path ?? currentFile()
  const tabFile = () => (isDesktop() ? currentFile() : "")
  // A tab's vault file that isn't there any more (deleted from outside the app: its tab isn't reopened).
  const fileGone = (to: string) => {
    const s = getStore(), p = vaultPath(to)
    return !!s && p !== null && !inVault(s, p)
  }
  const besideText = () => { const ed = currentEditor(); return !!ed?.undo && keysInEditor(ed) }
  useCommands(() => [
    // (`label` and `icon`: as a blank tab's buttons, core/newtab.ts' default ones.)
    { id: "switcher:open", name: "Open quick switcher", keys: ["Mod+O"], run: () => setPalette((p) => (p === "search" ? null : "search")), fromLink: true, label: "Open a file", icon: FileText },
    // (a new tab's, picking what it shows: what ⌘T opens with newtab.json's `opens`, core/launcher.ts)
    { id: "switcher:new-tab", name: "Open new tab from quick switcher", run: () => setPalette((p) => (p === "launcher" ? null : "launcher")), icon: Plus },
    { id: "palette:open", name: "Open command palette", keys: ["Mod+P"], run: () => setPalette((p) => (p === "commands" ? null : "commands")), icon: CommandIcon },
    { id: "icon:search", name: "Search icons", run: () => pickIcon({ title: "Search icons", onPick: (n) => copyText(n).then(() => notify(`Copied ${n}: use it as an icon:`, { id: "copied" }), notifyError) }), icon: Smile },
    // ⌘N, ⌘T, ⌘W are the browser's: the desktop app has them (its menu), the web gets another key or none.
    { id: "file:new", name: "Create new note", keys: desktopApp ? ["Mod+N"] : ["Mod+Alt+N"], run: () => void newNote(), fromLink: true, label: "New note", icon: FilePlus },
    // On a phone the sidebars are drawers (components/PhoneDrawer.tsx).
    { id: "sidebar:toggle", name: "Show left sidebar", keys: ["Mod+\\"],
      run: () => (isDesktop() ? setPrefs({ sidebar: !getPrefs().sidebar }) : openDrawer(drawerOut() === "left" ? null : "left")), icon: PanelLeft,
      nameWhenOn: "Hide left sidebar", on: () => (isDesktop() ? getPrefs().sidebar : drawerOut() === "left") },
    { id: "sidebar:toggle-right", name: "Show right sidebar", keys: ["Mod+Shift+\\"],
      run: () => { if (isDesktop()) document.querySelector<HTMLElement>("[data-sidebar-toggle=right]")?.click(); else openDrawer(drawerOut() === "right" ? null : "right") }, icon: PanelRight,
      nameWhenOn: "Hide right sidebar", on: () => (isDesktop() ? document.querySelector("[data-sidebar-toggle=right]")?.getAttribute("aria-expanded") === "true" : drawerOut() === "right") },
    { id: "tab:new", name: "Open new tab", keys: desktopApp ? ["Mod+T"] : undefined, when: isDesktop, run: () => openNewTab(), icon: Plus },
    { id: "split:right", name: "Split right", keys: ["Mod+Alt+\\"], when: isDesktop, run: () => splitTab("right"), icon: Columns2 },
    { id: "split:down", name: "Split down", when: isDesktop, run: () => splitTab("bottom"), icon: Rows2 },
    { id: "split:move-right", name: "Move current tab to new split right", when: () => isDesktop() && hasSiblings(activeTab().id), run: () => moveToSplit("right"), icon: SquareSplitHorizontal },
    { id: "split:move-down", name: "Move current tab to new split down", when: () => isDesktop() && hasSiblings(activeTab().id), run: () => moveToSplit("bottom"), icon: SquareSplitVertical },
    ...([["left", "to the left"], ["right", "to the right"], ["top", "above"], ["bottom", "below"]] as const).map(([side, where]) => (
      // Past the last pane on a side: into that side's sidebar, and from a sidebar back to the pane (core/keylist.ts).
      { id: `split:focus-${side}`, name: `Focus on the pane ${where}`, when: () => isDesktop() && canGoSide(side), run: () => goSide(side), icon: Focus })),
    // Off a Mac, ⌃⌥← switches workspaces (GNOME, Xfce): ⌥← there, as browsers have it.
    { id: "nav:back", name: "Navigate back", keys: isMac ? ["Mod+Alt+ArrowLeft", "Mod+["] : ["Alt+ArrowLeft"], when: isDesktop, run: () => navigate(-1), icon: ArrowLeft },
    { id: "nav:forward", name: "Navigate forward", keys: isMac ? ["Mod+Alt+ArrowRight", "Mod+]"] : ["Alt+ArrowRight"], when: isDesktop, run: () => navigate(1), icon: ArrowRight },
    // (A pinned tab stays: ⌘W rests it, as Arc does; it's closed from its menu, with its pane, or unpinned first.)
    { id: "tab:close", name: "Close current tab", keys: desktopApp ? ["Mod+W"] : undefined, label: "Close tab", icon: X, run: () => {
      const t = activeTab()
      if (t.pinned) restTab(t.id); else closeTab(t.id)
    } },
    // (⇧⌘W closes the window: ⌥⇧⌘W, beside ⌥⌘W's Close all other tabs.)
    { id: "pane:close", name: "Close pane", keys: ["Mod+Alt+Shift+W"], when: () => isDesktop() && canClosePane(), run: () => closePane(), icon: SquareX },
    { id: "tab:toggle-pin", name: "Pin tab", when: isDesktop, run: () => togglePinTab(activeTab().id), icon: Pin, nameWhenOn: "Unpin tab", on: () => !!activeTab().pinned },
    { id: "tab:toggle-stacked", name: "Stack tabs", when: isDesktop, run: () => toggleStacked(), icon: Layers, nameWhenOn: "Unstack tabs", on: isStacked },
    // Vertical tabs, one switch: the tab bar or the Tabs panel at the top of the left sidebar (core/plugins.ts).
    { id: "tab:sidebar", name: "Show tabs in the sidebar", when: () => isDesktop() && !isPopout() && !!tabListPanel(), run: () => showTabsIn(tabsInSidebar() ? "top" : "sidebar"),
      icon: PanelLeft, nameWhenOn: "Show tabs on top", on: () => tabsInSidebar() },
    { id: "tab:group", name: "Add current tab to new group", when: isDesktop, run: () => { const id = makeSet([activeTab().id]); if (id) editSet(id) }, icon: GroupIcon },
    { id: "tab:ungroup", name: "Remove current tab from group", when: () => isDesktop() && !!activeTab().set, run: () => leaveSet([activeTab().id]), icon: Ungroup },
    // A window of its own (a pop-out): no sidebars, its own tabs.
    { id: "tab:move-to-window", name: "Move current tab to new window", when: () => isDesktop() && activeTab().to !== "new", run: () => popOut(activeTab().id, true), icon: AppWindow },
    { id: "tab:move-to-main", name: "Move current tab to main window", when: hasMainWindow, run: () => moveToMain([activeTab().id]), icon: AppWindow },
    { id: "tab:open-in-window", name: "Open current tab in new window", when: () => isDesktop() && activeTab().to !== "new", run: () => popOut(activeTab().id), icon: SquareArrowOutUpRight },
    // ⌘1–⌘8 the nth tab of the pane, ⌘9 its last, like a browser's (the browser's own keys: the desktop app has them).
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `tab:goto-${n}`, name: `Go to tab #${n}`, keys: desktopApp ? [`Mod+${n}`] : undefined,
      when: () => isDesktop() && tabsHere() >= n, run: () => selectTabAt(n), icon: Hash })),
    { id: "tab:goto-last", name: "Go to last tab", keys: desktopApp ? ["Mod+9"] : undefined, when: isDesktop, run: () => selectTabAt(-1), icon: ArrowRightToLine },
    // (⌘⇧T is the browser's too.)
    { id: "tab:reopen", name: "Reopen closed tab", keys: desktopApp ? ["Mod+Shift+T"] : undefined, when: () => isDesktop() && canReopen(), run: () => reopenLatest(fileGone), icon: RotateCcw },
    { id: "tab:close-others", name: "Close all other tabs", keys: ["Mod+Alt+W"], when: isDesktop, run: () => closeTabs("others", activeTab().id), icon: CopyX },
    // (⌃⇧PgUp and PgDn are the browser's: the desktop app has them.)
    { id: "tab:move-left", name: "Move tab left", keys: desktopApp ? ["Ctrl+Shift+PageUp"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => moveTabBy(-1), icon: ArrowLeft },
    { id: "tab:move-right", name: "Move tab right", keys: desktopApp ? ["Ctrl+Shift+PageDown"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => moveTabBy(1), icon: ArrowRight },
    // (⌃Tab is the browser's: the desktop app has it, the web none by default.)
    { id: "tab:next", name: "Go to next tab", keys: desktopApp ? ["Ctrl+Tab", ...(isMac ? ["Mod+Shift+]"] : [])] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => cycleTab(1), icon: ChevronRight },
    { id: "tab:previous", name: "Go to previous tab", keys: desktopApp ? ["Ctrl+Shift+Tab", ...(isMac ? ["Mod+Shift+["] : [])] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => cycleTab(-1), icon: ChevronLeft },
    // (Ctrl+. is IBus' emoji key on Linux: Alt+Enter there too, JetBrains' "show actions".)
    { id: "file:actions", name: "Show actions for current file", keys: isMac ? ["Mod+."] : ["Mod+.", "Alt+Enter"], when: () => !!actionTarget(), run: () => chooseAction(actionTarget()), icon: Zap },
    { id: "file:reveal", name: "Reveal current file in file tree", when: () => !!tabFile() && isEnabled("files", getPrefs().disabled),
      run: () => revealInTree(tabFile(), { scroll: true, flash: true, open: true }), icon: ListTree },
    { id: "file:rename", name: "Rename current file", when: () => !!tabFile() && !isProtected(tabFile()), run: () => askRename(tabFile()), icon: PencilLine },
    // To the trash at once, with Undo in a toast (in the trash: for good, after asking).
    { id: "file:delete", name: "Delete current file", when: () => !!tabFile() && !isProtected(tabFile()), run: () => remove(tabFile()), icon: Trash2 },
    { id: "file:duplicate", name: "Duplicate current file", when: () => !!tabFile() && !isReadOnly(tabFile()), run: () => duplicate(tabFile()), icon: Copy },
    { id: "file:copy-path", name: "Copy file path", when: () => !!tabFile(), run: () => copyPath(tabFile()), icon: ClipboardCopy },
    { id: "file:copy-link", name: "Copy link to current file", when: () => !!tabFile(), run: () => copyLink(tabFile()), icon: Link },
    // (The name stays a literal for core/appsource.ts; off a Mac it's the file manager's.)
    { id: "file:reveal-finder", name: "Reveal current file in Finder", when: () => !!tabFile() && canReveal(), run: () => revealInFinder(tabFile()), icon: FolderOpen,
      ...(isMac ? {} : { name: isWindows ? "Show current file in Explorer" : "Show current file in folder" }) },
    ...APP_PAGES.map((p) => ({ id: `page:${p.id}`, name: `Open ${p.label}`, keys: p.keys, words: p.words, run: () => openAppPage(p), icon: p.icon })),
    // Setup's tabs: Plugins, and Bundles (core/bundles.ts), setups of the app to start from, save and share.
    { id: "page:plugins", name: "Open Plugins", words: "setup extensions install", run: () => openSetup("plugins"), icon: Puzzle },
    { id: "bundles:choose", name: "Choose a bundle…", words: "setup", run: () => openSetup("bundles"), icon: Package },
    { id: "bundles:save", name: "Save current setup as a bundle…", run: () => void startSave(), icon: PackagePlus },
    { id: "bundles:import", name: "Import a bundle…", run: () => openDetail("bundle-import"), icon: Import },
    { id: "bundles:restore", name: "Restore previous setup", when: () => !!previousSetup(), run: () => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it")), icon: ArchiveRestore },
    { id: "theme:light", name: "Use light theme", when: () => getPrefs().theme !== "light", run: () => setPrefs({ theme: "light" }), icon: Sun },
    { id: "theme:dark", name: "Use dark theme", when: () => getPrefs().theme !== "dark", run: () => setPrefs({ theme: "dark" }), icon: Moon },
    { id: "theme:system", name: "Use the system's light or dark theme", when: () => getPrefs().theme !== "system", run: () => setPrefs({ theme: "system" }), icon: SunMoon },
    { id: "scheme:gruvbox", name: "Use Gruvbox colours (the default)", when: () => getPrefs().scheme !== "gruvbox", run: () => setPrefs({ scheme: "gruvbox" }), icon: PaletteIcon },
    { id: "scheme:default", name: "Use Classic colours", when: () => getPrefs().scheme !== "default", run: () => setPrefs({ scheme: "default" }), icon: PaletteIcon },
    { id: "scheme:choose", name: "Change colour scheme", run: chooseScheme, icon: PaletteIcon },
    { id: "newtab:page", name: "Choose a page for new tabs…", run: chooseNewTabPage, icon: LayoutDashboard },
    { id: "newtab:sections", name: "Show sections on new tabs", when: () => !!getPrefs().newTab.page, run: showNewTabSections, icon: Layers },
    { id: "sidebars:customize", name: "Customize sidebars", run: () => openDetail("sidebars"), icon: SlidersHorizontal },
    { id: "hotkeys:open", name: "Open hotkeys", keys: ["Shift+/"], run: () => openDetail("hotkeys"), icon: Keyboard },
    // A choice of two, like the theme: the one not in use is offered (the menu bar's radio items).
    { id: "density:compact", name: "Use compact density", when: () => getPrefs().density === "comfortable", run: () => setPrefs({ density: "compact" }), icon: FoldVertical },
    { id: "density:comfortable", name: "Use comfortable density", when: () => getPrefs().density !== "comfortable", run: () => setPrefs({ density: "comfortable" }), icon: UnfoldVertical },
    // "Properties in document": the two not in use, so hidden properties can be brought back from anywhere.
    { id: "properties:visible", name: "Show properties in notes", when: () => editorSettings().propertiesInDocument !== "visible", run: () => showPropertiesAs("visible"), icon: Tags },
    { id: "properties:hidden", name: "Hide properties in notes", when: () => editorSettings().propertiesInDocument !== "hidden", run: () => showPropertiesAs("hidden"), icon: EyeOff },
    { id: "properties:source", name: "Show properties as text while editing", when: () => editorSettings().propertiesInDocument !== "source", run: () => showPropertiesAs("source"), icon: Braces },
    // The note's history while the keyboard is beside its text, not in it (a property just removed, a chip clicked).
    { id: "editor:undo", name: "Undo", keys: ["Mod+Z"], when: besideText, run: () => currentEditor()?.undo?.(), icon: Undo2 },
    { id: "editor:redo", name: "Redo", keys: ["Mod+Shift+Z"], when: besideText, run: () => currentEditor()?.redo?.(), icon: Redo2 },
    { id: "vault:reload", name: "Reload the vault", run: () => reload(), icon: RefreshCw },
    { id: "vault:manage", name: "Manage vaults", run: manageVaults, icon: Vault },
    { id: "vault:sandbox", name: "Open the playground", when: () => !!desktopApp?.openSandbox, run: () => desktopApp?.openSandbox?.(), icon: FlaskConical },
    { id: "app:setup", name: "Set up Vaultite", when: () => !!desktopApp?.setup, run: () => desktopApp?.setup?.(), icon: CirclePlay },
    { id: "app:switch-server", name: "Switch server…", when: () => !!phoneApp, run: () => phoneApp?.launcher(), icon: Server },
    { id: "file:open-outside", name: "Open file from outside the vault…", when: () => !!desktopApp, run: () => desktopApp?.pickOutside(), icon: FileInput },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [!!store])
  // Plugins' own commands (Open terminal...), while they're on (an opt-in one's too: `enabled`), and again when the
  // vault's plugins arrive or change.
  const pluginsVersion = usePluginsVersion()
  // Plugins' background work, drawn again when the store changes (it listens to the rest itself): a tab switched or a
  // sidebar shown redraws none of it. One that throws stops alone (its error goes to Errors).
  const running = useMemo(() => store && backgrounds(disabled).map(({ key, Run }) => <Catch key={key} fallback={() => null}><Run store={store} /></Catch>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, disabled.join(), enabled.join(), pluginsVersion])
  useCommands(() => pluginCommands(disabled), [disabled.join(), enabled.join(), pluginsVersion])
  // "Open <Name> settings": each plugin's settings sheet, while it's on and has some (core/pluginSettings.ts).
  useCommands(settingsCommands, [disabled.join(), enabled.join(), pluginsVersion])
  // Text sizes: notes' and the plugins' kinds (the Terminal's), apart from the app's zoom (core/textsize.ts).
  useCommands(() => textSizeCommands(disabled), [disabled.join(), enabled.join()])
  // Every on/off setting, the app's and the plugins' (core/switches.ts).
  useCommands(() => [...allSwitches(disabled).map(switchCommand), ...choiceCommands(disabled)], [disabled.join(), enabled.join(), pluginsVersion])
  // A pop-out window (core/workspace.ts POPOUT) has no sidebars: its tabs fill it.
  const popout = isPopout()
  // Without rails a hidden sidebar takes no room: it slides in over the page from its edge (core/peek.ts).
  const hideLeft = desktop && !popout && !rails && !sidebar
  const side = popout || hideLeft ? "0px" : sidebar ? `${sidebarPx(sidebarWidth)}px` : space(RAIL)
  const header = shownHeaderItems(disabled, sidebarHeader)
  // The right sidebar is there while
  // panels are in it; with none it takes no room, only its dimmed toggle (a click opens it empty to drop panels in).
  const rightCount = panelsIn("right", useSidebars(), disabled).length
  const [emptyRight, setEmptyRight] = useState(false)
  const hasRight = rightCount > 0
  useEffect(() => { if (hasRight) setEmptyRight(false) }, [hasRight])
  const rightOpen = hasRight ? rightSidebar : emptyRight
  const showRight = !popout && (hasRight || emptyRight)
  const hideRight = desktop && showRight && !rails && !rightOpen
  const rside = showRight && !hideRight ? (rightOpen ? `${sidebarPx(rightSidebarWidth)}px` : space(RAIL)) : "0px"
  const peek = usePeek(hideLeft, hideRight && hasRight)
  const leftOpen = sidebar || hideLeft
  // The traffic lights go with the sidebar they sit in; it slides out once they're gone, inert only then (an inert one
  // isn't hit, so a web page it's still over would be raised over it meanwhile).
  const leftIn = usePeekLights(hideLeft, peek)
  useTypingFade(desktop && typingFade)
  useEffect(() => keepTypingInSight(), [])
  // What's fixed to the window's edges (the status bar) keeps clear of the sidebars.
  // (before the paint: the bar drawn a frame with the old room moves when it gets the new)
  useLayoutEffect(() => { document.documentElement.style.setProperty("--right-sidebar", desktop ? rside : "0px") }, [rside, desktop])
  useLayoutEffect(() => { document.documentElement.style.setProperty("--left-sidebar", desktop ? side : "0px") }, [side, desktop])
  // Which sidebars are there, for index.css (not body:has(aside...): that made every DOM change recalc 4x the styles).
  useLayoutEffect(() => {
    const root = document.documentElement.dataset
    if (showRight) root.rightSidebar = ""; else delete root.rightSidebar
    if (!popout && !sidebar && rails) root.leftRail = ""; else delete root.leftRail
    if (showRight && !rightOpen && rails) root.rightRail = ""; else delete root.rightRail
    if (!rails) root.noRails = ""; else delete root.noRails
  }, [showRight, rightOpen, popout, sidebar, rails])
  // The shell takes its places without sliding to them while the vault's state comes in (main.tsx sets it).
  useEffect(() => {
    if (!store) return
    const t = setTimeout(() => { delete document.body.dataset.arriving }, 500)
    return () => clearTimeout(t)
  }, [!!store])

  return (
    <>
      {/* Desktop: the sidebar. Folded, it's an icon rail where only the width changes, so every icon stays put (RAIL in
          Sidebar.tsx, all offsets in spacing units). Right-click it to pick which panels show. */}
      {/* Behind a hidden sidebar slid in, the page dims a little (index.css: it starts once the sidebar is in, so
          brushing the edge never flashes it). Clicks pass through: one on the page puts the sidebar away. */}
      {peekShade && (hideLeft || hideRight) && <div aria-hidden data-peek-shade="" data-shown={peek ? "" : undefined} className="pointer-events-none fixed inset-0 z-[35]" />}
      {/* Over a frame (an HTML file, a PDF) the window hears no pointer: these catch it at the edges meanwhile (core/peek.ts). */}
      {hideLeft && <div aria-hidden data-peek-edge="" className="fixed inset-y-0 left-0 z-[38] w-[6px]" />}
      {hideRight && hasRight && <div aria-hidden data-peek-edge="" className="fixed inset-y-0 right-0 z-[38] w-[3px]" />}
      {!popout && <>
      <aside data-side="left" data-collapsed={!leftOpen || undefined} data-peek={hideLeft ? peek === "left" : undefined} inert={hideLeft && !leftIn} onContextMenu={menuFor(panelMenu)}
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col overflow-hidden border-r-[0.5px] border-border bg-sidebar pr-[calc(--spacing(2)-0.5px)] pl-2 pt-[env(safe-area-inset-top)] pb-2",
          "transition-[width] duration-200 ease-out md:flex",
          hideLeft && "z-40 rounded-[12px] border-0 shadow-[0_8px_32px_rgb(0_0_0/0.22)] transition-[translate]",
        )} style={hideLeft ? { width: `${sidebarPx(sidebarWidth)}px`, ...peekPanel("left", leftIn) } : { width: side }}>
        {/* As tall as the tab bar: right of the toggle, plugins' `header` items (Workspaces' switcher); a container, so
            an item fits itself to the room the traffic lights leave. */}
        <div data-titlebar onContextMenu={menuFor(headerMenu)} className={cn("@container flex h-10 shrink-0 items-center justify-end gap-1 pl-7.5 whitespace-nowrap transition-opacity duration-200", !leftOpen && "pointer-events-none opacity-0")}>
          {store && desktop && leftOpen && header.map(({ key, item }) => (
            <div key={key} data-header-item={key} className="flex min-w-0 shrink-0 items-center"><Guard what="This item"><Drawn draw={() => item.render({ store, open: true, file: filePath, tab: targetOf(tab) })} /></Guard></div>
          ))}
        </div>
        {/* Stand-ins for the Mac's traffic lights while it slides (core/peek.ts places and shows them). */}
        {hideLeft && hasLights && <span aria-hidden data-lights-ghost=""><i /><i /><i /></span>}
        {/* The plugins' panels; as a rail, the header's items go first, under the toggle. Phones draw them in drawers
            (PhoneDrawer.tsx). */}
        <div className="flex min-h-0 flex-1 flex-col">
          {store && desktop && <SidebarPanels store={store} open={leftOpen} file={filePath} tab={targetOf(tab)}
            head={!leftOpen && header.length ? header.map(({ key, item }) => (
              <div key={key} data-header-item={key} className="flex"><Guard what="This item"><Drawn draw={() => item.render({ store, open: false, file: filePath, tab: targetOf(tab) })} /></Guard></div>
            )) : undefined} />}
        </div>
        {/* The vault's profile: the vault's name (a menu), then Setup and Settings as buttons. As a rail,
            the two buttons stack, in line with the icons above. */}
        <nav aria-label="App" className={cn("-mx-2 -mb-2 flex shrink-0 gap-1 border-t-[0.5px] border-border p-2", !leftOpen && "flex-col items-start")}>
          {leftOpen && share && <SharedWith />}
          {leftOpen && !share && (
            <button type="button" onClick={vaultMenu} aria-haspopup="menu"
              className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] font-medium whitespace-nowrap hover:bg-foreground/[0.06]">
              <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
              <span className="min-w-0 truncate">{vaultName}</span>
            </button>
          )}
          {APP_PAGES.map((t) => (
            <a key={t.id} href={hrefOf(t)} aria-label={t.label} data-tip={t.label} data-tip-side={leftOpen ? "top" : "right"} data-app-page={t.id}
              onClick={(e) => { if (!desktop) return; e.preventDefault(); openAppPage(t, e.metaKey || e.ctrlKey) }}
              className={cn("grid size-7 shrink-0 place-items-center rounded-[5px] transition-colors",
                t.id === active?.id ? "bg-foreground/[0.08] text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground")}>
              <t.icon className="size-4" strokeWidth={2} />
            </a>
          ))}
        </nav>
      </aside>
      {/* Its edge (the splits' Resizer): dragged past half its narrowest it folds to the rail, keeping its width, and
          out again it opens, in one drag. */}
      {!hideLeft && <Resizer label="Resize the sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().sidebarWidth); dragOpen = getPrefs().sidebar }} onDrag={(x) => dragSidebar(false, x)}
        onCancel={() => setPrefs({ sidebar: dragOpen, sidebarWidth: dragFrom })} onReset={() => setPrefs({ sidebar: true, sidebarWidth: SIDEBAR.default })}
        className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ left: `calc(${side} - 4px)` }} />}
      </>}

      {showRight && (
        <aside data-side="right" data-collapsed={!(rightOpen || hideRight) || undefined} data-peek={hideRight ? peek === "right" : undefined} inert={hideRight && peek !== "right"}
          onContextMenu={menuFor(() => panelMenu(undefined, "right"))}
          className={cn(
            "fixed inset-y-0 right-0 z-20 hidden flex-col overflow-hidden border-l-[0.5px] border-border bg-sidebar pr-2 pl-[calc(--spacing(2)-0.5px)] pt-[env(safe-area-inset-top)] pb-2",
            "transition-[width] duration-200 ease-out md:flex",
            hideRight && "z-40 rounded-[12px] border-0 shadow-[0_8px_32px_rgb(0_0_0/0.22)] transition-[translate]",
          )} style={hideRight ? { width: `${sidebarPx(rightSidebarWidth)}px`, ...peekPanel("right", peek === "right") } : { width: rside }}>
          {/* As tall as the tab bar, with the toggle (fixed, below) at its right end. */}
          <div data-titlebar className="h-10 shrink-0" />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {store && desktop && <SidebarPanels side="right" store={store} open={rightOpen || hideRight} file={filePath} tab={targetOf(tab)} />}
          </div>
        </aside>
      )}
      {showRight && rightOpen && (
        <Resizer label="Resize the right sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().rightSidebarWidth); dragOpen = getPrefs().rightSidebar }} onDrag={(x) => dragSidebar(true, x)}
          onCancel={() => setPrefs({ rightSidebar: dragOpen, rightSidebarWidth: dragFrom })}
          onReset={() => setPrefs({ rightSidebar: true, rightSidebarWidth: 280 })}
          className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ right: `calc(${rside} - 4px)` }} />
      )}

      {desktop ? (
        <Workspace store={store} error={error} left={side} right={rside} pageInfo={pageInfo} page={pageTabOf} />
      ) : (
        // Phones: the window scrolls, under the header (its name, the drawer's button, the … menu); one tab at a time,
        // the active one (the tab list has the others; files open in tabs, as on a computer: core/files.ts, openFile).
        <div id="main-scroll" className="overflow-x-clip">
          {store && <PhoneHeader title={tabInfo(activeTab()).label} tab={activeTab()} />}
          <main className="pb-safe mx-auto max-w-5xl px-4 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
            {error && !store && <p className="mt-10 text-muted-foreground">{error}</p>}
            {!error && !store && <VaultLoading />}
            {store && <Guard what="This tab" size="tab" reset={tab} close={() => closeTab(activeTab().id)}>
              {isFileTab && <FileView key={filePath} store={store} path={filePath} pane />}
              {(isNewTab || isViewTab) && <PhoneTab key={isViewTab && viewFor(targetOf(tab), disabled)?.def.argState ? targetOf(tab).split("/")[0] : tab} store={store} to={targetOf(tab)} />}
              {active && !isFileTab && <div key={active.id}><Drawn draw={() => DRAW[active.id](store, tab, activeTab())} /></div>}
            </Guard>}
          </main>
          {/* What a finger drags (a file, a page, a panel: core/drag.ts); a computer's is the Workspace's. */}
          <DragGhost info={tabInfo} />
        </div>
      )}

      {/* The sidebars' toggles, fixed over the window's top corners, come after the panes: in the desktop app a drag
          region (index.css: a top bar that's its pane's title row) drawn later than them would swallow their clicks. */}
      {/* (the left one: hidden without a rail, it slides in and out with the sidebar; a click there keeps the sidebar open) */}
      {!popout && (
        <SidebarToggle side="left" open={sidebar} onClick={() => setPrefs({ sidebar: !sidebar })}
          className={hideLeft ? cn("z-50 transition-[translate,color,background-color] duration-200 ease-out", peek !== "left" && "pointer-events-none") : undefined}
          style={hideLeft ? peekRider("left", leftIn, sidebarPx(sidebarWidth)) : undefined} />
      )}
      {desktop && !popout && (
        <SidebarToggle side="right" open={rightOpen} empty={!hasRight}
          onClick={() => (hasRight ? setPrefs({ rightSidebar: !rightSidebar }) : setEmptyRight(!emptyRight))}
          className={!rails && !rightOpen ? cn("z-50 transition-[translate,color,background-color] duration-200 ease-out", peek !== "right" && "pointer-events-none") : undefined}
          style={!rails && !rightOpen ? peekRider("right", peek === "right", sidebarPx(rightSidebarWidth)) : undefined} />
      )}

      <DetailSheet open={!!sheet && !!store} onClose={sheet === "tabs" ? closeSwitcher : closeDetail} path={sheet} depth={depth}
        still={!desktop && sheet === "tabs" && zooms()} own={sheet === "tabs"}
        onBack={canBack ? backDetail : undefined} backLabel={prevTitle.length <= 12 ? prevTitle : "Back"}
        title={sheetDetail?.title ?? ""} wide={sheetDetail?.wide}>
        {sheetDetail && <Guard key={sheet} what="This sheet" size="tab" reset={sheet}>{sheetDetail.body}</Guard>}
      </DetailSheet>

      {(palette === "search" || palette === "launcher") && store && <SearchPalette key={palette} store={store} launcher={palette === "launcher"} onClose={() => setPalette(null)} />}
      {palette === "commands" && <CommandPalette onClose={() => setPalette(null)} />}
      <FolderPicker />
      <Chooser />
      <DownloadingNotice store={store} />
      <IconPicker />
      {/* Over every tab but one drawn edge to edge (a terminal): the plugins' ambient items show whatever is open. */}
      {desktop && !(isViewTab && viewFor(targetOf(tab), disabled)?.def.full) && <StatusBar />}
      {desktop && <KeyHints />}
      {desktop && <Tooltips />}
      {!desktop && <SelectionBar />}
      <ContextMenus />
      <ConfirmDialogs />
      <BundleTrial store={store} />
      <Toaster desktop={desktop} />

      {/* Plugins' background work (Workspaces keeping the tabs and the vault in step), drawn nowhere. */}
      {running}
      {store && <GrantAsker store={store} />}

      {/* Phones: the bar at the bottom (Back, search, a new tab, the tab list, the menu) and the sidebars as drawers. */}
      {!desktop && (
        <PhoneBar system={APP_PAGES} active={active} listOpen={detail === "tabs"}
          onSearch={() => setSearching(true)} onCommands={() => setPalette("commands")} onNewNote={() => void newNote()} />
      )}
      {/* Phones: a page pulled down from its top: New note, Commands, Close tab. */}
      {!desktop && store && <PullActions />}
      {!desktop && store && <PhoneDrawers store={store} file={filePath} tab={targetOf(tab)} vaultName={vaultName} vaultMenu={vaultMenu} />}
    </>
  )
}

/** Once a load: the sandbox is made afresh each time it opens, so nothing written in it lasts. */
let sandboxTold = false
function sandboxNotice() {
  if (sandboxTold) return
  sandboxTold = true
  notify("This is the playground: changes here are lost when it's opened again. Make a vault of your own to keep notes.", { duration: 10000, id: "sandbox",
    ...(desktopApp?.setup ? { action: { label: "Set up my vault", run: () => desktopApp!.setup!() } } : {}) })
}
