import { showPanel } from "@/core/sidebarmode"

/** Whether `id` (a data-ui id) was brought into sight; false when the app has no way to show it. */
export function revealUi(id: string): boolean {
  const panel = /^panel:(.+)$/.exec(id)?.[1]
  return panel ? showPanel(panel) : false
}
