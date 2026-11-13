export type Hunk = { line: number; added: string[]; removed: string[] }

export function nearest(text: string, find: string, line?: number) {
  if (!find) return -1
  let best = -1, bestD = Infinity
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) {
    const d = line ? Math.abs(text.slice(0, i).split("\n").length - line) : 0
    if (d < bestD) { best = i; bestD = d }
    if (!line) break
  }
  return best
}

// Yjs turns each half of a split surrogate pair into U+FFFD.
export function span(a: string, b: string): [number, number] {
  const low = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff }
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  if (head > 0 && (low(a, head) || low(b, head))) head--
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  if (tail > 0 && (low(a, a.length - tail) || low(b, b.length - tail))) tail--
  return [head, tail]
}

export type Change = { id: string; find: string; text: string; line: number; intent?: string; stale?: boolean }

export const changeAt = (text: string, c: Pick<Change, "find" | "line">) => (c.find ? nearest(text, c.find, c.line) : text ? -1 : 0)

export function privateOf(list: unknown) {
  const out: { folders: string[]; sites: string[]; containers: string[]; apps: string[] } = { folders: [], sites: [], containers: [], apps: [] }
  for (const l of Array.isArray(list) ? list.map(String) : []) {
    const m = /^\s*(site|container|app):\s*(.+?)\s*$/i.exec(l)
    if (!m) { if (l.trim()) out.folders.push(l.trim()); continue }
    const kind = m[1].toLowerCase()
    ;(kind === "site" ? out.sites : kind === "container" ? out.containers : out.apps).push(m[2])
  }
  return out
}

export function isPrivate(path: string, text: string, list: string[]) {
  const folders = privateOf(list).folders
  if (folders.some((f) => { const d = f.trim().replace(/^\/+|\/+$/g, ""); return !!d && (path === d || path.startsWith(`${d}/`)) })) return true
  const fm = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(text)?.[1]
  return !!fm && /^companion:\s*["']?private["']?\s*$/m.test(fm)
}
