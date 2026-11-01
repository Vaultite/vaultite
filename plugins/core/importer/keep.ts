// Google Keep's export (Takeout: a JSON file per note in Keep/, attachments beside them): a note's text, its checklist
// as tasks, its links, labels as tags, dates and archived kept; a trashed note is left out.

export type KeepNote = {
  title: string; body: string; tags: string[]; created: number | null; updated: number | null
  archived: boolean; trashed: boolean; attachments: { path: string; mime: string }[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const usec = (v: unknown) => (typeof v === "number" && v > 0 ? Math.floor(v / 1000) : null)

/** A note's JSON as a note, or null when it isn't one of Keep's. */
export function readKeep(v: unknown): KeepNote | null {
  if (!isObj(v) || (typeof v.textContent !== "string" && !Array.isArray(v.listContent))) return null
  const text = typeof v.textContent === "string" ? v.textContent.replace(/\r\n?/g, "\n").trim() : ""
  const list = (Array.isArray(v.listContent) ? v.listContent : []).filter(isObj)
    .map((i) => `- [${i.isChecked ? "x" : " "}] ${String(i.text ?? "").replace(/\s*\n\s*/g, " ").trim()}`)
  const links = (Array.isArray(v.annotations) ? v.annotations : []).filter(isObj).filter((a) => typeof a.url === "string" && a.url)
    .map((a) => `[${String(a.title || a.url).replace(/[[\]]/g, "")}](${a.url})`)
  const first = (text.split("\n")[0] ?? "").trim()
  const title = String(v.title ?? "").trim() || (first.length <= 60 ? first : `${first.slice(0, 57).trimEnd()}…`) || "Untitled"
  return {
    title, body: [text, list.join("\n"), links.join("\n")].filter(Boolean).join("\n\n"),
    tags: (Array.isArray(v.labels) ? v.labels : []).filter(isObj).map((l) => String(l.name ?? "").trim()).filter(Boolean),
    created: usec(v.createdTimestampUsec), updated: usec(v.userEditedTimestampUsec),
    archived: v.isArchived === true, trashed: v.isTrashed === true,
    attachments: (Array.isArray(v.attachments) ? v.attachments : []).filter(isObj).filter((a) => typeof a.filePath === "string" && a.filePath)
      .map((a) => ({ path: String(a.filePath), mime: String(a.mimetype ?? "") })),
  }
}
