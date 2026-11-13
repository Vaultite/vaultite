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
  keys?: string[]; words?: string
  tabs?: readonly string[]
  full?: boolean }

export const APP_PAGES: AppPage[] = share ? [] : [
  { id: "setup", label: "Plugins", icon: Puzzle, tint: "var(--primary)", words: "setup extensions install store get bundles packs", tabs: SETUP_TABS, full: true },
  { id: "settings", label: "Settings", icon: Settings, tint: "var(--muted-foreground)", keys: ["Mod+,"], full: true },
]

export const appPageOf = (to: string) => APP_PAGES.find((p) => (p.tabs ?? [p.id]).includes(to)) ?? null
export const isSetupTab = (to: string): to is SetupTab => SETUP_TABS.some((t) => t === to)
export const pageShownAt = (to: string) => {
  const p = appPageOf(to)
  const plugins = p?.id === "settings" && isDesktop() && ownerOf(settingsSection.get()) === "setup"
  return plugins ? APP_PAGES.find((q) => q.id === "setup") ?? p : p
}
export const hrefOf = (p: AppPage) => `#${p.tabs?.[0] ?? p.id}`

const goTo = (to: string, newTab = false) => { if (isDesktop()) go(to, newTab); else location.hash = `#${to}` }

export function openAppPage(p: AppPage, newTab = false) {
  if (p.id === "setup" && !newTab) return openSetup()
  if (p.id === "settings") { settingsSection.set(lastOf.settings); settingsSectionOpen.set(false) }
  goTo(hrefOf(p).slice(1), newTab)
}

export function openSetup(tab?: SetupTab) {
  if (isDesktop()) return openSettings(tab ?? lastOf.setup)
  const open = findOpen(...SETUP_TABS)
  const to = tab ?? (open && isSetupTab(open.p.to) ? open.p.to : undefined) ?? "plugins"
  if (open && open.p.to !== to) replaceTabTarget(open.p.id, to)
  goTo(to)
}

export const settingsSection = cell("appearance")
const ownerOf = (section: string): AppPage["id"] => (isSetupTab(settingsLit(section)) ? "setup" : "settings")
const lastOf: Record<AppPage["id"], string> = { settings: settingsSection.get(), setup: "plugins" }
settingsSection.subscribe(() => { const s = settingsSection.get(); lastOf[ownerOf(s)] = s })
export const useSettingsOwner = () => settingsSection.use(ownerOf)
export const settingsSectionOpen = cell(false)

export function showSettingsSection(section: string) {
  settingsSection.set(section)
  settingsSectionOpen.set(true)
}

export function openSettings(section: string, selector?: string) {
  showSettingsSection(section)
  if (isDesktop()) goTo("settings")
  else openDetail(`settings-section/${encodeURIComponent(section)}`)
  if (selector) revealRow(selector)
}

/** Settings > Permissions, what macOS lets the app do: null where there's none (a browser, another system, an older
 *  build). The terminal's way there when macOS keeps an agent from the vault. */
export const openPermissions = desktop?.permission ? () => openSettings("permissions") : null
