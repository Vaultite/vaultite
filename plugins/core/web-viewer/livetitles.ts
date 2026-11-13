import { viewsChanged } from "@vaultite"

const titles = new Map<string, string>()
export const liveTitle = (id: string) => titles.get(id)
export function keepTitle(id: string, title: string) {
  if (!title || titles.get(id) === title) return
  titles.set(id, title)
  viewsChanged()
}
