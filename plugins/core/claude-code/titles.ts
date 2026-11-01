// Kept apart from ChatTab.tsx, which loads with the first chat tab: tab titles are read before that.
import { viewsChanged } from "@vaultite"

/** A chat tab's arg before its session exists. */
export const NEW = "new"

/** Sessions' titles, for their tabs (viewsChanged redraws them). */
const titles = new Map<string, string>()
export const chatTitle = (id: string, fallback: string) => (!id || id === NEW ? "New chat" : titles.get(id) || fallback)
export function nameTab(id: string, title: string) {
  if (!title || titles.get(id) === title) return
  titles.set(id, title)
  viewsChanged()
}
