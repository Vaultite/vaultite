export const HEAD = "> [!quote]- Transcript"
const IS_HEAD = /^>\s*\[!quote\][+-]?\s*transcript\b/i

export type Segment = { start: number; end: number; text: string }

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

export const textParagraphs = (text: string) =>
  text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const base = (p: string) => p.split("/").pop()!

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

export function callout(paras: string[]): string[] {
  const body = paras.length ? paras : ["(Nothing was heard.)"]
  return [HEAD, ...body.flatMap((p, i) => (i ? [">", `> ${p}`] : [`> ${p}`]))]
}

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
  let end = at + 1
  if (IS_HEAD.test(lines[end] ?? "")) while (end < lines.length && /^>/.test(lines[end])) end++
  // Markdown reads a line right after a callout as part of it.
  const after = lines[end] !== undefined && lines[end].trim() !== "" ? [""] : []
  lines.splice(at + 1, end - at - 1, ...box, ...after)
  return lines.join(eol)
}
