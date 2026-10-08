// Notes helpers shared by the list and the reader: kinds, statuses, previews, dates.
import { BookOpen, FileText, Lightbulb, type LucideIcon } from "lucide-react"
import { dateText, hasTag, iso, plainText, today } from "@vaultite"
import type { Note } from "./types"

export const TINT = "var(--notes)"

/** How a note shows: its kind (idea | note), or Journal for a journal entry (see journalOf). */
export const KINDS: Record<string, { label: string; plural: string; icon: LucideIcon }> = {
  idea: { label: "Idea", plural: "Ideas", icon: Lightbulb },
  note: { label: "Note", plural: "Notes", icon: FileText },
  journal: { label: "Journal", plural: "Journal", icon: BookOpen },
}
export const kindOf = (k?: string | null) => KINDS[k ?? ""] ?? KINDS.note

/** A journal entry: tagged `journal` (frontmatter or inline #journal, any case). */
export const isJournal = (tags: string[]) => hasTag(tags, "journal")
/** How a note shows (its label and icon): Journal for a journal entry, else its kind. */
export const lookOf = (kind: unknown, journal: boolean) => (journal ? KINDS.journal : kindOf(String(kind ?? "") || "note"))

/** Where an idea stands. */
export const STATUS: Record<string, { label: string; color: string }> = {
  seed: { label: "Seed", color: "var(--muted-foreground)" },
  exploring: { label: "Exploring", color: "var(--notes)" },
  parked: { label: "Parked", color: "var(--orange)" },
  done: { label: "Done", color: "var(--green)" },
}

export const tagList = (n: Note) => (n.tags || "").split(",").map((t) => t.trim()).filter(Boolean)

// ---------- dates (the server stores UTC) ----------
export const utc = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`)
const dayDiff = (d: Date) => Math.round((new Date(today()).getTime() - new Date(iso(d)).getTime()) / 864e5)


/** List sections by last edit: Today, Yesterday, Previous 7 days, Previous 30 days, then months. */
export function groupOf(n: Note) {
  const d = utc(n.updated_at), diff = dayDiff(d)
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return "Previous 7 days"
  if (diff < 30) return "Previous 30 days"
  return dateText(d, { month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
}

// ---------- text ----------
export const firstLine = (n: Note) => plainText(n.body).split("\n").map((l) => l.trim()).find(Boolean) ?? ""

/** Text around the first search hit ("…while building the life dashboard…"). */
export function snippet(n: Note, terms: string[]) {
  const text = plainText(n.body).replace(/\s+/g, " ").trim()
  const low = text.toLowerCase()
  const at = Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0))
  if (!Number.isFinite(at) || at < 50) return text.slice(0, 200)
  const from = text.lastIndexOf(" ", at - 30)
  return `…${text.slice(from + 1, from + 200)}`
}

export const matches = (n: Note, terms: string[]) => {
  const hay = `${n.title}\n${plainText(n.body)}\n${n.tags}`.toLowerCase()
  return terms.every((t) => hay.includes(t))
}

