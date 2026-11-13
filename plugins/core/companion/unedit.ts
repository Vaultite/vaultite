export type FileEdit = { file: string; kind: "edit"; old: string; new: string; all: boolean; original: string | null }
  | { file: string; kind: "write"; content: string; original: string | null }

export type Undone = { ok: true; files: Map<string, string | null> } | { ok: false; file: string; why: string }

function nearest(text: string, s: string, near: number) {
  let best = -1
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i
  return best
}

export function unedit(edits: FileEdit[], read: (file: string) => string | null): Undone {
  const files = new Map<string, string | null>()
  const now = (f: string) => (files.has(f) ? files.get(f)! : read(f))
  for (const e of [...edits].reverse()) {
    const text = now(e.file)
    if (e.kind === "write") {
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
    const was = e.original?.indexOf(e.old) ?? -1
    if (!e.new) {
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
