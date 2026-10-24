// The app's own pages, at the left sidebar's foot (a phone's: its drawer's, and its bar's menu): Setup and Settings.
// Every other page is a file. Setup's tabs (pages/Setup.tsx) are each an address of their own: #bundles, #plugins.
import { Blocks, Settings, type LucideIcon } from "lucide-react"
import { isDesktop } from "@/core/platform"
import { share } from "@/core/share"
import { findOpen, go, replaceTabTarget } from "@/core/workspace"

export const SETUP_TABS = ["bundles", "plugins"] as const
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
  { id: "setup", label: "Setup", icon: Blocks, tint: "var(--primary)", words: "bundles plugins extensions", tabs: SETUP_TABS },
  { id: "settings", label: "Settings", icon: Settings, tint: "var(--muted-foreground)", keys: ["Mod+,"], full: true },
]

/** The page an address shows (`plugins`: Setup), or null: a file, a view. */
export const appPageOf = (to: string) => APP_PAGES.find((p) => (p.tabs ?? [p.id]).includes(to)) ?? null
export const isSetupTab = (to: string): to is SetupTab => (SETUP_TABS as readonly string[]).includes(to)
export const hrefOf = (p: AppPage) => `#${p.tabs?.[0] ?? p.id}`

const goTo = (to: string, newTab = false) => { if (isDesktop()) go(to, newTab); else location.hash = `#${to}` }

/** Open one of the app's pages (in a new tab: at its first tab). */
export function openAppPage(p: AppPage, newTab = false) {
  if (p.id === "setup" && !newTab) openSetup()
  else goTo(hrefOf(p).slice(1), newTab)
}

/** Open Setup on `tab`, else as a tab already showing it is (Bundles if none does). Setup stays one tab: the one open
 *  switches to `tab`. */
export function openSetup(tab?: SetupTab) {
  const open = findOpen(...SETUP_TABS)
  const to = tab ?? (open?.t.to as SetupTab | undefined) ?? "bundles"
  if (open && open.t.to !== to) replaceTabTarget(open.t.id, to)
  goTo(to)
}
