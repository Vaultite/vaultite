import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react"
import { AppWindow, Archive, ArchiveRestore, ArchiveX, ArrowLeft, ArrowRight, ArrowRightToLine, ChevronLeft, ChevronRight, ChevronsUpDown, CirclePlay, ClipboardCopy, Columns2, Command as CommandIcon, Copy, CopyX, Eye, EyeOff, FileInput, FilePlus, FileText, FlaskConical, Focus, FolderOpen, Hash, Keyboard, Layers, Link, ListChecks, ListOrdered, ListTree, Moon, Package, PackagePlus, Palette as PaletteIcon, PanelLeft, PanelRight, PanelTop, PencilLine, Pin, Plus, Puzzle, Redo2, RefreshCw, RotateCcw, Rows2, Server, Settings as SettingsIcon, Shapes, Smile, SquareArrowOutUpRight, SquareSplitHorizontal, SquareSplitVertical, Sun, SunMoon, Trash2, Undo2, UnfoldVertical, Vault, X, Zap, type LucideIcon } from "lucide-react"
import { getStore, onState, reload, useStore, type Store } from "@/core/data"
import { newNoteFolder } from "@/core/conventions"
import { runCommandId, typingIn, useCommands } from "@/core/commands"
import { isMac } from "@/core/platform"
import { loadActions } from "@/core/actions"
import { currentEditor } from "@/core/editors"
import { desktop as desktopApp, otherVaults } from "@/core/desktop"
import { phoneApp, takeLinks } from "@/core/phoneapp"
import { createFile, freeName, isProtected, inVault, isReadOnly, openNew, openFile, stem } from "@/core/files"
import { activeTab, askRename, canReopenTab, closeTab, closeTabs, currentFile, cycleTab, fillFirstTab, onWorkspaceChange, followHash, go, hashOf, isDesktop, tabsHere, navigate, newTab, reopenTab, selectTabAt, togglePinTab, toggleStacked, isPopout, popOut, targetOf, useWorkspace } from "@/core/workspace"
import { hasSiblings, moveToSplit, splitTab } from "@/core/splits"
import { hasMainWindow, moveToMain } from "@/core/windows"
import { vaultPath, type Tab } from "@/core/layout"
import { backDetail, closeDetail, openDetail, route, setDetailRedirect, takeScroll } from "@/core/nav"
import { keepScroll, restoreScroll, scrollOf } from "@/core/viewstate"
import { currentWorkspace, noteOpened, subscribeScoped } from "@/core/scope"
import { sayWindowState, setWindowState } from "@/core/live"
import { backgrounds, detailFor, headerItems, homeTab, isEnabled, panelsIn, pluginById, pluginCommands, safeMode, turnPluginsBackOn, usePluginsVersion, useSidebars, viewFor } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { textSizeCommands } from "@/core/textsize"
import { loadVaultPlugins } from "@/core/vaultPlugins"
import { menuBelow, menuFor, type MenuItem } from "@/components/ContextMenu"
import { DetailSheet } from "@/components/DetailSheet"
import { revealInTree } from "@/components/FileTree"
import { panelMenu, RAIL, SidebarPanels, SidebarToggle } from "@/components/Sidebar"
import { FileView } from "@/components/FileView"
import { StatusBar } from "@/components/StatusBar"
import { Catch, Drawn, Guard } from "@/components/Guard"
import { DownloadingNotice, VaultLoading } from "@/components/VaultLoading"
import { KeyHints } from "@/components/KeyHints"
import { preloadEditor } from "@/editor/lazy"
import { Logo, SheetHead } from "@/components/kit"
import { notify, notifyError } from "@/core/notify"
import { PluginPreview } from "@/components/PluginPreview"
import { PluginSettings } from "@/components/PluginSettings"
import { settingsCommands, settingsTitle } from "@/core/pluginSettings"
import { offerBundles, openBundles, previousSetup, restoreSetup } from "@/core/bundles"
import { CommandPalette } from "@/components/CommandPalette"
import { FolderPicker } from "@/components/FolderPicker"
import { Chooser } from "@/components/Chooser"
import { IconPicker, pickIcon } from "@/components/IconPicker"
import { SearchPalette } from "@/components/SearchPalette"
import { Workspace } from "@/components/Workspace"
import { Resizer } from "@/components/Resizer"
import { DragGhost, setPageInfo, useTabInfo, type TabInfo } from "@/components/Tabs"
import { useLingeringSheet, zooms } from "@/core/motion"
import { closeSwitcher } from "@/core/phoneTabs"
import { PhoneTab, TabSwitcher } from "@/components/TabSwitcher"
import { PullActions } from "@/components/PullActions"
import { PhoneBar } from "@/components/PhoneBar"
import { PhoneHeader } from "@/components/PhoneHeader"
import { drawerOut, openDrawer, PhoneDrawers } from "@/components/PhoneDrawer"
import { Tooltips } from "@/components/Tooltip"
import { Toaster } from "@/components/Toast"
import { SelectionBar } from "@/components/SelectionBar"
import { VaultManager, webVaults } from "@/components/VaultManager"
import { ContextMenus } from "@/components/ContextMenu"
import { ConfirmDialogs } from "@/components/ConfirmDialog"
import { canReveal, chooseAction, copyLink, copyPath, copyText, duplicate, remove, revealInFinder } from "@/components/FileActions"
import { cn, space, whenIdle } from "@/lib/utils"
import { canGoSide, goSide } from "@/core/keylist"

// The app's own pages, which few visits open: loaded when they are.
const Plugins = lazy(() => import("@/pages/Plugins").then((m) => ({ default: m.Plugins })))
const Settings = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })))
const SchemeGallery = lazy(() => import("@/components/Appearance").then((m) => ({ default: m.SchemeGallery })))
const HotkeysSheet = lazy(() => import("@/pages/Hotkeys").then((m) => ({ default: m.HotkeysSheet })))
const FontsSheet = lazy(() => import("@/components/Appearance").then((m) => ({ default: m.FontsSheet })))
const PluginSettingsSheet = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.PluginSettingsSheet })))
const BundlesPage = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.Bundles })))
const BundlePreview = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.BundlePreview })))
const SaveBundle = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.SaveBundle })))
const MoreBundles = lazy(() => import("@/pages/Bundles").then((m) => ({ default: m.MoreBundles })))

// The core app's own pages (Plugins, Settings), beside the vault's name at the sidebar's bottom. Every
// other page is a file.
type Page = { id: string; label: string; icon: LucideIcon; tint: string
  /** It draws itself. */
  render: (store: Store) => React.ReactNode }
const SYSTEM_PAGES: Page[] = [
  { id: "plugins", label: "Plugins", icon: Puzzle, tint: "var(--primary)", render: (store) => <Suspense><Plugins store={store} /></Suspense> },
  { id: "settings", label: "Settings", icon: SettingsIcon, tint: "var(--muted-foreground)", render: (store) => <Suspense><Settings store={store} /></Suspense> },
]
/** The app's pages without a button of their own: Bundles (pages/Bundles.tsx), reached from the command "Choose a
 *  bundle…", Settings and Plugins, and opened by itself on a new vault. */
const OTHER_PAGES: Page[] = [
  { id: "bundles", label: "Bundles", icon: Package, tint: "var(--primary)", render: (store) => <Suspense><BundlesPage store={store} /></Suspense> },
]
/** The sidebar: open (its edge drags between these px widths, double-click resets) or an icon rail (RAIL: in spacing
 *  units, so it follows density; `railPx` is what it measures now). */
const SIDEBAR = { min: 200, max: 480, default: 240 }
const railPx = () => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing")) || 0.25) * 16 * RAIL
const sidebarPx = (w: number) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, w || SIDEBAR.default)))
/** The sidebar's edge dragged to x: narrower than halfway between the rail and its narrowest, it's the rail, and it
 *  keeps the width it had when the drag began, so it reopens as it was. */
let dragFrom = SIDEBAR.default
function dragSidebar(x: number) {
  const open = x > (railPx() + SIDEBAR.min) / 2
  if (!open) { if (getPrefs().sidebar) setPrefs({ sidebar: false, sidebarWidth: dragFrom }); return }
  setPrefs({ sidebar: true, sidebarWidth: sidebarPx(x) })
}
/** The right sidebar's edge, the same way from the right. */
function dragRightSidebar(x: number) {
  const w = innerWidth - x
  if (w <= (railPx() + SIDEBAR.min) / 2) { if (getPrefs().rightSidebar) setPrefs({ rightSidebar: false, rightSidebarWidth: dragFrom }); return }
  setPrefs({ rightSidebar: true, rightSidebarWidth: sidebarPx(w) })
}
/** The vault menu (the vault's name at the sidebar's bottom): the other vaults, Manage vaults. */
const manageVaults = () => (desktopApp ? desktopApp.manageVaults() : openDetail("vaults"))
const VAULT_MENU = (): MenuItem[] => [
  ...otherVaults().map((v) => ({ label: `Open ${v.name}`, run: () => { (desktopApp ? desktopApp.openVault(v.path) : webVaults.open(v.path)).catch((e) => notifyError(e, "Couldn't open it")) } })),
  { label: "Manage vaults", sep: !!otherVaults().length, run: () => { manageVaults() } },
  ...(desktopApp?.openSandbox ? [{ label: "Open the sandbox", run: () => { desktopApp!.openSandbox!() } }] : []), // a made-up vault to try things in
  ...(phoneApp ? [{ label: "Switch server…", run: () => { phoneApp!.launcher() } }] : []), // the iPhone app's servers
]

/** A sheet's body and title (detail_): a plugin's `title` or `file` that throws is a sheet saying so (the Guard around
 *  its body), not the app stopped, as it's called while App draws. */
function sheet_(...a: Parameters<typeof detail_>): ReturnType<typeof detail_> {
  try { return detail_(...a) } catch (e) { return { body: <Drawn draw={() => { throw e }} />, title: "" } }
}

/** The detail sheet for a path: a plugin's (person/…, log/…), or the core's plugin sheet (plugin/<id>). */
function detail_(store: Store, path: string, disabled: string[], tabInfo: (t: Tab) => TabInfo): { body: React.ReactNode; title: string } {
  const [kind, id] = path.split("/")
  if (kind === "file") {
    const p = decodeURIComponent(id ?? "")
    return { body: <FileView store={store} path={p} pane={false} />, title: stem(p) }
  }
  if (kind === "tabs") return { body: <TabSwitcher store={store} info={tabInfo} />, title: "Tabs" } // the phone's tab list
  if (kind === "vaults") { // Manage vaults, on the web (the desktop app has its own window)
    return { body: <><SheetHead icon={Logo} tint="var(--primary)" kicker="Vaultite" title="Vaults" /><VaultManager backend={webVaults} /></>, title: "Vaults" }
  }
  if (kind === "schemes") return { body: <Suspense><SchemeGallery /></Suspense>, title: "Colour schemes" } // the command "Change colour scheme"
  if (kind === "fonts") return { body: <Suspense><FontsSheet /></Suspense>, title: "Fonts" } // Settings' Fonts row
  if (kind === "plugin-settings" && !id) return { body: <Suspense><PluginSettingsSheet store={store} /></Suspense>, title: "Plugin settings" } // Settings' Plugin settings row
  if (kind === "hotkeys") return { body: <Suspense><HotkeysSheet /></Suspense>, title: "Hotkeys" } // Settings' Hotkeys row, the command "Open hotkeys"
  if (kind === "bundle" && id) return { body: <Suspense><BundlePreview id={decodeURIComponent(id)} /></Suspense>, title: "Bundle" } // a bundle's preview (pages/Bundles.tsx)
  if (kind === "bundles-more") return { body: <Suspense><MoreBundles /></Suspense>, title: "More bundles" } // the Bundles page's More…
  if (kind === "bundle-save") return { body: <Suspense><SaveBundle /></Suspense>, title: "Save current setup" }
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
  if (d && title) return { body: <Guard what="This sheet" size="tab" reset={path}><Drawn draw={() => d.def.render(store, d.args)} /></Guard>, title }
  return { body: <SheetHead icon={ListChecks} tint="var(--muted-foreground)" kicker="Not found" title="This entry isn't loaded" />, title: "" }
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

/** md and up: the sidebar (with the file tree) and tabs. */
function useDesktop() {
  const [d, setD] = useState(isDesktop)
  useEffect(() => {
    const m = matchMedia("(min-width: 768px)"), on = () => setD(m.matches)
    m.addEventListener("change", on)
    return () => m.removeEventListener("change", on)
  }, [])
  return d
}

// The vault's own plugins load with each state, before it's drawn.
onState(loadVaultPlugins)

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
  const { sidebar, sidebarWidth, rightSidebar, rightSidebarWidth, disabled, enabled, order } = usePrefs()
  const pages = [...SYSTEM_PAGES, ...OTHER_PAGES]
  // Where a device starts (a plugin's `home`: Pinned's first page), else a new tab.
  const home = store ? homeTab(store, disabled, order) : null
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
    if (store && offerBundles()) { openBundles(); return }
    if (home) fillFirstTab(home)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  // No address, or on a phone one it can't show: where the app starts (home, else a new tab).
  useEffect(() => {
    if (!store) return
    // The address moved on since this was drawn (a workspace's tabs put in place meanwhile): the next draw sees to it.
    if (route().tab !== tab) return
    if (isFileTab || isViewTab || isNewTab || pages.some((p) => p.id === tab)) return
    const to = !tab || (!desktop && !detail) ? (home ? hashOf(home) : desktop ? null : "new") : null
    if (!to) return
    history.replaceState(history.state, "", `#${to}${detail ? `/${detail}` : ""}`)
    dispatchEvent(new HashChangeEvent("hashchange"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, tab])
  useWorkspace() // re-render when tabs change
  // The address shows the focused group's active tab; when it changes by itself (back, a link, a page picked in
  // the phone's drawer), the tab follows. Phones use the same tabs, shown one at a time (components/TabSwitcher.tsx).
  const known = isFileTab || isViewTab || isNewTab || pages.some((p) => p.id === tab)
  useEffect(() => {
    if (known) followHash(tab)
    else if (desktop && !detail && store) { history.replaceState(null, "", `#${hashOf(activeTab().to)}`); dispatchEvent(new HashChangeEvent("hashchange")) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desktop, known, !!store])
  useEffect(() => takeLinks({ command: runCommandId, open: (p) => { const s = getStore(); if (!s?.files.files.some((f) => f.path === p)) return false; openFile(p); return true } }), [])
  // First load with no address: show the tab that was open last time.
  useEffect(() => {
    if (!location.hash) { history.replaceState(null, "", `#${hashOf(activeTab().to)}`); dispatchEvent(new HashChangeEvent("hashchange")) }
  }, [])
  const filePath = isFileTab ? targetOf(tab).slice(5) : ""
  const active = pages.find((t) => t.id === tab) ?? null
  // A file's sheet in the address (#<tab>/file/…, a phone's): on desktop, the file's tab.
  useEffect(() => {
    if (!desktop || !store || !detail) return
    const [kind, arg] = detail.split("/")
    if (kind !== "file") return
    let f: string | null = null
    try { f = decodeURIComponent(arg ?? "") } catch { f = null }
    if (f) { history.replaceState(null, "", `#${hashOf(activeTab().to)}`); go(`file:${f}`, false, false) }
  }, [desktop, store, detail])
  const pageInfo = (id: string) => { const p = pages.find((x) => x.id === hashOf(id)); return p ? { label: p.label, icon: p.icon, tint: p.tint } : null }
  const tabInfo = useTabInfo(store, pageInfo)
  setPageInfo(pageInfo)
  // Back when this sheet was opened from another sheet.
  const canBack = !!prev
  const prevTitle = canBack && store ? sheet_(store, prev, disabled, tabInfo).title : ""
  // The quick switcher (⌘O) or the command palette (⌘P); their commands are below.
  const [palette, setPalette] = useState<"search" | "commands" | null>(null)
  const setSearching = (on: boolean) => setPalette(on ? "search" : null)
  // The vault's name at the bottom of the sidebar: a menu of vault-wide things (VAULT_MENU).
  const vaultName = store ? (store.vault.path.split("/").filter(Boolean).pop() ?? "Vault") : "Vault"
  const vaultMenu = (e: React.MouseEvent) => menuBelow(e, VAULT_MENU())
  const newNote = async () => {
    const s = getStore()
    if (!s) return
    const folder = newNoteFolder(s, tabFile())
    const f = await createFile(folder, freeName(s.files, folder, "Untitled"))
    openNew(f.path)
  }
  // The app's commands (⌘P lists them; their keys work everywhere). File commands act on the active tab's file (in the
  // vault: not one from outside it, "file:/…").
  // The file the user means: the editor's (a sheet's over the page too), else the focused tab's.
  const actionTarget = () => currentEditor()?.path ?? currentFile()
  const tabFile = () => (isDesktop() ? currentFile() : "")
  // A tab's vault file that isn't there any more (deleted from outside the app: its tab isn't reopened).
  const fileGone = (to: string) => {
    const s = getStore(), p = vaultPath(to)
    return !!s && p !== null && !inVault(s, p)
  }
  const besideText = () => {
    const a = document.activeElement, ed = currentEditor()
    // (the editor itself, for the phone's keys; nothing focused, something in the file's view, or what holds it: a sheet)
    return !!ed?.undo && (a === ed.view.contentDOM || !typingIn(a) && (!a || a.contains(ed.view.dom) || !!a.closest(".file-view")?.contains(ed.view.dom)))
  }
  const pageKey = pages.map((p) => `${p.id}:${p.label}`).join("|")
  useCommands(() => [
    // (`label` and `icon`: as a blank tab's buttons, core/newtab.ts' default ones.)
    { id: "switcher:open", name: "Open quick switcher", keys: ["Mod+O"], run: () => setPalette((p) => (p === "search" ? null : "search")), label: "Open a file", icon: FileText },
    { id: "palette:open", name: "Open command palette", keys: ["Mod+P"], run: () => setPalette((p) => (p === "commands" ? null : "commands")), icon: CommandIcon },
    { id: "icon:search", name: "Search icons", run: () => pickIcon({ title: "Search icons", onPick: (n) => copyText(n).then(() => notify(`Copied ${n}: use it as an icon:`, { id: "copied" }), notifyError) }), icon: Smile },
    // ⌘N, ⌘T, ⌘W are the browser's: the desktop app has them (its menu), the web gets another key or none.
    { id: "file:new", name: "Create new note", keys: desktopApp ? ["Mod+N"] : ["Mod+Alt+N"], run: () => newNote(), label: "New note", icon: FilePlus },
    // On a phone the sidebars are drawers (components/PhoneDrawer.tsx).
    { id: "sidebar:toggle", name: "Toggle left sidebar", keys: ["Mod+\\"],
      run: () => (isDesktop() ? setPrefs({ sidebar: !getPrefs().sidebar }) : openDrawer(drawerOut() === "left" ? null : "left")), icon: PanelLeft },
    { id: "sidebar:toggle-right", name: "Toggle right sidebar", keys: ["Mod+Shift+\\"],
      run: () => { if (isDesktop()) document.querySelector<HTMLElement>("[data-sidebar-toggle=right]")?.click(); else openDrawer(drawerOut() === "right" ? null : "right") }, icon: PanelRight },
    { id: "tab:new", name: "Open new tab", keys: desktopApp ? ["Mod+T"] : undefined, when: isDesktop, run: () => newTab(), icon: Plus },
    { id: "split:right", name: "Split right", keys: ["Mod+Alt+\\"], when: isDesktop, run: () => splitTab("right"), icon: Columns2 },
    { id: "split:down", name: "Split down", when: isDesktop, run: () => splitTab("bottom"), icon: Rows2 },
    { id: "split:move-right", name: "Move current tab to new split right", when: () => isDesktop() && hasSiblings(activeTab().id), run: () => moveToSplit("right"), icon: SquareSplitHorizontal },
    { id: "split:move-down", name: "Move current tab to new split down", when: () => isDesktop() && hasSiblings(activeTab().id), run: () => moveToSplit("bottom"), icon: SquareSplitVertical },
    ...([["left", "to the left"], ["right", "to the right"], ["top", "above"], ["bottom", "below"]] as const).map(([side, where]) => (
      // Past the last pane on a side: into that side's sidebar, and from a sidebar back to the pane (core/keylist.ts).
      { id: `split:focus-${side}`, name: `Focus on the pane ${where}`, when: () => isDesktop() && canGoSide(side), run: () => goSide(side), icon: Focus })),
    // Off a Mac, ⌃⌥← switches workspaces (GNOME, Xfce): ⌥← there, as browsers have it.
    { id: "nav:back", name: "Navigate back", keys: [isMac ? "Mod+Alt+ArrowLeft" : "Alt+ArrowLeft"], when: isDesktop, run: () => navigate(-1), icon: ArrowLeft },
    { id: "nav:forward", name: "Navigate forward", keys: [isMac ? "Mod+Alt+ArrowRight" : "Alt+ArrowRight"], when: isDesktop, run: () => navigate(1), icon: ArrowRight },
    // (A pinned tab stays open: closed from its menu, or unpinned first.)
    { id: "tab:close", name: "Close current tab", keys: desktopApp ? ["Mod+W"] : undefined, when: isDesktop, run: () => { if (!activeTab().pinned) closeTab(activeTab().id) }, icon: X },
    { id: "tab:toggle-pin", name: "Toggle pin", when: isDesktop, run: () => togglePinTab(activeTab().id), icon: Pin },
    { id: "tab:toggle-stacked", name: "Toggle stacked tabs", when: isDesktop, run: () => toggleStacked(), icon: Layers },
    // A window of its own (a pop-out): no sidebars, its own tabs.
    { id: "tab:move-to-window", name: "Move current tab to new window", when: () => isDesktop() && activeTab().to !== "new", run: () => popOut(activeTab().id, true), icon: AppWindow },
    { id: "tab:move-to-main", name: "Move current tab to main window", when: hasMainWindow, run: () => moveToMain([activeTab().id]), icon: AppWindow },
    { id: "tab:open-in-window", name: "Open current tab in new window", when: () => isDesktop() && activeTab().to !== "new", run: () => popOut(activeTab().id), icon: SquareArrowOutUpRight },
    // ⌘1–⌘8 the nth tab of the pane, ⌘9 its last, like a browser's (the browser's own keys: the desktop app has them).
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `tab:goto-${n}`, name: `Go to tab #${n}`, keys: desktopApp ? [`Mod+${n}`] : undefined,
      when: () => isDesktop() && tabsHere() >= n, run: () => selectTabAt(n), icon: Hash })),
    { id: "tab:goto-last", name: "Go to last tab", keys: desktopApp ? ["Mod+9"] : undefined, when: isDesktop, run: () => selectTabAt(-1), icon: ArrowRightToLine },
    // (⌘⇧T is the browser's too.)
    { id: "tab:reopen", name: "Reopen closed tab", keys: desktopApp ? ["Mod+Shift+T"] : undefined, when: () => isDesktop() && canReopenTab(), run: () => reopenTab(fileGone), icon: RotateCcw },
    { id: "tab:close-others", name: "Close all other tabs", when: isDesktop, run: () => closeTabs("others", activeTab().id), icon: CopyX },
    // (⌃Tab is the browser's: the desktop app has it, the web none by default.)
    { id: "tab:next", name: "Go to next tab", keys: desktopApp ? ["Ctrl+Tab"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => cycleTab(1), icon: ChevronRight },
    { id: "tab:previous", name: "Go to previous tab", keys: desktopApp ? ["Ctrl+Shift+Tab"] : undefined, when: () => isDesktop() && tabsHere() > 1, run: () => cycleTab(-1), icon: ChevronLeft },
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
      ...(isMac ? {} : { name: "Show current file in folder" }) },
    ...SYSTEM_PAGES.map((p) => ({ id: `page:${p.id}`, name: `Open ${p.label}`,
      run: () => { if (isDesktop()) go(targetOf(p.id)); else location.hash = `#${p.id}` }, icon: p.icon })),
    // Bundles (core/bundles.ts): setups of the app to start from, save and share.
    { id: "bundles:choose", name: "Choose a bundle…", run: openBundles, icon: Package },
    { id: "bundles:save", name: "Save current setup as a bundle…", run: () => openDetail("bundle-save"), icon: PackagePlus },
    { id: "bundles:restore", name: "Restore previous setup", when: () => !!previousSetup(), run: () => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it")), icon: ArchiveRestore },
    { id: "theme:light", name: "Use light theme", when: () => getPrefs().theme !== "light", run: () => setPrefs({ theme: "light" }), icon: Sun },
    { id: "theme:dark", name: "Use dark theme", when: () => getPrefs().theme !== "dark", run: () => setPrefs({ theme: "dark" }), icon: Moon },
    { id: "theme:system", name: "Use the system's light or dark theme", when: () => getPrefs().theme !== "system", run: () => setPrefs({ theme: "system" }), icon: SunMoon },
    { id: "scheme:gruvbox", name: "Use Gruvbox colours (the default)", when: () => getPrefs().scheme !== "gruvbox", run: () => setPrefs({ scheme: "gruvbox" }), icon: PaletteIcon },
    { id: "scheme:default", name: "Use Classic colours", when: () => getPrefs().scheme !== "default", run: () => setPrefs({ scheme: "default" }), icon: PaletteIcon },
    { id: "scheme:choose", name: "Change colour scheme", run: () => openDetail("schemes"), icon: PaletteIcon },
    { id: "hotkeys:open", name: "Open hotkeys", run: () => openDetail("hotkeys"), icon: Keyboard },
    { id: "density:toggle", name: "Toggle comfortable density", run: () => setPrefs({ density: getPrefs().density === "comfortable" ? "compact" : "comfortable" }), icon: UnfoldVertical },
    { id: "editor:toggle-line-numbers", name: "Toggle line numbers", run: () => setPrefs({ lineNumbers: !getPrefs().lineNumbers }), icon: ListOrdered },
    { id: "file-icons:toggle", name: "Toggle file icons", run: () => setPrefs({ fileIcons: !getPrefs().fileIcons }), icon: Shapes },
    { id: "tab-bar:toggle", name: "Toggle tab bar", run: () => setPrefs({ tabBar: !getPrefs().tabBar }), icon: PanelTop },
    // The note's history while the keyboard is beside its text, not in it (a property just removed, a chip clicked).
    { id: "editor:undo", name: "Undo", keys: ["Mod+Z"], when: besideText, run: () => currentEditor()?.undo?.(), icon: Undo2 },
    { id: "editor:redo", name: "Redo", keys: ["Mod+Shift+Z"], when: besideText, run: () => currentEditor()?.redo?.(), icon: Redo2 },
    { id: "files:show-hidden", name: "Show hidden files", when: () => !getPrefs().showHidden, run: () => setPrefs({ showHidden: true }).then(reload), icon: Eye },
    { id: "files:hide-hidden", name: "Hide hidden files", when: () => getPrefs().showHidden, run: () => setPrefs({ showHidden: false }).then(reload), icon: EyeOff },
    { id: "files:show-archived", name: "Show archived files", when: () => !getPrefs().showArchived, run: () => setPrefs({ showArchived: true }), icon: Archive },
    { id: "files:hide-archived", name: "Hide archived files", when: () => getPrefs().showArchived, run: () => setPrefs({ showArchived: false }), icon: ArchiveX },
    { id: "vault:reload", name: "Reload the vault", run: () => reload(), icon: RefreshCw },
    { id: "vault:manage", name: "Manage vaults", run: manageVaults, icon: Vault },
    { id: "vault:sandbox", name: "Open the sandbox vault", when: () => !!desktopApp?.openSandbox, run: () => desktopApp?.openSandbox?.(), icon: FlaskConical },
    { id: "app:setup", name: "Set up Vaultite", when: () => !!desktopApp?.setup, run: () => desktopApp?.setup?.(), icon: CirclePlay },
    { id: "app:switch-server", name: "Switch server…", when: () => !!phoneApp, run: () => phoneApp?.launcher(), icon: Server },
    { id: "file:open-outside", name: "Open file from outside the vault…", when: () => !!desktopApp, run: () => desktopApp?.pickOutside(), icon: FileInput },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pageKey, !!store])
  // Plugins' own commands (Open terminal...), while they're on (an opt-in one's too: `enabled`), and again when the
  // vault's plugins arrive or change.
  const pluginsVersion = usePluginsVersion()
  useCommands(() => pluginCommands(disabled), [disabled.join(), enabled.join(), pluginsVersion])
  // "Open <Name> settings": each plugin's settings sheet, while it's on and has some (core/pluginSettings.ts).
  useCommands(settingsCommands, [disabled.join(), enabled.join(), pluginsVersion])
  // Text sizes: notes' and the plugins' kinds (the Terminal's), apart from the app's zoom (core/textsize.ts).
  useCommands(() => textSizeCommands(disabled, order), [disabled.join(), enabled.join(), order.join()])
  // A pop-out window (core/workspace.ts POPOUT) has no sidebars: its tabs fill it.
  const popout = isPopout()
  const side = popout ? "0px" : sidebar ? `${sidebarPx(sidebarWidth)}px` : space(RAIL)
  const header = headerItems(disabled, order)
  // The right sidebar is there while
  // panels are in it; with none it takes no room, only its dimmed toggle (a click opens it empty to drop panels in).
  const rightCount = panelsIn("right", useSidebars(), disabled, order).length
  const [emptyRight, setEmptyRight] = useState(false)
  const hasRight = rightCount > 0
  useEffect(() => { if (hasRight) setEmptyRight(false) }, [hasRight])
  const rightOpen = hasRight ? rightSidebar : emptyRight
  const showRight = !popout && (hasRight || emptyRight)
  const rside = showRight ? (rightOpen ? `${sidebarPx(rightSidebarWidth)}px` : space(RAIL)) : "0px"
  // What's fixed to the window's right edge (the status bar) keeps clear of it.
  useEffect(() => { document.documentElement.style.setProperty("--right-sidebar", desktop ? rside : "0px") }, [rside, desktop])

  return (
    <>
      {/* Desktop: the sidebar. Folded, it's an icon rail where only the width changes, so every icon stays put (RAIL in
          Sidebar.tsx, all offsets in spacing units). Right-click it to pick which panels show. */}
      {!popout && <>
      <aside data-side="left" data-collapsed={!sidebar || undefined} onContextMenu={menuFor(panelMenu)}
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden flex-col overflow-hidden border-r-[0.5px] border-border bg-sidebar pr-[calc(--spacing(2)-0.5px)] pl-2 pt-[env(safe-area-inset-top)] pb-2",
          "transition-[width] duration-200 ease-out md:flex",
        )} style={{ width: side }}>
        {/* As tall as the tab bar: right of the toggle, plugins' `header` items (Workspaces' switcher); a container, so
            an item fits itself to the room the traffic lights leave. */}
        <div data-titlebar className={cn("@container flex h-10 shrink-0 items-center justify-end gap-1 pl-7.5 whitespace-nowrap transition-opacity duration-200", !sidebar && "pointer-events-none opacity-0")}>
          {store && desktop && sidebar && header.map(({ key, item }) => (
            <div key={key} data-header-item={key} className="flex min-w-0 shrink-0 items-center"><Guard what="This item"><Drawn draw={() => item.render({ store, open: true, file: filePath, tab: targetOf(tab) })} /></Guard></div>
          ))}
        </div>
        {/* The plugins' panels; as a rail, the header's items go first, under the toggle. Phones draw them in drawers
            (PhoneDrawer.tsx). */}
        <div className="flex min-h-0 flex-1 flex-col">
          {store && desktop && <SidebarPanels store={store} open={sidebar} file={filePath} tab={targetOf(tab)}
            head={!sidebar && header.length ? header.map(({ key, item }) => (
              <div key={key} data-header-item={key} className="flex"><Guard what="This item"><Drawn draw={() => item.render({ store, open: false, file: filePath, tab: targetOf(tab) })} /></Guard></div>
            )) : undefined} />}
        </div>
        {/* The vault's profile: the vault's name (a menu), then Plugins and Settings as buttons. As a rail,
            the two buttons stack, in line with the icons above. */}
        <nav aria-label="App" className={cn("-mx-2 -mb-2 flex shrink-0 gap-1 border-t-[0.5px] border-border p-2", !sidebar && "flex-col items-start")}>
          {sidebar && (
            <button type="button" onClick={vaultMenu} aria-haspopup="menu"
              className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] font-medium whitespace-nowrap hover:bg-foreground/[0.06]">
              <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
              <span className="min-w-0 truncate">{vaultName}</span>
            </button>
          )}
          {SYSTEM_PAGES.map((t) => (
            <a key={t.id} href={`#${t.id}`} aria-label={t.label} data-tip={t.label} data-tip-side={sidebar ? "top" : "right"}
              onClick={(e) => { if (!desktop) return; e.preventDefault(); go(targetOf(t.id), e.metaKey || e.ctrlKey) }}
              className={cn("grid size-7 shrink-0 place-items-center rounded-[5px] transition-colors",
                t.id === active?.id ? "bg-foreground/[0.08] text-primary" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground")}>
              <t.icon className="size-4" strokeWidth={2} />
            </a>
          ))}
        </nav>
      </aside>
      {/* Its edge (the splits' Resizer): dragged past half its narrowest it folds to the rail, keeping its width, and
          out again it opens, in one drag. */}
      <Resizer label="Resize the sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().sidebarWidth) }} onDrag={dragSidebar} onReset={() => setPrefs({ sidebar: true, sidebarWidth: SIDEBAR.default })}
        className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ left: `calc(${side} - 4px)` }} />
      <SidebarToggle side="left" open={sidebar} onClick={() => setPrefs({ sidebar: !sidebar })} />
      </>}

      {showRight && (
        <aside data-side="right" data-collapsed={!rightOpen || undefined} onContextMenu={menuFor(() => panelMenu(undefined, "right"))}
          className={cn(
            "fixed inset-y-0 right-0 z-20 hidden flex-col overflow-hidden border-l-[0.5px] border-border bg-sidebar pr-2 pl-[calc(--spacing(2)-0.5px)] pt-[env(safe-area-inset-top)] pb-2",
            "transition-[width] duration-200 ease-out md:flex",
          )} style={{ width: rside }}>
          {/* As tall as the tab bar, with the toggle (fixed, below) at its right end. */}
          <div data-titlebar className="h-10 shrink-0" />
          <div className="relative flex min-h-0 flex-1 flex-col">
            {store && desktop && <SidebarPanels side="right" store={store} open={rightOpen} file={filePath} tab={targetOf(tab)} />}
          </div>
        </aside>
      )}
      {showRight && rightOpen && (
        <Resizer label="Resize the right sidebar" onStart={() => { dragFrom = sidebarPx(getPrefs().rightSidebarWidth) }} onDrag={dragRightSidebar}
          onReset={() => setPrefs({ rightSidebar: true, rightSidebarWidth: 280 })}
          className="fixed inset-y-0 z-30 hidden w-[7px] md:block" style={{ right: `calc(${rside} - 4px)` }} />
      )}
      {desktop && !popout && (
        <SidebarToggle side="right" open={rightOpen} empty={!hasRight}
          onClick={() => (hasRight ? setPrefs({ rightSidebar: !rightSidebar }) : setEmptyRight(!emptyRight))} />
      )}

      {desktop ? (
        <Workspace store={store} error={error} left={side} right={rside} pageInfo={pageInfo} page={(to) => pages.find((p) => p.id === to) ?? null} />
      ) : (
        // Phones: the window scrolls, under the header (its name, the drawer's button, the … menu); one tab at a time,
        // the active one (the tab list has the others; files open in tabs, as on a computer: core/files.ts, openFile).
        <div id="main-scroll" className="overflow-x-clip">
          {store && <PhoneHeader title={tabInfo(activeTab()).label} tab={activeTab()} />}
          <main className="pb-safe mx-auto max-w-5xl px-4 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
            {error && !store && <p className="mt-10 text-muted-foreground">Couldn't reach the server: {error}</p>}
            {!error && !store && <VaultLoading />}
            {store && <Guard what="This tab" size="tab" reset={tab} close={() => closeTab(activeTab().id)}>
              {isFileTab && <FileView key={filePath} store={store} path={filePath} pane />}
              {(isNewTab || isViewTab) && <PhoneTab key={isViewTab && viewFor(targetOf(tab), disabled)?.def.argState ? targetOf(tab).split("/")[0] : tab} store={store} to={targetOf(tab)} />}
              {active && !isFileTab && <div key={active.id}><Drawn draw={() => active.render!(store)} /></div>}
            </Guard>}
          </main>
          {/* What a finger drags (a file, a page, a panel: core/drag.ts); a computer's is the Workspace's. */}
          <DragGhost info={tabInfo} />
        </div>
      )}

      <DetailSheet open={!!sheet && !!store} onClose={sheet === "tabs" ? closeSwitcher : closeDetail} path={sheet} depth={depth}
        still={!desktop && sheet === "tabs" && zooms()} own={sheet === "tabs"}
        onBack={canBack ? backDetail : undefined} backLabel={prevTitle.length <= 12 ? prevTitle : "Back"}
        title={store && sheet ? sheet_(store, sheet, disabled, tabInfo).title : ""}>
        {store && sheet && <Guard key={sheet} what="This sheet" size="tab" reset={sheet}>{sheet_(store, sheet, disabled, tabInfo).body}</Guard>}
      </DetailSheet>

      {palette === "search" && store && <SearchPalette store={store} onClose={() => setPalette(null)} />}
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
      <Toaster desktop={desktop} />

      {/* Plugins' background work (Workspaces keeping the tabs and the vault in step), drawn nowhere; one that throws
          stops alone (its error goes to Errors), not the app on every load. */}
      {store && backgrounds(disabled, order).map(({ key, Run }) => <Catch key={key} fallback={() => null}><Run store={store} /></Catch>)}

      {/* Phones: the bar at the bottom (Back, search, a new tab, the tab list, the menu) and the sidebars as drawers. */}
      {!desktop && (
        <PhoneBar system={SYSTEM_PAGES} active={active} listOpen={detail === "tabs"}
          onSearch={() => setSearching(true)} onCommands={() => setPalette("commands")} onNewNote={newNote} />
      )}
      {/* Phones: a page pulled down from its top: New note, Commands, Close tab. */}
      {!desktop && store && <PullActions run={(w) => (w === "new" ? void newNote() : w === "commands" ? setPalette("commands") : closeTab(activeTab().id))} />}
      {!desktop && store && <PhoneDrawers store={store} file={filePath} tab={targetOf(tab)} vaultName={vaultName} vaultMenu={vaultMenu} />}
    </>
  )
}

/** Once a load: the sandbox is made afresh each time it opens, so nothing written in it lasts. */
let sandboxTold = false
function sandboxNotice() {
  if (sandboxTold) return
  sandboxTold = true
  notify("This is the sandbox: changes here are lost when it's opened again. Make a vault of your own to keep notes.", { duration: 10000, id: "sandbox",
    ...(desktopApp?.setup ? { action: { label: "Set up my vault", run: () => desktopApp!.setup!() } } : {}) })
}
