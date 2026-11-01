// Kept apart from LiveView.tsx, which loads with the first watched tab: tab titles are read before that.
import { viewsChanged } from "@vaultite"

const titles = new Map<string, string>()
/** A watched tab's title, for its tab ("3@m1"). */
export const liveTitle = (id: string) => titles.get(id)
export function keepTitle(id: string, title: string) {
  if (!title || titles.get(id) === title) return
  titles.set(id, title)
  viewsChanged()
}
