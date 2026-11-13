import { PanelTopClose, PanelTopOpen } from "lucide-react"
import { commandItems, type MenuItem } from "@vaultite"
import { settings } from "./state"

export const barHidden = () => settings.get().pageBar === "hidden"
export const setBarHidden = (hidden: boolean) => settings.set({ pageBar: hidden ? "hidden" : null })

export const marksBarShown = () => settings.get().bookmarksBar === "shown"
export const setMarksBarShown = (shown: boolean) => settings.set({ bookmarksBar: shown ? "shown" : null })

/** Hide page bar, or Always show page bar: the bar's menus, the pane's top's and the palette's. */
export const pageBarItem = (sep = false): MenuItem => (barHidden()
  ? { label: "Always show page bar", icon: PanelTopOpen, sep, run: () => void setBarHidden(false) }
  : { label: "Hide page bar", icon: PanelTopClose, sep, run: () => void setBarHidden(true) })

/** The bars' switches, last in every menu that has them: Always show bookmarks bar (a check, ⇧⌘B; not while the page
 *  bar's hidden, which takes it along), then the page bar's. */
export const barItems = (sep = false): MenuItem[] => {
  const marks = barHidden() ? [] : commandItems("web:bookmarks-bar")
  return [...marks.map((m, i) => (i ? m : { ...m, sep })), pageBarItem(sep && !marks.length)]
}
