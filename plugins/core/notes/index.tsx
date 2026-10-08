// Notes: what a note is (kind, status, id and dates filled by the server) and its kind and status above the title.
// Notes themselves are core: every Markdown file is one.
import { NotebookText } from "lucide-react"
import { definePlugin, detailPath, plainText } from "@vaultite"
import { lookOf } from "./format"
import { NoteKicker, NotePreview } from "./NoteHeader"
import { mockNotes } from "./mock"

export default definePlugin({
  icon: NotebookText,
  mock: mockNotes,
  // Old #…/note/<id> addresses and links open the file.
  details: {
    note: {
      render: () => null,
      title: (s, [id]) => { const n = s.notes.find((x) => x.id === id); return n ? n.title || "Untitled" : "" },
      file: (s, [id]) => (s.notes.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  files: {
    types: ["note"], folders: ["Notes"], icon: NotebookText, tint: "var(--notes)",
    kicker: (ctx) => <NoteKicker {...ctx} />,
  },
  search: (s) => s.notes.map((n) => {
    const body = plainText(n.body).replace(/\s+/g, " ").trim()
    return {
      id: `note-${n.id}`, title: n.title || "Untitled", meta: body.slice(0, 120), kind: lookOf(n.kind, n.journal).label, icon: lookOf(n.kind, n.journal).icon,
      tint: "var(--notes)", detail: detailPath("note", n.id), file: `${n.id}.md`, text: `${n.tags} ${body}`,
      recent: Date.parse(`${n.updated_at.replace(" ", "T")}Z`) || 0, weight: 8,
    }
  }),
  preview: () => <NotePreview />,
})
