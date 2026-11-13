import { PanelTopClose, PanelTopOpen } from "lucide-react"
import { commandItems, type MenuItem } from "@vaultite"
import { settings } from "./state"

export const barHidden = () => settings.get().pageBar === "hidden"
export const setBarHidden = (hidden: boolean) => settings.set({ pageBar: hidden ? "hidden" : null })

export const marksBarShown = () => settings.get().bookmarksBar === "shown"
export const setMarksBarShown = (shown: boolean) => settings.set({ bookmarksBar: shown ? "shown" : null })

export const pageBarItem = (sep = false): MenuItem => (barHidden()
  ? { label: "Always show page bar", icon: PanelTopOpen, sep, run: () => void setBarHidden(false) }
  : { label: "Hide page bar", icon: PanelTopClose, sep, run: () => void setBarHidden(true) })

export const barItems = (sep = false): MenuItem[] => {
  const marks = barHidden() ? [] : commandItems("web:bookmarks-bar")
  return [...marks.map((m, i) => (i ? m : { ...m, sep })), pageBarItem(sep && !marks.length)]
}
