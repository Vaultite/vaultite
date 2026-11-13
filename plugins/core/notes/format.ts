import { BookOpen, FileText, Lightbulb, type LucideIcon } from "lucide-react"

export const KINDS: Record<string, { label: string; plural: string; icon: LucideIcon }> = {
  idea: { label: "Idea", plural: "Ideas", icon: Lightbulb },
  note: { label: "Note", plural: "Notes", icon: FileText },
  journal: { label: "Journal", plural: "Journal", icon: BookOpen },
}
export const kindOf = (k?: string | null) => KINDS[k ?? ""] ?? KINDS.note

export const lookOf = (kind: unknown, journal: boolean) => (journal ? KINDS.journal : kindOf(String(kind ?? "") || "note"))
