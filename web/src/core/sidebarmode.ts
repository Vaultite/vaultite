// The left sidebar's mode: one panel alone filling it in place of the stack (Activity's), kept in the workspace. Any
// panel can be one; its plugin's command shows it, and its heading's X (or the command again) brings the panels back.
import { useSyncExternalStore } from "react"
import { isDesktop } from "@/core/platform"
import { peekSidebar } from "@/core/peek"
import { sidebarPanels } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { scopedState, subscribeScoped } from "@/core/scope"

const kept = scopedState<string | null>("core:sidebar-mode", null)

/** The panel the left sidebar shows alone now (its key), or null: its panels. One whose plugin is off doesn't count. */
export function sidebarMode(prefs = getPrefs()): string | null {
  const key = kept.get()
  return typeof key === "string" && sidebarPanels(prefs.disabled).some((p) => p.key === key) ? key : null
}
export const useSidebarMode = () => useSyncExternalStore(subscribeScoped, () => sidebarMode())

/** Show panel `key` alone in the left sidebar, the sidebar open (null: its panels again). */
export function setSidebarMode(key: string | null) {
  kept.set(key ?? undefined)
  if (!key || !isDesktop()) return
  // Hidden without a rail, it slides in for this; folded to the rail, it opens.
  if (!peekSidebar("left") && !getPrefs().sidebar) void setPrefs({ sidebar: true })
}

/** Panel `key` alone in the left sidebar, or the panels again if it is already. */
export const toggleSidebarMode = (key: string) => setSidebarMode(sidebarMode() === key ? null : key)
