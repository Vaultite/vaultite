// Phones' tabs, the helpers the bar (components/PhoneBar.tsx) and the tab list (components/TabSwitcher.tsx) share.
import { folderOf } from "@/core/files"
import { activeTab, selectTab } from "@/core/workspace"
import { openNewTab, opensSwitcher } from "@/core/launcher"
import { zoomIn, zoomNew, zoomOut } from "@/core/motion"
import { afterSheets, closeDetail, replaceHash, route } from "@/core/nav"
import { isPage } from "@/core/pages"
import { shootTab, shotOf } from "@/core/tabShots"

/** Open the tab list without a history entry of its own (closing tabs in it would leave one pointing at a gone tab):
 *  it replaces the address, and closing replaces it back with whatever tab is active then. */
export async function openSwitcher(from?: { page: DOMRect; reset: () => void }) {
  // A picture of the tab for its card (the iPhone app: core/tabShots.ts, started as the bar was pressed), then the page
  // shrinks into it (core/motion.ts). From a finger dragging the bar up: the page shrinks on from where it left it.
  if (!from) await shootTab()
  zoomOut(() => {
    replaceHash(`${route().tab}/tabs`, { sheet: 0 })
  }, () => activeTab().id, from?.page, from?.reset)
}

/** Close the tab list (its Done): the tab on screen grows back out of its card. */
export function closeSwitcher() {
  if (route().detail !== "tabs") return closeDetail()
  zoomIn(activeTab().id, closeDetail)
}

/** Show a tab picked in the tab list: its card grows into the page. */
export function pickTab(id: string) {
  zoomIn(id, () => afterSheets(() => selectTab(id)))
}

/** A new tab (the bar's +, the tab list's: in tab group `set` when one is open), grown out of the button pressed. */
export async function newPhoneTab(button: Element | null, set?: string) {
  // (the switcher picks what it shows: nothing to grow till then)
  if (opensSwitcher()) return afterSheets(() => openNewTab(undefined, set))
  await shootTab()
  const t = activeTab()
  zoomNew(button, () => afterSheets(() => openNewTab(undefined, set)), shotOf(t.id, t.to))
}

/** The line under a tab's name in the switcher: where the file is, or what kind of tab it is. */
export function tabMeta(to: string) {
  if (to === "new") return "Empty"
  if (to.startsWith("file:/")) return "Outside the vault"
  if (to.startsWith("file:")) {
    const p = to.slice(5)
    return isPage(p) ? "Page" : folderOf(p).split("/").filter(Boolean).join(" / ") || "Vault"
  }
  if (to.startsWith("view:")) return "Plugin view"
  return "App"
}
