// The app's own pages, at the left sidebar's foot (a phone's: its drawer's, and its bar's menu): Plugins and Settings.
// Plugins' tabs (pages/Setup.tsx), #plugins and #get, are on a computer sections of Settings, yet still its own place.
import { Puzzle, Settings, type LucideIcon } from "lucide-react"
import { isDesktop } from "@/core/platform"
import { share } from "@/core/share"
import { findOpen, go, replaceTabTarget } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { desktop } from "@/core/desktop"
import { revealRow, settingsLit } from "@/core/pluginSettings"
import { cell } from "@/core/signal"

const SETUP_TABS = ["plugins", "get"] as const
export type SetupTab = (typeof SETUP_TABS)[number]

export type AppPage = { id: "setup" | "settings"; label: string; icon: LucideIcon; tint: string
  /** Opening it from the keyboard, and what else the palette finds it by. */
  keys?: string[]; words?: string
  /** Its tabs, each its own address (the first is where it opens); else its id is its address. */
  tabs?: readonly string[]
  /** It lays out and scrolls itself in a pane, its root stretched to the pane's box (Workspace's TabContent); else the
   *  pane scrolls it. */
  full?: boolean }

export const APP_PAGES: AppPage[] = share ? [] : [
  { id: "setup", label: "Plugins", icon: Puzzle, tint: "var(--primary)", words: "setup extensions install store get bundles packs", tabs: SETUP_TABS, full: true },
  { id: "settings", label: "Settings", icon: Settings, tint: "var(--muted-foreground)", keys: ["Mod+,"], full: true },
]

/** The page an address shows (`plugins`: the Plugins page), or null: a file, a view. */
export const appPageOf = (to: string) => APP_PAGES.find((p) => (p.tabs ?? [p.id]).includes(to)) ?? null
export const isSetupTab = (to: string): to is SetupTab => (SETUP_TABS as readonly string[]).includes(to)
/** The page the user is on at an address: as appPageOf, but on a computer Settings showing one of Plugins' sections is
 *  Plugins (what the sidebar lights and its tab is named). Read it where useSettingsOwner is. */
export const pageShownAt = (to: string) => {
  const p = appPageOf(to)
  const plugins = p?.id === "settings" && isDesktop() && ownerOf(settingsSection.get()) === "setup"
  return plugins ? APP_PAGES.find((q) => q.id === "setup") ?? p : p
}
export const hrefOf = (p: AppPage) => `#${p.tabs?.[0] ?? p.id}`

const goTo = (to: string, newTab = false) => { if (isDesktop()) go(to, newTab); else location.hash = `#${to}` }

/** Open one of the app's pages (in a new tab: at its first tab). */
export function openAppPage(p: AppPage, newTab = false) {
  if (p.id === "setup" && !newTab) return openSetup()
  // (Settings itself opens on its menu and search, not on a section a narrow pane left open; beside the menu, its own
  // last, never one of Plugins')
  if (p.id === "settings") { settingsSection.set(lastOf.settings); settingsSectionOpen.set(false) }
  goTo(hrefOf(p).slice(1), newTab)
}

/** Open Plugins on `tab`: on a computer, Settings' section (pages/Setup.tsx); on a phone its page, else as a tab already
 *  showing it is (Your plugins if none does). It stays one tab: the one open switches to `tab`. */
export function openSetup(tab?: SetupTab) {
  if (isDesktop()) return openSettings(tab ?? lastOf.setup)
  const open = findOpen(...SETUP_TABS)
  const to = tab ?? (open?.p.to as SetupTab | undefined) ?? "plugins"
  if (open && open.p.to !== to) replaceTabTarget(open.p.id, to)
  goTo(to)
}

/** Which section Settings shows. */
export const settingsSection = cell("appearance")
/** Whose a section is: Plugins' (yours, Get, a plugin's page listed there) or Settings'. */
const ownerOf = (section: string): AppPage["id"] => (isSetupTab(settingsLit(section)) ? "setup" : "settings")
/** Where each was last, kept while the app runs: each button reopens there, not on the other's. */
const lastOf: Record<AppPage["id"], string> = { settings: settingsSection.get(), setup: "plugins" }
settingsSection.subscribe(() => { const s = settingsSection.get(); lastOf[ownerOf(s)] = s })
/** Whose section Settings shows, drawn again only when that changes. */
export const useSettingsOwner = () => settingsSection.use(ownerOf)
/** Where a pane is too narrow for the menu beside it, whether that section takes the menu's place (else the menu). */
export const settingsSectionOpen = cell(false)

/** Show `section` in Settings: beside the menu where the pane is wide, in its place where narrow. */
export function showSettingsSection(section: string) {
  settingsSection.set(section)
  settingsSectionOpen.set(true)
}

/** Open Settings on a section (a phone's: its sheet), and go to the row `selector` finds in it. */
export function openSettings(section: string, selector?: string) {
  showSettingsSection(section)
  if (isDesktop()) goTo("settings")
  else openDetail(`settings-section/${encodeURIComponent(section)}`)
  if (selector) revealRow(selector)
}

/** Settings > Permissions, what macOS lets the app do: null where there's none (a browser, another system, an older
 *  build). The terminal's way there when macOS keeps an agent from the vault. */
export const openPermissions = desktop?.permission ? () => openSettings("permissions") : null
