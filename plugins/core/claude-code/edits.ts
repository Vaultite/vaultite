// The files a session changed, by the message each change answered (agent-edits:claude): its Edit and Write results,
// which keep the text before and after, so a change can be taken back exactly (the companion's live editing).

/** One file change it made (the companion's unedit.ts takes the same shape): an Edit's strings, or a
 *  Write's whole text (`original` null: it made the file). */
export type FileEdit = { file: string; kind: "edit"; old: string; new: string; all: boolean; original: string | null }
  | { file: string; kind: "write"; content: string; original: string | null }
/** What it was told (`prompt`: a message, or one typed while it worked) or said (`said`: its words between steps), when,
 *  and the changes it made after it till the next. */
export type EditSpan = { prompt?: string; said?: string; at: number; edits: FileEdit[] }

const str = (v: unknown) => (typeof v === "string" ? v : "")
type Line = { type?: string; timestamp?: string; message?: { content?: unknown }; toolUseResult?: unknown; attachment?: { type?: string; prompt?: unknown }; isSidechain?: boolean }

/** What a line says it was told: a message of the user's (not a tool's result), or a message typed while it worked. */
function told(d: Line): string | null {
  if (d.type === "attachment" && d.attachment?.type === "queued_command") return str(d.attachment.prompt) || null
  if (d.type !== "user" || d.toolUseResult !== undefined) return null
  const c = d.message?.content
  if (typeof c === "string") return c
  if (!Array.isArray(c) || c.some((x) => x?.type === "tool_result")) return null
  const text = c.filter((x) => x?.type === "text").map((x) => str(x.text)).join("\n")
  return text || null
}
function editOf(r: unknown): FileEdit | null {
  if (!r || typeof r !== "object") return null
  const x = r as Record<string, unknown>, file = str(x.filePath), original = typeof x.originalFile === "string" ? x.originalFile : null
  if (!file) return null
  if (typeof x.oldString === "string" && typeof x.newString === "string") return { file, kind: "edit", old: x.oldString, new: x.newString, all: x.replaceAll === true, original }
  if ((x.type === "create" || x.type === "update") && typeof x.content === "string") return { file, kind: "write", content: x.content, original: x.type === "create" ? null : original }
  return null
}

/** A transcript's JSONL lines as spans: each message it was told and each of its words between steps, with the file
 *  changes made before the next (asks typed while it works come before it acts on any: its words tell which it's on). */
export function editSpans(lines: string[]): EditSpan[] {
  const spans: EditSpan[] = []
  for (const l of lines) {
    if (!l.includes('"type"')) continue
    let d: Line
    try { d = JSON.parse(l) } catch { continue }
    if (d.isSidechain) continue
    const at = Date.parse(str(d.timestamp)) || 0, p = told(d)
    if (p !== null) { spans.push({ prompt: p, at, edits: [] }); continue }
    if (d.type === "assistant" && Array.isArray(d.message?.content)) {
      for (const c of d.message.content) if (c?.type === "text" && str(c.text).trim()) spans.push({ said: str(c.text), at, edits: [] })
      continue
    }
    const e = d.toolUseResult !== undefined ? editOf(d.toolUseResult) : null
    if (e && spans.length) spans[spans.length - 1].edits.push(e)
  }
  return spans
}
