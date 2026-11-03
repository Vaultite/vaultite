// Moments read back from the text an agent was given (plugin.ts' momentsText): its session's messages are all a chat
// keeps of them, so its timeline and its chat draw them from there. No Node, no DOM.
import type { Hunk } from "./text.ts"

export type Kind = "ask" | "point" | "edit" | "open" | "reply" | "accept" | "reject" | "dismiss"
/** A moment as it reads: `item` the comment or suggestion it answers, `thread` a person's thread it's in. */
export type Read = { kind: Kind; path?: string; line?: number; text?: string; item?: string; thread?: string; selection?: string
  /** An accept's text, as it is now. */
  to?: string
  /** A drawing's changes, then a note's lines changed. */
  changes?: string[]; hunks?: Hunk[]
  /** They went on writing an ask already sent. */
  more?: boolean }
/** A note's lines sent with the moments (`lines`), or a drawing's scene (`scene`). */
export type Lines = { path: string; from: number; to: number; of: number; lines: string[] } | { path: string; scene: string[] }
/** A message of moments: what came before them (the first's "Read ME.md…"), the mode, where the user was, and them. */
export type Message = { before: string; mode: string; focus: { path: string; line?: number } | null; moments: Read[]; notes: Lines[] }

const json = (s: string) => { try { const v = JSON.parse(s); return typeof v === "string" ? v : s } catch { return s } }
/** "Notes/A.md:12" or "Notes/A.md": a path with spaces in it too. */
function place(s: string) {
  const m = /^(.*?):(\d+)$/.exec(s)
  return m ? { path: m[1], line: Number(m[2]) } : s ? { path: s } : {}
}

const HEAD = /^Mode: (\w+)\.(?: The user is in (.+?)(?: at line (\d+)| at -?[\d.]+,-?[\d.]+)\.)?$/
const ASK = /^- ask(?: (.+?))?( \(in their comment thread (\S+), by the line: [^)]*\))?(?: \(in [^)]*\))?( \(they went on writing it: the whole line now\))?: (".*")$/
const REPLY = /^- reply to (\S+)(?: (.+?))?( \(in their comment thread (\S+), by the line: [^)]*\))?: (".*")$/
const POINT = /^- point(?: (.+?))?: they pointed you here/
const ANSWER = /^- (accept|reject|dismiss) (\S+)(?: (.+?))?(?: \(now (".*")\))?$/
const BARE = /^- (edit|open)(?: (.+))?$/
const NOTE = /^(.+), lines (\d+)-(\d+) of (\d+):$/
const SCENE = /^(.+), the drawing \(ids for companion draw, say --find\):$/

/** The moments in a message an agent was sent, or null when it isn't one (a handover ask, its first "get ready"). */
export function readMoments(text: string): Message | null {
  const lines = text.split("\n")
  const h = lines.findIndex((l) => HEAD.test(l))
  if (h < 0) return null
  const head = HEAD.exec(lines[h])!
  const out: Message = { before: lines.slice(0, h).join("\n").trim(), mode: head[1], focus: head[2] ? { path: head[2], ...(head[3] ? { line: Number(head[3]) } : {}) } : null, moments: [], notes: [] }
  let m: Read | undefined, hunk: Hunk | undefined, note: Lines | undefined
  for (const l of lines.slice(h + 1)) {
    let x: RegExpExecArray | null
    if (note && "lines" in note && /^ *\d+ {2}/.test(l)) { note.lines.push(l.replace(/^ *\d+ {2}/, "")); continue }
    if (note && "scene" in note && !NOTE.test(l) && !SCENE.test(l)) { note.scene.push(l); continue }
    if ((x = NOTE.exec(l))) { note = { path: x[1], from: Number(x[2]), to: Number(x[3]), of: Number(x[4]), lines: [] }; out.notes.push(note); m = undefined; continue }
    if ((x = SCENE.exec(l))) { note = { path: x[1], scene: [] }; out.notes.push(note); m = undefined; continue }
    if (m && l.startsWith("  ")) {
      const s = l.slice(2)
      if ((x = /^at line (\d+):$/.exec(s)) && m.kind === "edit") { hunk = { line: Number(x[1]), removed: [], added: [] }; (m.hunks ??= []).push(hunk) }
      else if (hunk && s.startsWith("- ")) hunk.removed.push(s.slice(2))
      else if (hunk && s.startsWith("+ ")) hunk.added.push(s.slice(2))
      else if (s.startsWith("on the selection: ")) m.selection = json(s.slice(18))
      else if (m.kind === "edit" && !hunk) (m.changes ??= []).push(s)
      continue
    }
    hunk = undefined
    if ((x = ASK.exec(l))) m = { kind: "ask", ...place(x[1] ?? ""), ...(x[3] ? { thread: x[3], item: x[3] } : {}), ...(x[4] ? { more: true } : {}), text: json(x[5]) }
    else if ((x = REPLY.exec(l))) m = { kind: "reply", item: x[1], ...place(x[2] ?? ""), ...(x[4] ? { thread: x[4] } : {}), text: json(x[5]) }
    else if ((x = POINT.exec(l))) m = { kind: "point", ...place(x[1] ?? "") }
    else if ((x = BARE.exec(l))) m = { kind: x[1] as Kind, ...place(x[2] ?? "") }
    else if ((x = ANSWER.exec(l))) m = { kind: x[1] as Kind, item: x[2], ...place(x[3] ?? ""), ...(x[4] ? { to: json(x[4]) } : {}) }
    else { m = undefined; continue }
    out.moments.push(m)
  }
  return out
}
