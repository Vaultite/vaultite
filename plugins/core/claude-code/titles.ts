import { viewsChanged } from "@vaultite"

export const NEW = "new"

const titles = new Map<string, string>()
export const chatTitle = (id: string, fallback: string) => (!id || id === NEW ? "New chat" : titles.get(id) || fallback)
export function nameTab(id: string, title: string) {
  if (!title || titles.get(id) === title) return
  titles.set(id, title)
  viewsChanged()
}
