// Notes helpers shared by the list and the reader: kinds.
import { BookOpen, FileText, Lightbulb, type LucideIcon } from "lucide-react"

/** How a note shows: its kind (idea | note), or Journal for a journal entry (see journalOf). */
export const KINDS: Record<string, { label: string; plural: string; icon: LucideIcon }> = {
  idea: { label: "Idea", plural: "Ideas", icon: Lightbulb },
  note: { label: "Note", plural: "Notes", icon: FileText },
  journal: { label: "Journal", plural: "Journal", icon: BookOpen },
}
export const kindOf = (k?: string | null) => KINDS[k ?? ""] ?? KINDS.note

/** How a note shows (its label and icon): Journal for a journal entry, else its kind. */
export const lookOf = (kind: unknown, journal: boolean) => (journal ? KINDS.journal : kindOf(String(kind ?? "") || "note"))
