import type { KeyboardEvent } from "react"
import { Copy, Globe, Pencil, Timer, Trash2, User } from "lucide-react"
import { commandKeys, type MenuItem } from "@vaultite"
import { isBinned, moveItems, remove } from "./actions"
import { openSite } from "./acting"
import { copyCode, copyPassword, copyText, editEntry, openEntry, state } from "./store"
import type { Row } from "./types"

export const LIST = "passwords"

const hint = (id: string) => commandKeys(`web:password-${id}`) || undefined
export function entryMenu(e: Row, more: MenuItem[] = []): MenuItem[] {
  return [
    ...(e.username ? [{ label: "Copy username", icon: User, hint: hint("username"), run: () => copyText(e.username, "username") }] : []),
    { label: "Copy password", icon: Copy, hint: hint("copy"), run: () => copyPassword(e.id) },
    ...(e.otp ? [{ label: "Copy one-time code", icon: Timer, hint: hint("code"), run: () => copyCode(e.id) }] : []),
    ...(e.urls[0] ? [{ label: "Open website", icon: Globe, hint: hint("open"), run: () => openSite(e.urls[0]) }] : []),
    { label: "Edit", icon: Pencil, sep: true, run: () => editEntry(e.id) },
    ...moveItems([e]),
    ...more,
    { label: isBinned(e) ? "Delete for good…" : "Delete", icon: Trash2, danger: true, sep: true, run: () => remove([e]) },
  ]
}
export const listMenu = (ids: string[]): MenuItem[] => {
  const rows = (state.get().entries ?? []).filter((e) => ids.includes(e.id))
  if (!rows.length) return []
  return [...moveItems(rows), { label: rows.every(isBinned) ? "Delete for good…" : "Delete", icon: Trash2, danger: true, sep: true, run: () => remove(rows) }]
}

export function onSearchKey(e: KeyboardEvent<HTMLElement>, first: Row | undefined) {
  if (!first || !(e.target instanceof HTMLInputElement)) return
  if (e.key === "Enter") { e.preventDefault(); openEntry(first.id) }
  else if (e.key === "ArrowDown") {
    e.preventDefault()
    e.currentTarget.closest("[data-passwords]")?.querySelector<HTMLElement>(`[data-select-list="${LIST}"] [data-keyrow]`)?.focus()
  }
}
