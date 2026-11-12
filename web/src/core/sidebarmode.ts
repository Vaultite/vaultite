import { useSyncExternalStore } from "react"
import { isDesktop } from "@/core/platform"
import { peekSidebar } from "@/core/peek"
import { revealPanel, sideOf, sidebarPanels } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { scopedState, subscribeScoped } from "@/core/scope"

const kept = scopedState<string | null>("core:sidebar-mode", null)

/** The panel the left sidebar shows alone now (its key), or null: its panels. One whose plugin is off doesn't count. */
export function sidebarMode(prefs = getPrefs()): string | null {
  const key = kept.get()
  return typeof key === "string" && sidebarPanels(prefs.disabled).some((p) => p.key === key) ? key : null
}
export const useSidebarMode = () => useSyncExternalStore(subscribeScoped, () => sidebarMode())

let switchedAt = -Infinity
export const modeJustSwitched = () => performance.now() - switchedAt < 150

/** Show panel `key` alone in the left sidebar, the sidebar open (null: its panels again). */
export function setSidebarMode(key: string | null) {
  if (key !== sidebarMode()) switchedAt = performance.now()
  kept.set(key ?? undefined)
  if (!key || !isDesktop()) return
  if (!peekSidebar("left") && !getPrefs().sidebar) void setPrefs({ sidebar: true })
}

/** Panel `key` alone in the left sidebar, or the panels again if it is already. */
export const toggleSidebarMode = (key: string) => setSidebarMode(sidebarMode() === key ? null : key)

/** Bring panel `key` into sight (revealPanel), leaving the left sidebar's mode when another panel fills it. */
export function showPanel(key: string) {
  const mode = sidebarMode()
  if (mode === key) { setSidebarMode(key); return true }
  if (mode && sideOf(key) === "left") setSidebarMode(null)
  return revealPanel(key)
}
