import { useSyncExternalStore } from "react"

export type ContextChip = { key: string; path: string; line: number; text: string; comment: string }

const chips = new Map<string, ContextChip[]>()
const subs = new Set<() => void>()
const NONE: ContextChip[] = []
const changed = () => { for (const f of subs) f() }

export function addChip(chat: string, c: Omit<ContextChip, "key">) {
  chips.set(chat, [...(chips.get(chat) ?? []), { ...c, key: crypto.randomUUID() }])
  changed()
}
export function dropChip(chat: string, key: string) {
  chips.set(chat, (chips.get(chat) ?? []).filter((c) => c.key !== key))
  changed()
}
export const useChips = (chat: string) =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => chips.get(chat) ?? NONE)

const quoted = (t: string) => t.trim().slice(0, 160).replace(/`/g, "'")
export const chipLine = (c: ContextChip) => `${c.path}:${c.line}${c.text.trim() ? ` (\`${quoted(c.text)}\`)` : ""}: ${c.comment.trim()}`

export function withChips(chat: string, said: string) {
  const cs = chips.get(chat) ?? []
  if (!cs.length) return said
  chips.delete(chat)
  changed()
  return [`About these lines:\n${cs.map((c) => `- ${chipLine(c)}`).join("\n")}`, said].filter(Boolean).join("\n\n")
}
