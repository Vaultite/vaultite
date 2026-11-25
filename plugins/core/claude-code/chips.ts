import { useSyncExternalStore } from "react"

export type LineChip = { kind?: "line"; key: string; path: string; line: number; text: string; comment: string }
export type PageChip = { kind: "page"; key: string; url: string; title: string; comment?: string }
export type ContextChip = LineChip | PageChip

const chips = new Map<string, ContextChip[]>()
const subs = new Set<() => void>()
const NONE: ContextChip[] = []
const changed = () => { for (const f of subs) f() }

export function addChip(chat: string, c: Omit<LineChip, "key">) {
  chips.set(chat, [...(chips.get(chat) ?? []), { ...c, key: crypto.randomUUID() }])
  changed()
}
export function addPageChip(chat: string, c: Omit<PageChip, "key" | "kind">) {
  chips.set(chat, [...(chips.get(chat) ?? []), { ...c, kind: "page", key: crypto.randomUUID() }])
  changed()
}
export function dropChip(chat: string, key: string) {
  chips.set(chat, (chips.get(chat) ?? []).filter((c) => c.key !== key))
  changed()
}
export const useChips = (chat: string) =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => chips.get(chat) ?? NONE)

const quoted = (t: string) => t.trim().slice(0, 160).replace(/`/g, "'")
export const chipLine = (c: LineChip) => `${c.path}:${c.line}${c.text.trim() ? ` (\`${quoted(c.text)}\`)` : ""}: ${c.comment.trim()}`
export const pageChipLine = (c: PageChip) => `${c.title ? `${c.title} (${c.url})` : c.url}${c.comment?.trim() ? `: ${c.comment.trim()}` : ""}`

export function withChips(chat: string, said: string) {
  const cs = chips.get(chat) ?? []
  if (!cs.length) return said
  chips.delete(chat)
  changed()
  const lines = cs.filter((c): c is LineChip => c.kind !== "page")
  const pages = cs.filter((c): c is PageChip => c.kind === "page")
  return [
    lines.length ? `About these lines:\n${lines.map((c) => `- ${chipLine(c)}`).join("\n")}` : "",
    pages.length ? `About these pages:\n${pages.map((c) => `- ${pageChipLine(c)}`).join("\n")}` : "",
    said,
  ].filter(Boolean).join("\n\n")
}
