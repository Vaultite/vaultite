import { NotebookText } from "lucide-react"
import { definePlugin, detailPath, plainText, stampMs } from "@vaultite"
import { lookOf } from "./format"
import { NotePreview } from "./NotePreview"
import { mockNotes } from "./mock"

export default definePlugin({
  mock: mockNotes,
  details: {
    note: {
      render: () => null,
      title: (s, [id]) => { const n = s.notes.find((x) => x.id === id); return n ? n.title || "Untitled" : "" },
      file: (s, [id]) => (s.notes.some((x) => x.id === id) ? `${id}.md` : null),
    },
  },
  files: {
    types: ["note"], folders: ["Notes"], icon: NotebookText, tint: "var(--notes)",
  },
  search: (s) => s.notes.map((n) => {
    const body = plainText(n.body).replace(/\s+/g, " ").trim()
    return {
      id: `note-${n.id}`, title: n.title || "Untitled", meta: body.slice(0, 120), kind: lookOf(n.kind, n.journal).label, icon: lookOf(n.kind, n.journal).icon,
      tint: "var(--notes)", detail: detailPath("note", n.id), file: `${n.id}.md`, text: `${n.tags} ${body}`,
      recent: stampMs(n.updated_at) || 0, weight: 8,
    }
  }),
  preview: () => <NotePreview />,
})
