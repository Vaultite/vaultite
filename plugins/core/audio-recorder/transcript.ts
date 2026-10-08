// A transcript as a folded `> [!quote]- Transcript` callout right under the recording's embed, written as a small
// edit. Pure text, so the server's job and the tests share it.

/** The callout's first line (what a transcript already there is found by, to be replaced, not doubled). */
export const HEAD = "> [!quote]- Transcript"
const IS_HEAD = /^>\s*\[!quote\][+-]?\s*transcript\b/i

export type Segment = { start: number; end: number; text: string }

/** Whisper's segments as paragraphs: a new one after a pause (2 s or more), or at a sentence's end once one runs long. */
export function paragraphs(segments: Segment[]): string[] {
  const out: string[] = []
  let cur = "", last = -1
  for (const s of segments) {
    const t = s.text.trim()
    if (!t) continue
    const pause = last >= 0 && s.start - last >= 2
    const long = cur.length > 600 && /[.!?]["')]?$/.test(cur)
    if (cur && (pause || long)) { out.push(cur); cur = "" }
    cur = cur ? `${cur} ${t}` : t
    last = s.end
  }
  if (cur) out.push(cur)
  return out
}

/** Plain text (a transcriber's output) as paragraphs: blank lines split them, other line breaks are spaces. */
export const textParagraphs = (text: string) =>
  text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const base = (p: string) => p.split("/").pop()!

/** Whether a line embeds the file at vault path `audio`: `![[name]]` (or its path, `|...` after it), or `![](path)`. */
export function embedsAudio(line: string, audio: string): boolean {
  const name = base(audio).toLowerCase(), full = audio.toLowerCase()
  for (const m of line.matchAll(/!\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)) {
    const t = m[1].trim().toLowerCase()
    if (t === name || t === full || full.endsWith(`/${t}`)) return true
  }
  for (const m of line.matchAll(/!\[[^\]\n]*\]\(<?([^)>\n]+)>?\)/g)) {
    const t = decode(m[1].trim()).replace(/^\.?\//, "").toLowerCase()
    if (t === full || t === name || full.endsWith(`/${t}`)) return true
  }
  return false
}

/** The callout's lines for these paragraphs (one that says so when nothing was heard). */
export function callout(paras: string[]): string[] {
  const body = paras.length ? paras : ["(Nothing was heard.)"]
  return [HEAD, ...body.flatMap((p, i) => (i ? [">", `> ${p}`] : [`> ${p}`]))]
}

/** The note's text with the transcript under the recording's embed (a transcript already there replaced); the embed
 *  and the transcript at the end when the note doesn't embed it. Line endings are kept. */
export function withTranscript(text: string, audio: string, paras: string[]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = text.split(/\r?\n/)
  const box = callout(paras)
  let at = lines.findIndex((l) => embedsAudio(l, audio))
  if (at < 0) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop()
    if (lines.length) lines.push("")
    lines.push(`![[${base(audio)}]]`)
    at = lines.length - 1
    lines.push("")
  }
  // A transcript already under it: replaced (its lines run while they're quoted).
  let end = at + 1
  if (IS_HEAD.test(lines[end] ?? "")) while (end < lines.length && /^>/.test(lines[end])) end++
  // A line right after a callout would be read as part of it: a blank line between them.
  const after = lines[end] !== undefined && lines[end].trim() !== "" ? [""] : []
  lines.splice(at + 1, end - at - 1, ...box, ...after)
  return lines.join(eol)
}
