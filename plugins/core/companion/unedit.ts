// Taking a worker's changes back (live editing's "undo that"): its own edits reversed, latest first, on the files as
// they are now, so the user's edits and other asks' stay. Nothing is written unless every one reverses cleanly.

/** A file change a worker made, as its harness's agent-edits service gives it (claude-code's edits.ts). */
export type FileEdit = { file: string; kind: "edit"; old: string; new: string; all: boolean; original: string | null }
  | { file: string; kind: "write"; content: string; original: string | null }

/** What undoing comes to: each file's text after (null: removed), or why it can't (the file, in plain words). */
export type Undone = { ok: true; files: Map<string, string | null> } | { ok: false; file: string; why: string }

/** The index of `s` in `text` nearest `near`, or -1. */
function nearest(text: string, s: string, near: number) {
  let best = -1
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i
  return best
}

/** `edits` (in the order made) reversed on the files now (`read`: a file's text, null when it's gone). */
export function unedit(edits: FileEdit[], read: (file: string) => string | null): Undone {
  const files = new Map<string, string | null>()
  const now = (f: string) => (files.has(f) ? files.get(f)! : read(f))
  for (const e of [...edits].reverse()) {
    const text = now(e.file)
    if (e.kind === "write") {
      // (a whole file written: back to what it was only while it still says what was written)
      if (text !== e.content) return { ok: false, file: e.file, why: text === null ? "it's gone" : "it changed since" }
      files.set(e.file, e.original)
      continue
    }
    if (text === null) return { ok: false, file: e.file, why: "it's gone" }
    if (e.all) {
      if (!e.new || !text.includes(e.new)) return { ok: false, file: e.file, why: "what it wrote there changed since" }
      files.set(e.file, text.split(e.new).join(e.old))
      continue
    }
    // (the occurrence nearest where it was made: the same words may be elsewhere in the file too)
    const was = e.original?.indexOf(e.old) ?? -1
    if (!e.new) {
      // (a cut: put back between the words that were on either side of it)
      const before = e.original && was >= 0 ? e.original.slice(Math.max(0, was - 80), was) : "", after = e.original && was >= 0 ? e.original.slice(was + e.old.length, was + e.old.length + 80) : ""
      const at = before || after ? nearest(text, before + after, was) : -1
      if (at < 0) return { ok: false, file: e.file, why: "the lines around what it cut changed since" }
      files.set(e.file, text.slice(0, at + before.length) + e.old + text.slice(at + before.length))
      continue
    }
    const at = nearest(text, e.new, was < 0 ? 0 : was)
    if (at < 0) return { ok: false, file: e.file, why: "what it wrote there changed since" }
    files.set(e.file, text.slice(0, at) + e.old + text.slice(at + e.new.length))
  }
  return { ok: true, files }
}
