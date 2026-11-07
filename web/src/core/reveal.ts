// Bring a part of the app's UI into sight by its data-ui id, when it's hidden (a panel in a closed sidebar, a folded one,
// one behind another filling the sidebar): what an agent's press of a place it can't see means.
import { showPanel } from "@/core/sidebarmode"

/** Whether `id` (a data-ui id) was brought into sight; false when the app has no way to show it. */
export function revealUi(id: string): boolean {
  const panel = /^panel:(.+)$/.exec(id)?.[1]
  return panel ? showPanel(panel) : false
}
