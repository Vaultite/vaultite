export type DiffLine = { k: "ctx" | "add" | "del"; a?: number; b?: number; text: string }
export type Hunk = { head: string; lines: DiffLine[] }
export type FileDiff = { path: string; from?: string; status: "added" | "deleted" | "renamed" | "modified"; binary?: boolean
  added: number; removed: number; hunks: Hunk[] }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function pathOf(line: string, prefix: string) {
  const p = line.slice(4).replace(/\t.*$/, "")
  if (p === "/dev/null") return ""
  const bare = p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p
  return bare.startsWith(prefix) ? bare.slice(prefix.length) : bare
}

function headPaths(line: string): [string, string] {
  const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line)
  return m ? [m[1], m[2]] : ["", ""]
}

type Reading = { file: FileDiff; hunk: Hunk | null; a: number; b: number }

function headerLine(r: Reading, line: string) {
  const f = r.file
  if (line.startsWith("new file mode")) f.status = "added"
  else if (line.startsWith("deleted file mode")) f.status = "deleted"
  else if (line.startsWith("rename from ")) { f.from = line.slice(12); f.status = "renamed" }
  else if (line.startsWith("rename to ")) f.path = line.slice(10)
  else if (line.startsWith("Binary files ")) f.binary = true
  else if (line.startsWith("--- ")) { const p = pathOf(line, "a/"); if (p && f.status === "renamed") f.from = p }
  else if (line.startsWith("+++ ")) { const p = pathOf(line, "b/"); if (p) f.path = p }
}

function bodyLine(r: Reading, line: string) {
  const h = r.hunk
  if (!h) return
  const c = line[0], text = line.slice(1)
  if (c === "+") { h.lines.push({ k: "add", b: r.b++, text }); r.file.added++ }
  else if (c === "-") { h.lines.push({ k: "del", a: r.a++, text }); r.file.removed++ }
  else if (c === " " || line === "") h.lines.push({ k: "ctx", a: r.a++, b: r.b++, text })
}

export function parseDiff(patch: string): FileDiff[] {
  const files: FileDiff[] = []
  let r: Reading | null = null
  const lines = patch.split("\n")
  if (lines.at(-1) === "") lines.pop()
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const [from, to] = headPaths(line)
      r = { file: { path: to, from: from !== to ? from : undefined, status: "modified", added: 0, removed: 0, hunks: [] }, hunk: null, a: 0, b: 0 }
      files.push(r.file)
      continue
    }
    if (!r) continue
    const m = HUNK.exec(line)
    if (m) { r.hunk = { head: line, lines: [] }; r.file.hunks.push(r.hunk); r.a = Number(m[1]); r.b = Number(m[2]); continue }
    if (r.hunk) { if (!line.startsWith("\\")) bodyLine(r, line) } else headerLine(r, line)
  }
  return files
}

export type SplitRow = { left: DiffLine | null; right: DiffLine | null }
export function splitRows(h: Hunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: DiffLine[] = [], adds: DiffLine[] = []
  const flush = () => {
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) rows.push({ left: dels[n] ?? null, right: adds[n] ?? null })
    dels = []; adds = []
  }
  for (const l of h.lines) {
    if (l.k === "del") { if (adds.length) flush(); dels.push(l) }
    else if (l.k === "add") adds.push(l)
    else { flush(); rows.push({ left: l, right: l }) }
  }
  flush()
  return rows
}
